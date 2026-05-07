import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:9200",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:9200",
        ws: true,
        configure: (proxy) => {
          proxy.on("error", () => {
            // Silence EPIPE errors when backend restarts
          });
          proxy.on("proxyReqWs", (_proxyReq, _req, socket) => {
            socket.on("error", () => {
              // Silence socket errors on disconnect
            });
          });
        },
      },
    },
  },
});
