import { AlertCard, GoalCard, LineChart, StackedFlowChart, StatCard, formatMoney } from "@/components";
import { dashboardLiquidity, dashboardMonthlyFlows } from "@/lib/dashboard";
import {
  balancesOn,
  effectiveTransactions,
  fundedForGoal,
  goalAllocationValue,
  monthLabel,
  monthStart,
  nextMonth,
  projectedGoalDate,
  todayInIndia,
  totalsOn,
} from "@/lib/finance";
import type { FinanceData, MoneyTransaction } from "@/lib/types";
import { buildAlerts, filterActiveAlerts } from "@/lib/planning";

interface OverviewProps { data: FinanceData }
interface DashboardProps extends OverviewProps {
  onDismissAlert?: (key: string) => Promise<void>;
  onSnoozeAlert?: (key: string) => Promise<void>;
}

const sectionStyle = { marginTop: 28 };
const cardStyle = { padding: 22 };

function monthEnd(month: string): string {
  const next = new Date(`${nextMonth(month)}T00:00:00Z`);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}

function shortMonth(month: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${month}T00:00:00Z`));
}

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
}

function monthlyActivity(data: FinanceData, month: string) {
  const relevant = effectiveTransactions(data).filter((transaction) => transaction.occurred_on.slice(0, 7) === month.slice(0, 7));
  return relevant.reduce((totals, transaction) => {
    if (transaction.kind === "income") totals.income += Number(transaction.amount_paise);
    if (transaction.kind === "expense") totals.spending += Number(transaction.amount_paise);
    if (transaction.kind === "loan_payment") totals.spending += Number(transaction.interest_paise || 0);
    return totals;
  }, { income: 0, spending: 0 });
}

function history(data: FinanceData) {
  const today = todayInIndia();
  const currentMonth = monthStart(today);
  return Array.from({ length: 12 }, (_, index) => {
    const month = nextMonth(currentMonth, index - 11);
    const asOf = month === currentMonth ? today : monthEnd(month);
    return { month, asOf, ...totalsOn(data, asOf), ...monthlyActivity(data, month) };
  });
}

function GoalList({ data }: OverviewProps) {
  const visibleGoals = data.goals.filter((goal) => goal.status !== "archived");
  if (visibleGoals.length === 0) {
    return <div className="empty-state"><h3>No savings goals yet</h3><p>Create a goal to see how much of your money is reserved for it and where that money is held.</p><a className="button button-secondary" href="/goals">Explore goals</a></div>;
  }

  const balances = balancesOn(data);
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));

  return <div className="stat-grid">{visibleGoals.map((goal) => {
    const fundedPaise = fundedForGoal(goal, data, balances);
    const completion = data.goalCompletions.find((item) => item.goal_id === goal.id);
    const allocations = data.goalAllocations.filter((allocation) => allocation.goal_id === goal.id).map((allocation) => {
      const account = accountById.get(allocation.account_id);
      return {
        source: account?.name ?? "Unknown account",
        amountPaise: goalAllocationValue(allocation, account, balances.get(allocation.account_id) ?? 0),
      };
    });
    if (completion) {
      for (const payment of data.goalCompletionPayments.filter((item) => item.completion_id === completion.id)) {
        const transaction = data.transactions.find((item) => item.id === payment.transaction_id);
        if (transaction) allocations.push({ source: `${data.accounts.find((account) => account.id === transaction.source_account_id)?.name ?? "Account"} · ${payment.payment_method}`, amountPaise: Number(transaction.amount_paise) });
      }
    }
    return <GoalCard
      key={goal.id}
      name={goal.name}
      targetPaise={Number(goal.target_paise)}
      fundedPaise={fundedPaise}
      monthlySavingPaise={Number(goal.monthly_contribution_paise)}
      estimatedCompletion={goal.status === "completed" ? "Completed" : projectedGoalDate(goal, fundedPaise)}
      allocations={allocations}
      status={goal.status === "completed" ? "completed" : goal.status === "paused" ? "paused" : "active"}
      completedSpentPaise={completion ? Number(completion.total_spent_paise) : undefined}
      completedOn={goal.completed_at}
      href="/goals"
    />;
  })}</div>;
}

function GoalHistory({ data }: OverviewProps) {
  const points = history(data);
  const accountById = new Map(data.accounts.map((account) => [account.id, account]));
  const visibleGoals = data.goals.filter((goal) => goal.status !== "archived");
  const changes = [...data.goalAllocationChanges].sort((a, b) =>
    a.effective_on.localeCompare(b.effective_on) || a.created_at.localeCompare(b.created_at),
  );
  const goalsWithHistory = visibleGoals.filter((goal) => changes.some((change) => change.goal_id === goal.id));

  if (goalsWithHistory.length === 0) {
    return <div className="empty-state"><h3>No goal history yet</h3><p>Goal progress lines will begin when you first reserve money for a goal. Earlier values are left blank rather than estimated.</p></div>;
  }

  return <div style={{ display: "grid", gap: 16 }}>{goalsWithHistory.map((goal) => {
    const goalChanges = changes.filter((change) => change.goal_id === goal.id);
    const accountIds = [...new Set(goalChanges.map((change) => change.account_id))];
    const valuesPaise = points.map((point) => {
      if (!goalChanges.some((change) => change.effective_on <= point.asOf)) return null;
      return accountIds.reduce((sum, accountId) => {
        const account = accountById.get(accountId);
        const latest = goalChanges.filter((change) => change.account_id === accountId && change.effective_on <= point.asOf).at(-1);
        if (!account || !latest) return sum;
        if (account.kind === "investment") {
          return sum + Math.round((point.balances.get(accountId) ?? 0) * Number(latest.new_investment_share_ppm || 0) / 1_000_000);
        }
        return sum + Number(latest.new_cash_amount_paise || 0);
      }, 0);
    });
    return <LineChart
      key={goal.id}
      title={`${goal.name} progress`}
      subtitle="Recorded allocations at each month end; investment values use the latest valuation available then"
      labels={points.map((point) => shortMonth(point.month))}
      series={[{ label: "Funded", valuesPaise }]}
    />;
  })}</div>;
}

function moneyChart(data: FinanceData, title: string) {
  const points = history(data);
  return <LineChart
    title={title}
    subtitle="Based on dated account entries and recorded investment valuations"
    labels={points.map((point) => shortMonth(point.month))}
    series={[
      { label: "Net worth", valuesPaise: points.map((point) => point.netWorth), color: "#2c7055" },
      { label: "Cash and bank", valuesPaise: points.map((point) => point.cash), color: "#6887a8" },
      { label: "Investments", valuesPaise: points.map((point) => point.investments), color: "#d18a4b" },
    ]}
  />;
}

function transactionName(transaction: MoneyTransaction, data: FinanceData): string {
  if (transaction.note?.trim()) return transaction.note.trim();
  const category = data.categories.find((item) => item.id === transaction.category_id);
  if (category) return category.name;
  const labels: Record<MoneyTransaction["kind"], string> = {
    income: "Income",
    expense: "Expense",
    transfer: "Transfer",
    investment_contribution: "Investment contribution",
    card_payment: "Card payment",
    loan_payment: "Loan payment",
    adjustment_increase: "Balance correction",
    adjustment_decrease: "Balance correction",
    reversal: "Reversal",
  };
  return labels[transaction.kind];
}

function transactionAmount(transaction: MoneyTransaction): string {
  const direction = transaction.kind === "income" || transaction.kind === "adjustment_increase" ? "+" : transaction.kind === "expense" || transaction.kind === "adjustment_decrease" ? "−" : "";
  return `${direction}${formatMoney(Number(transaction.amount_paise))}`;
}

export function DashboardView({ data, onDismissAlert, onSnoozeAlert }: DashboardProps) {
  if (data.accounts.length === 0) {
    return <div className="empty-state"><h3>Start with where your money is</h3><p>Add a bank, cash, card, or investment account and its opening balance. Your dashboard will build from those records.</p><a className="button button-primary" href="/accounts">Add an account</a></div>;
  }

  const today = todayInIndia();
  const month = monthStart(today);
  const liquidity = dashboardLiquidity(data, today);
  const balances = balancesOn(data, today);
  const flows = dashboardMonthlyFlows(data, today);
  const actual = monthlyActivity(data, month);
  const plan = data.monthlyPlans.find((item) => item.month_start === month && item.status === "active")
    ?? data.monthlyPlans.find((item) => item.month_start === month);
  const items = plan ? data.planItems.filter((item) => item.plan_id === plan.id) : [];
  const plannedIncome = items.filter((item) => item.kind === "income").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const plannedSpending = items.filter((item) => item.kind === "fixed_expense" || item.kind === "variable_expense").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const plannedSaving = items.filter((item) => item.kind === "saving" || item.kind === "investment").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const spendingPercent = plannedSpending > 0 ? Math.round((actual.spending / plannedSpending) * 100) : 0;
  const recent = [...effectiveTransactions(data)].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || (b.created_at ?? "").localeCompare(a.created_at ?? "")).slice(0, 6);
  const activeAlerts = filterActiveAlerts(buildAlerts(data, today), data.alertStates, new Date().toISOString());

  return <>
    <section>
      <div className="section-heading"><div><h2>Alerts</h2><p>Upcoming bills, budgets and backup reminders</p></div><a href="/alerts">View all {activeAlerts.length} alerts →</a></div>
      {activeAlerts.length > 0 ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
        {activeAlerts.slice(0, 3).map((alert) => <AlertCard key={alert.key} title={alert.title} description={alert.description} severity={alert.severity} actionLabel="Open" onAction={() => { window.location.href = alert.href; }} onDismiss={onDismissAlert ? () => void onDismissAlert(alert.key).catch(() => {}) : undefined} onSnooze={onSnoozeAlert ? () => void onSnoozeAlert(alert.key).catch(() => {}) : undefined} />)}
      </div> : <div className="surface-card dashboard-clear">All clear for now. New alerts will appear here.</div>}
      {activeAlerts.length > 3 && <p className="muted" style={{ margin: "10px 0 0", fontSize: ".76rem" }}>And {activeAlerts.length - 3} more in Alerts.</p>}
    </section>

    <section style={sectionStyle}><StackedFlowChart flows={flows} /></section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Usable cash</h2><p>Bank and physical cash left after goal allocations and unprocessed commitments</p></div><a href="/plan">Manage monthly plan →</a></div>
      <div className="surface-card dashboard-liquidity">
        <div><span className="dashboard-kicker">Available to use</span><strong className={liquidity.usablePaise < 0 ? "dashboard-negative" : ""}>{formatMoney(liquidity.usablePaise)}</strong><small>As of {dayLabel(today)} · not a bank balance</small></div>
        <div className="dashboard-liquidity-breakdown"><span>Bank + cash <strong>{formatMoney(liquidity.locations.reduce((sum, location) => sum + location.balancePaise, 0))}</strong></span><span>Reserved for goals <strong>−{formatMoney(liquidity.goalReservedPaise)}</strong></span><span>Remaining monthly commitments <strong>−{formatMoney(liquidity.plannedReservedPaise)}</strong></span></div>
      </div>
      {liquidity.unassignedCount > 0 && <p className="notice-banner dashboard-notice">{liquidity.unassignedCount} commitment{liquidity.unassignedCount === 1 ? "" : "s"} totaling {formatMoney(liquidity.unassignedPaise)} ha{liquidity.unassignedCount === 1 ? "s" : "ve"} no funding bank or cash account. The total above deducts it, but account-level usable amounts do not. Assign funding on the Monthly Plan page.</p>}
      {liquidity.possibleOverlapCount > 0 && <p className="notice-banner dashboard-notice">{liquidity.possibleOverlapCount} recurring item{liquidity.possibleOverlapCount === 1 ? " may" : "s may"} overlap an unlinked plan line. Link them on the Monthly Plan page to avoid reserving twice.</p>}
      {liquidity.usablePaise < 0 && <p className="notice-banner dashboard-notice">Your goals and remaining commitments exceed current bank and cash balances. Review the allocations and plan before spending.</p>}
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Where your money is</h2><p>Each account or investment, with its current location and purpose</p></div><a href="/accounts">Manage accounts →</a></div>
      <div className="dashboard-account-grid">{data.accounts.map(account => {
        const location = liquidity.locations.find(item => item.account.id === account.id);
        const balance = balances.get(account.id) ?? 0;
        const investmentPurposes = account.kind === "investment" ? data.goalAllocations.filter(item => item.account_id === account.id).map(item => ({ label: data.goals.find(goal => goal.id === item.goal_id)?.name || "Goal", amountPaise: goalAllocationValue(item, account, balance) })) : [];
        const purposes = location?.purposes.map(item => ({ label: item.label, amountPaise: item.amountPaise })) || investmentPurposes;
        const assigned = purposes.reduce((sum, item) => sum + item.amountPaise, 0);
        return <div className="surface-card dashboard-account" key={account.id}><div className="dashboard-account-top"><span className="pill">{account.kind === "card" || account.kind === "loan" ? "Liability" : account.kind === "investment" ? "Investment" : account.kind === "cash" ? "Physical cash" : "Bank"}</span>{!account.active && <span className="muted">Archived</span>}</div><h3>{account.name}</h3><strong className="dashboard-account-balance">{formatMoney(balance)}</strong><small className="muted">{account.kind === "card" || account.kind === "loan" ? "Outstanding balance · not usable cash" : account.kind === "investment" ? "Latest recorded value · not usable cash" : "Recorded balance"}</small>
          {location ? <div className="dashboard-account-facts"><span>Goal reserved <strong>{formatMoney(location.goalReservedPaise)}</strong></span><span>Plans & recurring <strong>{formatMoney(location.plannedReservedPaise)}</strong></span><span>Usable here <strong className={location.usablePaise < 0 ? "dashboard-negative" : ""}>{formatMoney(location.usablePaise)}</strong></span></div> : null}
          {account.kind === "investment" && <div className="dashboard-account-facts"><span>Goal assigned <strong>{formatMoney(assigned)}</strong></span><span>Unassigned <strong>{formatMoney(balance - assigned)}</strong></span></div>}
          {(purposes.length > 0 || location) && <div className="dashboard-purpose-list"><span>Purpose</span>{purposes.map((purpose, index) => <div key={`${purpose.label}-${index}`}><span>{purpose.label}</span><strong>{formatMoney(purpose.amountPaise)}</strong></div>)}{location && <div><span>Unused here</span><strong className={location.usablePaise < 0 ? "dashboard-negative" : ""}>{formatMoney(location.usablePaise)}</strong></div>}</div>}
        </div>;
      })}</div>
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Recent activity</h2><p>Your latest recorded money movements</p></div><a href="/transactions">All transactions →</a></div>
      {recent.length ? <div className="surface-card table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Activity</th><th>Type</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead><tbody>{recent.map((transaction) => <tr key={transaction.id}><td>{dayLabel(transaction.occurred_on)}</td><td><strong>{transactionName(transaction, data)}</strong></td><td>{transaction.kind.replaceAll("_", " ")}</td><td style={{ textAlign: "right" }}><strong>{transactionAmount(transaction)}</strong></td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>No transactions yet</h3><p>Record income, spending or transfers to see recent activity here.</p><a className="button button-secondary" href="/transactions">Add a transaction</a></div>}
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>{monthLabel(month)} plan</h2><p>Your intentions alongside recorded activity</p></div><a href="/plan">Open plan →</a></div>
      {plan ? <div className="surface-card" style={cardStyle}>
        {plan.status === "draft" && <span className="pill pill-warm">Draft plan</span>}
        <div className="stat-grid" style={{ marginTop: plan.status === "draft" ? 15 : 0 }}>
          <div><span className="muted">Planned income</span><h3>{formatMoney(plannedIncome)}</h3><small className="muted">Received: {formatMoney(actual.income)}</small></div>
          <div><span className="muted">Planned spending</span><h3>{formatMoney(plannedSpending)}</h3><small className="muted">Spent: {formatMoney(actual.spending)}</small></div>
          <div><span className="muted">Savings and investments</span><h3>{formatMoney(plannedSaving)}</h3><small className="muted">Planned uses of income</small></div>
          <div><span className="muted">Unassigned plan amount</span><h3>{formatMoney(plannedIncome - plannedSpending - plannedSaving)}</h3><small className="muted">Income less planned uses</small></div>
        </div>
        {plannedSpending > 0 && <div style={{ marginTop: 22 }}><div className="goal-card-progress-heading"><span>Spending against plan</span><strong>{spendingPercent}%</strong></div><div className="goal-card-progress" role="progressbar" aria-label="Monthly spending against planned spending" aria-valuenow={Math.min(spendingPercent, 100)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${spendingPercent}% spent`}><span style={{ width: `${Math.min(spendingPercent, 100)}%` }} /></div></div>}
      </div> : <div className="empty-state"><h3>Plan this month</h3><p>Copy last month and edit it, or begin with a blank plan.</p><a className="button button-secondary" href="/plan">Create monthly plan</a></div>}
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Savings goals</h2><p>Reserved money is already included in your accounts above</p></div><a href="/goals">All goals →</a></div>
      <GoalList data={data} />
    </section>

  </>;
}

export function ReportsView({ data }: OverviewProps) {
  if (data.accounts.length === 0) {
    return <div className="empty-state"><h3>Reports begin with your accounts</h3><p>Add an account and opening balance to start your financial history.</p><a className="button button-primary" href="/accounts">Add an account</a></div>;
  }

  const points = history(data);
  const current = points[points.length - 1];

  return <>
    <div className="stat-grid">
      <StatCard label="Current net worth" valuePaise={current.netWorth} detail="Assets less card and loan debt" tone="accent" />
      <StatCard label="This month’s income" valuePaise={current.income} detail="Recorded income transactions" />
      <StatCard label="This month’s spending" valuePaise={current.spending} detail="Expenses plus loan interest" tone="warm" />
      <StatCard label="Income less spending" valuePaise={current.income - current.spending} detail="Transfers and investments excluded" />
    </div>

    <section style={sectionStyle}>{moneyChart(data, "Net worth and asset history")}</section>

    <section style={sectionStyle}>
      <LineChart
        title="Income and spending"
        subtitle="Each point is the activity recorded in that month"
        labels={points.map((point) => shortMonth(point.month))}
        series={[
          { label: "Income", valuesPaise: points.map((point) => point.income), color: "#2c7055" },
          { label: "Spending", valuesPaise: points.map((point) => point.spending), color: "#d18a4b" },
        ]}
      />
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Month by month</h2><p>Income and expenses are counted once; transfers and goal allocations are excluded.</p></div></div>
      <div className="surface-card table-wrap"><table className="data-table"><thead><tr><th>Month</th><th style={{ textAlign: "right" }}>Income</th><th style={{ textAlign: "right" }}>Spending</th><th style={{ textAlign: "right" }}>Income less spending</th><th style={{ textAlign: "right" }}>Net worth</th></tr></thead><tbody>{[...points].reverse().map((point) => <tr key={point.month}><td><strong>{monthLabel(point.month)}</strong></td><td style={{ textAlign: "right" }}>{formatMoney(point.income)}</td><td style={{ textAlign: "right" }}>{formatMoney(point.spending)}</td><td style={{ textAlign: "right" }}>{formatMoney(point.income - point.spending)}</td><td style={{ textAlign: "right" }}><strong>{formatMoney(point.netWorth)}</strong></td></tr>)}</tbody></table></div>
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Current goal progress</h2><p>Goal values are parts of your accounts, so they are not added to net worth again.</p></div><a href="/goals">Manage goals →</a></div>
      <GoalList data={data} />
    </section>

    <section style={sectionStyle}>
      <div className="section-heading"><div><h2>Goal progress over time</h2><p>Each line begins when its first allocation was recorded.</p></div></div>
      <GoalHistory data={data} />
    </section>
  </>;
}
