import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../store/app-store'

export default function CaptureMode() {
  const { captures, addCapture } = useAppStore()
  const [draft, setDraft] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => ref.current?.focus(), 100)
  }, [])

  const submit = () => {
    if (!draft.trim()) return
    addCapture({
      id: Math.random().toString(36).slice(2),
      text: draft.trim(),
      created_at: new Date().toISOString(),
    })
    setDraft('')
  }

  return (
    <div className="capture">
      <div className="capture-inner">
        <div className="capture-eye">Capture · no thinking required</div>
        <input
          ref={ref}
          className="capture-input"
          placeholder="what's on your mind…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
        <div className="capture-hint">
          <kbd>↵</kbd> to capture &nbsp; <kbd>esc</kbd> to leave
        </div>
        <div className="capture-recent">
          {captures.slice(0, 5).map((c, i) => (
            <div key={c.id} className={`capture-recent-row ${i === 0 ? 'fresh' : ''}`}>
              {c.text}
              <span className="age">· {i === 0 ? 'just now' : `${i * 2}h ago`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
