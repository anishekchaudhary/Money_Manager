import { formatMoney } from "./money";

export interface GoalAllocationView {
  source: string;
  amountPaise: number;
}

export interface GoalCardProps {
  name: string;
  targetPaise: number;
  fundedPaise: number;
  monthlySavingPaise?: number;
  estimatedCompletion?: string | null;
  allocations?: GoalAllocationView[];
  status?: "active" | "paused" | "completed";
  completedSpentPaise?: number;
  completedOn?: string | null;
  href?: string;
}

export function GoalCard({
  name,
  targetPaise,
  fundedPaise,
  monthlySavingPaise,
  estimatedCompletion,
  allocations = [],
  status = "active",
  completedSpentPaise,
  completedOn,
  href,
}: GoalCardProps) {
  const progress = targetPaise > 0 ? Math.max(0, Math.round((fundedPaise / targetPaise) * 100)) : 0;
  const progressBar = Math.min(progress, 100);

  if (status === "completed") return (
    <article className="goal-card">
      <div className="goal-card-heading"><span className="goal-card-symbol" aria-hidden="true">✓</span><div className="goal-card-heading-copy"><h3>{name}</h3><span>Completed</span></div>{href && <a className="goal-card-arrow" href={href} aria-label={`View ${name}`}>↗</a>}</div>
      <div className="goal-card-amount"><strong>{formatMoney(completedSpentPaise ?? 0)}</strong><span>recorded spending</span></div>
      <div className="goal-card-facts"><div><span>Original target</span><strong>{formatMoney(targetPaise)}</strong></div>{completedOn && <div><span>Completed on</span><strong>{new Date(completedOn).toLocaleDateString("en-IN")}</strong></div>}</div>
      {allocations.length > 0 && <div className="goal-card-sources"><span className="goal-card-sources-title">Paid from</span>{allocations.map((allocation, index) => <div className="goal-card-source" key={`${allocation.source}-${index}`}><span>{allocation.source}</span><strong>{formatMoney(allocation.amountPaise)}</strong></div>)}</div>}
    </article>
  );

  return (
    <article className="goal-card">
      <div className="goal-card-heading">
        <span className="goal-card-symbol" aria-hidden="true">◎</span>
        <div className="goal-card-heading-copy"><h3>{name}</h3><span>{status === "paused" ? "Paused goal" : "Savings goal"}</span></div>
        {href && <a className="goal-card-arrow" href={href} aria-label={`View ${name}`}>↗</a>}
      </div>
      <div className="goal-card-amount"><strong>{formatMoney(fundedPaise)}</strong><span>of {formatMoney(targetPaise)}</span></div>
      <div className="goal-card-progress-heading"><span>Progress</span><strong>{progress}%</strong></div>
      <div className="goal-card-progress" role="progressbar" aria-label={`${name} funding progress`} aria-valuenow={progressBar} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${progress}% of target`}>
        <span style={{ width: `${progressBar}%` }} />
      </div>
      {(monthlySavingPaise !== undefined || estimatedCompletion) && (
        <div className="goal-card-facts">
          {monthlySavingPaise !== undefined && <div><span>Monthly plan</span><strong>{formatMoney(monthlySavingPaise)}</strong></div>}
          {estimatedCompletion && <div><span>Estimated completion</span><strong>{estimatedCompletion}</strong></div>}
        </div>
      )}
      {allocations.length > 0 && (
        <div className="goal-card-sources">
          <span className="goal-card-sources-title">Linked sources</span>
          {allocations.map((allocation, index) => <div className="goal-card-source" key={`${allocation.source}-${index}`}><span>{allocation.source}</span><strong>{formatMoney(allocation.amountPaise)}</strong></div>)}
        </div>
      )}
    </article>
  );
}
