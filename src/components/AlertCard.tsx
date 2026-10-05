"use client";

export interface AlertCardProps {
  title: string;
  description: string;
  severity?: "info" | "warning" | "critical";
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
}

export function AlertCard({
  title,
  description,
  severity = "info",
  actionLabel,
  onAction,
  onDismiss,
  onSnooze,
}: AlertCardProps) {
  return (
    <article className={`alert-card alert-${severity}`}>
      <span className="alert-card-mark" aria-hidden="true">{severity === "info" ? "i" : "!"}</span>
      <div className="alert-card-content">
        <h3>{title}</h3>
        <p>{description}</p>
        {(actionLabel || onSnooze || onDismiss) && <div className="alert-card-actions">
          {actionLabel && onAction && <button className="button button-small button-primary" type="button" onClick={onAction}>{actionLabel}</button>}
          {onSnooze && <button className="button button-small button-subtle" type="button" onClick={onSnooze}>Snooze</button>}
          {onDismiss && <button className="button button-small button-subtle" type="button" onClick={onDismiss}>Dismiss</button>}
        </div>}
      </div>
    </article>
  );
}
