import type { Account, Entry, FinanceData, Goal, GoalAllocation, InvestmentValuation, MoneyTransaction } from "./types";

const assetKinds = new Set<Account["kind"]>(["cash", "bank", "investment"]);

export function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function monthStart(date: string): string { return `${date.slice(0, 7)}-01`; }

export function monthStartFromInput(value: string): string | null {
  return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));
}

export function nextMonth(month: string, delta = 1): string {
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

export function paiseFromRupees(input: string | number): number {
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error("Enter a valid amount.");
  const paise = Math.round(value * 100);
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Amount is outside the supported range.");
  return paise;
}

export function rupeesFromPaise(paise: number): string { return (Number(paise || 0) / 100).toFixed(2); }

export function balanceOn(
  account: Account,
  entries: Entry[],
  valuations: InvestmentValuation[],
  transactions: MoneyTransaction[],
  asOf: string,
): number {
  if (account.opening_on > asOf) return 0;
  const transactionDates = new Map(transactions.map((transaction) => [transaction.id, transaction.occurred_on]));
  const accountEntries = entries.filter((entry) => entry.account_id === account.id);
  let base = Number(account.opening_balance_paise || 0);
  let latestValuation: InvestmentValuation | undefined;
  if (account.kind === "investment") {
    latestValuation = valuations
      .filter((valuation) => valuation.account_id === account.id && valuation.as_of_date <= asOf)
      .sort((a, b) => b.as_of_date.localeCompare(a.as_of_date) || (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (latestValuation) base = Number(latestValuation.market_value_paise);
  }
  const delta = accountEntries.reduce((sum, entry) => {
    const date = transactionDates.get(entry.transaction_id);
    if (!date || date > asOf) return sum;
    if (latestValuation) {
      const transaction = transactions.find(item => item.id === entry.transaction_id);
      const afterValuation = date > latestValuation.as_of_date || (date === latestValuation.as_of_date && (transaction?.created_at || "") > (latestValuation.created_at || ""));
      if (!afterValuation) return sum;
    }
    return sum + Number(entry.delta_paise || 0);
  }, 0);
  return base + delta;
}

export function balancesOn(data: FinanceData, asOf = todayInIndia()): Map<string, number> {
  return new Map(data.accounts.map((account) => [
    account.id,
    balanceOn(account, data.entries, data.investmentValuations, data.transactions, asOf),
  ]));
}

export function totalsOn(data: FinanceData, asOf = todayInIndia()) {
  const balances = balancesOn(data, asOf);
  let cash = 0, investments = 0, debts = 0;
  for (const account of data.accounts) {
    const value = balances.get(account.id) ?? 0;
    if (account.kind === "cash" || account.kind === "bank") cash += value;
    else if (account.kind === "investment") investments += value;
    else debts += value;
  }
  return { cash, investments, debts, assets: cash + investments, netWorth: cash + investments - debts, balances };
}

export function goalAllocationValue(allocation: GoalAllocation, account: Account | undefined, balance: number): number {
  if (!account) return 0;
  if (account.kind === "investment") return Math.round(balance * Number(allocation.investment_share_ppm || 0) / 1_000_000);
  return Number(allocation.cash_amount_paise || 0);
}

export function fundedForGoal(goal: Goal, data: FinanceData, balances = balancesOn(data)): number {
  return data.goalAllocations
    .filter((allocation) => allocation.goal_id === goal.id)
    .reduce((sum, allocation) => sum + goalAllocationValue(
      allocation,
      data.accounts.find((account) => account.id === allocation.account_id),
      balances.get(allocation.account_id) ?? 0,
    ), 0);
}

export function availableCash(account: Account, data: FinanceData, balances = balancesOn(data)): number {
  const reserved = data.goalAllocations
    .filter((allocation) => allocation.account_id === account.id)
    .reduce((sum, allocation) => sum + Number(allocation.cash_amount_paise || 0), 0);
  return (balances.get(account.id) ?? 0) - reserved;
}

export function increasedCashReservation(currentPaise: number, increasePaise: number, availablePaise: number): number {
  if (!Number.isSafeInteger(increasePaise) || increasePaise <= 0) throw new Error("Enter an amount greater than zero to add.");
  if (increasePaise > availablePaise) throw new Error("The increase exceeds the unreserved balance in this account.");
  const total = currentPaise + increasePaise;
  if (!Number.isSafeInteger(total)) throw new Error("The new reservation is outside the supported range.");
  return total;
}

export function projectedGoalDate(goal: Goal, funded: number, today = todayInIndia()): string | null {
  if (funded >= Number(goal.target_paise)) return "Target reached";
  if (!goal.monthly_contribution_paise || goal.monthly_contribution_paise <= 0) return null;
  const months = Math.ceil((Number(goal.target_paise) - funded) / Number(goal.monthly_contribution_paise));
  return monthLabel(nextMonth(monthStart(today), months));
}

export function isAsset(account: Account): boolean { return assetKinds.has(account.kind); }

export function effectiveTransactions(data: FinanceData): MoneyTransaction[] {
  const reversed = new Set(data.transactions.filter(transaction => transaction.kind === "reversal").map(transaction => transaction.reverses_transaction_id).filter(Boolean));
  return data.transactions.filter(transaction => transaction.kind !== "reversal" && !reversed.has(transaction.id));
}
