import { Link, Navigate, useRouterState } from "@tanstack/react-router";
import {
  Banknote,
  BarChart3,
  BookOpen,
  Calculator,
  CalendarDays,
  ClipboardList,
  IndianRupee,
  PenLine,
  Smartphone,
  NotebookPen,
  Notebook,
  ArrowLeftRight,
  Download,
  Menu,
  Receipt,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useRefresh } from "@/lib/use-refresh";
import { SettingsDialog } from "@/components/settings-dialog";
import { PasswordDialog } from "@/components/password-dialog";
import { BackupDialog } from "@/components/backup-dialog";
import { CentreCredit } from "@/components/centre-credit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { authEnabled, deskIsOpen, signOut } from "@/lib/auth/client";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { myRole, recordLogin, type CentreRole } from "@/lib/centre.functions";
import { hydrateLedger, useLedger } from "@/lib/ledger/store";
import { pullSharedCloses, sharedBookMissing, startSharing, watchAdminBook } from "@/lib/ledger/share";
import { useMounted } from "@/lib/use-mounted";

const NAV = [
  { to: "/", label: "Desk", icon: BookOpen, group: "Today", mobile: true },
  { to: "/counter", label: "Counter", icon: PenLine, group: "Today", mobile: true },
  { to: "/gpay", label: "Personal GPay", icon: Smartphone, group: "Today", mobile: false },
  { to: "/payments", label: "Payments", icon: Banknote, group: "Today", mobile: true },
  { to: "/closing", label: "Closing", icon: Calculator, group: "Today", mobile: true },
  { to: "/credit", label: "Credit and advances", icon: ArrowLeftRight, group: "Today", mobile: true },
  { to: "/diary", label: "Diary", icon: Notebook, group: "Today", mobile: false },
  { to: "/collections", label: "Collections", icon: IndianRupee, group: "Money", mobile: false },
  { to: "/expenses", label: "Expenses", icon: Receipt, group: "Money", mobile: false },
  { to: "/salary", label: "Salary", icon: Wallet, group: "Money", mobile: false },
  { to: "/staff", label: "Staff", icon: Users, group: "People", mobile: false },
  { to: "/leave", label: "Leave", icon: CalendarDays, group: "People", mobile: false },
  { to: "/centre", label: "Centre", icon: BarChart3, group: "Review", mobile: false },
  { to: "/reports", label: "Reports", icon: ClipboardList, group: "Review", mobile: false },
  { to: "/note", label: "Notice board", icon: NotebookPen, group: "Review", mobile: false },
] as const;

const GROUPS = ["Today", "Money", "People", "Review"] as const;

const MORE_LABEL: Record<(typeof NAV)[number]["to"], string> = {
  "/": "Desk",
  "/counter": "Live counter",
  "/gpay": "Personal GPay Payments",
  "/payments": "Payments",
  "/credit": "Credit and advances",
  "/diary": "Diary",
  "/note": "Notice board",
  "/collections": "Collections",
  "/closing": "Daily closing",
  "/salary": "Salary",
  "/expenses": "Expenses",
  "/centre": "Centre performance",
  "/reports": "Consolidated reports",
  "/staff": "Staff report",
  "/leave": "Leave register",
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const centreName = useLedger((state) => state.centreName);
  const sample = useLedger((state) => state.sample);
  const sampleBanner = useLedger((state) => state.sampleBanner);
  const dismissSample = useLedger((state) => state.dismissSample);
  const startEmpty = useLedger((state) => state.startEmpty);
  const [more, setMore] = useState(false);
  const [settings, setSettings] = useState(false);
  const [backup, setBackup] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mounted = useMounted();
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? "";
  const [role, setRole] = useState<CentreRole | null | "loading">(authEnabled ? "loading" : "admin");
  const [blocked, setBlocked] = useState("");

  useEffect(() => {
    hydrateLedger();
  }, []);

  useEffect(() => {
    if (!authEnabled || !mounted || pathname === "/login" || deskIsOpen()) return;
    window.location.replace("/login");
    void signOut("/login").catch(() => undefined);
  }, [mounted, pathname]);

  useEffect(() => {
    if (!authEnabled || !mounted || isPending || !userId || !deskIsOpen()) return;
    let stop = () => {};
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setRole(null);
      setBlocked("The book is taking too long. Check the connection, then open it again.");
    }, 12000);
    void myRole()
      .then(async ({ role: next }) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        if (!next) {
          setRole(null);
          setBlocked("This account is not on the centre book.");
          return;
        }
        setBlocked("");
        setRole(next);
        try {
          await startSharing(next);
        } catch (error) {
          if (!cancelled) setBlocked(error instanceof Error ? error.message : "The saved book did not load.");
        }
        if (cancelled) return;
        if (sharedBookMissing()) {
          setRole(null);
          setBlocked("The admin has to sign in once before staff can enter a charge.");
          return;
        }
        if (sessionStorage.getItem("centre-login-logged") !== userId) {
          void recordLogin({ data: { screen: `${window.screen.width}×${window.screen.height}` } })
            .then(() => sessionStorage.setItem("centre-login-logged", userId))
            .catch(() => undefined);
        }
        if (next === "admin") stop = watchAdminBook();
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        if (cancelled) return;
        setRole(null);
        setBlocked(error instanceof Error ? error.message : "Could not open the account.");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [mounted, isPending, userId]);

  useRefresh(() => {
    if (role !== "admin" && role !== "closer") return;
    if (pathname === "/closing") return;
    return pullSharedCloses();
  }, 20000, [role, pathname]);

  if (pathname === "/login") return <>{children}</>;

  if (authEnabled && (!mounted || isPending || (user && role === "loading"))) {
    return <p className="grid min-h-dvh place-items-center text-sm text-muted">Opening the book…</p>;
  }

  if (authEnabled && !user) return <RedirectToSignIn />;

  if (authEnabled && role !== "admin" && role !== "employee" && role !== "closer") {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-muted">{blocked || "This account cannot open the book."}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={() => window.location.reload()}>
              Open again
            </Button>
            <UserButton />
          </div>
        </div>
      </div>
    );
  }

  if (role === "employee" && pathname !== "/counter" && pathname !== "/credit" && pathname !== "/note" && pathname !== "/payments" && pathname !== "/diary" && pathname !== "/gpay") return <Navigate to="/counter" />;
  if (role === "closer" && pathname !== "/closing" && pathname !== "/counter") return <Navigate to="/closing" />;

  const links =
    role === "employee"
      ? [
          ...NAV.filter((item) => item.to === "/counter" || item.to === "/payments" || item.to === "/diary" || item.to === "/note"),
          ...NAV.filter((item) => item.to === "/gpay"),
        ]
      : role === "closer"
        ? NAV.filter((item) => item.to === "/counter" || item.to === "/closing")
        : NAV.filter((item) => item.to !== "/payments");

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <aside className="no-print fixed inset-y-0 left-0 z-20 hidden h-dvh w-56 flex-col overflow-hidden border-r border-line bg-surface md:flex">
        <Link
          to={role === "employee" ? "/counter" : role === "closer" ? "/closing" : "/"}
          aria-label={role === "employee" ? "Counter" : role === "closer" ? "Closing" : "Desk"}
          className="block shrink-0 border-b border-line px-4 pb-4 pt-5 text-center"
        >
          <img src="/akshaya-logo.png" alt="" className="mx-auto h-auto w-16" />
          <p className="mt-2 font-display text-2xl leading-none text-ink">Thrikkadeeri</p>
          <p className="mt-1 text-xs tracking-wide text-faint">Centre book</p>
        </Link>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          {role === "employee" ? (
            links.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} icon={item.icon} active={isActive(pathname, item.to)} />
            ))
          ) : (
            GROUPS.map((group) => {
              const items = links.filter((item) => item.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="mb-3 last:mb-0">
                  <p className="px-3 pb-1 text-[10px] font-semibold tracking-[0.16em] text-faint">{group.toUpperCase()}</p>
                  {items.map((item) => (
                    <NavLink key={item.to} to={item.to} label={item.label} icon={item.icon} active={isActive(pathname, item.to)} />
                  ))}
                </div>
              );
            })
          )}
        </nav>
        <div className="grid shrink-0 gap-1 border-t border-line bg-surface p-3">
          {role === "employee" || role === "closer" ? (
            <Button variant="ghost" className="w-full justify-start" onClick={() => setPasswordOpen(true)}>
              Change password
            </Button>
          ) : null}
          <UserButton hideSignOut />
          {role === "admin" ? (
            <>
              <Button variant="ghost" className="w-full justify-start" onClick={() => setBackup(true)}>
                <Download className="size-4" />
                Backup
              </Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => setSettings(true)}>
                <Settings className="size-4" />
                Settings
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut("/login").catch(() => setSigningOut(false));
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
        <CentreCredit place="side" />
      </aside>

      <div className="print-shell md:pl-56">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur md:hidden">
          <Link to={role === "employee" ? "/counter" : role === "closer" ? "/closing" : "/"} aria-label={role === "employee" ? "Counter" : role === "closer" ? "Closing" : "Desk"} className="flex min-w-0 items-center gap-2">
            <img src="/akshaya-logo.png" alt="" className="h-9 w-auto shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-widest text-accent">AKSHAYA</p>
              <p className="truncate font-display text-lg leading-none">{shortName(centreName)}</p>
            </div>
          </Link>
          {role === "admin" ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setBackup(true)}>
                Backup
              </Button>
              <Button variant="secondary" size="icon" aria-label="Settings" onClick={() => setSettings(true)}>
                <Settings className="size-4" />
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void signOut("/login")}>
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPasswordOpen(true)}>
                Change password
              </Button>
              <UserButton />
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:px-8 md:pb-12 md:pt-8">
          <img src="/akshaya-logo.png" alt="Akshaya" className="mx-auto mb-4 hidden h-14 w-auto print:block" />
          {blocked ? (
            <div className="no-print mb-5 rounded-lg border border-line bg-accent-soft p-4 text-sm text-ink">{blocked}</div>
          ) : null}
          {role === "admin" && sample && sampleBanner ? (
            <div className="no-print mb-5 rounded-lg border border-line bg-accent-soft p-4">
              <p className="text-sm text-ink">
                Sample figures for three staff are filled in, so salary, margin, and last-year growth are visible.
                Replace any number with yours, or clear the book and start empty.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={dismissSample}>
                  Keep sample
                </Button>
                <Button size="sm" onClick={startEmpty}>
                  Start empty
                </Button>
              </div>
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <nav className="no-print safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden">
        <div className={cn("grid", role === "closer" ? "grid-cols-2" : "grid-cols-5")}>
          {(role === "admin" ? links.filter((item) => item.mobile) : links).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center justify-center px-0.5 text-center leading-tight",
                role === "employee" ? "min-h-16 gap-0.5 text-[11px]" : "min-h-14 gap-1 text-xs",
                isActive(pathname, item.to) ? "text-accent" : "text-muted",
              )}
            >
              <item.icon className="size-4" />
              {item.label === "Collections" ? "Cash" : item.label === "Personal GPay" ? "GPay" : item.label === "Notice board" ? "Notice" : item.label}
            </Link>
          ))}
          {role === "admin" ? (
            <button
              type="button"
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-xs",
                more ? "text-accent" : "text-muted",
              )}
              onClick={() => setMore(true)}
            >
              <Menu className="size-4" />
              More
            </button>
          ) : null}
        </div>
      </nav>

      {more ? (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <button type="button" className="absolute inset-0 bg-ink/30" aria-label="Close menu" onClick={() => setMore(false)} />
          <div className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-xl border border-line bg-surface p-4">
            <p className="mb-2 text-xs font-semibold tracking-widest text-faint">MORE</p>
            <div className="grid gap-3">
              {GROUPS.map((group) => {
                const items = NAV.filter((item) => !item.mobile && item.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="px-2 pb-1 text-[10px] font-semibold tracking-[0.16em] text-faint">{group.toUpperCase()}</p>
                    {items.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMore(false)}
                        className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-2"
                      >
                        <item.icon className="size-4 text-accent" />
                        {MORE_LABEL[item.to]}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <BackupDialog open={backup} onOpenChange={setBackup} />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: (typeof NAV)[number]["to"];
  label: string;
  icon: (typeof NAV)[number]["icon"];
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex min-h-9 items-center gap-3 rounded-md px-3 text-sm",
        active ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-surface-2",
      )}
    >
      <Icon className={cn("size-4", active ? "text-accent" : "text-muted")} />
      {label}
    </Link>
  );
}

function isActive(pathname: string, to: string): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function shortName(name: string): string {
  return name.replace(/^Akshaya Centre\s+/i, "") || name;
}
