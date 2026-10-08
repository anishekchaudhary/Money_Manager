"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppShell, type SyncStatus } from "@/components";
import { getSupabase } from "@/lib/supabase";
import { insertRow, isRetryableRequestError, loadFinanceData, postTransaction, updateRow, type PostTransactionInput } from "@/lib/data";
import { addPending, flagPending, listPending, loadSnapshot, removePending, saveSnapshot, type PendingTransaction } from "@/lib/offline";
import { monthStart, nextMonth, todayInIndia } from "@/lib/finance";
import { EMPTY_DATA, type FinanceData } from "@/lib/types";
import { DashboardView, ReportsView } from "@/features/OverviewViews";
import { AccountsView, AlertsView, GoalsView, PlanningView, SettingsView, TransactionsView } from "@/features/WorkViews";

interface FinanceContextValue {
  client: SupabaseClient;
  ownerId: string;
  data: FinanceData;
  pending: PendingTransaction[];
  syncStatus: SyncStatus;
  refresh: () => Promise<void>;
  transact: (input: PostTransactionInput) => Promise<void>;
  retryPending: (id: string) => Promise<void>;
  discardPending: (id: string) => Promise<void>;
  run: (operation: () => Promise<unknown>) => Promise<void>;
  setNotice: (value: string) => void;
}

const FinanceContext = createContext<FinanceContextValue | null>(null);

export function useFinance(): FinanceContextValue {
  const context = useContext(FinanceContext);
  if (!context) throw new Error("Finance context is not available.");
  return context;
}

function Login({ client, onSignedIn }: { client: SupabaseClient; onSignedIn: (id: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const result = await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setError(result.error.message);
    else if (result.data.user) onSignedIn(result.data.user.id);
  }

  return <main className="auth-wrap"><section className="auth-card surface-card">
    <div className="auth-mark">m.</div>
    <p className="app-eyebrow">PERSONAL FINANCE</p>
    <h1>Welcome to My Money</h1>
    <p>Sign in to see your accounts, plans, and goals on this device.</p>
    <form onSubmit={submit} className="form-stack">
      <label className="field">Email<input className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="field">Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="auth-help">Your owner account is created in Supabase during setup. This app does not offer public registration.</p>
  </section></main>;
}

const titles: Record<string, [string, string]> = {
  dashboard: ["Your money, clearly", "A calm overview of what you own, owe, plan, and save."],
  transactions: ["Transactions", "Every rupee in and out, with a clear history."],
  accounts: ["Accounts", "Where your money and investments are held."],
  plan: ["Planning & recurring", "Plan the month and manage regular income, bills, and investments."],
  goals: ["Savings goals", "See what is reserved, where it lives, and how it grows."],
  reports: ["Reports", "Follow your money over time."],
  alerts: ["Alerts", "Reminders and budget signals you can control."],
  settings: ["Settings & backup", "Keep your information portable and your account secure."],
};

function Content({ section }: { section: string }) {
  const finance = useFinance();
  async function saveDashboardAlert(key: string, state: "dismissed" | "snoozed", until: string | null) {
    const existing = finance.data.alertStates.find(item => item.alert_key === key);
    await finance.run(() => existing
      ? updateRow(finance.client, "alert_states", existing.id, { state, snoozed_until: until })
      : insertRow(finance.client, "alert_states", finance.ownerId, { id: crypto.randomUUID(), alert_key: key, state, snoozed_until: until }));
  }
  switch (section) {
    case "accounts": return <AccountsView />;
    case "transactions": return <TransactionsView />;
    case "plan": return <PlanningView />;
    case "goals": return <GoalsView />;
    case "reports": return <ReportsView data={finance.data} />;
    case "alerts": return <AlertsView />;
    case "settings": return <SettingsView />;
    default: return <DashboardView data={finance.data} onDismissAlert={key => saveDashboardAlert(key, "dismissed", null)} onSnoozeAlert={key => saveDashboardAlert(key, "snoozed", new Date(Date.now() + 86_400_000).toISOString())} />;
  }
}

export default function FinanceApp() {
  const path = usePathname();
  const section = path === "/" ? "dashboard" : path.split("/")[1];
  const client = useMemo(() => getSupabase(), []);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<FinanceData>(EMPTY_DATA);
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("syncing");
  const [notice, setNotice] = useState("");
  const flushingRef = useRef(false);
  const offlineScope = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}:${ownerId || ""}`;

  useEffect(() => {
    if (!client) { setAuthReady(true); return; }
    client.auth.getSession().then(({ data: sessionData }) => {
      setOwnerId(sessionData.session?.user.id || null);
      setAuthReady(true);
    });
    const { data: authData } = client.auth.onAuthStateChange((_event, session) => {
      setOwnerId(session?.user.id || null);
      setAuthReady(true);
    });
    return () => authData.subscription.unsubscribe();
  }, [client]);

  const refresh = useCallback(async () => {
    if (!client || !ownerId) return;
    setSyncStatus("syncing");
    try {
      const currentMonth = monthStart(todayInIndia());
      for (const month of [currentMonth, nextMonth(currentMonth)]) {
        const { error } = await client.rpc("ensure_recurring_occurrences", { p_month_start: month });
        if (error) throw error;
      }
      const loaded = await loadFinanceData(client);
      setData(loaded);
      await saveSnapshot(offlineScope, loaded);
      const items = await listPending(offlineScope);
      setPending(items);
      setSyncStatus(items.some(item => item.error) ? "needs-attention" : items.length ? "syncing" : "synced");
    } catch (error) {
      const cached = await loadSnapshot(offlineScope);
      if (cached) setData(cached);
      const items = await listPending(offlineScope);
      setPending(items);
      setSyncStatus(navigator.onLine ? "needs-attention" : "offline");
      setNotice(error instanceof Error ? error.message : "Could not load data. Try again.");
    }
  }, [client, ownerId, offlineScope]);

  const flushPending = useCallback(async () => {
    if (!client || !ownerId || !navigator.onLine || flushingRef.current) return;
    const items = await listPending(offlineScope);
    if (!items.length) return;
    flushingRef.current = true;
    setSyncStatus("syncing");
    try {
      for (const item of items) {
        if (item.error) continue;
        try {
          await postTransaction(client, item.input);
          await removePending(item.id);
        } catch (error) {
          if (!navigator.onLine || isRetryableRequestError(error)) break;
          await flagPending(item.id, error instanceof Error ? error.message : "Could not sync");
        }
      }
      await refresh();
    } finally {
      flushingRef.current = false;
    }
  }, [client, ownerId, refresh, offlineScope]);

  useEffect(() => {
    if (!ownerId) return;
    loadSnapshot(offlineScope).then(cached => { if (cached) setData(cached); });
    listPending(offlineScope).then(setPending);
    refresh().then(flushPending);
  }, [ownerId, refresh, flushPending, offlineScope]);

  useEffect(() => {
    if (!ownerId || !client) return;
    const onOnline = () => { refresh().then(flushPending); };
    const onOffline = () => setSyncStatus("offline");
    const onVisible = () => { if (document.visibilityState === "visible") refresh().then(flushPending); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    let refreshTimer: number | undefined;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void refresh(); }, 150);
    };
    const channel = client.channel("finance-refresh");
    for (const table of ["transactions", "goal_allocations", "plan_items", "accounts", "goals", "monthly_plans", "recurring_occurrences", "alert_states", "investment_valuations", "categories", "recurring_templates"]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleRefresh);
    }
    channel.subscribe();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [ownerId, client, refresh, flushPending]);

  const retryablePendingCount = pending.filter(item => !item.error).length;
  useEffect(() => {
    if (!ownerId || !retryablePendingCount) return;
    const timer = window.setInterval(() => { if (navigator.onLine) void flushPending(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [ownerId, retryablePendingCount, flushPending]);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setNotice("");
    try { await operation(); await refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Something went wrong."); throw error; }
  }, [refresh]);

  const transact = useCallback(async (input: PostTransactionInput) => {
    if (!client) throw new Error("Supabase is not configured.");
    const withId = { ...input, id: input.id || crypto.randomUUID() };
    setNotice("");
    if (!navigator.onLine) {
      await addPending(offlineScope, withId);
      setPending(await listPending(offlineScope));
      setSyncStatus("offline");
      return;
    }
    try {
      await postTransaction(client, withId);
      await refresh();
    } catch (error) {
      if (isRetryableRequestError(error)) {
        await addPending(offlineScope, withId);
        setPending(await listPending(offlineScope));
        setSyncStatus(navigator.onLine ? "needs-attention" : "offline");
        setNotice("The service is unavailable. This transaction is saved on this device and will retry when the connection returns.");
      } else {
        setNotice(error instanceof Error ? error.message : "Could not save transaction.");
        throw error;
      }
    }
  }, [client, refresh, offlineScope]);

  const retryPending = useCallback(async (id: string) => {
    const item = (await listPending(offlineScope)).find(candidate => candidate.id === id);
    if (!item) return;
    await flagPending(id, "");
    await flushPending();
  }, [offlineScope, flushPending]);

  const discardPending = useCallback(async (id: string) => {
    await removePending(id);
    setPending(await listPending(offlineScope));
  }, [offlineScope]);

  if (!client) return <main className="auth-wrap"><section className="auth-card surface-card"><div className="auth-mark">m.</div><h1>Connect your private database</h1><p>Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase project URL and publishable key, then restart the development server. Follow <code>SETUP.md</code> for exact steps.</p></section></main>;
  if (!authReady) return <main className="auth-wrap"><p>Loading your space…</p></main>;
  if (!ownerId) return <Login client={client} onSignedIn={setOwnerId} />;

  const [title, subtitle] = titles[section] || titles.dashboard;
  const value: FinanceContextValue = { client, ownerId, data, pending, syncStatus, refresh, transact, retryPending, discardPending, run, setNotice };
  return <FinanceContext.Provider value={value}>
    <AppShell title={title} subtitle={subtitle} activeHref={section === "dashboard" ? "/" : `/${section}`} syncStatus={syncStatus} primaryActionHref="/transactions?add=1">
      {notice && <div className="notice-banner" role="alert"><span>{notice}</span><button className="button button-quiet" onClick={() => setNotice("")}>Dismiss</button></div>}
      {(syncStatus === "offline" || pending.length > 0) && <div className="notice-banner" role="status">Balances and charts show the last server-confirmed data. {pending.length} pending transaction{pending.length === 1 ? " is" : "s are"} stored on this device and not included in those totals yet.</div>}
      <Content section={section} />
    </AppShell>
  </FinanceContext.Provider>;
}
