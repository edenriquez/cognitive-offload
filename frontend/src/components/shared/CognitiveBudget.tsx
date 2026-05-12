import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { TaskEstimate, Task } from "../../types";

interface Props {
  task?: Task;
  taskText?: string;
  onSplitApply?: (splits: { text: string; kind: string }[]) => void;
  onDismiss?: () => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  scope: "Scope",
  novelty: "Novelty",
  dependencies: "Dependencies",
  ambiguity: "Ambiguity",
  prior_work: "Prior Work",
  error_risk: "Error Risk",
  cognitive_switch: "Context Switch",
};

function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function complexityClass(c: string): string {
  if (c === "trivial" || c === "low") return "low";
  if (c === "high" || c === "extreme") return "high";
  return "med";
}

export default function CognitiveBudget({
  task,
  taskText,
  onSplitApply,
  onDismiss,
}: Props) {
  const [estimate, setEstimate] = useState<TaskEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);

  const textToEstimate = task?.text || taskText;

  const runEstimate = async () => {
    if (!textToEstimate) return;
    setLoading(true);
    setError(null);
    try {
      const result = task?.id
        ? await api.estimateTask(task.id)
        : await api.estimateNewTask(textToEstimate);
      setEstimate(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Estimation failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (textToEstimate && !estimate && !loading) {
      runEstimate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textToEstimate]);

  if (!textToEstimate) return null;

  if (loading) {
    return (
      <div className="cb-card">
        <div className="cb-head">
          <span className="cb-head-label">Estimating cognitive budget…</span>
        </div>
        <div className="cb-loading-track">
          <div className="cb-loading-fill" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cb-card">
        <div className="cb-head">
          <span className="cb-head-label">Estimation unavailable</span>
          {onDismiss && (
            <button className="cb-dismiss" onClick={onDismiss}>
              ×
            </button>
          )}
        </div>
        <div className="cb-error">{error}</div>
        <button className="btn-secondary cb-action-sm" onClick={runEstimate}>
          Retry
        </button>
      </div>
    );
  }

  if (!estimate) return null;

  const cClass = complexityClass(estimate.complexity);
  const matrixEntries = estimate.matrix
    ? Object.entries(estimate.matrix).filter(([key]) => DIMENSION_LABELS[key])
    : [];

  return (
    <div className={`cb-card cb-${cClass}`}>
      {/* Header */}
      <div className="cb-head">
        <span className="cb-head-label">Cognitive Budget</span>
        <span className={`cb-source ${estimate.source}`}>
          {estimate.source === "llm" ? "AI" : "heuristic"}
        </span>
        {onDismiss && (
          <button className="cb-dismiss" onClick={onDismiss}>
            ×
          </button>
        )}
      </div>

      {/* Main estimate row */}
      <div className="cb-estimate">
        <div className="cb-time">
          <span className="cb-time-value">
            {formatTime(estimate.estimated_min)}
          </span>
          <span className="cb-time-label">estimated</span>
        </div>

        <div className="cb-detail">
          <span className={`cb-complexity ${cClass}`}>
            {estimate.complexity}
          </span>
          <div className="cb-load-track">
            <div
              className={`cb-load-fill ${cClass}`}
              style={{ width: `${estimate.cognitive_load}%` }}
            />
          </div>
          <span className="cb-load-label">
            cognitive load {estimate.cognitive_load}%{" "}
            <span className="cb-confidence">
              · {estimate.confidence}% confidence
            </span>
          </span>
        </div>
      </div>

      {/* Split warning */}
      {estimate.should_split && (
        <div className="cb-split">
          <div className="cb-split-head">
            <b>{formatTime(estimate.estimated_min)}</b> exceeds a 90m focus
            block — splitting into {estimate.suggested_splits?.length || 2}{" "}
            tasks to ensure it can be accomplished.
          </div>

          {estimate.suggested_splits &&
            estimate.suggested_splits.length > 0 && (
              <div className="cb-split-list">
                {estimate.suggested_splits.map((split, i) => (
                  <div key={i} className="cb-split-item">
                    <span className="cb-split-num">{split.order}</span>
                    <span className="cb-split-text">{split.text}</span>
                    <span className="cb-split-time">
                      {formatTime(split.estimated_min)}
                    </span>
                  </div>
                ))}
              </div>
            )}

          {onSplitApply && estimate.suggested_splits && (
            <button
              className="btn-primary cb-split-apply"
              onClick={() =>
                onSplitApply(
                  estimate.suggested_splits!.map((s) => ({
                    text: s.text,
                    kind: s.kind,
                  })),
                )
              }
            >
              Apply splits → create {estimate.suggested_splits.length} tasks
            </button>
          )}
        </div>
      )}

      {/* Reasoning */}
      {estimate.reasoning && (
        <div className="cb-reasoning">{estimate.reasoning}</div>
      )}

      {/* Matrix */}
      {matrixEntries.length > 0 && (
        <div className="cb-matrix-section">
          <button
            className="cb-matrix-toggle"
            onClick={() => setShowMatrix(!showMatrix)}
          >
            {showMatrix ? "Hide" : "Show"} complexity matrix
          </button>

          {showMatrix && (
            <div className="cb-matrix">
              {matrixEntries.map(([key, value]) => {
                const v = value as number;
                const barClass = v <= 3 ? "low" : v <= 6 ? "med" : "high";
                return (
                  <div key={key} className="cb-matrix-row">
                    <span className="cb-matrix-label">
                      {DIMENSION_LABELS[key]}
                    </span>
                    <div className="cb-matrix-track">
                      <div
                        className={`cb-matrix-fill ${barClass}`}
                        style={{ width: `${v * 10}%` }}
                      />
                    </div>
                    <span className="cb-matrix-val">{v}/10</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Re-estimate */}
      <button className="btn-secondary cb-action-sm" onClick={runEstimate}>
        Re-estimate
      </button>
    </div>
  );
}
