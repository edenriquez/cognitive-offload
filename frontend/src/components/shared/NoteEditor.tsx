import { useState, useEffect, useRef, useCallback } from "react";
import { marked } from "marked";
import { api } from "../../api/client";

// Configure marked — minimal, safe
marked.setOptions({ gfm: true, breaks: true });

interface NoteEditorProps {
  taskId: string;
}

export default function NoteEditor({ taskId }: NoteEditorProps) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load note when task changes
  useEffect(() => {
    setLoading(true);
    setEditing(false);
    api
      .getTaskNote(taskId)
      .then((n) => setContent(n.content ?? ""))
      .catch(() => setContent(""))
      .finally(() => setLoading(false));
  }, [taskId]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (editing) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [editing]);

  // Debounced save — 800ms after last keystroke
  const scheduleSave = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await api.upsertTaskNote(taskId, value);
        } catch { /* ignore */ } finally {
          setSaving(false);
        }
      }, 800);
    },
    [taskId],
  );

  // Save immediately on blur
  const handleBlur = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (content !== "") {
      setSaving(true);
      try { await api.upsertTaskNote(taskId, content); }
      catch { /* ignore */ } finally { setSaving(false); }
    }
    setEditing(false);
  }, [taskId, content]);

  const handleChange = (val: string) => {
    setContent(val);
    scheduleSave(val);
  };

  const previewHtml = content
    ? (marked.parse(content) as string)
    : "";

  if (loading) {
    return <div className="note-editor note-editor--loading">Loading…</div>;
  }

  return (
    <div className="note-editor">
      {/* Status row */}
      <div className="note-editor-bar">
        <span className="note-editor-label">Notes</span>
        <span className="note-editor-status">
          {saving ? (
            <span className="note-saving">saving…</span>
          ) : editing ? (
            <span className="note-hint">markdown · esc to preview</span>
          ) : (
            content && <span className="note-hint">click to edit</span>
          )}
        </span>
        {editing ? (
          <button
            className="note-mode-btn"
            onClick={() => setEditing(false)}
            title="Preview"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          </button>
        ) : (
          <button
            className="note-mode-btn"
            onClick={() => setEditing(true)}
            title="Edit"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 2l3 3-8 8H3v-3l8-8z" />
            </svg>
          </button>
        )}
      </div>

      {/* Edit mode — plain textarea */}
      {editing ? (
        <textarea
          ref={textareaRef}
          className="note-textarea"
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); handleBlur(); }
          }}
          placeholder={
            "Add notes in markdown…\n\n# Heading\n**bold** _italic_\n- list item\n`code`"
          }
          spellCheck={false}
        />
      ) : (
        /* Preview mode */
        <div
          className={`note-preview${!content ? " note-preview--empty" : ""}`}
          onClick={() => setEditing(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEditing(true); }}
        >
          {content ? (
            <div
              className="note-md"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <span className="note-empty-hint">No notes yet — click to add</span>
          )}
        </div>
      )}
    </div>
  );
}
