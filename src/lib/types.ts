export type AccountKind = "cash" | "bank" | "card" | "loan" | "investment";
export type TransactionKind =
  | "income"
  | "expense"
  | "transfer"
  | "investment_contribution"
  | "card_payment"
  | "loan_payment"
  | "adjustment_increase"
  | "adjustment_decrease"
  | "reversal";

export interface Account {
  id: string;
  owner_id: string;
  name: string;
  kind: AccountKind;
  opening_balance_paise: number;
  opening_on: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  version?: number;
}

export interface Category {
  id: string;
  owner_id: string;
  name: string;
  kind: "income" | "expense";
  active: boolean;
}

export interface MoneyTransaction {
  id: string;
  owner_id: string;
  occurred_on: string;
  kind: TransactionKind;
  amount_paise: number;
  source_account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  note: string | null;
  interest_paise: number;
  payment_method?: string | null;
  plan_item_id?: string | null;
  goal_id?: string | null;
  reverses_transaction_id?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number;
}

export interface Entry {
  id: string;
  owner_id: string;
  transaction_id: string;
  account_id: string;
  delta_paise: number;
}

export interface InvestmentValuation {
  id: string;
  owner_id: string;
  account_id: string;
  as_of_date: string;
  market_value_paise: number;
  created_at?: string;
}

export interface Goal {
  id: string;
  owner_id: string;
  name: string;
  target_paise: number | null;
  target_on: string | null;
  monthly_contribution_paise: number | null;
  status: "active" | "paused" | "completed" | "archived";
  completed_at: string | null;
  notes: string | null;
  version?: number;
}

export interface GoalAllocation {
  id: string;
  owner_id: string;
  goal_id: string;
  account_id: string;
  cash_amount_paise: number | null;
  investment_share_ppm: number | null;
}

export interface GoalAllocationChange {
  id: string;
  owner_id: string;
  goal_id: string;
  account_id: string;
  transaction_id: string | null;
  reason: string;
  old_cash_amount_paise: number | null;
  new_cash_amount_paise: number | null;
  old_investment_share_ppm: number | null;
  new_investment_share_ppm: number | null;
  effective_on: string;
  created_at: string;
}

export interface MonthlyPlan {
  id: string;
  owner_id: string;
  month_start: string;
  source_plan_id: string | null;
  status: "draft" | "active";
  notes: string | null;
  version?: number;
}

export interface PlanItem {
  id: string;
  owner_id: string;
  plan_id: string;
  name: string;
  kind: "income" | "fixed_expense" | "variable_expense" | "saving" | "investment";
  planned_paise: number;
  due_day: number | null;
  category_id: string | null;
  goal_id: string | null;
  account_id: string | null;
  funding_account_id?: string | null;
  recurring_template_id: string | null;
  version?: number;
}

export interface RecurringTemplate {
  id: string;
  owner_id: string;
  name: string;
  kind: string;
  amount_paise: number;
  interest_paise: number;
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  source_account_id: string | null;
  destination_account_id: string | null;
  category_id: string | null;
  goal_id: string | null;
  active: boolean;
  notes: string | null;
  version?: number;
}

export interface RecurringOccurrence {
  id: string;
  owner_id: string;
  template_id: string;
  month_start: string;
  due_on: string;
  expected_amount_paise: number;
  status: "pending" | "completed" | "skipped";
  actual_transaction_id: string | null;
}

export interface AlertState {
  id: string;
  owner_id: string;
  alert_key: string;
  state: "dismissed" | "snoozed";
  snoozed_until: string | null;
}

export interface GoalCompletion {
  id: string;
  owner_id: string;
  goal_id: string;
  total_spent_paise: number;
  note: string | null;
  request_payments: unknown[];
  request_allocation_changes: unknown[];
  created_at: string;
}

export interface GoalCompletionPayment {
  id: string;
  owner_id: string;
  completion_id: string;
  transaction_id: string;
  payment_method: string;
}

export interface FinanceData {
  accounts: Account[];
  categories: Category[];
  transactions: MoneyTransaction[];
  entries: Entry[];
  investmentValuations: InvestmentValuation[];
  goals: Goal[];
  goalAllocations: GoalAllocation[];
  goalAllocationChanges: GoalAllocationChange[];
  monthlyPlans: MonthlyPlan[];
  planItems: PlanItem[];
  recurringTemplates: RecurringTemplate[];
  recurringOccurrences: RecurringOccurrence[];
  alertStates: AlertState[];
  goalCompletions: GoalCompletion[];
  goalCompletionPayments: GoalCompletionPayment[];
}

export const EMPTY_DATA: FinanceData = {
  accounts: [],
  categories: [],
  transactions: [],
  entries: [],
  investmentValuations: [],
  goals: [],
  goalAllocations: [],
  goalAllocationChanges: [],
  monthlyPlans: [],
  planItems: [],
  recurringTemplates: [],
  recurringOccurrences: [],
  alertStates: [],
  goalCompletions: [],
  goalCompletionPayments: [],
};
