import { openDB, type IDBPDatabase } from "idb";
import type { FinanceData } from "./types";
import type { PostTransactionInput } from "./data";

export interface PendingTransaction {
  id: string;
  scope: string;
  input: PostTransactionInput;
  addedAt: string;
  error?: string;
}

const DB_NAME = "my-money-offline-v1";
let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore("snapshot");
        db.createObjectStore("pending", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function saveSnapshot(scope: string, data: FinanceData): Promise<void> {
  await (await database()).put("snapshot", data, scope);
}

export async function loadSnapshot(scope: string): Promise<FinanceData | null> {
  return (await database()).get("snapshot", scope) || null;
}

export async function addPending(scope: string, input: PostTransactionInput): Promise<PendingTransaction> {
  const id = input.id || crypto.randomUUID();
  const item: PendingTransaction = {
    id,
    scope,
    input: { ...input, id },
    addedAt: new Date().toISOString(),
  };
  await (await database()).put("pending", item);
  return item;
}

export async function listPending(scope: string): Promise<PendingTransaction[]> {
  return (await database()).getAll("pending").then((items: PendingTransaction[]) => items.filter(item => item.scope === scope));
}

export async function removePending(id: string): Promise<void> {
  await (await database()).delete("pending", id);
}

export async function flagPending(id: string, error: string): Promise<void> {
  const db = await database();
  const item = await db.get("pending", id) as PendingTransaction | undefined;
  if (item) await db.put("pending", { ...item, error });
}

export async function clearOfflineScope(scope: string): Promise<void> {
  const db = await database();
  await db.delete("snapshot", scope);
  const pending = await listPending(scope);
  for (const item of pending) await db.delete("pending", item.id);
}
