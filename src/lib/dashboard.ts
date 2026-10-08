import { balancesOn, effectiveTransactions, goalAllocationValue, monthStart, nextMonth, todayInIndia } from "./finance.ts";
import { actualForPlanItem } from "./planning.ts";
import type { Account, FinanceData, MoneyTransaction, PlanItem } from "./types";

export interface PurposeAmount {
  label: string;
  amountPaise: number;
  kind: "goal" | "plan" | "recurring";
}

export interface CashLocation {
  account: Account;
  balancePaise: number;
  goalReservedPaise: number;
  plannedReservedPaise: number;
  usablePaise: number;
  purposes: PurposeAmount[];
}

export interface DashboardLiquidity {
  locations: CashLocation[];
  unassignedPaise: number;
  unassignedCount: number;
  usablePaise: number;
  goalReservedPaise: number;
  plannedReservedPaise: number;
  possibleOverlapCount: number;
}

function cashAccount(account: Account | undefined): account is Account {
  return account?.kind === "cash" || account?.kind === "bank";
}

function remainingPlanAmount(item: PlanItem, data: FinanceData, month: string): number {
  const actual = actualForPlanItem(item, data, month);
  return Math.max(0, Number(item.planned_paise) - actual);
}

/** A snapshot of locations and purposes; plan reservations never change actual balances. */
export function dashboardLiquidity(data: FinanceData, today = todayInIndia()): DashboardLiquidity {
  const month = monthStart(today);
  const balances = balancesOn(data, today);
  const accountById = new Map(data.accounts.map(account => [account.id, account]));
  const locations = data.accounts.filter(cashAccount).map(account => ({
    account, balancePaise: balances.get(account.id) ?? 0,
    goalReservedPaise: 0, plannedReservedPaise: 0, usablePaise: 0,
    purposes: [] as PurposeAmount[],
  }));
  const locationById = new Map(locations.map(location => [location.account.id, location]));
  let unassignedPaise = 0;
  let unassignedCount = 0;
  let possibleOverlapCount = 0;

  function reserve(accountId: string | null | undefined, purpose: PurposeAmount) {
    if (purpose.amountPaise <= 0) return;
    const location = accountId ? locationById.get(accountId) : undefined;
    if (!location) { unassignedPaise += purpose.amountPaise; unassignedCount++; return; }
    location.plannedReservedPaise += purpose.amountPaise;
    location.purposes.push(purpose);
  }

  for (const allocation of data.goalAllocations) {
    const location = locationById.get(allocation.account_id);
    if (!location) continue;
    const amountPaise = goalAllocationValue(allocation, location.account, location.balancePaise);
    const goalName = data.goals.find(goal => goal.id === allocation.goal_id)?.name ?? "Goal";
    location.goalReservedPaise += amountPaise;
    location.purposes.push({ label: goalName, amountPaise, kind: "goal" });
  }

  const plan = data.monthlyPlans.find(item => item.month_start === month && item.status === "active");
  const planItems = plan ? data.planItems.filter(item => item.plan_id === plan.id && item.kind !== "income") : [];
  const linkedCurrent = new Set<string>();
  const unlinkedPlanCategories = new Set<string>();
  for (const item of planItems) {
    const template = data.recurringTemplates.find(row => row.id === item.recurring_template_id);
    const occurrence = template && data.recurringOccurrences.find(row => row.template_id === template.id && row.month_start === month);
    let amountPaise = remainingPlanAmount(item, data, month);
    if (template) {
      linkedCurrent.add(template.id);
      if (item.kind === "fixed_expense" || item.kind === "investment") {
        amountPaise = occurrence?.status === "completed" || occurrence?.status === "skipped"
          ? 0 : Math.max(amountPaise, Number(occurrence?.expected_amount_paise ?? 0));
      } else if (occurrence?.status === "pending") {
        amountPaise = Math.max(amountPaise, Number(occurrence.expected_amount_paise));
      }
    } else if (item.category_id && (item.kind === "fixed_expense" || item.kind === "variable_expense")) {
      unlinkedPlanCategories.add(item.category_id);
    }
    const linkedAccount = template?.source_account_id;
    const accountId = item.funding_account_id || (cashAccount(accountById.get(linkedAccount || "")) ? linkedAccount : null);
    // A card-funded purchase creates debt, not an immediate bank reservation.
    if (accountById.get(linkedAccount || "")?.kind === "card") continue;
    reserve(accountId, { label: item.name, amountPaise, kind: "plan" });
  }

  for (const occurrence of data.recurringOccurrences) {
    if (occurrence.status !== "pending" || occurrence.month_start > month) continue;
    if (occurrence.month_start === month && linkedCurrent.has(occurrence.template_id)) continue;
    const template = data.recurringTemplates.find(item => item.id === occurrence.template_id);
    if (!template) continue;
    const source = accountById.get(template.source_account_id || "");
    if (!cashAccount(source)) continue;
    if (template.kind === "transfer" && accountById.get(template.destination_account_id || "")?.kind !== "investment") continue;
    if (!["expense", "investment_contribution", "card_payment", "loan_payment", "transfer"].includes(template.kind)) continue;
    if (occurrence.month_start === month && template.category_id && unlinkedPlanCategories.has(template.category_id)) possibleOverlapCount++;
    reserve(source.id, { label: template.name, amountPaise: Number(occurrence.expected_amount_paise), kind: "recurring" });
  }

  for (const location of locations) location.usablePaise = location.balancePaise - location.goalReservedPaise - location.plannedReservedPaise;
  return {
    locations, unassignedPaise, unassignedCount,
    usablePaise: locations.reduce((sum, location) => sum + location.usablePaise, 0) - unassignedPaise,
    goalReservedPaise: locations.reduce((sum, location) => sum + location.goalReservedPaise, 0),
    plannedReservedPaise: locations.reduce((sum, location) => sum + location.plannedReservedPaise, 0) + unassignedPaise,
    possibleOverlapCount,
  };
}

export interface MonthlyFlow {
  month: string;
  income: Record<string, number>;
  uses: Record<string, number>;
}

function add(bucket: Record<string, number>, label: string, amountPaise: number) {
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return;
  bucket[label] = (bucket[label] || 0) + amountPaise;
}

function categoryName(transaction: MoneyTransaction, data: FinanceData): string {
  return data.categories.find(category => category.id === transaction.category_id)?.name || "Other";
}

/** Monthly events, not repeated balances: transfers and card repayments are not new uses. */
export function dashboardMonthlyFlows(data: FinanceData, today = todayInIndia(), count = 12): MonthlyFlow[] {
  const currentMonth = monthStart(today);
  const months = Array.from({ length: count }, (_, index) => nextMonth(currentMonth, index - count + 1));
  const flows = months.map(month => ({ month, income: {} as Record<string, number>, uses: {} as Record<string, number> }));
  const byMonth = new Map(flows.map(flow => [flow.month.slice(0, 7), flow]));
  for (const transaction of effectiveTransactions(data)) {
    const flow = byMonth.get(transaction.occurred_on.slice(0, 7));
    if (!flow) continue;
    const amount = Number(transaction.amount_paise);
    if (transaction.kind === "income") add(flow.income, categoryName(transaction, data), amount);
    else if (transaction.kind === "expense") add(flow.uses, categoryName(transaction, data), amount);
    else if (transaction.kind === "investment_contribution") add(flow.uses, "Investing", amount);
    else if (transaction.kind === "transfer" && data.accounts.find(account => account.id === transaction.destination_account_id)?.kind === "investment") add(flow.uses, "Investing", amount);
    else if (transaction.kind === "loan_payment") {
      add(flow.uses, "Debt repayment", amount - Number(transaction.interest_paise || 0));
      add(flow.uses, categoryName(transaction, data) === "Other" ? "Loan interest" : categoryName(transaction, data), Number(transaction.interest_paise || 0));
    }
  }

  const goalNetByMonth = new Map<string, number>();
  for (const change of data.goalAllocationChanges) {
    if (change.reason !== "manual" && change.reason !== "quick_save") continue;
    const flow = byMonth.get(change.effective_on.slice(0, 7));
    if (!flow) continue;
    const account = data.accounts.find(item => item.id === change.account_id);
    const goal = data.goals.find(item => item.id === change.goal_id);
    if (!cashAccount(account) || !goal) continue;
    // Investment funding is already a use when money enters the holding.
    const delta = Number(change.new_cash_amount_paise || 0) - Number(change.old_cash_amount_paise || 0);
    const key = `${flow.month}:${goal.id}`;
    goalNetByMonth.set(key, (goalNetByMonth.get(key) || 0) + delta);
  }
  for (const [key, amountPaise] of goalNetByMonth) {
    const separator = key.indexOf(":");
    const flow = byMonth.get(key.slice(0, separator).slice(0, 7));
    const goal = data.goals.find(item => item.id === key.slice(separator + 1));
    if (flow && goal) add(flow.uses, `Goal · ${goal.name}`, Math.max(0, amountPaise));
  }
  return flows;
}
