import type { ReactNode } from "react";

export type SyncStatus = "synced" | "syncing" | "offline" | "needs-attention";
export type NavIcon =
  | "dashboard"
  | "transactions"
  | "plan"
  | "accounts"
  | "goals"
  | "reports"
  | "alerts"
  | "settings";

export interface NavigationItem {
  label: string;
  href: string;
  icon: NavIcon;
  mobile?: boolean;
}

export interface AppShellProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  activeHref?: string;
  syncStatus?: SyncStatus;
  navigation?: NavigationItem[];
  primaryActionHref?: string;
  primaryActionLabel?: string;
}

const defaultNavigation: NavigationItem[] = [
  { label: "Dashboard", href: "/", icon: "dashboard", mobile: true },
  { label: "Transactions", href: "/transactions", icon: "transactions", mobile: true },
  { label: "Planning", href: "/plan", icon: "plan", mobile: true },
  { label: "Goals", href: "/goals", icon: "goals", mobile: true },
  { label: "Accounts", href: "/accounts", icon: "accounts" },
  { label: "Reports", href: "/reports", icon: "reports" },
  { label: "Alerts", href: "/alerts", icon: "alerts" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

function Icon({ name, size = 20 }: { name: NavIcon; size?: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "dashboard":
      return <svg {...shared}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "transactions":
      return <svg {...shared}><path d="M4 7h16M4 12h16M4 17h10" /><circle cx="18" cy="17" r="2" /></svg>;
    case "plan":
      return <svg {...shared}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M8 15h3M8 18h7" /></svg>;
    case "accounts":
      return <svg {...shared}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /></svg>;
    case "goals":
      return <svg {...shared}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>;
    case "reports":
      return <svg {...shared}><path d="M4 20V9M10 20V4M16 20v-7M22 20v-9M2 20h20" /></svg>;
    case "alerts":
      return <svg {...shared}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>;
    case "settings":
      return <svg {...shared}><circle cx="12" cy="12" r="3" /><path d="M4.9 6.2 7 4.9l1.9 1a7.8 7.8 0 0 1 2-.8L12 3l1.1 2.1a7.8 7.8 0 0 1 2 .8l1.9-1 2.1 1.3-.1 2.2a7.8 7.8 0 0 1 1 1.7L22 12l-2 1.9a7.8 7.8 0 0 1-1 1.7l.1 2.2-2.1 1.3-1.9-1a7.8 7.8 0 0 1-2 .8L12 21l-1.1-2.1a7.8 7.8 0 0 1-2-.8l-1.9 1-2.1-1.3.1-2.2a7.8 7.8 0 0 1-1-1.7L2 12l2-1.9a7.8 7.8 0 0 1 1-1.7Z" /></svg>;
  }
}

function navLink(item: NavigationItem, activeHref: string | undefined, className: string) {
  const active = activeHref === item.href;
  return (
    <a
      key={item.href}
      href={item.href}
      className={`${className}${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </a>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
  activeHref,
  syncStatus,
  navigation = defaultNavigation,
  primaryActionHref,
  primaryActionLabel = "Add transaction",
}: AppShellProps) {
  const mobileItems = navigation.filter((item) => item.mobile).slice(0, 4);
  const moreItems = navigation.filter((item) => !mobileItems.includes(item));
  const syncLabels: Record<SyncStatus, string> = {
    synced: "Synced",
    syncing: "Syncing",
    offline: "Offline",
    "needs-attention": "Needs attention",
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Main navigation">
        <a className="app-brand" href="/" aria-label="My Money home">
          <span className="app-brand-mark" aria-hidden="true">m.</span>
          <span className="app-brand-copy"><strong>my money</strong><small>Personal finance</small></span>
        </a>
        <span className="app-nav-caption">WORKSPACE</span>
        <nav className="app-sidebar-nav" aria-label="Sections">
          {navigation.map((item) => navLink(item, activeHref, "app-sidebar-link"))}
        </nav>
        <div className="app-sidebar-footer">
          <span className="app-owner-avatar" aria-hidden="true">M</span>
          <span><strong>Personal space</strong><small>Only you can access this</small></span>
        </div>
      </aside>

      <div className="app-main-area">
        <header className="app-topbar">
          <div className="app-page-heading">
            <p className="app-eyebrow">MY MONEY</p>
            <h1>{title}</h1>
            {subtitle && <p className="app-page-subtitle">{subtitle}</p>}
          </div>
          <div className="app-topbar-actions">
            {syncStatus && <span className={`app-sync-status status-${syncStatus}`} role="status"><span className="app-sync-dot" />{syncLabels[syncStatus]}</span>}
            {primaryActionHref && <a className="button button-primary app-topbar-primary" href={primaryActionHref}><span aria-hidden="true">＋</span>{primaryActionLabel}</a>}
          </div>
        </header>
        <main id="main-content" className="app-content">{children}</main>
      </div>

      {primaryActionHref && <a className="app-mobile-add" href={primaryActionHref} aria-label={primaryActionLabel}>＋</a>}
      <nav className="app-mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => navLink(item, activeHref, "app-mobile-link"))}
        {moreItems.length > 0 && (
          <details className="app-mobile-more">
            <summary className={`app-mobile-link${moreItems.some((item) => item.href === activeHref) ? " is-active" : ""}`}>
              <span className="app-more-icon" aria-hidden="true">•••</span><span>More</span>
            </summary>
            <div className="app-mobile-more-menu">
              {moreItems.map((item) => navLink(item, activeHref, "app-mobile-menu-link"))}
            </div>
          </details>
        )}
      </nav>
    </div>
  );
}
