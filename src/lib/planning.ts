import { formatMoney } from "../components/money.ts";
import { effectiveTransactions, monthStart } from "./finance.ts";
import type { AlertState, FinanceData, PlanItem } from "./types";

export interface AppAlert {
  key: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  href: string;
}

/** Amount matched to one planned line in a given calendar month. */
export function actualForPlanItem(item: PlanItem, data: FinanceData, month: string): number {
  const transactions = effectiveTransactions(data)
    .filter((transaction) => transaction.occurred_on.slice(0, 7) === month.slice(0, 7));

  if (item.kind === "income") {
    if (item.recurring_template_id) {
      const matchingIds = new Set(data.recurringOccurrences
        .filter((occurrence) => occurrence.template_id === item.recurring_template_id && occurrence.actual_transaction_id)
        .map((occurrence) => occurrence.actual_transaction_id));
      return transactions
        .filter((transaction) => transaction.kind === "income" && matchingIds.has(transaction.id))
        .reduce((sum, transaction) => sum + Number(transaction.amount_paise), 0);
    }
    return transactions
      .filter((transaction) => transaction.kind === "income" && (!item.category_id || transaction.category_id === item.category_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount_paise), 0);
  }

  if (item.kind === "fixed_expense" || item.kind === "variable_expense") {
    if (item.recurring_template_id) {
      const matchingIds = new Set(data.recurringOccurrences
        .filter((occurrence) => occurrence.template_id === item.recurring_template_id && occurrence.actual_transaction_id)
        .map((occurrence) => occurrence.actual_transaction_id));
      return transactions
        .filter((transaction) => matchingIds.has(transaction.id))
        .reduce((sum, transaction) => sum + Number(transaction.amount_paise), 0);
    }
    return transactions
      .filter((transaction) => transaction.category_id === item.category_id && (transaction.kind === "expense" || transaction.kind === "loan_payment"))
      .reduce((sum, transaction) => sum + (transaction.kind === "loan_payment" ? Number(transaction.interest_paise || 0) : Number(transaction.amount_paise)), 0);
  }

  if (item.kind === "investment") {
    return transactions
      .filter((transaction) => (transaction.kind === "investment_contribution" || (transaction.kind === "transfer" && data.accounts.some((account) => account.id === transaction.destination_account_id && account.kind === "investment"))) && (!item.account_id || transaction.destination_account_id === item.account_id))
      .reduce((sum, transaction) => sum + Number(transaction.amount_paise), 0);
  }

  const netCashAllocation = data.goalAllocationChanges
    .filter((change) => change.effective_on.slice(0, 7) === month.slice(0, 7) && change.goal_id === item.goal_id && (!item.funding_account_id || change.account_id === item.funding_account_id) && ["quick_save", "manual"].includes(change.reason))
    .reduce((sum, change) => sum + Number(change.new_cash_amount_paise || 0) - Number(change.old_cash_amount_paise || 0), 0);
  return Math.max(0, netCashAllocation);
}

/** Build alert candidates from finance records. `today` is YYYY-MM-DD in Asia/Kolkata. */
export function buildAlerts(data: FinanceData, today: string): AppAlert[] {
  const month = monthStart(today);
  const ranked: Array<AppAlert & { rank: number }> = [];
  const plan = data.monthlyPlans.find((item) => item.month_start === month && item.status === "active");

  if (plan) {
    for (const item of data.planItems.filter((line) => line.plan_id === plan.id && (line.kind === "fixed_expense" || line.kind === "variable_expense"))) {
      const planned = Number(item.planned_paise);
      if (planned <= 0) continue;
      const actual = actualForPlanItem(item, data, month);
      if (actual < planned * 0.85) continue;
      const tier = actual > planned ? "over" : actual === planned ? "full" : "85";
      const percent = Math.floor((actual / planned) * 100);
      ranked.push({
        key: `budget:${month}:${item.id}:${tier}`,
        title: tier === "over" ? `${item.name} is over budget` : tier === "full" ? `${item.name} budget is fully used` : `${item.name} budget is ${percent}% used`,
        description: `${formatMoney(actual)} of ${formatMoney(planned)} planned this month.`,
        severity: tier === "over" ? "critical" : "warning",
        href: "/plan",
        rank: tier === "over" ? 2 : tier === "full" ? 3 : 5,
      });
    }
  }

  for (const occurrence of data.recurringOccurrences.filter((item) => item.status === "pending")) {
    const days = Math.round((Date.parse(`${occurrence.due_on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days > 3) continue;
    const template = data.recurringTemplates.find((item) => item.id === occurrence.template_id);
    if (template && !template.active) continue;
    const name = template?.name || "Recurring item";
    ranked.push({
      key: `due:${occurrence.id}`,
      title: days < 0 ? `${name} is ${Math.abs(days)} day${days === -1 ? "" : "s"} overdue` : days === 0 ? `${name} is due today` : `${name} due in ${days} day${days === 1 ? "" : "s"}`,
      description: `Expected amount ${formatMoney(Number(occurrence.expected_amount_paise))}. Open Recurring to record or skip it.`,
      severity: days < 0 ? "critical" : days === 0 ? "warning" : "info",
      href: "/recurring",
      rank: days < 0 ? 0 : days === 0 ? 1 : 4,
    });
  }

  if (data.transactions.length) {
    ranked.push({
      key: `backup:${month}`,
      title: "Export a backup of your money data",
      description: "Supabase Free does not include automatic database backups. Save an encrypted copy regularly.",
      severity: "warning",
      href: "/settings",
      rank: 6,
    });
  }

  return ranked.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).map(({ rank: _rank, ...alert }) => alert);
}

/** Hide an alert only for its own key; a new month or occurrence has a new key. */
export function filterActiveAlerts(alerts: AppAlert[], states: AlertState[], nowIso: string): AppAlert[] {
  const stateByKey = new Map(states.map((state) => [state.alert_key, state]));
  const now = Date.parse(nowIso);
  return alerts.filter((alert) => {
    const state = stateByKey.get(alert.key);
    if (state?.state === "dismissed") return false;
    if (state?.state === "snoozed" && state.snoozed_until && Date.parse(state.snoozed_until) > now) return false;
    return true;
  });
}
