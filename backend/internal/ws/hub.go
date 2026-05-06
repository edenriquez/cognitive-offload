package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	closed bool
}

type Hub struct {
	mu         sync.Mutex
	clients    map[*client]bool
	register   chan *client
	unregister chan *client
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*client]bool),
		register:   make(chan *client, 16),
		unregister: make(chan *client, 16),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			total := len(h.clients)
			h.mu.Unlock()
			slog.Info("ws client connected", "total", total)

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				if !c.closed {
					c.closed = true
					close(c.send)
				}
			}
			total := len(h.clients)
			h.mu.Unlock()
			slog.Debug("ws client disconnected", "total", total)
		}
	}
}

func (h *Hub) Broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		slog.Error("ws broadcast marshal", "error", err)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	var stale []*client
	for c := range h.clients {
		if c.closed {
			stale = append(stale, c)
			continue
		}
		select {
		case c.send <- data:
		default:
			// slow client — mark for removal, don't close in-loop
			stale = append(stale, c)
		}
	}

	// Clean up stale clients outside the iteration
	for _, c := range stale {
		delete(h.clients, c)
		if !c.closed {
			c.closed = true
			close(c.send)
		}
	}
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err)
		return
	}

	// Configure connection
	conn.SetReadLimit(512)
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	c := &client{hub: h, conn: conn, send: make(chan []byte, 64)}
	h.register <- c

	// Writer goroutine — sends messages + pings
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer func() {
			ticker.Stop()
			conn.Close()
		}()

		for {
			select {
			case msg, ok := <-c.send:
				if !ok {
					// Channel closed — send close frame and exit
					conn.WriteMessage(websocket.CloseMessage, []byte{})
					return
				}
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			case <-ticker.C:
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}
	}()

	// Reader goroutine — detects disconnect
	go func() {
		defer func() { h.unregister <- c }()
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}
