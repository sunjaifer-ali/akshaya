import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { MoneyField } from "@/components/money-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import {
  NOTE_ROWS,
  accountLines,
  cashInHand,
  checkClose,
  countStarted,
  creditGivenTotal,
  creditPaidTotal,
  emptyNotes,
  moneyInHand,
  previousClose,
} from "@/lib/ledger/cash";
import { addDays, formatDay, formatFull } from "@/lib/ledger/dates";
import { pushClose } from "@/lib/ledger/share";
import { myRole, closingDesk, addCentrePayout, listCentrePayouts, removeCentrePayout } from "@/lib/centre.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLedger } from "@/lib/ledger/store";
import type { CashClose, CentrePayout, CreditGiven, CreditPayment, Employee } from "@/lib/ledger/types";
import { payoutKind, payoutLabel } from "@/lib/ledger/types";
import { readDate } from "@/lib/search";
import { useTodayKey } from "@/lib/use-today";
import { useEffect, useState, type ReactNode } from "react";
import { useRefresh } from "@/lib/use-refresh";

export const Route = createFileRoute("/closing")({
  validateSearch: readDate,
  component: ClosingPage,
});

function ClosingPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useTodayKey();
  const date = search.d || today || "2026-10-05";
  const book = useLedger();
  const { user } = useCurrentUserState();
  const [role, setRole] = useState<"admin" | "employee" | "closer">("admin");
  const saved = book.cashCloses.find((item) => item.date === date);
  const accepted = Boolean(saved?.accepted);
  const locked = accepted && role !== "admin";
  const previous = previousClose(book.cashCloses, date);
  const [draft, setDraft] = useState<CashClose>(() => saved ?? blank(date, previous?.credits ?? 0));
  const [editing, setEditing] = useState(!saved);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [liveCredit, setLiveCredit] = useState<{ given: CreditGiven[]; paid: CreditPayment[]; unpaid: number } | null>(null);
  const [liveAdvance, setLiveAdvance] = useState<{ held: number; lastDate: string; lastHeld: number; received: number; used: number; served: number; taken?: number; open: AdvanceLine[]; paid: AdvanceLine[]; tracked?: boolean } | null>(null);
  const [payouts, setPayouts] = useState<CentrePayout[]>([]);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payNote, setPayNote] = useState("");
  const [gpayByDate, setGpayByDate] = useState<Record<string, { service: number; department: number }>>({});

  useEffect(() => {
    void myRole()
      .then((result) => setRole(result.role === "employee" || result.role === "closer" ? result.role : "admin"))
      .catch(() => setRole("admin"));
  }, []);

  useEffect(() => {
    if (!today || date !== today) return;
    const current = book.cashCloses.find((item) => item.date === date);
    if (!current || current.creditSeparate) return;
    const next = { ...current, creditSeparate: true };
    book.setCashClose(next);
    void pushClose(date, next).catch(() => undefined);
  }, [book, date, today]);

  useEffect(() => {
    const current = book.cashCloses.find((item) => item.date === date);
    const prev = previousClose(book.cashCloses, date);
    setDraft(current ?? blank(date, prev?.credits ?? 0, counterName(book.employees, user?.displayName)));
    setEditing(!current);
    setConfirmClear(false);
    // Only when the day changes. A shared save must not wipe the count being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useRefresh(() => {
    if (role !== "admin" && role !== "closer") return;
    return closingDesk({ data: date })
      .then((desk) => {
        setLiveCredit(desk.credit);
        setLiveAdvance(desk.advance);
        setPayouts(desk.payouts);
        const next: Record<string, { service: number; department: number }> = {};
        for (const line of desk.gpay) next[line.date] = { service: line.service, department: line.department };
        setGpayByDate(next);
      })
      .catch(() => undefined);
  }, 45000, [date, role]);

  const base = editing ? draft : (saved ?? draft);
  const separate = Boolean(saved?.creditSeparate) || !saved || Boolean(today && date >= today);
  const useLiveAdvance = Boolean(liveAdvance?.tracked);
  const row = {
    ...base,
    creditSeparate: separate,
    ...(liveCredit ? { creditGiven: liveCredit.given, creditPaid: liveCredit.paid, credits: liveCredit.unpaid } : {}),
    advanceHeld: useLiveAdvance ? liveAdvance!.held : (base.advanceHeld ?? 0),
    advanceServed: useLiveAdvance ? liveAdvance!.used : (base.advanceServed ?? 0),
    advanceIn: useLiveAdvance ? liveAdvance!.received : base.advanceIn,
  };
  const closing = moneyInHand(row);
  const cash = cashInHand(row.notes);
  const paid = creditPaidTotal(row);
  const givenTotal = creditGivenTotal(row);
  const counted = countStarted(row);
  const tallyReady = counted;
  const previewCloses = (tallyReady ? [...book.cashCloses.filter((item) => item.date !== date), row] : book.cashCloses).map((item) => {
    if (!useLiveAdvance || !liveAdvance) return item;
    if (item.date === date) return { ...item, advanceHeld: liveAdvance.held, advanceServed: liveAdvance.used };
    if (liveAdvance.lastDate && item.date === liveAdvance.lastDate) return { ...item, advanceHeld: liveAdvance.lastHeld };
    return item;
  });
  const daysForClose = book.days.map((day) => {
    const live = gpayByDate[day.date];
    if (!live) return day;
    return { ...day, personalGpay: live.service, departmentGpay: live.department };
  });
  const check = checkClose(row, previewCloses, daysForClose, book.holidays, payouts);
  const lined = book.cashCloses.map((item) => {
    if (item.date === date) return { ...item, creditSeparate: separate, profitTaken: row.profitTaken, profitNote: row.profitNote, advanceHeld: row.advanceHeld, advanceServed: row.advanceServed };
    if (liveAdvance?.tracked && liveAdvance.lastDate && item.date === liveAdvance.lastDate) return { ...item, advanceHeld: liveAdvance.lastHeld };
    return item;
  });
  const lines = accountLines(lined, daysForClose, book.holidays, payouts);
  const shorts = lines.filter((line) => line.unfixed < 0);
  const excesses = lines.filter((line) => line.unfixed > 0);
  const shortTotal = shorts.reduce((sum, line) => sum + -line.unfixed, 0);
  const excessTotal = excesses.reduce((sum, line) => sum + line.unfixed, 0);
  const go = (next: string) => {
    void navigate({ search: { d: next } });
  };
  const patch = (next: Partial<CashClose>) => {
    setDraft({ ...draft, ...next, date });
  };

  return (
    <div className="report-sheet mx-auto max-w-xl">
      <PageHeader
        kicker="CLOSING"
        title="Daily closing"
        actions={
          <div className="no-print flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <input
              type="date"
              aria-label="Closing date"
              className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
              value={date}
              onChange={(event) => {
                if (event.target.value) go(event.target.value);
              }}
            />
            <Button variant="secondary" size="icon" aria-label="Next day" onClick={() => go(addDays(date, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <p className="mb-4 text-sm text-muted">
        {formatFull(date)}
        {saved && !editing ? " · Saved" : " · Not saved"}
        {saved ? ` · Closed by ${row.countedBy || "Admin"}` : ""}
        {accepted ? " · Accepted" : ""}
      </p>

      <section className="mx-auto max-w-lg rounded-xl border border-line bg-surface p-4">
        <h2 className="text-center font-medium">Notes</h2>
        <div className="mt-3 grid grid-flow-col grid-rows-3 gap-x-4 gap-y-2">
          {NOTE_ROWS.map((note) => {
            const count = row.notes[note.key];
            return (
              <label key={note.key} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-sm font-medium">{note.face}×</span>
                <input
                  aria-label={`${note.face} rupee notes`}
                  inputMode="numeric"
                  className="h-10 w-14 rounded-sm border border-line bg-bg px-2 text-base tabular-nums outline-none focus:border-accent"
                  value={count ? String(count) : ""}
                  placeholder="0"
                  readOnly={!editing}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "");
                    patch({ notes: { ...row.notes, [note.key]: digits ? Number(digits) : 0 } });
                  }}
                />
                <span className="ml-auto text-sm tabular-nums text-muted">{inr(note.face * count)}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 flex justify-between border-t border-line pt-3 text-sm">
          <span className="text-muted">Cash in hand</span>
          <span className="font-medium tabular-nums">{inr(cash)}</span>
        </p>
      </section>

      <section className="mx-auto mt-3 max-w-lg rounded-xl border border-line bg-surface p-4">
        <h2 className="text-center font-medium">Other balances</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="E-district wallet">
          <MoneyField label="E-district wallet" value={row.eDistrict} disabled={!editing} onChange={(amount) => patch({ eDistrict: amount ?? 0 })} />
        </Field>
        <Field label="CSC wallet">
          <MoneyField label="CSC wallet" value={row.csc} disabled={!editing} onChange={(amount) => patch({ csc: amount ?? 0 })} />
        </Field>
        <Field label="Bank balance">
          <MoneyField label="Bank balance" value={row.bank} disabled={!editing} onChange={(amount) => patch({ bank: amount ?? 0 })} />
        </Field>
        </div>
      </section>

      <PaidOut
        date={date}
        rows={payouts.filter((item) => item.date === date)}
        amount={payAmount}
        note={payNote}
        onAmount={setPayAmount}
        onNote={setPayNote}
        onSaved={(message) => setResult({ ok: true, message })}
        onFailed={(message) => setResult({ ok: false, message })}
        onReload={() => {
          void listCentrePayouts({ data: date }).then((desk) => setPayouts(desk.rows)).catch(() => undefined);
        }}
        locked={locked}
      />

      {role === "admin" ? (
        <section className="mx-auto mt-3 max-w-lg rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">Transfer to self or other accounts</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Amount transferred">
              <MoneyField label="Amount transferred" value={row.profitTaken ?? 0} disabled={locked} onChange={(amount) => patch({ profitTaken: amount ?? 0 })} />
            </Field>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Account</span>
              <input
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:opacity-70"
                value={row.profitNote ?? ""}
                disabled={locked}
                placeholder="Own account"
                onChange={(event) => patch({ profitNote: event.target.value.slice(0, 80) })}
              />
            </label>
          </div>
          {locked ? null : (
            <Button
              className="no-print mt-3"
              onClick={() => {
                const next = { ...row, date, countedBy: row.countedBy || user?.displayName?.trim() || "Admin" };
                book.setCashClose(next);
                setResult({ ok: true, message: "Transfer saved." });
                void pushClose(date, next).catch((error: unknown) => {
                  setResult({ ok: false, message: error instanceof Error ? error.message : "Saved on this browser, but not shared." });
                });
              }}
            >
              Save
            </Button>
          )}
        </section>
      ) : null}

      <section className="mx-auto mt-3 max-w-lg rounded-xl border border-line bg-surface p-4 text-center">
        <h2 className="font-medium">Total closing</h2>
        <p className="mt-1 font-display text-3xl tabular-nums">{inr(closing)}</p>
        <ClosingParts cash={cash} wallets={row.eDistrict + row.csc} bank={row.bank} />
      </section>

      <CheckCard date={date} check={check} fixed={row.fixed} paid={paid} given={givenTotal} locked={!editing} hold={!tallyReady} onFixed={(fixed) => patch({ fixed })} />

      {shorts.length + excesses.length > 0 ? (
        <details className="short-report mx-auto mt-3 max-w-lg rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Open days</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <AccountList title="Short" lines={shorts} onOpen={go} />
            <AccountList title="Excess" lines={excesses} onOpen={go} />
          </div>
        </details>
      ) : null}

      <section className="mx-auto mt-3 grid max-w-lg gap-3 sm:grid-cols-2">
        <AccountTile label="Short" count={shorts.length} total={shortTotal} tone="bad" />
        <AccountTile label="Excess" count={excesses.length} total={excessTotal} tone="warn" />
      </section>

      <div className="no-print mx-auto mt-3 flex max-w-lg flex-wrap justify-center gap-2 rounded-xl border border-line bg-surface p-3">
        {locked ? (
          <p className="text-sm text-muted">Accepted. Only the admin can change this closing.</p>
        ) : editing ? (
          <Button
            onClick={() => {
              const closer = user?.displayName?.trim() || "Admin";
              const next = { ...row, date, countedBy: closer, accepted: role === "admin" ? Boolean(saved?.accepted) : false };
              book.setCashClose(next);
              setEditing(false);
              setResult({ ok: true, message: `Closing for ${formatDay(date)} successfully saved.` });
              void pushClose(date, next).catch((error: unknown) => {
                setResult({ ok: false, message: error instanceof Error ? error.message : "Saved on this browser, but not shared." });
              });
            }}
          >
            Save
          </Button>
        ) : (
          <Button
            onClick={() => {
              setDraft(saved ?? blank(date, 0, counterName(book.employees, user?.displayName)));
              setEditing(true);
              setNotice("");
            }}
          >
            Edit
          </Button>
        )}
        {role === "admin" && saved && !editing ? (
          <Button
            onClick={() => {
              const next = {
                ...saved,
                creditGiven: liveCredit?.given ?? saved.creditGiven,
                creditPaid: liveCredit?.paid ?? saved.creditPaid,
                credits: liveCredit?.unpaid ?? saved.credits,
                accepted: !accepted,
              };
              book.setCashClose(next);
              setResult({
                ok: true,
                message: next.accepted ? `${formatDay(date)} accepted. Staff cannot change it.` : `${formatDay(date)} opened again.`,
              });
              void pushClose(date, next).catch((error: unknown) => {
                setResult({ ok: false, message: error instanceof Error ? error.message : "Saved on this browser, but not shared." });
              });
            }}
          >
            {accepted ? "Open again" : "Accept"}
          </Button>
        ) : null}
        {locked ? null : confirmClear ? (
          <>
            <Button
              variant="danger"
              onClick={() => {
                book.clearCashClose(date);
                void pushClose(date, null).catch(() => undefined);
                setDraft(blank(date, 0, counterName(book.employees, user?.displayName)));
                setEditing(true);
                setConfirmClear(false);
                setResult({ ok: true, message: `Closing for ${formatDay(date)} successfully cleared.` });
              }}
            >
              Clear {formatDay(date)}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmClear(true)}>
            Clear
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {notice ? <p className="no-print mt-3 text-center text-sm text-muted">{notice}</p> : null}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function CheckCard({
  date,
  check,
  fixed,
  paid,
  given,
  locked,
  hold,
  onFixed,
}: {
  date: string;
  check: ReturnType<typeof checkClose>;
  fixed: number;
  paid: number;
  given: number;
  locked: boolean;
  hold: boolean;
  onFixed: (amount: number) => void;
}) {
  if (check.last == null) {
    return (
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Opening</h2>
      </section>
    );
  }

  const shown = hold ? { ...check, difference: null, unfixed: null } : check;

  return (
    <section className="mx-auto mt-4 max-w-lg rounded-xl border border-line bg-surface p-5 text-center">
      <p className="text-xs font-semibold tracking-widest text-faint">DIFFERENCE</p>
      <p
        className={cn(
          "mt-1 font-display text-4xl tabular-nums",
          shown.difference == null ? "text-ink" : shown.difference < 0 ? "text-bad" : shown.difference > 0 ? "text-warn" : "text-accent",
        )}
      >
        {diffLabel(shown.difference)}
      </p>
      <h2 className="mt-5 font-medium">Put together</h2>
      <dl className="mx-auto mt-3 grid max-w-md gap-3 text-left text-lg">
        <Pair label={`Opening, ${formatDay(check.lastDate)}`} value={inr(check.last)} />
        <Pair label="Counter collection" value={check.collected == null ? "—" : `+${inr(check.collected)}`} />
        {check.personalGpay > 0 ? <Pair label="Personal service, personal account only" value={`−${inr(check.personalGpay)}`} /> : null}
        {check.departmentGpay > 0 ? <Pair label="Personal department, personal account only" value={`−${inr(check.departmentGpay)}`} /> : null}
        {given > 0 ? <Pair label="Credit given, not a shortage" value={`−${inr(given)}`} /> : null}
        {paid > 0 ? <Pair label="Credit repaid, not an excess" value={`+${inr(paid)}`} /> : null}
        {check.advanceIn > 0 ? <Pair label="Advance received, not an excess" value={`+${inr(check.advanceIn)}`} /> : null}
        {check.advanceServed > 0 ? <Pair label="Advance served, not a shortage" value={`−${inr(check.advanceServed)}`} /> : null}
        {check.paidOut > 0 ? <Pair label="Expenses" value={`−${inr(check.paidOut)}`} /> : null}
        {check.profitTaken > 0 ? <Pair label="Transferred out" value={`−${inr(check.profitTaken)}`} /> : null}
      </dl>
      {hold ? null : shown.missing.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          Counter missing: {check.missing.map((item) => formatDay(item)).join(", ")}.
        </p>
      ) : shown.difference === 0 ? null : (
        <div className="mx-auto mt-4 max-w-xs text-left">
          <label className="block max-w-xs text-sm">
            <span className="mb-1 block text-muted">Fixed</span>
            <MoneyField label="Amount fixed" value={fixed} disabled={locked} onChange={(amount) => onFixed(amount ?? 0)} />
          </label>
          {fixed !== 0 ? (
            <p className="mt-2 text-sm">
              Still open {(check.unfixed ?? 0) < 0 ? "short" : "excess"}{" "}
              <span className={cn("font-medium tabular-nums", (check.unfixed ?? 0) < 0 ? "text-bad" : "text-warn")}>{inr(Math.abs(check.unfixed ?? 0))}</span>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function diffLabel(difference: number | null): string {
  if (difference == null) return "—";
  if (difference === 0) return "Balanced";
  if (difference < 0) return `Short ${inr(Math.abs(difference))}`;
  return `Excess ${inr(difference)}`;
}

function PaidOut({
  date,
  rows,
  amount,
  note,
  onAmount,
  onNote,
  onSaved,
  onFailed,
  onReload,
  locked,
}: {
  date: string;
  rows: CentrePayout[];
  amount: number | null;
  note: string;
  onAmount: (value: number | null) => void;
  onNote: (value: string) => void;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
  onReload: () => void;
  locked: boolean;
}) {
  const [pending, setPending] = useState(false);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <section className="mx-auto mt-3 max-w-lg rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">Paid out</h2>
        <p className="text-sm tabular-nums text-muted">{inr(total)}</p>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{row.note || payoutLabel(row.category)}</span>
                <span className="text-muted"> · {row.by}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{inr(row.amount)}</span>
                {locked ? null : (
                <Button
                  className="no-print"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void removeCentrePayout({ data: row.id })
                      .then(() => {
                        onSaved("Payment successfully deleted.");
                        onReload();
                      })
                      .catch((error: unknown) => onFailed(error instanceof Error ? error.message : "Payment was not deleted."));
                  }}
                >
                  Delete
                </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {locked ? null : (
      <form
        className="no-print mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const written = note.trim();
          if (!written) {
            onFailed("Write what was paid.");
            return;
          }
          setPending(true);
          void addCentrePayout({ data: { date, category: payoutKind(written), amount: amount ?? 0, note: written } })
            .then(() => {
              onAmount(null);
              onNote("");
              onSaved("Payment successfully saved.");
              onReload();
            })
            .catch((error: unknown) => onFailed(error instanceof Error ? error.message : "Payment was not saved."))
            .finally(() => setPending(false));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">What was paid</span>
          <input
            aria-label="What was paid"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={note}
            placeholder="eg. tea, stationery, donation"
            onChange={(event) => onNote(event.target.value.slice(0, 80))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Amount</span>
          <MoneyField label="Amount paid" value={amount} onChange={onAmount} />
        </label>
        <div>
          <Button type="submit" disabled={pending}>
            Add payment
          </Button>
        </div>
      </form>
      )}
    </section>
  );
}

function ClosingParts({ cash, wallets, bank }: { cash: number; wallets: number; bank: number }) {
  const parts = [
    cash > 0 ? `Cash ${inr(cash)}` : null,
    wallets > 0 ? `Wallets ${inr(wallets)}` : null,
    bank > 0 ? `Bank ${inr(bank)}` : null,
  ].filter((part): part is string => part != null);
  if (parts.length < 2) return null;
  return <p className="mt-1 text-base tabular-nums">{parts.join(" · ")}</p>;
}

function AccountTile({ label, count, total, tone }: { label: string; count: number; total: number; tone: "bad" | "warn" }) {
  return (
    <div className={cn("rounded-xl border border-line p-5", tone === "bad" ? "bg-bad-soft" : "bg-warn-soft")}>
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className={cn("mt-1 font-display text-3xl tabular-nums", tone === "bad" ? "text-bad" : "text-warn")}>
        {count === 0 ? "None" : inr(total)}
      </p>
      {count > 0 ? <p className="mt-1 text-sm text-muted">{count} {count === 1 ? "day" : "days"}</p> : null}
    </div>
  );
}

function AccountList({
  title,
  lines,
  onOpen,
}: {
  title: string;
  lines: { date: string; unfixed: number }[];
  onOpen: (date: string) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-muted">None open.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {lines.map((line) => (
            <li key={line.date}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" onClick={() => onOpen(line.date)}>
                <span>{formatDay(line.date)}</span>
                <span className={cn("tabular-nums", title === "Short" ? "text-bad" : "text-warn")}>{inr(Math.abs(line.unfixed))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Pair({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "good" | "bad" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-medium tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-accent")}>{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}

function blank(date: string, credits = 0, countedBy = ""): CashClose {
  return {
    date,
    notes: emptyNotes(),
    eDistrict: 0,
    csc: 0,
    credits,
    bank: 0,
    fixed: 0,
    creditPaid: [],
    creditGiven: [],
    countedBy,
    accepted: false,
    creditSeparate: true,
    advanceHeld: 0,
    advanceServed: 0,
    profitTaken: 0,
    profitNote: "",
  };
}

function counterName(employees: Employee[], displayName: string | null | undefined): string {
  const name = (displayName ?? "").trim();
  const match = employees.find((employee) => employee.active && employee.name.toLowerCase() === name.toLowerCase());
  return match?.name ?? "";
}

type AdvanceLine = { id: string; customer: string; mobile: string; service: string; staff: string; amount: number; date?: string };
