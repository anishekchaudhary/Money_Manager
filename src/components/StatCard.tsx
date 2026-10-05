import { formatMoney } from "./money";

export interface StatCardProps {
  label: string;
  valuePaise: number;
  detail?: string;
  tone?: "default" | "accent" | "warm";
  icon?: string;
}

export function StatCard({ label, valuePaise, detail, tone = "default", icon }: StatCardProps) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="stat-card-top"><span>{label}</span>{icon && <span className="stat-card-icon" aria-hidden="true">{icon}</span>}</div>
      <strong className="stat-card-value">{formatMoney(valuePaise)}</strong>
      {detail && <p className="stat-card-detail">{detail}</p>}
    </article>
  );
}
