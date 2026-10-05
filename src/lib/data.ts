import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_DATA, type FinanceData, type TransactionKind } from "./types";
import { BACKUP_TABLES, type BackupPayload } from "./backup";

const tableMap = {
  accounts: "accounts",
  categories: "categories",
  transactions: "transactions",
  entries: "entries",
  investmentValuations: "investment_valuations",
  goals: "goals",
  goalAllocations: "goal_allocations",
  goalAllocationChanges: "goal_allocation_changes",
  monthlyPlans: "monthly_plans",
  planItems: "plan_items",
  recurringTemplates: "recurring_templates",
  recurringOccurrences: "recurring_occurrences",
  alertStates: "alert_states",
  goalCompletions: "goal_completions",
  goalCompletionPayments: "goal_completion_payments",
} as const;

type TableName = typeof tableMap[keyof typeof tableMap];

export class FinanceRequestError extends Error {
  constructor(message: string, public readonly status?: number, public readonly code?: string) {
    super(message);
    this.name = "FinanceRequestError";
  }
}

function assertNoError(error: { message: string; code?: string; status?: number } | null, action: string, status?: number): void {
  if (error) throw new FinanceRequestError(`${action}: ${error.message}`, status ?? error.status, error.code);
}

export function isRetryableRequestError(error: unknown): boolean {
  const status = error instanceof FinanceRequestError ? error.status : undefined;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  const code = error instanceof FinanceRequestError ? error.code : undefined;
  if (code && /^(08|53|57P01|PGRST00)/i.test(code)) return true;
  return /fetch|network|connection|timeout|timed out|service unavailable|bad gateway|gateway timeout|\b503\b|\b504\b/i.test(String(error));
}

export async function loadFinanceData(client: SupabaseClient): Promise<FinanceData> {
  const snapshot = await exportBackupSnapshot(client);
  const entries = Object.entries(tableMap).map(([key, table]) => [key, snapshot.tables[table]]);
  return { ...EMPTY_DATA, ...Object.fromEntries(entries) } as FinanceData;
}

export async function exportBackupSnapshot(client: SupabaseClient): Promise<BackupPayload> {
  const { data, error, status } = await client.rpc("export_backup_snapshot");
  assertNoError(error, "Export backup snapshot", status);
  const snapshot = data as Record<string, unknown> | null;
  if (!snapshot || snapshot.schema_version !== 1 || typeof snapshot.exported_at !== "string") throw new Error("The server returned an invalid backup snapshot.");
  const tables: Record<string, unknown[]> = {};
  for (const table of Object.values(BACKUP_TABLES)) {
    if (!Array.isArray(snapshot[table])) throw new Error(`The server backup is missing ${table}.`);
    tables[table] = snapshot[table];
  }
  return { schema_version: 1, exported_at: snapshot.exported_at, tables };
}

export async function insertRow<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: TableName,
  ownerId: string,
  values: T,
): Promise<void> {
  const { error } = await client.from(table).insert({ ...values, owner_id: ownerId });
  assertNoError(error, `Save ${table}`);
}

export async function updateRow(
  client: SupabaseClient,
  table: TableName,
  id: string,
  values: Record<string, unknown>,
  expectedVersion?: number,
): Promise<void> {
  let query = client.from(table).update(values).eq("id", id);
  if (expectedVersion !== undefined) query = query.eq("version", expectedVersion);
  const { data, error } = await query.select("id");
  assertNoError(error, `Update ${table}`);
  if (!data?.length) throw new Error("This item changed on another device. Refresh and review it before saving.");
}

export async function deleteRow(client: SupabaseClient, table: TableName, id: string): Promise<void> {
  const { error } = await client.from(table).delete().eq("id", id);
  assertNoError(error, `Delete ${table}`);
}

export interface PostTransactionInput {
  id?: string;
  occurred_on: string;
  kind: TransactionKind;
  amount_paise: number;
  source_account_id?: string | null;
  destination_account_id?: string | null;
  category_id?: string | null;
  note?: string | null;
  interest_paise?: number;
  payment_method?: string | null;
  allocation_changes?: unknown[];
}

export async function postTransaction(client: SupabaseClient, input: PostTransactionInput): Promise<string> {
  const id = input.id || crypto.randomUUID();
  const { data, error, status } = await client.rpc("post_transaction", {
    p_id: id,
    p_occurred_on: input.occurred_on,
    p_kind: input.kind,
    p_amount_paise: input.amount_paise,
    p_source_account_id: input.source_account_id || null,
    p_destination_account_id: input.destination_account_id || null,
    p_category_id: input.category_id || null,
    p_note: input.note || null,
    p_interest_paise: input.interest_paise || 0,
    p_payment_method: input.payment_method || null,
    p_allocation_changes: input.allocation_changes || [],
  });
  assertNoError(error, "Save transaction", status);
  return String(data || id);
}

export async function quickSave(client: SupabaseClient, accountId: string, amountPaise: number): Promise<unknown> {
  const { data, error } = await client.rpc("quick_save", {
    p_account_id: accountId,
    p_amount_paise: amountPaise,
  });
  assertNoError(error, "Quick Save");
  return data;
}

export interface GoalPayment {
  id: string;
  account_id: string;
  amount_paise: number;
  payment_method: string;
  category_id: string | null;
}

export async function completeGoal(
  client: SupabaseClient,
  goalId: string,
  payments: GoalPayment[],
  allocationChanges: Record<string, unknown>[],
  note?: string,
): Promise<string> {
  const { data, error } = await client.rpc("complete_goal", {
    p_goal_id: goalId,
    p_payments: payments,
    p_allocation_changes: allocationChanges,
    p_note: note || null,
  });
  assertNoError(error, "Complete goal");
  return String(data);
}

export async function setGoalAllocations(
  client: SupabaseClient,
  changes: Record<string, unknown>[],
  reason = "manual",
): Promise<void> {
  const { error } = await client.rpc("set_goal_allocations", {
    p_changes: changes,
    p_reason: reason,
  });
  assertNoError(error, "Update goal allocations");
}
