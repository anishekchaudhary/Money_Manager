"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCard, GoalCard, LineChart, StatCard, formatMoney } from "@/components";
import { useFinance } from "@/app/FinanceApp";
import { completeGoal, deleteRow, exportBackupSnapshot, insertRow, quickSave, setGoalAllocations, updateRow, type GoalPayment, type PostTransactionInput } from "@/lib/data";
import { BACKUP_TABLES, decryptBackup, downloadText, encryptBackup, transactionsCsv, type BackupPayload } from "@/lib/backup";
import { clearOfflineScope } from "@/lib/offline";
import { availableCash, balancesOn, fundedForGoal, goalAllocationValue, increasedCashReservation, monthLabel, monthStart, monthStartFromInput, nextMonth, paiseFromRupees, projectedGoalDate, rupeesFromPaise, todayInIndia, totalsOn } from "@/lib/finance";
import { actualForPlanItem, buildAlerts, filterActiveAlerts } from "@/lib/planning";
import type { Account, FinanceData, Goal, MoneyTransaction, PlanItem, RecurringOccurrence, RecurringTemplate, TransactionKind } from "@/lib/types";

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function amountInput(value: string, setter: (value: string) => void, label = "Amount (₹)") {
  return <label className="field">{label}<input className="input" type="number" min="0" step="0.01" required value={value} onChange={event => setter(event.target.value)} /></label>;
}
function accountSelect(accounts: Account[], value: string, setter: (value: string) => void, label = "Account", required = true) {
  return <label className="field">{label}<select className="select" required={required} value={value} onChange={event => setter(event.target.value)}><option value="">Choose account</option>{accounts.filter(account => account.active).map(account => <option key={account.id} value={account.id}>{account.name} · {account.kind}</option>)}</select></label>;
}
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="surface-card app-section"><div className="section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div>{children}</section>;
}
function Empty({ text }: { text: string }) { return <p className="empty-state">{text}</p>; }

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [year, setYear] = useState(Number(month.slice(0, 4)));

  return <div className="month-picker"><span className="month-picker-label">Month</span>
    <details ref={details} onToggle={event => { if (event.currentTarget.open) setYear(Number(month.slice(0, 4))); }}>
      <summary className="input month-picker-trigger" aria-label={`Choose month, currently ${monthLabel(month)}`}>
        <span>{monthLabel(month)}</span><span aria-hidden="true">▾</span>
      </summary>
      <div className="month-picker-panel">
        <div className="month-picker-year">
          <button type="button" className="button button-quiet button-small" aria-label="Previous year" disabled={year <= 1000} onClick={() => setYear(value => value - 1)}>←</button>
          <strong>{year}</strong>
          <button type="button" className="button button-quiet button-small" aria-label="Next year" disabled={year >= 9999} onClick={() => setYear(value => value + 1)}>→</button>
        </div>
        <div className="month-picker-grid">{monthNames.map((name, index) => {
          const selected = month === `${year}-${String(index + 1).padStart(2, "0")}-01`;
          return <button type="button" key={name} className={`month-picker-option${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => {
            onChange(`${year}-${String(index + 1).padStart(2, "0")}-01`);
            if (details.current) details.current.open = false;
          }}>{name}</button>;
        })}</div>
      </div>
    </details>
  </div>;
}

export function AccountsView() {
  const { data, ownerId, client, run } = useFinance();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Account["kind"]>("bank");
  const [opening, setOpening] = useState("0");
  const [openingOn, setOpeningOn] = useState(todayInIndia());
  const [newAccountNotes, setNewAccountNotes] = useState("");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editAccountName, setEditAccountName] = useState("");
  const [editAccountKind, setEditAccountKind] = useState<Account["kind"]>("bank");
  const [editAccountOpening, setEditAccountOpening] = useState("");
  const [editAccountOpeningOn, setEditAccountOpeningOn] = useState("");
  const [editAccountNotes, setEditAccountNotes] = useState("");
  const [valuationAccount, setValuationAccount] = useState("");
  const [valuationAmount, setValuationAmount] = useState("");
  const [valuationDate, setValuationDate] = useState(todayInIndia());
  const [localError, setLocalError] = useState("");
  const totals = useMemo(() => totalsOn(data), [data]);

  async function createAccount(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      await run(() => insertRow(client, "accounts", ownerId, {
        id: crypto.randomUUID(), name: name.trim(), kind,
        opening_balance_paise: paiseFromRupees(opening), opening_on: openingOn, active: true, notes: newAccountNotes.trim() || null,
      }));
      setName(""); setOpening("0"); setNewAccountNotes("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function recordValuation(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      await run(() => insertRow(client, "investment_valuations", ownerId, {
        id: crypto.randomUUID(), account_id: valuationAccount, as_of_date: valuationDate,
        market_value_paise: paiseFromRupees(valuationAmount),
      }));
      setValuationAmount("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  function startAccountEdit(account: Account) {
    setEditingAccount(account);
    setEditAccountName(account.name);
    setEditAccountKind(account.kind);
    setEditAccountOpening(rupeesFromPaise(Number(account.opening_balance_paise)));
    setEditAccountOpeningOn(account.opening_on);
    setEditAccountNotes(account.notes || "");
    setLocalError("");
  }

  const accountHasEntries = editingAccount ? data.entries.some(item => item.account_id === editingAccount.id) : false;
  const accountHasLinks = editingAccount ? data.goalAllocations.some(item => item.account_id === editingAccount.id)
    || data.investmentValuations.some(item => item.account_id === editingAccount.id)
    || data.planItems.some(item => item.account_id === editingAccount.id || item.funding_account_id === editingAccount.id)
    || data.recurringTemplates.some(item => item.source_account_id === editingAccount.id || item.destination_account_id === editingAccount.id) : false;

  async function saveAccountEdit(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if (!editingAccount) return;
    try {
      const nextName = editAccountName.trim();
      if (!nextName) throw new Error("Enter an account name.");
      const nextOpening = paiseFromRupees(editAccountOpening);
      if (accountHasEntries && (nextOpening !== Number(editingAccount.opening_balance_paise) || editAccountOpeningOn !== editingAccount.opening_on || editAccountKind !== editingAccount.kind)) {
        throw new Error("Opening amount, start date, and type cannot change after transactions. You can still edit the name and notes.");
      }
      if (accountHasLinks && editAccountKind !== editingAccount.kind) throw new Error("Account type cannot change while linked to goals, valuations, plans, or recurring items.");
      const changes: Record<string, unknown> = { name: nextName, notes: editAccountNotes.trim() || null };
      if (!accountHasEntries) { changes.opening_balance_paise = nextOpening; changes.opening_on = editAccountOpeningOn; }
      if (!accountHasEntries && !accountHasLinks) changes.kind = editAccountKind;
      const financialChange = nextOpening !== Number(editingAccount.opening_balance_paise) || editAccountOpeningOn !== editingAccount.opening_on || editAccountKind !== editingAccount.kind;
      if (financialChange && !window.confirm(`Update ${editingAccount.name}'s opening details? This can change displayed balances. Review the amount, date, and type before continuing.`)) return;
      await run(() => updateRow(client, "accounts", editingAccount.id, changes, editingAccount.version));
      setEditingAccount(null);
    } catch (error) { setLocalError(errorText(error)); }
  }

  const investmentAccounts = data.accounts.filter(account => account.kind === "investment");
  return <div className="page-stack">
    <div className="stat-grid"><StatCard label="Cash and bank" valuePaise={totals.cash} /><StatCard label="Investments" valuePaise={totals.investments} /><StatCard label="Debts" valuePaise={totals.debts} /><StatCard label="Net worth" valuePaise={totals.netWorth} tone="accent" /></div>
    <Section title="Where your money is" description="Balances come from opening amounts and transactions. Goal reservations are shown separately.">
      {data.accounts.length === 0 ? <Empty text="Add your first bank, cash, card, loan, or investment account." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Account</th><th>Type</th><th>Balance</th><th>Reserved</th><th>Available</th><th></th></tr></thead><tbody>{data.accounts.map(account => {
        const balance = totals.balances.get(account.id) || 0;
        const reserved = data.goalAllocations.filter(allocation => allocation.account_id === account.id).reduce((sum, allocation) => sum + goalAllocationValue(allocation, account, balance), 0);
        const latestValuation = account.kind === "investment" ? data.investmentValuations.filter(item => item.account_id === account.id).sort((a, b) => b.as_of_date.localeCompare(a.as_of_date) || (b.created_at || "").localeCompare(a.created_at || ""))[0] : null;
        const canArchive = Math.abs(balance) < 1 && !data.goalAllocations.some(allocation => allocation.account_id === account.id);
        return <tr key={account.id}><td><strong>{account.name}</strong>{account.notes && <small className="account-note">{account.notes}</small>}{latestValuation && <small className="muted"> · valued {latestValuation.as_of_date}</small>}{!account.active && <span className="pill">Archived</span>}</td><td>{account.kind}</td><td>{formatMoney(balance)}</td><td>{formatMoney(reserved)}</td><td>{account.kind === "bank" || account.kind === "cash" ? formatMoney(availableCash(account, data, totals.balances)) : "—"}</td><td><span className="list-actions"><button className="button button-quiet" onClick={() => startAccountEdit(account)}>Edit</button>{account.active && <button className="button button-quiet" disabled={!canArchive} title={canArchive ? "Archive this empty account" : "Bring the balance to zero and release goal allocations first"} onClick={() => { if (window.confirm(`Archive ${account.name}? Its history stays in reports.`)) void run(() => updateRow(client, "accounts", account.id, { active: false }, account.version)).catch(() => {}); }}>Archive</button>}</span></td></tr>;
      })}</tbody></table></div>}
    </Section>
    {editingAccount && <Section title={`Edit ${editingAccount.name}`} description="Names and notes can be changed anytime. Opening details are locked after transactions; account type is also locked while linked elsewhere."><form className="form-stack" onSubmit={saveAccountEdit}><div className="form-grid">
      <label className="field">Name<input className="input" required maxLength={100} value={editAccountName} onChange={event => setEditAccountName(event.target.value)} /></label>
      <label className="field">Type<select className="select" disabled={accountHasEntries || accountHasLinks} value={editAccountKind} onChange={event => setEditAccountKind(event.target.value as Account["kind"])}><option value="bank">Bank</option><option value="cash">Cash</option><option value="investment">Investment holding</option><option value="card">Credit card debt</option><option value="loan">Loan debt</option></select></label>
      <label className="field">Opening balance / amount owed (₹)<input className="input" type="number" min="0" step="0.01" required disabled={accountHasEntries} value={editAccountOpening} onChange={event => setEditAccountOpening(event.target.value)} /></label>
      <label className="field">As of date<input className="input" type="date" max={todayInIndia()} required disabled={accountHasEntries} value={editAccountOpeningOn} onChange={event => setEditAccountOpeningOn(event.target.value)} /></label>
    </div><label className="field">Notes (optional)<textarea className="input" rows={3} value={editAccountNotes} onChange={event => setEditAccountNotes(event.target.value)} /></label>{localError && <p className="form-error" role="alert">{localError}</p>}<div className="section-actions"><button className="button button-primary">Save account</button><button type="button" className="button button-quiet" onClick={() => setEditingAccount(null)}>Cancel</button></div></form></Section>}
    <div className="two-column-grid">
      <Section title="Add an account" description="Enter the amount on the date you start tracking it. Opening balances are not income."><form className="form-stack" onSubmit={createAccount}>
        <label className="field">Name<input className="input" required maxLength={80} placeholder="e.g. Savings Account" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field">Type<select className="select" value={kind} onChange={e => setKind(e.target.value as Account["kind"])}><option value="bank">Bank</option><option value="cash">Cash</option><option value="investment">Investment holding</option><option value="card">Credit card debt</option><option value="loan">Loan debt</option></select></label>
        {amountInput(opening, setOpening, "Opening balance / amount owed (₹)")}
        <label className="field">As of date<input className="input" type="date" max={todayInIndia()} required value={openingOn} onChange={e => setOpeningOn(e.target.value)} /></label>
        <label className="field">Notes (optional)<textarea className="input" rows={3} value={newAccountNotes} onChange={e => setNewAccountNotes(e.target.value)} /></label>
        <button className="button button-primary">Add account</button>
      </form></Section>
      <Section title="Update investment value" description="Enter a manual current value. The app will show the valuation date; this is not a live market quote.">
        {investmentAccounts.length ? <form className="form-stack" onSubmit={recordValuation}>
          {accountSelect(investmentAccounts, valuationAccount, setValuationAccount, "Investment holding")}
          {amountInput(valuationAmount, setValuationAmount, "Current market value (₹)")}
          <label className="field">Valued on<input className="input" type="date" max={todayInIndia()} required value={valuationDate} onChange={e => setValuationDate(e.target.value)} /></label>
          <button className="button button-secondary">Save valuation</button>
        </form> : <Empty text="Add an investment holding to record its value." />}
      </Section>
    </div>
    {localError && !editingAccount && <p className="form-error" role="alert">{localError}</p>}
  </div>;
}

const kindLabels: Record<TransactionKind, string> = {
  income: "Income", expense: "Expense", transfer: "Transfer", investment_contribution: "Investment contribution",
  card_payment: "Card payment", loan_payment: "Loan payment", adjustment_increase: "Balance increase", adjustment_decrease: "Balance decrease",
  reversal: "Reversal",
};

export function TransactionsView() {
  const { data, pending, client, run, transact, retryPending, discardPending, syncStatus } = useFinance();
  const params = useSearchParams();
  const [showForm, setShowForm] = useState(params.get("add") === "1");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInIndia());
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("");
  const [interest, setInterest] = useState("0");
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState("");
  const [editing, setEditing] = useState<MoneyTransaction | null>(null);
  const accounts = data.accounts.filter(account => account.active);
  const needSource = kind !== "income";
  const needDestination = ["income", "transfer", "investment_contribution", "card_payment", "loan_payment"].includes(kind);
  const needCategory = kind === "income" || kind === "expense" || (kind === "loan_payment" && Number(interest) > 0);
  const relevantCategories = data.categories.filter(item => item.kind === (kind === "income" ? "income" : "expense") && item.active);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      const input: PostTransactionInput = {
        occurred_on: date, kind, amount_paise: paiseFromRupees(amount),
        source_account_id: needSource ? source : null,
        destination_account_id: needDestination ? destination : null,
        category_id: category || null, note: note.trim() || null,
        interest_paise: kind === "loan_payment" ? paiseFromRupees(interest) : 0,
        payment_method: method.trim() || null,
      };
      if (needCategory && !category) throw new Error("Choose a category for this transaction.");
      if (source && source === destination) throw new Error("Source and destination accounts must differ.");
      if (editing) {
        if (!navigator.onLine) throw new Error("Connect to the internet before correcting an existing transaction.");
        await run(async () => {
          const { error } = await client.rpc("correct_transaction", {
            p_original_id: editing.id,
            p_reversal_id: crypto.randomUUID(),
            p_reversal_allocation_changes: [],
            p_replacement: { ...input, id: crypto.randomUUID() },
          });
          if (error) throw error;
        });
      } else await transact(input);
      setAmount(""); setNote(""); setInterest("0"); setShowForm(false); setEditing(null);
    } catch (error) { setLocalError(errorText(error)); }
  }

  function openCorrection(transaction: MoneyTransaction) {
    setEditing(transaction); setKind(transaction.kind); setAmount(rupeesFromPaise(Number(transaction.amount_paise)));
    setDate(transaction.occurred_on); setSource(transaction.source_account_id || ""); setDestination(transaction.destination_account_id || "");
    setCategory(transaction.category_id || ""); setNote(transaction.note || ""); setMethod(transaction.payment_method || "");
    setInterest(rupeesFromPaise(Number(transaction.interest_paise || 0))); setLocalError(""); setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function voidTransaction(transaction: MoneyTransaction) {
    if (!navigator.onLine) { setLocalError("Connect to the internet before voiding a transaction."); return; }
    if (!window.confirm(`Void this ${kindLabels[transaction.kind].toLowerCase()} of ${formatMoney(Number(transaction.amount_paise))}? Its original and reversal will stay in the audit history.`)) return;
    setLocalError("");
    try { await run(async () => {
      const { error } = await client.rpc("void_transaction", { p_transaction_id: transaction.id, p_reversal_id: crypto.randomUUID(), p_allocation_changes: [] });
      if (error) throw error;
    }); }
    catch (error) { setLocalError(errorText(error)); }
  }

  const reversedIds = new Set(data.transactions.filter(item => item.kind === "reversal").map(item => item.reverses_transaction_id));
  const canVoid = (item: MoneyTransaction) => item.kind !== "reversal" && !reversedIds.has(item.id)
    && !data.goalAllocationChanges.some(change => change.transaction_id === item.id)
    && !data.goalCompletionPayments.some(payment => payment.transaction_id === item.id);
  const canCorrect = (item: MoneyTransaction) => canVoid(item)
    && !data.recurringOccurrences.some(occurrence => occurrence.actual_transaction_id === item.id)
    && !item.plan_item_id
    && item.kind !== "transfer" && item.kind !== "investment_contribution";

  const transactions = [...data.transactions]
    .filter(item => `${kindLabels[item.kind]} ${item.note || ""} ${data.categories.find(category => category.id === item.category_id)?.name || ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || (b.created_at || "").localeCompare(a.created_at || ""));
  return <div className="page-stack">
    {pending.length > 0 && <div className="notice-banner"><strong>{pending.length} transaction{pending.length === 1 ? "" : "s"} waiting to sync.</strong> {pending.some(item => item.error) ? "Open the pending list below to review errors." : "They will upload when the connection returns."}</div>}
    <div className="section-actions" style={{ justifyContent: "flex-end" }}><button className="button button-primary" onClick={() => { setShowForm(value => !value); setEditing(null); }}>{showForm ? "Close" : "+ Add transaction"}</button></div>
    <Section title="Transaction history" description="Transfers and card repayments do not count as new spending.">
      <div className="section-actions"><input className="input" aria-label="Search transactions" placeholder="Search transactions" value={query} onChange={e => setQuery(e.target.value)} /></div>
      {showForm && <form className="form-stack inline-form" onSubmit={submit}>
        {editing && <div className="notice-banner" role="status">Correcting the selected transaction. Saving will keep the original and add a reversal plus your corrected entry.</div>}
        <div className="form-grid">
          <label className="field">Type<select className="select" disabled={Boolean(editing)} value={kind} onChange={e => { setKind(e.target.value as TransactionKind); setSource(""); setDestination(""); setCategory(""); }}>{Object.entries(kindLabels).filter(([value]) => value !== "reversal").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {amountInput(amount, setAmount)}
          <label className="field">Date<input className="input" type="date" max={todayInIndia()} required value={date} onChange={e => setDate(e.target.value)} /></label>
          {needSource && accountSelect(accounts.filter(account => kind === "expense" ? ["cash", "bank", "card", "investment"].includes(account.kind) : kind === "adjustment_increase" || kind === "adjustment_decrease" ? true : ["cash", "bank"].includes(account.kind)), source, setSource, kind.startsWith("adjustment") ? "Account to correct" : "From account")}
          {needDestination && accountSelect(accounts.filter(account => kind === "income" ? ["cash", "bank"].includes(account.kind) : kind === "card_payment" ? account.kind === "card" : kind === "loan_payment" ? account.kind === "loan" : kind === "investment_contribution" ? account.kind === "investment" : ["cash", "bank", "investment"].includes(account.kind)), destination, setDestination, "To account")}
          {needCategory && <label className="field">Category<select className="select" required value={category} onChange={e => setCategory(e.target.value)}><option value="">Choose category</option>{relevantCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          {kind === "loan_payment" && amountInput(interest, setInterest, "Interest portion (₹)")}
          <label className="field">Payment method<input className="input" placeholder="e.g. UPI, card, bank transfer" value={method} onChange={e => setMethod(e.target.value)} /></label>
          <label className="field">Note<input className="input" value={note} onChange={e => setNote(e.target.value)} /></label>
        </div>
        <p className="muted">{syncStatus === "offline" ? "Offline: this will be queued on this device. Totals stay at the last confirmed values until it syncs." : "The balance updates after the server confirms the transaction."}</p>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <button className="button button-primary">{editing ? "Save auditable correction" : "Save transaction"}</button>
      </form>}
      {transactions.length === 0 ? <Empty text="No transactions yet. Add your first income or expense." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Details</th><th>Account</th><th>Amount</th><th>Actions</th></tr></thead><tbody>{transactions.slice(0, 150).map(item => <tr key={item.id}><td>{item.occurred_on}</td><td>{kindLabels[item.kind]}{reversedIds.has(item.id) && <span className="pill">Reversed</span>}</td><td>{item.note || data.categories.find(category => category.id === item.category_id)?.name || "—"}{item.payment_method && <span className="muted"> · {item.payment_method}</span>}</td><td>{data.accounts.find(account => account.id === (item.source_account_id || item.destination_account_id))?.name || "—"}</td><td>{formatMoney(Number(item.amount_paise))}</td><td><span className="list-actions">{canCorrect(item) && <button className="button button-quiet" onClick={() => openCorrection(item)}>Correct</button>}{canVoid(item) && <button className="button button-quiet" onClick={() => void voidTransaction(item)}>Void</button>}</span></td></tr>)}</tbody></table></div>}
    </Section>
    {pending.length > 0 && <Section title="Pending on this device" description="These entries are stored locally until Supabase confirms them. Review errors before retrying; discarding cannot be undone."><div className="list-stack">{pending.map(item => <div key={item.id} className="list-row"><span>{item.input.occurred_on} · {kindLabels[item.input.kind]} · {formatMoney(item.input.amount_paise)}</span><span className="list-actions"><span className="pill">{item.error || "Waiting to sync"}</span>{item.error && <button className="button button-secondary" onClick={() => void retryPending(item.id)}>Retry</button>}<button className="button button-quiet" onClick={() => { if (window.confirm("Discard this unsynced transaction from this device? Confirm it was not saved on another device first.")) void discardPending(item.id); }}>Discard</button></span></div>)}</div></Section>}
  </div>;
}

const planKinds: PlanItem["kind"][] = ["income", "fixed_expense", "variable_expense", "saving", "investment"];
const planLabels: Record<PlanItem["kind"], string> = { income: "Expected income", fixed_expense: "Fixed expense", variable_expense: "Category budget", saving: "Goal saving", investment: "Investment contribution" };

interface PlanningSectionProps {
  month?: string;
  onMonthChange?: (month: string) => void;
}

export function PlanningView() {
  const [month, setMonth] = useState(monthStart(todayInIndia()));
  useEffect(() => {
    if (window.location.hash === "#recurring" || new URLSearchParams(window.location.search).get("view") === "recurring") {
      const frame = window.requestAnimationFrame(() => document.getElementById("recurring")?.scrollIntoView());
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);
  return <div className="page-stack">
    <div className="section-actions"><MonthPicker month={month} onChange={setMonth} /><span className="pill">{monthLabel(month)}</span></div>
    <nav className="planning-jump-nav" aria-label="Planning sections"><a className="button button-secondary button-small" href="#monthly-plan">Monthly plan</a><a className="button button-secondary button-small" href="#recurring">Recurring items</a></nav>
    <section id="monthly-plan" className="planning-group" aria-labelledby="monthly-plan-heading"><h2 id="monthly-plan-heading">Monthly plan</h2><MonthlyPlanView month={month} onMonthChange={setMonth} /></section>
    <section id="recurring" className="planning-group" aria-labelledby="recurring-heading"><h2 id="recurring-heading">Recurring items</h2><RecurringView month={month} onMonthChange={setMonth} /></section>
  </div>;
}

export function MonthlyPlanView({ month: selectedMonth, onMonthChange }: PlanningSectionProps = {}) {
  const { data, client, ownerId, run } = useFinance();
  const [localMonth, setLocalMonth] = useState(monthStart(todayInIndia()));
  const month = selectedMonth ?? localMonth;
  const setMonth = onMonthChange ?? setLocalMonth;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PlanItem["kind"]>("fixed_expense");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("");
  const [category, setCategory] = useState("");
  const [goal, setGoal] = useState("");
  const [account, setAccount] = useState("");
  const [fundingAccount, setFundingAccount] = useState("");
  const [recurringTemplate, setRecurringTemplate] = useState("");
  const [localError, setLocalError] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [editingDue, setEditingDue] = useState("");
  const [editingFundingAccount, setEditingFundingAccount] = useState("");
  const [paymentItem, setPaymentItem] = useState<PlanItem | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInIndia());
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [linkingItem, setLinkingItem] = useState<PlanItem | null>(null);
  const [linkTransactionId, setLinkTransactionId] = useState("");
  const plan = data.monthlyPlans.find(item => item.month_start === month);
  const items = data.planItems.filter(item => item.plan_id === plan?.id);
  const plannedIncome = items.filter(item => item.kind === "income").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const plannedExpense = items.filter(item => item.kind === "fixed_expense" || item.kind === "variable_expense").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const plannedSaving = items.filter(item => item.kind === "saving" || item.kind === "investment").reduce((sum, item) => sum + Number(item.planned_paise), 0);
  const previousPlan = data.monthlyPlans.find(item => item.month_start === nextMonth(month, -1));
  const matchingTemplates = data.recurringTemplates.filter(template => template.active && (kind === "income" ? template.kind === "income" : kind === "fixed_expense" || kind === "variable_expense" ? template.kind === "expense" : kind === "investment" ? template.kind === "investment_contribution" : false));
  const cashFundingAccounts = data.accounts.filter(item => item.active && (item.kind === "cash" || item.kind === "bank"));

  async function createPlan(copyPrevious: boolean) {
    setLocalError("");
    try { await run(async () => {
      const { error } = await client.rpc("create_monthly_plan", { p_month_start: month, p_copy_previous: copyPrevious });
      if (error) throw error;
    }); }
    catch (error) { setLocalError(errorText(error)); }
  }

  async function addItem(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if (!plan) return;
    try {
      if (["income", "fixed_expense", "variable_expense"].includes(kind) && !category) throw new Error("Choose a category so actual amounts can be matched accurately.");
      if (kind === "income" && category && items.some(item => item.kind === "income" && item.category_id === category && !item.recurring_template_id && !recurringTemplate)) throw new Error("This income category already has an unlinked plan line this month.");
      if (recurringTemplate && items.some(item => item.recurring_template_id === recurringTemplate)) throw new Error("This recurring item is already linked to a plan line this month.");
      if (kind === "saving" && items.some(item => item.kind === "saving" && item.goal_id === goal)) throw new Error("This goal already has a saving plan line this month.");
      if (kind === "investment" && items.some(item => item.kind === "investment" && item.account_id === account)) throw new Error("This holding already has an investment plan line this month.");
      const linkedTemplate = data.recurringTemplates.find(item => item.id === recurringTemplate);
      const fundedByCard = linkedTemplate?.source_account_id && data.accounts.find(item => item.id === linkedTemplate.source_account_id)?.kind === "card";
      if (kind !== "income" && !fundingAccount && !fundedByCard) throw new Error("Choose the bank or cash account that funds this plan.");
      await run(() => insertRow(client, "plan_items", ownerId, {
        id: crypto.randomUUID(), plan_id: plan.id, name: name.trim(), kind,
        planned_paise: paiseFromRupees(amount), due_day: dueDay ? Number(dueDay) : null,
        category_id: category || null, goal_id: goal || null, account_id: account || null,
        funding_account_id: kind === "income" ? null : fundingAccount || null,
        recurring_template_id: recurringTemplate || null,
      }));
      setName(""); setAmount(""); setDueDay(""); setRecurringTemplate(""); setFundingAccount("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function saveItemEdit(item: PlanItem) {
    setLocalError("");
    try { await run(() => updateRow(client, "plan_items", item.id, { planned_paise: paiseFromRupees(editingAmount), due_day: editingDue ? Number(editingDue) : null, funding_account_id: item.kind === "income" ? null : editingFundingAccount || null }, item.version)); setEditingItem(null); }
    catch (error) { setLocalError(errorText(error)); }
  }

  function reviewPlanPayment(item: PlanItem) {
    setPaymentItem(item);
    setPaymentAmount(rupeesFromPaise(Number(item.planned_paise)));
    setPaymentDate(month === monthStart(todayInIndia()) ? todayInIndia() : month);
    setPaymentMethod("");
    setPaymentNote(item.name);
    setLocalError("");
  }

  async function confirmPlanPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentItem) return;
    setLocalError("");
    try {
      await run(async () => {
        const { error } = await client.rpc("record_plan_item_payment", {
          p_plan_item_id: paymentItem.id,
          p_transaction_id: crypto.randomUUID(),
          p_occurred_on: paymentDate,
          p_amount_paise: paiseFromRupees(paymentAmount),
          p_payment_method: paymentMethod.trim() || null,
          p_note: paymentNote.trim() || null,
        });
        if (error) throw error;
      });
      setPaymentItem(null);
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function confirmTransactionLink(event: FormEvent) {
    event.preventDefault();
    if (!linkingItem || !linkTransactionId) return;
    setLocalError("");
    try {
      await run(async () => {
        const { error } = await client.rpc("link_plan_item_transaction", {
          p_plan_item_id: linkingItem.id,
          p_transaction_id: linkTransactionId,
        });
        if (error) throw error;
      });
      setLinkingItem(null);
      setLinkTransactionId("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  function linkCandidates(item: PlanItem) {
    return data.transactions.filter(transaction => transaction.kind === "expense"
      && !transaction.plan_item_id
      && transaction.occurred_on.slice(0, 7) === month.slice(0, 7)
      && transaction.category_id === item.category_id
      && (!item.funding_account_id || transaction.source_account_id === item.funding_account_id)
      && !data.transactions.some(reversal => reversal.reverses_transaction_id === transaction.id)
      && !data.recurringOccurrences.some(occurrence => occurrence.actual_transaction_id === transaction.id));
  }

  const displayMonth = monthLabel(month);
  return <div className="page-stack">
    {!onMonthChange && <div className="section-actions"><label className="field">Planning month<input className="input" type="month" value={month.slice(0, 7)} onChange={event => { const selected = monthStartFromInput(event.target.value); if (selected) setMonth(selected); }} /></label><span className="pill">{displayMonth}</span></div>}
    {!plan ? <Section title={`Create your ${displayMonth} plan`} description="Choose how you want to start. Previous actual transactions will never be copied.">
      <div className="choice-grid"><button className="choice-card" disabled={!previousPlan} onClick={() => void createPlan(true)}><strong>Copy previous month and edit</strong><span>{previousPlan ? "Bring forward planned lines and amounts. Review before using them." : "No previous month's plan exists yet."}</span></button><button className="choice-card" onClick={() => void createPlan(false)}><strong>Create from scratch</strong><span>Start with a blank monthly plan.</span></button></div>
      {localError && <p className="form-error" role="alert">{localError}</p>}
    </Section> : <>
      <div className="section-actions"><span className="pill">{plan.status === "draft" ? "Draft · review before using" : "Active plan"}</span>{plan.status === "draft" && <button className="button button-primary" onClick={() => void run(() => updateRow(client, "monthly_plans", plan.id, { status: "active" }, plan.version)).catch(error => setLocalError(errorText(error)))}>Save and activate plan</button>}</div>
      {items.some(item => !item.recurring_template_id && (item.kind === "fixed_expense" || item.kind === "variable_expense") && linkCandidates(item).length > 0) && <div className="notice-banner" role="status">Recorded expenses are not assigned to plan lines automatically. Use “Use recorded transaction” below to connect an existing payment without spending twice.</div>}
      <div className="stat-grid"><StatCard label="Expected income" valuePaise={plannedIncome} /><StatCard label="Planned spending" valuePaise={plannedExpense} /><StatCard label="Savings & investing" valuePaise={plannedSaving} /><StatCard label="Unassigned" valuePaise={plannedIncome - plannedExpense - plannedSaving} tone={plannedIncome < plannedExpense + plannedSaving ? "warm" : "accent"} /></div>
      {plannedIncome < plannedExpense + plannedSaving && <div className="notice-banner" role="status">This plan uses more than the expected income. Check the amounts before relying on it.</div>}
      <Section title="Plan versus actual" description="Difference is planned minus actual; once an item is marked used, underspending becomes usable cash and overspending reduces it.">
        {items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Type</th><th>Planned</th><th>Actual</th><th>Difference</th><th></th></tr></thead><tbody>{items.map(item => {
          const actual = actualForPlanItem(item, data, month);
          return <tr key={item.id}><td><strong>{item.name}</strong>{item.due_day && <span className="muted"> · due {item.due_day}</span>}{item.kind !== "income" && (editingItem === item.id ? <select className="select" aria-label={`Funding account for ${item.name}`} value={editingFundingAccount} onChange={event => setEditingFundingAccount(event.target.value)}><option value="">Choose funding account</option>{cashFundingAccounts.map(funding => <option key={funding.id} value={funding.id}>{funding.name}</option>)}</select> : <small className="muted"> · from {data.accounts.find(funding => funding.id === (item.funding_account_id || data.recurringTemplates.find(template => template.id === item.recurring_template_id)?.source_account_id))?.name || "unassigned account"}</small>)}</td><td>{planLabels[item.kind]}</td><td>{editingItem === item.id ? <input className="input" aria-label={`Planned amount for ${item.name}`} type="number" min="0" step="0.01" value={editingAmount} onChange={event => setEditingAmount(event.target.value)} /> : formatMoney(Number(item.planned_paise))}</td><td>{formatMoney(actual)}</td><td>{editingItem === item.id ? <input className="input" aria-label={`Due day for ${item.name}`} type="number" min="1" max="31" placeholder="Due day" value={editingDue} onChange={event => setEditingDue(event.target.value)} /> : formatMoney(Number(item.planned_paise) - actual)}</td><td>{editingItem === item.id ? <><button className="button button-secondary" onClick={() => void saveItemEdit(item)}>Save</button><button className="button button-quiet" onClick={() => setEditingItem(null)}>Cancel</button></> : <><button className="button button-quiet" onClick={() => { setEditingItem(item.id); setEditingAmount(rupeesFromPaise(Number(item.planned_paise))); setEditingDue(item.due_day ? String(item.due_day) : ""); const source = item.funding_account_id || data.recurringTemplates.find(template => template.id === item.recurring_template_id)?.source_account_id; setEditingFundingAccount(cashFundingAccounts.some(funding => funding.id === source) ? source || "" : ""); }}>Edit</button><button className="button button-quiet" onClick={() => { if (window.confirm(`Remove planned item “${item.name}”? Actual transactions stay.`)) void run(() => deleteRow(client, "plan_items", item.id)).catch(() => {}); }}>Remove</button></>}</td></tr>;
        })}</tbody></table></div> : <Empty text="This plan is empty. Add expected income, expenses, and savings below." />}
      </Section>
      <Section title="Use a planned expense" description="Each line holds its planned amount until you confirm its actual payment. A lower payment releases the difference; a higher one uses additional available cash.">
        <div className="list-stack">{items.filter(item => item.kind === "fixed_expense" || item.kind === "variable_expense").map(item => {
          const linked = Boolean(item.recurring_template_id);
          const paid = data.transactions.some(transaction => transaction.plan_item_id === item.id && transaction.kind === "expense" && !data.transactions.some(reversal => reversal.reverses_transaction_id === transaction.id));
          const occurrence = linked ? data.recurringOccurrences.find(row => row.template_id === item.recurring_template_id && row.month_start === month) : null;
          return <div className="list-row" key={item.id}><span><strong>{item.name}</strong><span className="muted"> · {formatMoney(Number(item.planned_paise))} planned · {data.categories.find(category => category.id === item.category_id)?.name || "Expense"}</span></span><span className="list-actions">{paid || occurrence?.status === "completed" ? <span className="pill">Used</span> : linked ? <a className="button button-secondary button-small" href="#recurring">Mark paid in Recurring</a> : <><button className="button button-secondary button-small" disabled={plan.status !== "active" || !item.funding_account_id || month > monthStart(todayInIndia())} onClick={() => reviewPlanPayment(item)}>Mark used</button>{linkCandidates(item).length > 0 && <button className="button button-quiet button-small" onClick={() => { setLinkingItem(item); setLinkTransactionId(""); setLocalError(""); }}>Use recorded transaction</button>}</>}</span></div>;
        })}</div>
      </Section>
      <Section title="Add a planned item"><form className="form-stack" onSubmit={addItem}><div className="form-grid">
        <label className="field">Name<input className="input" required placeholder="e.g. Rent" value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="field">Type<select className="select" value={kind} onChange={event => { setKind(event.target.value as PlanItem["kind"]); setCategory(""); setGoal(""); setAccount(""); setFundingAccount(""); setRecurringTemplate(""); }}>{planKinds.map(value => <option key={value} value={value}>{planLabels[value]}</option>)}</select></label>
        {amountInput(amount, setAmount, "Planned amount (₹)")}
        <label className="field">Due day (optional)<input className="input" type="number" min="1" max="31" value={dueDay} onChange={event => setDueDay(event.target.value)} /></label>
        {matchingTemplates.length > 0 && <label className="field">Linked recurring item (optional)<select className="select" value={recurringTemplate} onChange={event => { const id = event.target.value; setRecurringTemplate(id); const template = matchingTemplates.find(item => item.id === id); if (template) { setName(template.name); setAmount(rupeesFromPaise(Number(template.amount_paise))); setDueDay(String(template.due_day)); setCategory(template.category_id || ""); setAccount(template.destination_account_id || ""); setFundingAccount(cashFundingAccounts.some(funding => funding.id === template.source_account_id) ? template.source_account_id || "" : ""); } }}><option value="">No linked recurring item</option>{matchingTemplates.map(template => <option key={template.id} value={template.id}>{template.name} · day {template.due_day}</option>)}</select></label>}
        {(kind === "income" || kind === "fixed_expense" || kind === "variable_expense") && <label className="field">Category<select className="select" required value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose category</option>{data.categories.filter(item => item.active && item.kind === (kind === "income" ? "income" : "expense")).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {kind === "saving" && <label className="field">Goal<select className="select" required value={goal} onChange={event => setGoal(event.target.value)}><option value="">Choose goal</option>{data.goals.filter(item => item.status === "active").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {kind === "investment" && accountSelect(data.accounts.filter(item => item.kind === "investment"), account, setAccount, "Investment holding")}
        {kind !== "income" && <label className="field">Funding bank or cash account<select className="select" value={fundingAccount} onChange={event => setFundingAccount(event.target.value)}><option value="">Choose funding account</option>{cashFundingAccounts.map(funding => <option key={funding.id} value={funding.id}>{funding.name}</option>)}</select></label>}
      </div>{localError && !paymentItem && <p className="form-error" role="alert">{localError}</p>}<button className="button button-primary">Add to plan</button></form></Section>
      {paymentItem && <div className="modal-backdrop" role="presentation"><section className="modal-panel surface-card" role="dialog" aria-modal="true" aria-labelledby="plan-payment-title"><div className="section-heading"><div><h2 id="plan-payment-title">Use {paymentItem.name}</h2><p>Confirm the actual amount before recording a transaction. The unused reservation will be released.</p></div><button type="button" className="button button-quiet" aria-label="Close" onClick={() => setPaymentItem(null)}>✕</button></div><form className="form-stack" onSubmit={confirmPlanPayment}>{amountInput(paymentAmount, setPaymentAmount, "Actual amount (₹)")}<label className="field">Payment date<input className="input" type="date" min={month} max={todayInIndia()} required value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label><label className="field">Payment method<input className="input" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value)} placeholder="e.g. UPI, bank transfer" /></label><label className="field">Note<input className="input" value={paymentNote} onChange={event => setPaymentNote(event.target.value)} /></label><p className="muted">From {data.accounts.find(account => account.id === paymentItem.funding_account_id)?.name || "funding account"}. If this payment has already been recorded elsewhere, cancel to avoid duplicating it.</p>{localError && <p className="form-error" role="alert">{localError}</p>}<div className="form-actions"><button className="button button-primary">Confirm payment</button><button type="button" className="button button-secondary" onClick={() => setPaymentItem(null)}>Cancel</button></div></form></section></div>}
      {linkingItem && <div className="modal-backdrop" role="presentation"><section className="modal-panel surface-card" role="dialog" aria-modal="true" aria-labelledby="plan-link-title"><div className="section-heading"><div><h2 id="plan-link-title">Use a recorded expense for {linkingItem.name}</h2><p>This links an existing transaction; it does not withdraw money again.</p></div><button type="button" className="button button-quiet" aria-label="Close" onClick={() => setLinkingItem(null)}>✕</button></div><form className="form-stack" onSubmit={confirmTransactionLink}><label className="field">Recorded transaction<select className="select" required value={linkTransactionId} onChange={event => setLinkTransactionId(event.target.value)}><option value="">Choose a transaction</option>{linkCandidates(linkingItem).map(transaction => <option key={transaction.id} value={transaction.id}>{transaction.occurred_on} · {formatMoney(Number(transaction.amount_paise))} · {transaction.note || data.accounts.find(account => account.id === transaction.source_account_id)?.name || "Expense"}</option>)}</select></label>{localError && <p className="form-error" role="alert">{localError}</p>}<div className="form-actions"><button className="button button-primary">Confirm link</button><button type="button" className="button button-secondary" onClick={() => setLinkingItem(null)}>Cancel</button></div></form></section></div>}
    </>}
  </div>;
}

export function RecurringView({ month: selectedMonth, onMonthChange }: PlanningSectionProps = {}) {
  const { data, ownerId, client, run, refresh } = useFinance();
  const [localMonth, setLocalMonth] = useState(monthStart(todayInIndia()));
  const month = selectedMonth ?? localMonth;
  const setMonth = onMonthChange ?? setLocalMonth;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [category, setCategory] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [localError, setLocalError] = useState("");
  const [paymentOccurrenceId, setPaymentOccurrenceId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [busyOccurrence, setBusyOccurrence] = useState<string | null>(null);

  useEffect(() => {
    client.rpc("ensure_recurring_occurrences", { p_month_start: month }).then(({ error }) => {
      if (!error) void refresh();
    });
  }, [client, month, refresh]);

  function startEditing(template: RecurringTemplate) {
    setEditingTemplate(template); setLocalError("");
    setName(template.name); setKind(template.kind as TransactionKind);
    setAmount(rupeesFromPaise(Number(template.amount_paise)));
    setDueDay(String(template.due_day));
    setSource(template.source_account_id || "");
    setDestination(template.destination_account_id || "");
    setCategory(template.category_id || "");
    document.getElementById("recurring-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearEditor() {
    setEditingTemplate(null); setName(""); setKind("expense"); setAmount("");
    setDueDay("1"); setSource(""); setDestination(""); setCategory(""); setLocalError("");
  }

  async function saveTemplate(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      if ((kind === "income" || kind === "expense") && !category) throw new Error("Choose a category before saving this recurring item.");
      if (source && source === destination) throw new Error("Source and destination accounts must differ.");
      const amountPaise = paiseFromRupees(amount);
      if (amountPaise <= 0) throw new Error("Enter an expected amount greater than zero.");
      const values = {
        name: name.trim(), kind, amount_paise: amountPaise, due_day: Number(dueDay),
        source_account_id: source || null, destination_account_id: destination || null,
        category_id: category || null,
      };
      await run(async () => {
        if (editingTemplate) await updateRow(client, "recurring_templates", editingTemplate.id, values, editingTemplate.version);
        else {
          await insertRow(client, "recurring_templates", ownerId, {
            id: crypto.randomUUID(), ...values, interest_paise: 0,
            starts_on: todayInIndia(), active: true,
          });
          const { error } = await client.rpc("ensure_recurring_occurrences", { p_month_start: month });
          if (error) throw error;
        }
      });
      clearEditor();
    } catch (error) { setLocalError(errorText(error)); }
  }

  function reviewPayment(occurrence: RecurringOccurrence) {
    setPaymentOccurrenceId(occurrence.id);
    setPaymentAmount(rupeesFromPaise(Number(occurrence.expected_amount_paise)));
    setPaymentError("");
  }

  async function markPaid(event: FormEvent) {
    event.preventDefault(); setPaymentError("");
    if (!paymentOccurrenceId || busyOccurrence) return;
    setBusyOccurrence(paymentOccurrenceId);
    try {
      const value = paiseFromRupees(paymentAmount);
      if (value <= 0) throw new Error("Enter an actual amount greater than zero.");
      await run(async () => {
        const { error } = await client.rpc("record_recurring_payment", {
          p_occurrence_id: paymentOccurrenceId, p_transaction_id: crypto.randomUUID(),
          p_occurred_on: todayInIndia(), p_amount_paise: value, p_note: null,
        });
        if (error) throw error;
      });
      setPaymentOccurrenceId(null);
    } catch (error) { setPaymentError(errorText(error)); }
    finally { setBusyOccurrence(null); }
  }

  const paymentOccurrence = data.recurringOccurrences.find(item => item.id === paymentOccurrenceId);
  const paymentTemplate = data.recurringTemplates.find(item => item.id === paymentOccurrence?.template_id);
  const paymentDetails = [
    paymentTemplate?.source_account_id && `From ${data.accounts.find(item => item.id === paymentTemplate.source_account_id)?.name || "account"}`,
    paymentTemplate?.destination_account_id && `To ${data.accounts.find(item => item.id === paymentTemplate.destination_account_id)?.name || "account"}`,
    paymentTemplate?.category_id && (data.categories.find(item => item.id === paymentTemplate.category_id)?.name || "category"),
  ].filter(Boolean).join(" · ");
  const occurrences = data.recurringOccurrences.filter(item => item.month_start === month).sort((a, b) => a.due_on.localeCompare(b.due_on));
  const overdueElsewhere = data.recurringOccurrences.filter(item => item.month_start !== month && item.status === "pending" && item.due_on < todayInIndia()).sort((a, b) => a.due_on.localeCompare(b.due_on));
  function occurrenceRow(occurrence: RecurringOccurrence) {
    const template = data.recurringTemplates.find(item => item.id === occurrence.template_id);
    return <div className="list-row" key={occurrence.id}><div><strong>{template?.name || "Recurring item"}</strong><div className="muted">Due {occurrence.due_on} · {template?.kind || "expense"}</div></div><div className="list-actions"><strong>{formatMoney(Number(occurrence.expected_amount_paise))}</strong><span className="pill">{occurrence.status}</span>{occurrence.status === "pending" && <><button className="button button-secondary" disabled={busyOccurrence === occurrence.id} onClick={() => reviewPayment(occurrence)}>Mark paid</button><button className="button button-quiet" onClick={() => void run(async () => { const { error } = await client.rpc("set_recurring_occurrence_status", { p_occurrence_id: occurrence.id, p_status: "skipped" }); if (error) throw error; }).catch(() => {})}>Skip</button></>}{occurrence.status === "skipped" && <button className="button button-quiet" onClick={() => void run(async () => { const { error } = await client.rpc("set_recurring_occurrence_status", { p_occurrence_id: occurrence.id, p_status: "pending" }); if (error) throw error; }).catch(() => {})}>Restore</button>}</div></div>;
  }
  return <div className="page-stack">
    {!onMonthChange && <div className="section-actions"><MonthPicker month={month} onChange={setMonth} /></div>}
    {overdueElsewhere.length > 0 && <Section title="Overdue from other months" description="Record these on the actual payment date or skip them; they stay visible until resolved."><div className="list-stack">{overdueElsewhere.map(occurrenceRow)}</div></Section>}
    <Section title={`Expected in ${monthLabel(month)}`} description="Recurring items are reminders until you mark an occurrence paid or received.">
      {occurrences.length ? <div className="list-stack">{occurrences.map(occurrenceRow)}</div> : <Empty text="No recurring items scheduled for this month." />}
    </Section>
    <Section title="Recurring templates" description="A template creates monthly reminders but never moves money automatically. Amount or due-day edits update pending reminders for this and future months. Recorded transactions and older reminder amounts stay unchanged. Pausing stops new reminders.">
      {data.recurringTemplates.length ? <div className="list-stack">{data.recurringTemplates.map(template => <div className="list-row" key={template.id}><span><strong>{template.name}</strong><span className="muted"> · day {template.due_day} · {template.kind}</span></span><span>{formatMoney(Number(template.amount_paise))} <span className="pill">{template.active ? "Active" : "Paused"}</span><button className="button button-quiet" onClick={() => startEditing(template)}>Edit</button><button className="button button-quiet" onClick={() => void run(() => updateRow(client, "recurring_templates", template.id, { active: !template.active }, template.version)).catch(error => setLocalError(errorText(error)))}>{template.active ? "Pause" : "Resume"}</button></span></div>)}</div> : <Empty text="Add rent, salary, SIPs, subscriptions, or other regular items." />}
    </Section>
    <div id="recurring-editor"><Section title={editingTemplate ? `Edit ${editingTemplate.name}` : "Add recurring item"}><form className="form-stack" onSubmit={saveTemplate}><div className="form-grid">
      <label className="field">Name<input className="input" required value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Rent" /></label>
      <label className="field">Type<select className="select" value={kind} onChange={event => { setKind(event.target.value as TransactionKind); setSource(""); setDestination(""); setCategory(""); }}>{(["income", "expense", "transfer", "investment_contribution", "card_payment", "loan_payment"] as TransactionKind[]).map(value => <option key={value} value={value}>{kindLabels[value]}</option>)}</select></label>
      {amountInput(amount, setAmount, "Expected amount (₹)")}
      <label className="field">Due day<input className="input" type="number" min="1" max="31" required value={dueDay} onChange={event => setDueDay(event.target.value)} /></label>
      {kind !== "income" && accountSelect(data.accounts.filter(account => kind === "expense" ? ["cash", "bank", "card", "investment"].includes(account.kind) : ["cash", "bank"].includes(account.kind)), source, setSource, "From account")}
      {kind !== "expense" && accountSelect(data.accounts.filter(account => kind === "income" ? ["cash", "bank"].includes(account.kind) : kind === "transfer" ? ["cash", "bank", "investment"].includes(account.kind) : kind === "investment_contribution" ? account.kind === "investment" : kind === "card_payment" ? account.kind === "card" : account.kind === "loan"), destination, setDestination, "To account")}
      {(kind === "income" || kind === "expense") && <label className="field">Category<select className="select" required value={category} onChange={event => setCategory(event.target.value)}><option value="">Choose category</option>{data.categories.filter(item => item.active && item.kind === (kind === "income" ? "income" : "expense")).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </div>{localError && <p className="form-error" role="alert">{localError}</p>}<div className="form-actions"><button className="button button-primary">{editingTemplate ? "Save recurring item" : "Add recurring item"}</button>{editingTemplate && <button type="button" className="button button-secondary" onClick={clearEditor}>Cancel editing</button>}</div></form></Section></div>
    {paymentOccurrenceId && <div className="modal-backdrop" role="presentation"><section className="modal-panel surface-card" role="dialog" aria-modal="true" aria-labelledby="recurring-payment-title"><div className="section-heading"><div><p className="app-eyebrow">RECURRING PAYMENT</p><h2 id="recurring-payment-title">Review {paymentTemplate?.name || "payment"}</h2><p>Check the actual amount before recording it. Nothing is processed until you confirm.</p></div><button type="button" className="button button-quiet" aria-label="Close" disabled={!!busyOccurrence} onClick={() => setPaymentOccurrenceId(null)}>✕</button></div>
      <form className="form-stack" onSubmit={markPaid}>
        <p className="muted">Expected {paymentOccurrence ? formatMoney(Number(paymentOccurrence.expected_amount_paise)) : "—"} · due {paymentOccurrence?.due_on || "—"} · recording on {todayInIndia()}</p>
        {paymentDetails && <p className="muted">{paymentDetails}</p>}
        <label className="field">Actual amount to record (₹)<input className="input" type="number" min="0.01" step="0.01" required autoFocus value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></label>
        <p className="muted">Changing this amount affects only this payment, not the recurring template.</p>
        {paymentOccurrence?.status !== "pending" && <p className="form-error" role="alert">This reminder is no longer pending. Close this window and review its status.</p>}
        {paymentError && <p className="form-error" role="alert">{paymentError}</p>}
        <div className="section-actions"><button type="button" className="button button-secondary" disabled={!!busyOccurrence} onClick={() => setPaymentOccurrenceId(null)}>Cancel</button><button className="button button-primary" disabled={!!busyOccurrence || paymentOccurrence?.status !== "pending"}>{busyOccurrence ? "Recording…" : "Confirm and record payment"}</button></div>
      </form>
    </section></div>}
  </div>;
}

interface PaymentDraft { key: string; accountId: string; amount: string; method: string; categoryId: string; }

export function GoalsView() {
  const { data, ownerId, client, run, syncStatus } = useFinance();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetOn, setTargetOn] = useState("");
  const [monthly, setMonthly] = useState("");
  const [newGoalNotes, setNewGoalNotes] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editGoalName, setEditGoalName] = useState("");
  const [editGoalTarget, setEditGoalTarget] = useState("");
  const [editGoalTargetOn, setEditGoalTargetOn] = useState("");
  const [editGoalMonthly, setEditGoalMonthly] = useState("");
  const [editGoalNotes, setEditGoalNotes] = useState("");
  const [quickAccount, setQuickAccount] = useState("");
  const [quickAmount, setQuickAmount] = useState("");
  const [excludedQuickGoals, setExcludedQuickGoals] = useState<string[]>([]);
  const [allocationGoal, setAllocationGoal] = useState("");
  const [allocationAccount, setAllocationAccount] = useState("");
  const [allocationMode, setAllocationMode] = useState<"total" | "increase">("total");
  const [allocationValue, setAllocationValue] = useState("");
  const [completing, setCompleting] = useState<Goal | null>(null);
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [reductions, setReductions] = useState<Record<string, string>>({});
  const [unreservedUses, setUnreservedUses] = useState<Record<string, string>>({});
  const [completionNote, setCompletionNote] = useState("");
  const [localError, setLocalError] = useState("");
  const balances = useMemo(() => balancesOn(data), [data]);
  const activeGoals = data.goals.filter(goal => goal.status === "active");
  const selectedQuickGoals = activeGoals.filter(goal => !excludedQuickGoals.includes(goal.id));
  const cashAccounts = data.accounts.filter(account => account.active && (account.kind === "bank" || account.kind === "cash"));
  const selectedAllocationAccount = data.accounts.find(account => account.id === allocationAccount);
  const selectedAllocation = data.goalAllocations.find(item => item.goal_id === allocationGoal && item.account_id === allocationAccount);
  const currentReservation = Number(selectedAllocation?.cash_amount_paise || 0);

  function existingAllocationValue(goalId: string, accountId: string): string {
    const existing = data.goalAllocations.find(item => item.goal_id === goalId && item.account_id === accountId);
    return existing ? (existing.investment_share_ppm !== null ? String(Number(existing.investment_share_ppm) / 10_000) : rupeesFromPaise(Number(existing.cash_amount_paise || 0))) : "";
  }

  async function addGoal(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      await run(() => insertRow(client, "goals", ownerId, {
        id: crypto.randomUUID(), name: name.trim(), target_paise: target ? paiseFromRupees(target) : null,
        target_on: targetOn || null, monthly_contribution_paise: monthly ? paiseFromRupees(monthly) : null,
        status: "active", notes: newGoalNotes.trim() || null,
      }));
      setName(""); setTarget(""); setTargetOn(""); setMonthly(""); setNewGoalNotes("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  function startGoalEdit(goal: Goal) {
    setEditingGoalId(goal.id);
    setEditGoalName(goal.name);
    setEditGoalTarget(goal.target_paise === null ? "" : rupeesFromPaise(Number(goal.target_paise)));
    setEditGoalTargetOn(goal.target_on || "");
    setEditGoalMonthly(goal.monthly_contribution_paise === null ? "" : rupeesFromPaise(Number(goal.monthly_contribution_paise)));
    setEditGoalNotes(goal.notes || "");
    setAllocationGoal(""); setLocalError("");
  }

  async function saveGoalEdit(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    const goal = data.goals.find(item => item.id === editingGoalId);
    if (!goal) return;
    try {
      const nextName = editGoalName.trim();
      if (!nextName) throw new Error("Enter a goal name.");
      const changes: Record<string, unknown> = { name: nextName, notes: editGoalNotes.trim() || null };
      if (goal.status !== "completed") {
        changes.target_paise = editGoalTarget ? paiseFromRupees(editGoalTarget) : null;
        if (changes.target_paise === 0) throw new Error("A goal target must be positive or blank.");
        changes.target_on = editGoalTargetOn || null;
        changes.monthly_contribution_paise = editGoalMonthly ? paiseFromRupees(editGoalMonthly) : null;
      }
      await run(() => updateRow(client, "goals", goal.id, changes, goal.version));
      setEditingGoalId(null);
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function doQuickSave(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try {
      if (!selectedQuickGoals.length) throw new Error("Select at least one active goal for Quick Save.");
      await run(() => quickSave(client, quickAccount, paiseFromRupees(quickAmount), selectedQuickGoals.map(goal => goal.id)));
      setQuickAmount("");
    }
    catch (error) { setLocalError(errorText(error)); }
  }

  async function saveAllocation(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if (!selectedAllocationAccount) return;
    try {
      const change: Record<string, unknown> = { goal_id: allocationGoal, account_id: allocationAccount };
      if (selectedAllocationAccount.kind === "investment") {
        const ppm = Math.round(Number(allocationValue) * 10_000);
        if (!Number.isInteger(ppm) || ppm < 0 || ppm > 1_000_000) throw new Error("Enter a share from 0% to 100%.");
        change.investment_share_ppm = ppm;
      } else if (allocationMode === "increase") {
        const increase = paiseFromRupees(allocationValue);
        change.cash_amount_paise = increasedCashReservation(currentReservation, increase, availableCash(selectedAllocationAccount, data, balances));
      } else change.cash_amount_paise = paiseFromRupees(allocationValue);
      await run(() => setGoalAllocations(client, [change]));
      setAllocationGoal(""); setAllocationAccount(""); setAllocationValue("");
    } catch (error) { setLocalError(errorText(error)); }
  }

  function toggleAllocation(goalId: string) {
    setLocalError("");
    setEditingGoalId(null);
    setAllocationGoal(current => current === goalId ? "" : goalId);
    setAllocationAccount(""); setAllocationMode("total"); setAllocationValue("");
  }

  function openCompletion(goal: Goal) {
    setEditingGoalId(null);
    setCompleting(goal);
    setPayments([{ key: crypto.randomUUID(), accountId: "", amount: "", method: "", categoryId: "" }]);
    setReductions({}); setUnreservedUses({}); setCompletionNote(""); setLocalError("");
  }

  function changePayment(key: string, patch: Partial<PaymentDraft>) {
    setPayments(current => current.map(payment => payment.key === key ? { ...payment, ...patch } : payment));
  }

  const completionAllocations = completing ? data.goalAllocations.filter(allocation => allocation.goal_id === completing.id) : [];
  const otherAllocations = completing ? data.goalAllocations.filter(allocation => allocation.goal_id !== completing.id && payments.some(payment => payment.accountId === allocation.account_id)) : [];
  const paymentByAccount = new Map<string, number>();
  for (const payment of payments) {
    const numeric = Number(payment.amount || 0);
    if (payment.accountId && Number.isFinite(numeric)) paymentByAccount.set(payment.accountId, (paymentByAccount.get(payment.accountId) || 0) + Math.max(0, Math.round(numeric * 100)));
  }
  const fundingByAccount = new Map<string, { completed: number; unreserved: number; extra: number; minimumOther: number }>();
  for (const [accountId, spending] of paymentByAccount) {
    const account = data.accounts.find(item => item.id === accountId);
    if (!account || account.kind === "card") continue;
    const balance = balances.get(accountId) || 0;
    const completed = completionAllocations.filter(item => item.account_id === accountId).reduce((sum, item) => sum + goalAllocationValue(item, account, balance), 0);
    const otherReserved = otherAllocations.filter(item => item.account_id === accountId).reduce((sum, item) => sum + goalAllocationValue(item, account, balance), 0);
    const unreserved = Math.max(0, balance - completed - otherReserved);
    const extra = Math.max(0, spending - completed);
    fundingByAccount.set(accountId, { completed, unreserved, extra, minimumOther: Math.max(0, extra - unreserved) });
  }

  async function finishGoal(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    if (!completing) return;
    try {
      if (!navigator.onLine || syncStatus === "offline") throw new Error("Connect to the internet before completing a goal.");
      const finalPayments: GoalPayment[] = payments.map(payment => ({
        id: crypto.randomUUID(), account_id: payment.accountId, amount_paise: paiseFromRupees(payment.amount),
        payment_method: payment.method.trim(), category_id: payment.categoryId || null,
      }));
      if (finalPayments.some(payment => !payment.account_id || !payment.payment_method || !payment.category_id || payment.amount_paise <= 0)) throw new Error("Choose a source account, positive amount, spending category, and payment method for every payment.");
      const changes: Record<string, unknown>[] = completionAllocations.map(allocation => ({
        goal_id: allocation.goal_id, account_id: allocation.account_id,
        ...(allocation.cash_amount_paise !== null ? { cash_amount_paise: 0 } : { investment_share_ppm: 0 }),
      }));
      for (const allocation of otherAllocations) {
        const entered = reductions[allocation.id];
        const account = data.accounts.find(item => item.id === allocation.account_id)!;
        if (account.kind === "investment") {
          const balance = balances.get(account.id) || 0;
          const spending = paymentByAccount.get(account.id) || 0;
          const afterBalance = balance - spending;
          const oldValue = goalAllocationValue(allocation, account, balance);
          const reduction = entered ? paiseFromRupees(entered) : 0;
          if (reduction > oldValue) throw new Error("Reduction exceeds the other goal's investment value.");
          if (afterBalance < 0) throw new Error("Investment spending exceeds its latest recorded value.");
          const targetValue = oldValue - reduction;
          const newShare = afterBalance > 0 ? Math.floor(targetValue * 1_000_000 / afterBalance) : 0;
          if (newShare > 1_000_000) throw new Error("Release more from other goals before this investment payment.");
          changes.push({ goal_id: allocation.goal_id, account_id: allocation.account_id, investment_share_ppm: newShare });
        } else {
          if (!entered || Number(entered) <= 0) continue;
          const current = Number(allocation.cash_amount_paise || 0);
          const reduction = paiseFromRupees(entered);
          if (reduction > current) throw new Error("Reduction exceeds the other goal's reservation.");
          changes.push({ goal_id: allocation.goal_id, account_id: allocation.account_id, cash_amount_paise: current - reduction });
        }
      }
      for (const [accountId, funding] of fundingByAccount) {
        const account = data.accounts.find(item => item.id === accountId)!;
        const choice = funding.extra > 0 ? unreservedUses[accountId] : "0";
        if (funding.extra > 0 && (choice === undefined || choice === "")) throw new Error(`Choose explicitly how much unreserved money to use from ${account.name}. Enter 0 if you want to reduce other goals instead.`);
        const unreservedUse = choice ? paiseFromRupees(choice) : 0;
        if (unreservedUse > funding.unreserved) throw new Error(`${account.name} has only ${formatMoney(funding.unreserved)} unreserved.`);
        const reductionValue = otherAllocations.filter(item => item.account_id === accountId).reduce((sum, allocation) => sum + (reductions[allocation.id] ? paiseFromRupees(reductions[allocation.id]) : 0), 0);
        if (unreservedUse + reductionValue !== funding.extra) throw new Error(`For ${account.name}, choose exactly ${formatMoney(funding.extra)} beyond the completed goal: unreserved cash plus named other-goal reductions must add to that amount.`);
      }
      await run(() => completeGoal(client, completing.id, finalPayments, changes, completionNote.trim() || undefined));
      setCompleting(null);
    } catch (error) { setLocalError(errorText(error)); }
  }

  return <div className="page-stack">
    <Section title="Quick Save" description="Choose an account and amount, then choose which active goals receive an equal share. All are selected by default."><form className="form-stack" onSubmit={doQuickSave}>
      {accountSelect(cashAccounts, quickAccount, setQuickAccount, "Save from")}
      {quickAccount && <p className="muted">Available in this account: {formatMoney(availableCash(cashAccounts.find(item => item.id === quickAccount)!, data, balances))}</p>}
      {amountInput(quickAmount, setQuickAmount)}
      <fieldset className="goal-checklist"><legend>Goals to save toward</legend>
        {activeGoals.length ? activeGoals.map(goal => <label className="goal-check-option" key={goal.id}><input type="checkbox" checked={!excludedQuickGoals.includes(goal.id)} onChange={event => setExcludedQuickGoals(current => event.target.checked ? current.filter(id => id !== goal.id) : [...current, goal.id])} /><span>{goal.name}</span></label>) : <p className="muted">Create a goal to use Quick Save.</p>}
      </fieldset>
      <p className="muted">{selectedQuickGoals.length} of {activeGoals.length} active goal{activeGoals.length === 1 ? "" : "s"} selected.</p>
      <button className="button button-primary" disabled={!selectedQuickGoals.length}>Split across selected goals</button>
    </form></Section>
    <h2 className="goal-list-heading">All goals</h2>
    <div className="goal-grid">{data.goals.length ? data.goals.map(goal => {
      const funded = fundedForGoal(goal, data, balances);
      const allocations = data.goalAllocations.filter(item => item.goal_id === goal.id).map(item => ({ source: data.accounts.find(account => account.id === item.account_id)?.name || "Account", amountPaise: goalAllocationValue(item, data.accounts.find(account => account.id === item.account_id), balances.get(item.account_id) || 0) }));
      const completion = data.goalCompletions.find(item => item.goal_id === goal.id);
      if (completion) for (const payment of data.goalCompletionPayments.filter(item => item.completion_id === completion.id)) { const transaction = data.transactions.find(item => item.id === payment.transaction_id); if (transaction) allocations.push({ source: `${data.accounts.find(account => account.id === transaction.source_account_id)?.name || "Account"} · ${payment.payment_method}`, amountPaise: Number(transaction.amount_paise) }); }
      return <GoalCard key={goal.id} name={goal.name} targetPaise={goal.target_paise === null ? null : Number(goal.target_paise)} fundedPaise={funded} monthlySavingPaise={goal.monthly_contribution_paise === null ? null : Number(goal.monthly_contribution_paise)} estimatedCompletion={goal.status === "completed" ? undefined : projectedGoalDate(goal, funded) || undefined} allocations={allocations} status={goal.status === "completed" ? "completed" : goal.status === "paused" ? "paused" : "active"} completedSpentPaise={completion ? Number(completion.total_spent_paise) : undefined} completedOn={goal.completed_at} notes={goal.notes}>
        <div className="goal-card-actions"><button type="button" className="button button-quiet" aria-expanded={editingGoalId === goal.id} onClick={() => editingGoalId === goal.id ? setEditingGoalId(null) : startGoalEdit(goal)}>{editingGoalId === goal.id ? "Close edit" : "Edit"}</button>{(goal.status === "active" || goal.status === "paused") && <><button type="button" className="button button-secondary" aria-expanded={allocationGoal === goal.id} onClick={() => toggleAllocation(goal.id)}>{allocationGoal === goal.id ? "Close assignment" : "Assign money"}</button><button type="button" className="button button-secondary" onClick={() => openCompletion(goal)}>Complete and record spending</button>{goal.status === "active" ? <button type="button" className="button button-quiet" onClick={() => void run(() => updateRow(client, "goals", goal.id, { status: "paused" }, goal.version)).catch(() => {})}>Pause</button> : <button type="button" className="button button-quiet" onClick={() => void run(() => updateRow(client, "goals", goal.id, { status: "active" }, goal.version)).catch(() => {})}>Resume</button>}</>}</div>
        {editingGoalId === goal.id && <form className="form-stack goal-inline-form" onSubmit={saveGoalEdit} aria-label={`Edit ${goal.name}`}>
          <label className="field">Name<input className="input" required maxLength={100} value={editGoalName} onChange={event => setEditGoalName(event.target.value)} /></label>
          {goal.status !== "completed" && <><label className="field">Target (₹, optional)<input className="input" type="number" min="0.01" step="0.01" value={editGoalTarget} onChange={event => setEditGoalTarget(event.target.value)} /></label><label className="field">Target date (optional)<input className="input" type="date" value={editGoalTargetOn} onChange={event => setEditGoalTargetOn(event.target.value)} /></label><label className="field">Planned monthly saving (₹, optional)<input className="input" type="number" min="0" step="0.01" value={editGoalMonthly} onChange={event => setEditGoalMonthly(event.target.value)} /></label></>}
          {goal.status === "completed" && <p className="muted">Completed goal targets and plans stay unchanged to preserve their recorded history.</p>}
          <label className="field">Notes (optional)<textarea className="input" rows={3} value={editGoalNotes} onChange={event => setEditGoalNotes(event.target.value)} /></label>
          {localError && <p className="form-error" role="alert">{localError}</p>}
          <div className="section-actions"><button className="button button-primary">Save goal</button><button type="button" className="button button-quiet" onClick={() => setEditingGoalId(null)}>Cancel</button></div>
        </form>}
        {(goal.status === "active" || goal.status === "paused") && <>
          {allocationGoal === goal.id && <form className="form-stack goal-inline-form" onSubmit={saveAllocation} aria-label={`Assign money to ${goal.name}`}>
            <p className="muted">Reserve money for this goal without changing the account balance.</p>
            {accountSelect(data.accounts.filter(item => ["cash", "bank", "investment"].includes(item.kind)), allocationAccount, value => { setAllocationAccount(value); const investment = data.accounts.find(item => item.id === value)?.kind === "investment"; if (investment) setAllocationMode("total"); setAllocationValue(investment || allocationMode === "total" ? existingAllocationValue(goal.id, value) : ""); }, "Linked account or holding")}
            {selectedAllocationAccount?.kind !== "investment" && <label className="field">Change reservation<select className="select" value={allocationMode} onChange={event => { const mode = event.target.value as "total" | "increase"; setAllocationMode(mode); setAllocationValue(mode === "total" ? existingAllocationValue(goal.id, allocationAccount) : ""); }}><option value="total">Set total reserved amount</option><option value="increase">Increase by an amount</option></select></label>}
            {amountInput(allocationValue, setAllocationValue, selectedAllocationAccount?.kind === "investment" ? "Share of holding (%)" : allocationMode === "increase" ? "Add to this goal (₹)" : "Total reserved in this account (₹)")}
            {selectedAllocationAccount?.kind === "investment" ? <p className="muted">Investment reservations use a percentage of the holding.</p> : allocationMode === "increase" ? <p className="muted">Currently reserved here: {formatMoney(currentReservation)}. Available to add: {selectedAllocationAccount ? formatMoney(availableCash(selectedAllocationAccount, data, balances)) : "choose an account"}.</p> : <p className="muted">Enter the new total, or 0 to remove this reservation.</p>}
            {localError && <p className="form-error" role="alert">{localError}</p>}
            <button className="button button-primary">Update allocation</button>
          </form>}</>}
      </GoalCard>;
    }) : <Empty text="Add a goal to see what you are saving for and where its money is held." />}</div>
    <Section title="Create a goal"><form className="form-stack" onSubmit={addGoal}>
        <label className="field">Goal name<input className="input" required value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Emergency Fund" /></label>
        <label className="field">Target (₹, optional)<input className="input" type="number" min="0.01" step="0.01" value={target} onChange={event => setTarget(event.target.value)} /></label>
        <label className="field">Planned monthly saving (₹, optional)<input className="input" type="number" min="0" step="0.01" value={monthly} onChange={event => setMonthly(event.target.value)} /></label>
        <label className="field">Target date (optional)<input className="input" type="date" value={targetOn} onChange={event => setTargetOn(event.target.value)} /></label>
        <label className="field">Notes (optional)<textarea className="input" rows={3} value={newGoalNotes} onChange={event => setNewGoalNotes(event.target.value)} /></label>
        <button className="button button-secondary">Create goal</button>
      </form></Section>
    {localError && !allocationGoal && !editingGoalId && !completing && <p className="form-error" role="alert">{localError}</p>}
    {completing && <div className="modal-backdrop" role="presentation"><section className="modal-panel surface-card" role="dialog" aria-modal="true" aria-labelledby="complete-title"><div className="section-heading"><div><p className="app-eyebrow">GOAL COMPLETION</p><h2 id="complete-title">Complete {completing.name}</h2><p>Choose exactly where the spending comes from. The app will not take money from other goals without your choice.</p></div><button className="button button-quiet" onClick={() => setCompleting(null)} aria-label="Close">✕</button></div>
      <form className="form-stack" onSubmit={finishGoal}>
        {payments.map((payment, index) => <div className="payment-row" key={payment.key}><h3>Payment {index + 1}</h3><div className="form-grid">
          {accountSelect(data.accounts.filter(item => ["bank", "cash", "card", "investment"].includes(item.kind)), payment.accountId, value => changePayment(payment.key, { accountId: value }), "Paid from")}
          {amountInput(payment.amount, value => changePayment(payment.key, { amount: value }))}
          <label className="field">Spending method<input className="input" required placeholder="UPI, card, cash, bank transfer…" value={payment.method} onChange={event => changePayment(payment.key, { method: event.target.value })} /></label>
          <label className="field">Spending category<select className="select" required value={payment.categoryId} onChange={event => changePayment(payment.key, { categoryId: event.target.value })}><option value="">Choose category</option>{data.categories.filter(item => item.active && item.kind === "expense").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>{payments.length > 1 && <button type="button" className="button button-quiet" onClick={() => setPayments(current => current.filter(item => item.key !== payment.key))}>Remove payment</button>}</div>)}
        <button type="button" className="button button-quiet" onClick={() => setPayments(current => [...current, { key: crypto.randomUUID(), accountId: "", amount: "", method: "", categoryId: "" }])}>+ Add another source account</button>
        <div className="completion-breakdown"><h3>Funding review</h3>{completionAllocations.length ? <p>Completing this goal releases its current reservations: {completionAllocations.map(item => `${data.accounts.find(account => account.id === item.account_id)?.name}: ${formatMoney(goalAllocationValue(item, data.accounts.find(account => account.id === item.account_id), balances.get(item.account_id) || 0))}`).join("; ")}.</p> : <p>This goal has no currently reserved money. Choose a source with available funds.</p>}
          {[...paymentByAccount].map(([accountId, spending]) => { const account = data.accounts.find(item => item.id === accountId); if (account?.kind === "card") return <p key={accountId}>{account.name}: {formatMoney(spending)} will be recorded as a card purchase and increase card debt. Any goal reservations in other accounts will be released; no cash leaves those accounts until you record a card payment.</p>; const funding = fundingByAccount.get(accountId); return <div key={accountId} className="form-stack"><p>{account?.name}: spending {formatMoney(spending)}; this goal has {formatMoney(funding?.completed || 0)} reserved here; {formatMoney(funding?.unreserved || 0)} is currently unreserved. {account?.kind === "investment" ? "Other goals' shares will be adjusted to preserve their value unless you explicitly reduce them below." : "Other goal reservations remain unchanged unless you choose reductions below."}</p>{funding && funding.extra > 0 && <><p>Choose where the extra {formatMoney(funding.extra)} comes from on this completion. No source is selected automatically.{funding.minimumOther > 0 && ` At least ${formatMoney(funding.minimumOther)} must come from named other goals.`}</p><label className="field">Use unreserved amount from {account?.name} (₹, enter 0 if none)<input className="input" type="number" min="0" max={rupeesFromPaise(funding.unreserved)} step="0.01" required value={unreservedUses[accountId] ?? ""} onChange={event => setUnreservedUses(current => ({ ...current, [accountId]: event.target.value }))} /></label></>}</div>; })}
          {otherAllocations.length > 0 && <div className="form-stack"><p>To use another goal, enter its exact reduction below. The selected reductions and unreserved amount must equal the extra spending for each account.</p>{otherAllocations.map(allocation => {
            const account = data.accounts.find(item => item.id === allocation.account_id)!;
            return <label className="field" key={allocation.id}>Reduce {data.goals.find(item => item.id === allocation.goal_id)?.name} in {account.name} by ₹ (currently {formatMoney(goalAllocationValue(allocation, account, balances.get(account.id) || 0))})<input className="input" type="number" min="0" step="0.01" value={reductions[allocation.id] || ""} onChange={event => setReductions(current => ({ ...current, [allocation.id]: event.target.value }))} /></label>;
          })}</div>}
        </div>
        <label className="field">Note (optional)<input className="input" value={completionNote} onChange={event => setCompletionNote(event.target.value)} /></label>
        {localError && <p className="form-error" role="alert">{localError}</p>}
        <div className="section-actions"><button type="button" className="button button-quiet" onClick={() => setCompleting(null)}>Cancel</button><button className="button button-primary">Record spending and complete goal</button></div>
      </form>
    </section></div>}
  </div>;
}

export function AlertsView() {
  const { data, ownerId, client, run } = useFinance();
  const alerts = buildAlerts(data, todayInIndia());
  const stateFor = (key: string) => data.alertStates.find(state => state.alert_key === key);
  const active = filterActiveAlerts(alerts, data.alertStates, new Date().toISOString());

  async function changeAlert(key: string, state: "dismissed" | "snoozed", until: string | null) {
    const existing = stateFor(key);
    if (existing) await run(() => updateRow(client, "alert_states", existing.id, { state, snoozed_until: until }));
    else await run(() => insertRow(client, "alert_states", ownerId, { id: crypto.randomUUID(), alert_key: key, state, snoozed_until: until }));
  }

  return <div className="page-stack">
    <Section title="Active alerts" description="Dismissal is saved across your phone and PC. New monthly occurrences can alert again.">
      {active.length ? <div className="list-stack">{active.map(alert => <AlertCard key={alert.key} title={alert.title} description={alert.description} severity={alert.severity} actionLabel={alert.href ? "Open" : undefined} onAction={alert.href ? () => { window.location.href = alert.href!; } : undefined} onDismiss={() => void changeAlert(alert.key, "dismissed", null)} onSnooze={() => void changeAlert(alert.key, "snoozed", new Date(Date.now() + 86_400_000).toISOString())} />)}</div> : <Empty text="No active alerts right now." />}
    </Section>
    <Section title="Dismissed and snoozed" description="Restore an alert if you want to see it again.">
      {data.alertStates.length ? <div className="list-stack">{data.alertStates.map(state => <div className="list-row" key={state.id}><span><strong>{alerts.find(alert => alert.key === state.alert_key)?.title || state.alert_key}</strong><span className="muted"> · {state.state}{state.snoozed_until ? ` until ${new Date(state.snoozed_until).toLocaleString("en-IN")}` : ""}</span></span><button className="button button-quiet" onClick={() => void run(() => deleteRow(client, "alert_states", state.id)).catch(() => {})}>Restore</button></div>)}</div> : <Empty text="No dismissed alerts." />}
    </Section>
  </div>;
}

export function SettingsView() {
  const { data, ownerId, client, run, pending, syncStatus } = useFinance();
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState<"income" | "expense">("expense");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryKind, setEditingCategoryKind] = useState<"income" | "expense">("expense");
  const [exportPass, setExportPass] = useState("");
  const [importPass, setImportPass] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPayload | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");

  async function addCategory(event: FormEvent) {
    event.preventDefault(); setLocalError("");
    try { await run(() => insertRow(client, "categories", ownerId, { id: crypto.randomUUID(), name: categoryName.trim(), kind: categoryKind, active: true })); setCategoryName(""); }
    catch (error) { setLocalError(errorText(error)); }
  }

  function categoryIsReferenced(categoryId: string): boolean {
    return data.transactions.some(item => item.category_id === categoryId)
      || data.planItems.some(item => item.category_id === categoryId)
      || data.recurringTemplates.some(item => item.category_id === categoryId);
  }

  function startCategoryEdit(category: FinanceData["categories"][number]) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryKind(category.kind);
    setLocalError(""); setLocalSuccess("");
  }

  async function saveCategoryEdit(event: FormEvent) {
    event.preventDefault(); setLocalError(""); setLocalSuccess("");
    const category = data.categories.find(item => item.id === editingCategoryId);
    if (!category) return;
    try {
      const nextName = editingCategoryName.trim();
      if (!nextName) throw new Error("Enter a category name.");
      if (editingCategoryKind !== category.kind && categoryIsReferenced(category.id)) {
        throw new Error("A category used by transactions, plans, or recurring items cannot change type. You can still rename it.");
      }
      await run(() => updateRow(client, "categories", category.id, { name: nextName, kind: editingCategoryKind }, category.version));
      setEditingCategoryId(null);
      setLocalSuccess(`Category “${nextName}” updated. Its existing records now show this name.`);
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function archiveCategory(category: FinanceData["categories"][number]) {
    setLocalError(""); setLocalSuccess("");
    const linkedRecurring = data.recurringTemplates.some(item => item.category_id === category.id);
    const currentMonth = monthStart(todayInIndia());
    const currentOrFuturePlan = data.planItems.some(item => item.category_id === category.id && data.monthlyPlans.some(plan => plan.id === item.plan_id && plan.month_start >= currentMonth));
    if (linkedRecurring || currentOrFuturePlan) {
      setLocalError(`“${category.name}” is used by a recurring item or a current/future monthly plan. Change those items to another category before archiving it.`);
      return;
    }
    if (!window.confirm(`Archive “${category.name}”? It will be hidden from active categories and new entry forms. Past records will keep it.`)) return;
    try {
      await run(() => updateRow(client, "categories", category.id, { active: false }, category.version));
      if (editingCategoryId === category.id) setEditingCategoryId(null);
      setLocalSuccess(`“${category.name}” archived. Past records are unchanged.`);
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function unarchiveCategory(category: FinanceData["categories"][number]) {
    setLocalError(""); setLocalSuccess("");
    try {
      await run(() => updateRow(client, "categories", category.id, { active: true }, category.version));
      setLocalSuccess(`“${category.name}” unarchived.`);
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function addDefaults() {
    const defaults: { name: string; kind: "income" | "expense" }[] = [
      { name: "Salary", kind: "income" }, { name: "Other income", kind: "income" },
      { name: "Rent", kind: "expense" }, { name: "Food", kind: "expense" },
      { name: "Travel", kind: "expense" }, { name: "Bills", kind: "expense" },
      { name: "Shopping", kind: "expense" }, { name: "Health", kind: "expense" },
      { name: "Goal spending", kind: "expense" }, { name: "Interest", kind: "expense" },
    ];
    setLocalError("");
    try { await run(async () => {
      for (const item of defaults) {
        const existing = data.categories.find(category => category.name.toLowerCase() === item.name.toLowerCase() && category.kind === item.kind);
        if (existing && !existing.active) await updateRow(client, "categories", existing.id, { active: true }, existing.version);
        else if (!existing) await insertRow(client, "categories", ownerId, { id: crypto.randomUUID(), ...item, active: true });
      }
    }); }
    catch (error) { setLocalError(errorText(error)); }
  }

  async function exportEncrypted() {
    setLocalError(""); setLocalSuccess("");
    try {
      if (!navigator.onLine || pending.length) throw new Error("Sync all pending transactions and connect to the internet before exporting a complete backup.");
      const snapshot = await exportBackupSnapshot(client);
      const text = await encryptBackup(snapshot, exportPass);
      downloadText(`my-money-backup-${todayInIndia()}.json`, text);
      const alertKey = `backup:${monthStart(todayInIndia())}`;
      const existing = data.alertStates.find(state => state.alert_key === alertKey);
      if (existing) await run(() => updateRow(client, "alert_states", existing.id, { state: "dismissed", snoozed_until: null }));
      else await run(() => insertRow(client, "alert_states", ownerId, { id: crypto.randomUUID(), alert_key: alertKey, state: "dismissed", snoozed_until: null }));
      setExportPass(""); setLocalSuccess("Encrypted backup downloaded. Keep the file and passphrase in separate safe places.");
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function previewImport() {
    setLocalError(""); setLocalSuccess(""); setPreview(null);
    if (!importFile) { setLocalError("Choose an encrypted backup file."); return; }
    try { setPreview(await decryptBackup(await importFile.text(), importPass)); }
    catch (error) { setLocalError(errorText(error)); }
  }

  async function restoreImport() {
    if (!preview) return;
    if (!window.confirm("Restore this backup into this empty project? The app will reject the import if any financial records already exist.")) return;
    setLocalError("");
    try {
      await run(async () => {
        const { error } = await client.rpc("restore_backup", { p_payload: { schema_version: 1, ...preview.tables } });
        if (error) throw error;
      });
      setPreview(null); setImportPass(""); setImportFile(null); setLocalSuccess("Backup restored. Review balances, goals, and reports before entering new transactions.");
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setLocalError(""); setLocalSuccess("");
    try {
      if (newPassword.length < 12) throw new Error("Use a password of at least 12 characters.");
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword(""); setLocalSuccess("Password updated.");
    } catch (error) { setLocalError(errorText(error)); }
  }

  async function signOut() {
    if (pending.length && !window.confirm(`${pending.length} transaction(s) have not synced. Signing out will remove those pending items from this device. Continue?`)) return;
    const scope = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}:${ownerId}`;
    await clearOfflineScope(scope);
    await client.auth.signOut();
  }

  const count = Object.values(BACKUP_TABLES).reduce((sum, table) => sum + (preview?.tables[table]?.length || 0), 0);
  const previewData = preview ? Object.fromEntries(Object.entries(BACKUP_TABLES).map(([key, table]) => [key, preview.tables[table]])) as unknown as FinanceData : null;
  const previewTotals = previewData ? totalsOn(previewData) : null;
  const activeCategories = data.categories.filter(item => item.active);
  const archivedCategories = data.categories.filter(item => !item.active);
  return <div className="page-stack">
    <div className="two-column-grid">
      <Section title="Categories" description="Edit active categories or archive ones you no longer use. Archived categories are hidden from new entry forms but stay in past records.">
        <button className="button button-secondary" onClick={() => void addDefaults()}>Add suggested categories</button>
        <form className="form-stack inline-form" onSubmit={addCategory}><div className="form-grid"><label className="field">Name<input className="input" required value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label><label className="field">Type<select className="select" value={categoryKind} onChange={event => setCategoryKind(event.target.value as "income" | "expense")}><option value="expense">Expense</option><option value="income">Income</option></select></label></div><button className="button button-primary">Add category</button></form>
        {activeCategories.length ? <div className="list-stack category-list">{activeCategories.map(item => <div className="list-row category-row" key={item.id}>
          {editingCategoryId === item.id ? <form className="form-stack category-edit-form" onSubmit={saveCategoryEdit}>
            <div className="form-grid"><label className="field">Name<input className="input" required maxLength={100} value={editingCategoryName} onChange={event => setEditingCategoryName(event.target.value)} /></label><label className="field">Type<select className="select" disabled={categoryIsReferenced(item.id)} value={editingCategoryKind} onChange={event => setEditingCategoryKind(event.target.value as "income" | "expense")}><option value="expense">Expense</option><option value="income">Income</option></select></label></div>
            {categoryIsReferenced(item.id) && <p className="muted">Type cannot change while this category has linked records.</p>}
            <div className="list-actions"><button className="button button-primary" type="submit">Save</button><button className="button button-quiet" type="button" onClick={() => setEditingCategoryId(null)}>Cancel</button></div>
          </form> : <><span><strong>{item.name}</strong><span className="muted"> · {item.kind}</span></span><span className="list-actions"><button className="button button-quiet" type="button" onClick={() => startCategoryEdit(item)}>Edit</button><button className="button button-quiet" type="button" onClick={() => void archiveCategory(item)}>Archive</button></span></>}
        </div>)}</div> : <Empty text="No active categories. Add one above or unarchive a previous category." />}
        {archivedCategories.length > 0 && <details className="archived-categories"><summary>Archived categories ({archivedCategories.length})</summary><div className="list-stack">{archivedCategories.map(item => <div className="list-row category-row" key={item.id}><span><strong>{item.name}</strong><span className="muted"> · {item.kind}</span></span><button className="button button-quiet" type="button" onClick={() => void unarchiveCategory(item)}>Unarchive</button></div>)}</div></details>}
      </Section>
      <Section title="Account security" description="Only the owner account can access this application's financial data."><p>Signed in as the private owner. Sync status: <strong>{syncStatus}</strong>.</p><p>{pending.length} unsynced transaction{pending.length === 1 ? "" : "s"} on this device.</p><form className="form-stack" onSubmit={changePassword}><label className="field">New password<input className="input" type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><button className="button button-secondary">Update password</button></form><button className="button button-quiet" onClick={() => void signOut()}>Sign out</button></Section>
    </div>
    <Section title="Encrypted backup" description="Supabase Free has no automatic database backup. Export regularly and keep a copy outside this device."><div className="form-stack"><label className="field">Backup passphrase (at least 12 characters)<input className="input" type="password" minLength={12} value={exportPass} onChange={event => setExportPass(event.target.value)} /></label><div className="section-actions"><button className="button button-primary" onClick={() => void exportEncrypted()}>Download encrypted JSON</button><button className="button button-secondary" onClick={() => downloadText(`my-money-transactions-${todayInIndia()}.csv`, transactionsCsv(data), "text/csv")}>Download transactions CSV</button></div><p className="muted">CSV is plain text. The encrypted JSON contains all app data, including goals and history. Keep your passphrase separately; it cannot be recovered from the file.</p></div></Section>
    <Section title="Restore an encrypted backup" description="Restore works only in an empty project after owner setup. Preview counts and totals before importing; a failed import rolls back."><div className="form-stack"><label className="field">Backup file<input className="input" type="file" accept="application/json,.json" onChange={event => { setImportFile(event.target.files?.[0] || null); setPreview(null); }} /></label><label className="field">Backup passphrase<input className="input" type="password" value={importPass} onChange={event => setImportPass(event.target.value)} /></label><button className="button button-secondary" onClick={() => void previewImport()}>Unlock and preview</button>{preview && <div className="notice-banner"><div><strong>Backup from {new Date(preview.exported_at).toLocaleString("en-IN")}</strong><p>{count} records across {Object.keys(BACKUP_TABLES).length} tables; {preview.tables.accounts.length} accounts, {preview.tables.transactions.length} transactions, {preview.tables.goals.length} goals.</p>{previewTotals && <p>Cash {formatMoney(previewTotals.cash)} · Investments {formatMoney(previewTotals.investments)} · Debts {formatMoney(previewTotals.debts)} · Net worth {formatMoney(previewTotals.netWorth)}</p>}</div><button className="button button-primary" onClick={() => void restoreImport()}>Restore into empty project</button></div>}</div></Section>
    {localError && <p className="form-error" role="alert">{localError}</p>}{localSuccess && <p className="notice-banner" role="status">{localSuccess}</p>}
  </div>;
}
