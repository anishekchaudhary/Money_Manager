import type { FinanceData } from "./types";

export const BACKUP_TABLES = {
  accounts: "accounts",
  categories: "categories",
  transactions: "transactions",
  entries: "entries",
  investmentValuations: "investment_valuations",
  goals: "goals",
  goalAllocations: "goal_allocations",
  goalAllocationChanges: "goal_allocation_changes",
  monthlyPlans: "monthly_plans",
  recurringTemplates: "recurring_templates",
  planItems: "plan_items",
  recurringOccurrences: "recurring_occurrences",
  alertStates: "alert_states",
  goalCompletions: "goal_completions",
  goalCompletionPayments: "goal_completion_payments",
} as const;

export interface BackupPayload {
  schema_version: 1;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

interface EncryptedBackup {
  format: "my-money-encrypted-backup";
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: 250000;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const value of bytes) text += String.fromCharCode(value);
  return btoa(text);
}

function fromBase64(value: string): Uint8Array {
  const text = atob(value);
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 250000, hash: "SHA-256" },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function makeBackupPayload(data: FinanceData): BackupPayload {
  const tables: Record<string, unknown[]> = {};
  for (const [key, table] of Object.entries(BACKUP_TABLES)) {
    tables[table] = [...(data[key as keyof FinanceData] as unknown[])];
  }
  return { schema_version: 1, exported_at: new Date().toISOString(), tables };
}

export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<string> {
  if (passphrase.length < 12) throw new Error("Choose a backup passphrase of at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const result: EncryptedBackup = {
    format: "my-money-encrypted-backup", version: 1,
    kdf: "PBKDF2-SHA256", iterations: 250000, cipher: "AES-256-GCM",
    salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(encrypted),
  };
  return JSON.stringify(result, null, 2);
}

export async function decryptBackup(fileText: string, passphrase: string): Promise<BackupPayload> {
  let envelope: EncryptedBackup;
  try { envelope = JSON.parse(fileText) as EncryptedBackup; }
  catch { throw new Error("This is not a valid backup JSON file."); }
  if (envelope.format !== "my-money-encrypted-backup" || envelope.version !== 1 || envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations !== 250000 || envelope.cipher !== "AES-256-GCM") throw new Error("Unsupported backup format.");
  try {
    const key = await deriveKey(passphrase, fromBase64(envelope.salt));
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) as BufferSource }, key, fromBase64(envelope.ciphertext) as BufferSource);
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as BackupPayload;
    if (payload.schema_version !== 1 || !payload.tables || typeof payload.tables !== "object") throw new Error("Backup data has an unsupported schema.");
    for (const table of Object.values(BACKUP_TABLES)) if (!Array.isArray(payload.tables[table])) throw new Error(`Backup is missing ${table}.`);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Backup")) throw error;
    throw new Error("Could not unlock backup. Check the passphrase and file.");
  }
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function transactionsCsv(data: FinanceData): string {
  const header = ["date", "type", "amount_inr", "from", "to", "category", "payment_method", "note"];
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = data.transactions.map(transaction => [
    transaction.occurred_on, transaction.kind, (Number(transaction.amount_paise) / 100).toFixed(2),
    data.accounts.find(account => account.id === transaction.source_account_id)?.name || "",
    data.accounts.find(account => account.id === transaction.destination_account_id)?.name || "",
    data.categories.find(category => category.id === transaction.category_id)?.name || "",
    transaction.payment_method || "", transaction.note || "",
  ]);
  return [header, ...rows].map(row => row.map(escape).join(",")).join("\r\n") + "\r\n";
}
