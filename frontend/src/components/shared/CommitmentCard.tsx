import { useState } from "react";
import type { Suggestion } from "../../types";
import { api } from "../../api/client";

interface CommitmentCardProps {
  suggestion: Suggestion;
  onCommit: () => void;
  onSkip: () => void;
}

export default function CommitmentCard({ suggestion, onCommit, onSkip }: CommitmentCardProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.title);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleCommit = async () => {
    setSaving(true);
    try {
      // Add as a constraint to tomorrow's plan
      await api.updateTomorrow({
        constraints: [{
          rule: "REVIEW.COMMITMENT",
          title: text,
          description: suggestion.detail,
          locked: false,
        }],
      } as any);
      setDone(true);
      onCommit();
    } catch {
      /* ignore — still mark done locally */
      setDone(true);
      onCommit();
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="commitment-card commitment-card--done">
        <span className="commitment-done-icon">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8l4 4 6-7" />
          </svg>
        </span>
        <span className="commitment-done-text">Added to tomorrow's plan</span>
      </div>
    );
  }

  return (
    <div className="commitment-card">
      <div className="commitment-eyebrow">Tomorrow, commit to:</div>

      <div className="commitment-text-row">
        {editing ? (
          <input
            className="commitment-input"
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={e => {
              if (e.key === "Enter") setEditing(false);
              if (e.key === "Escape") { setText(suggestion.title); setEditing(false); }
            }}
          />
        ) : (
          <>
            <span className="commitment-text" onClick={() => setEditing(true)}>
              "{text}"
            </span>
            <button className="commitment-edit-btn" onClick={() => setEditing(true)} title="Edit commitment">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 2l3 3-8 8H3v-3l8-8z" />
              </svg>
            </button>
          </>
        )}
      </div>

      <p className="commitment-why">{suggestion.detail}</p>

      {suggestion.metric && (
        <p className="commitment-metric">Measure: {suggestion.metric}</p>
      )}

      <div className="commitment-actions">
        <button className="commitment-btn commitment-btn--primary" onClick={handleCommit} disabled={saving}>
          {saving ? "Adding…" : "Add to tomorrow's plan"}
        </button>
        <button className="commitment-btn commitment-btn--ghost" onClick={onSkip}>
          Not today
        </button>
      </div>
    </div>
  );
}
