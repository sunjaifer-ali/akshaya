import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { MoneyField } from "@/components/money-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { inr, signedInr } from "@/lib/format";
import {
  NOTE_ROWS,
  accountLines,
  cashInHand,
  checkClose,
  countStarted,
  creditGivenInMonth,
  creditGivenTotal,
  creditPaidTotal,
  emptyNotes,
  moneyInHand,
  previousClose,
  unpaidCreditReport,
  type UnpaidCreditLine,
} from "@/lib/ledger/cash";
import { addDays, formatDay, formatFull } from "@/lib/ledger/dates";
import { pushClose } from "@/lib/ledger/share";
import { myRole, closingAdvance, closingCredit, addCentrePayout, listCentrePayouts, removeCentrePayout, updateAdvance } from "@/lib/centre.functions";
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
  const [advanceEdit, setAdvanceEdit] = useState<{ id: string; customer: string; mobile: string; service: string; amount: string } | null>(null);
  const [advancePending, setAdvancePending] = useState(false);
  const [payouts, setPayouts] = useState<CentrePayout[]>([]);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payNote, setPayNote] = useState("");

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
    return closingCredit({ data: date })
      .then((credit) => setLiveCredit({ given: credit.given, paid: credit.paid, unpaid: credit.unpaid }))
      .catch(() => undefined);
  }, 15000, [date]);

  useRefresh(() => {
    if (role !== "admin" && role !== "closer") return;
    return closingAdvance({ data: date })
      .then((advance) => setLiveAdvance(advance))
      .catch(() => undefined);
  }, 15000, [date, role]);

  useRefresh(() => {
    return listCentrePayouts({ data: date })
      .then((desk) => setPayouts(desk.rows))
      .catch(() => undefined);
  }, 15000, [date]);

  const base = editing ? draft : (saved ?? draft);
  const separate = Boolean(saved?.creditSeparate) || !saved || Boolean(today && date >= today);
  const useLiveAdvance = Boolean(liveAdvance?.tracked);
  const row = {
    ...base,
    creditSeparate: separate,
    ...(liveCredit ? { creditGiven: liveCredit.given, creditPaid: liveCredit.paid, credits: liveCredit.unpaid } : {}),
    advanceHeld: useLiveAdvance ? liveAdvance!.held : (base.advanceHeld ?? 0),
    advanceServed: useLiveAdvance ? liveAdvance!.served : (base.advanceServed ?? 0),
    advanceIn: useLiveAdvance ? liveAdvance!.taken ?? base.advanceIn : base.advanceIn,
  };
  const closing = moneyInHand(row);
  const cash = cashInHand(row.notes);
  const paid = creditPaidTotal(row);
  const givenTotal = creditGivenTotal(row);
  const counted = countStarted(row);
  const tallyReady = counted;
  const previewCloses = (tallyReady ? [...book.cashCloses.filter((item) => item.date !== date), row] : book.cashCloses).map((item) => {
    if (!useLiveAdvance || !liveAdvance) return item;
    if (item.date === date) return { ...item, advanceHeld: liveAdvance.held, advanceServed: liveAdvance.served };
    if (liveAdvance.lastDate && item.date === liveAdvance.lastDate) return { ...item, advanceHeld: liveAdvance.lastHeld };
    return item;
  });
  const check = checkClose(row, previewCloses, book.days, book.holidays, payouts);
  const lined = book.cashCloses.map((item) => {
    if (item.date === date) return { ...item, creditSeparate: separate, profitTaken: row.profitTaken, profitNote: row.profitNote, advanceHeld: row.advanceHeld, advanceServed: row.advanceServed };
    if (liveAdvance?.tracked && liveAdvance.lastDate && item.date === liveAdvance.lastDate) return { ...item, advanceHeld: liveAdvance.lastHeld };
    return item;
  });
  const lines = accountLines(lined, book.days, book.holidays, payouts);
  const shorts = lines.filter((line) => line.unfixed < 0);
  const excesses = lines.filter((line) => line.unfixed > 0);
  const shortTotal = shorts.reduce((sum, line) => sum + -line.unfixed, 0);
  const excessTotal = excesses.reduce((sum, line) => sum + line.unfixed, 0);
  const payments = row.creditPaid ?? [];
  const given = row.creditGiven ?? [];
  const monthGiven = creditGivenInMonth(
    [...book.cashCloses.filter((item) => item.date !== date), row],
    date.slice(0, 7),
  );
  const creditReport = unpaidCreditReport(
    [...book.cashCloses.filter((item) => item.date !== date), row],
    (id) => book.employees.find((employee) => employee.id === id)?.name ?? "Staff not entered",
  );
  const go = (next: string) => {
    void navigate({ search: { d: next } });
  };
  const patch = (next: Partial<CashClose>) => {
    setDraft({ ...draft, ...next, date });
  };

  return (
    <div className="report-sheet">
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

      <div className="no-print mb-4 flex flex-wrap gap-2">
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
            variant="secondary"
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
            variant="secondary"
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
          <Button variant="ghost" onClick={() => setConfirmClear(true)}>
            Clear
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {notice ? <p className="no-print mb-4 text-sm text-muted">{notice}</p> : null}
      <ResultDialog result={result} onClose={() => setResult(null)} />

      <section className="mb-4 grid gap-3 sm:grid-cols-2">
        <AccountTile label="Short" count={shorts.length} total={shortTotal} tone="bad" />
        <AccountTile label="Excess" count={excesses.length} total={excessTotal} tone="warn" />
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Notes</h2>
        <ul className="mt-2 divide-y divide-line">
          {NOTE_ROWS.map((note) => {
            const count = row.notes[note.key];
            return (
              <li key={note.key} className="flex items-center gap-3 py-2">
                <span className="w-14 text-sm font-medium">{note.face}×</span>
                <input
                  aria-label={`${note.face} rupee notes`}
                  inputMode="numeric"
                  className="h-11 w-24 rounded-sm border border-line bg-bg px-3 text-base tabular-nums outline-none focus:border-accent"
                  value={count ? String(count) : ""}
                  placeholder="0"
                  readOnly={!editing}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "");
                    patch({ notes: { ...row.notes, [note.key]: digits ? Number(digits) : 0 } });
                  }}
                />
                <span className="ml-auto text-sm tabular-nums text-muted">{inr(note.face * count)}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex justify-between text-sm">
          <span className="text-muted">Cash in hand</span>
          <span className="font-medium tabular-nums">{inr(cash)}</span>
        </p>
      </section>

      <section className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Other balances</h2>
        <Field label="E-district wallet">
          <MoneyField label="E-district wallet" value={row.eDistrict} disabled={!editing} onChange={(amount) => patch({ eDistrict: amount ?? 0 })} />
        </Field>
        <Field label="CSC wallet">
          <MoneyField label="CSC wallet" value={row.csc} disabled={!editing} onChange={(amount) => patch({ csc: amount ?? 0 })} />
        </Field>
        <Field label="Bank balance">
          <MoneyField label="Bank balance" value={row.bank} disabled={!editing} onChange={(amount) => patch({ bank: amount ?? 0 })} />
        </Field>
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
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-medium">Transfer to self or other accounts</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Amount transferred">
              <MoneyField label="Amount transferred" value={row.profitTaken ?? 0} disabled={!editing} onChange={(amount) => patch({ profitTaken: amount ?? 0 })} />
            </Field>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Account</span>
              <input
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:opacity-70"
                value={row.profitNote ?? ""}
                disabled={!editing}
                placeholder="Own account"
                onChange={(event) => patch({ profitNote: event.target.value.slice(0, 80) })}
              />
            </label>
          </div>
          <ProfitMonth date={date} row={row} closes={book.cashCloses} />
        </section>
      ) : null}

      {(role === "admin" || role === "closer") && liveAdvance && (liveAdvance.open.length > 0 || liveAdvance.paid.length > 0) ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-medium">Advance still to serve</h2>
          {liveAdvance.received > 0 || liveAdvance.used > 0 ? (
            <p className="mt-1 text-sm text-muted">
              {liveAdvance.received > 0 ? `Received today ${inr(liveAdvance.received)}` : ""}
              {liveAdvance.received > 0 && liveAdvance.used > 0 ? " · " : ""}
              {liveAdvance.used > 0 ? `Service given ${inr(liveAdvance.used)}` : ""}
            </p>
          ) : null}
          <ul className="mt-2 divide-y divide-line">
            {liveAdvance.open.map((line) => (
              <li key={line.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {line.customer}
                    <span className="mt-0.5 block text-xs text-faint">{line.service} · {line.staff}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{inr(line.amount)}</span>
                    {role === "admin" ? (
                      <Button size="sm" variant="secondary" className="no-print" disabled={advancePending} onClick={() => setAdvanceEdit({ id: line.id, customer: line.customer, mobile: line.mobile, service: line.service, amount: String(line.amount) })}>
                        Edit
                      </Button>
                    ) : null}
                  </span>
                </div>
                {role === "admin" && advanceEdit?.id === line.id ? (
                  <AdvanceEditFields edit={advanceEdit} pending={advancePending} onChange={setAdvanceEdit} onCancel={() => setAdvanceEdit(null)} onSave={() => saveClosingAdvance(advanceEdit, date, setAdvancePending, setAdvanceEdit, setLiveAdvance, setResult)} />
                ) : null}
              </li>
            ))}
          </ul>
          {role === "admin" && liveAdvance.paid.length > 0 ? (
            <>
              <h3 className="mt-4 font-medium">Service given</h3>
              <ul className="mt-2 divide-y divide-line">
                {liveAdvance.paid.map((line) => (
                  <li key={line.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {line.customer}
                        <span className="mt-0.5 block text-xs text-faint">{line.service} · {line.staff}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums">{inr(line.amount)}</span>
                        <Button size="sm" variant="secondary" className="no-print" disabled={advancePending} onClick={() => setAdvanceEdit({ id: line.id, customer: line.customer, mobile: line.mobile, service: line.service, amount: String(line.amount) })}>
                          Edit
                        </Button>
                      </span>
                    </div>
                    {advanceEdit?.id === line.id ? (
                      <AdvanceEditFields edit={advanceEdit} pending={advancePending} onChange={setAdvanceEdit} onCancel={() => setAdvanceEdit(null)} onSave={() => saveClosingAdvance(advanceEdit, date, setAdvancePending, setAdvanceEdit, setLiveAdvance, setResult)} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-medium">Credit</h2>
          <div className="flex items-center gap-3">
            <p className="text-sm tabular-nums text-muted">Unpaid {inr(row.credits)}</p>
            <Button
              className="no-print"
              size="sm"
              variant="secondary"
              onClick={() => downloadUnpaid(book.centreName, date, creditReport)}
            >
              Download unpaid
            </Button>
          </div>
        </div>
        {given.length > 0 ? (
          <CreditGiven
            editing={false}
            rows={given}
            staff={book.employees}
            stillUnpaid={row.credits}
            monthGiven={monthGiven}
            onChange={(creditGiven, credits) => patch({ creditGiven, credits })}
          />
        ) : null}
        {payments.length > 0 ? (
          <CreditPaid
            editing={false}
            payments={payments}
            paid={paid}
            lastCredits={previous?.credits ?? 0}
            stillUnpaid={row.credits}
            onChange={(creditPaid, credits) => patch({ creditPaid, credits })}
          />
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Total closing</h2>
        <p className="mt-1 font-display text-3xl tabular-nums">{inr(closing)}</p>
        <ClosingParts cash={cash} wallets={row.eDistrict + row.csc} bank={row.bank} />
      </section>

      <CheckCard date={date} check={check} fixed={row.fixed} paid={paid} given={givenTotal} locked={!editing} hold={!tallyReady} onFixed={(fixed) => patch({ fixed })} />

      {shorts.length + excesses.length > 0 ? (
        <details className="short-report mt-4 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Open days</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <AccountList title="Short" lines={shorts} onOpen={go} />
            <AccountList title="Excess" lines={excesses} onOpen={go} />
          </div>
        </details>
      ) : null}
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
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">DIFFERENCE</p>
      <p
        className={cn(
          "mt-1 font-display text-4xl tabular-nums",
          shown.difference == null ? "text-ink" : shown.difference < 0 ? "text-bad" : shown.difference > 0 ? "text-warn" : "text-accent",
        )}
      >
        {diffLabel(shown.difference)}
      </p>
      <h2 className="mt-5 font-medium">Against last closing</h2>
      <dl className="mt-3 grid gap-2 text-base">
        <Pair label={`Last closing, ${formatDay(check.lastDate)}`} value={inr(check.last)} />
        <Pair label="Movement" value={signedInr(check.movement)} />
        <Pair label="Receipts into the centre" value={inr(check.receipts)} />
        <Pair label="Service charge kept in the centre" value={inr(Math.max(0, check.receipts - check.advanceIn - paid))} />
        {check.advanceIn > 0 ? <Pair label="Advance received into the centre" value={inr(check.advanceIn)} /> : null}
        {paid > 0 ? <Pair label="Credit repaid into the centre" value={inr(paid)} /> : null}
        <Pair label="Payments out of the centre" value={inr(check.payments)} />
        {check.bankDepartment > 0 ? <Pair label="Department paid from our bank" value={inr(check.bankDepartment)} /> : null}
        {check.paidOut > 0 ? <Pair label="Expenses paid from the centre" value={inr(check.paidOut)} /> : null}
        {check.profitTaken > 0 ? <Pair label="Transfer to personal account" value={inr(check.profitTaken)} /> : null}
        {check.personalGpay > 0 ? <Pair label="Personal GPay, not counted" value={inr(check.personalGpay + check.departmentGpay)} /> : null}
        {check.advanceServed > 0 ? <Pair label="Advance served, not counted" value={inr(check.advanceServed)} /> : null}
        {given > 0 ? <Pair label="Credit given, not counted" value={inr(given)} /> : null}
      </dl>
      {hold ? null : shown.missing.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          Counter missing: {check.missing.map((item) => formatDay(item)).join(", ")}.
        </p>
      ) : shown.difference === 0 ? null : (
        <div className="mt-3">
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

function CreditGiven({
  editing,
  rows,
  staff,
  stillUnpaid,
  monthGiven,
  onChange,
}: {
  editing: boolean;
  rows: CreditGiven[];
  staff: Employee[];
  stillUnpaid: number;
  monthGiven: { employeeId: string; amount: number }[];
  onChange: (rows: CreditGiven[], credits: number) => void;
}) {
  const names = [...staff].sort((a, b) => a.name.localeCompare(b.name));
  const setRow = (index: number, next: CreditGiven) => {
    const list = rows.map((item) => ({ ...item }));
    const before = list[index]?.amount ?? 0;
    list[index] = next;
    onChange(list, Math.max(0, stillUnpaid + (next.amount - before)));
  };
  const nameOf = (id: string) => names.find((item) => item.id === id)?.name ?? "Not named";

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Given today</h3>
        {editing ? (
          <Button size="sm" variant="secondary" onClick={() => onChange([...rows, { employeeId: "", customer: "", amount: 0 }], stillUnpaid)}>
            + Add staff
          </Button>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className="mt-2 grid gap-2">
          {rows.map((item, index) => (
            <li key={index} className="grid gap-2">
              <input
                aria-label={`Customer given credit ${index + 1}`}
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:bg-surface-2"
                value={item.customer ?? ""}
                disabled={!editing}
                placeholder="Customer"
                onChange={(event) => setRow(index, { ...item, customer: event.target.value })}
              />
              <div className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2">
              <select
                aria-label={`Credit staff ${index + 1}`}
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent disabled:bg-surface-2"
                value={item.employeeId}
                disabled={!editing}
                onChange={(event) => setRow(index, { ...item, employeeId: event.target.value })}
              >
                <option value="">Staff</option>
                {names.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
              <MoneyField
                label={`Credit given ${index + 1}`}
                value={item.amount}
                disabled={!editing}
                onChange={(amount) => setRow(index, { ...item, amount: amount ?? 0 })}
              />
              {editing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove given row ${index + 1}`}
                  onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index), Math.max(0, stillUnpaid - item.amount))}
                >
                  ×
                </Button>
              ) : (
                <span />
              )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.some((item) => item.amount > 0 && !item.employeeId) ? <p className="mt-2 text-sm text-warn">Choose the staff.</p> : null}
      {monthGiven.length > 0 ? (
        <p className="mt-2 text-sm text-muted">
          Credit given this month · {monthGiven.map((item) => `${nameOf(item.employeeId)} ${inr(item.amount)}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function CreditPaid({
  editing,
  payments,
  paid,
  lastCredits,
  stillUnpaid,
  onChange,
}: {
  editing: boolean;
  payments: CreditPayment[];
  paid: number;
  lastCredits: number;
  stillUnpaid: number;
  onChange: (payments: CreditPayment[], credits: number) => void;
}) {
  const setRow = (index: number, next: CreditPayment) => {
    const list = payments.map((item) => ({ ...item }));
    const before = list[index]?.amount ?? 0;
    list[index] = next;
    onChange(list, Math.max(0, stillUnpaid - (next.amount - before)));
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Paid today</h3>
        {editing ? (
          <Button size="sm" variant="secondary" onClick={() => onChange([...payments, { name: "", amount: 0 }], stillUnpaid)}>
            Add a payment
          </Button>
        ) : null}
      </div>
      {lastCredits > 0 ? <p className="mt-1 text-sm text-muted">Last unpaid {inr(lastCredits)}</p> : null}
      {payments.length > 0 ? (
        <ul className="mt-2 grid gap-2">
          {payments.map((item, index) => (
            <li key={index} className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2">
              <input
                aria-label={`Credit customer ${index + 1}`}
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:bg-surface-2"
                value={item.name}
                disabled={!editing}
                placeholder="Customer"
                onChange={(event) => setRow(index, { ...item, name: event.target.value })}
              />
              <MoneyField
                label={`Credit paid ${index + 1}`}
                value={item.amount}
                disabled={!editing}
                onChange={(amount) => setRow(index, { ...item, amount: amount ?? 0 })}
              />
              {editing ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove paid row ${index + 1}`}
                  onClick={() => onChange(payments.filter((_, itemIndex) => itemIndex !== index), stillUnpaid + item.amount)}
                >
                  ×
                </Button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {paid > lastCredits ? <p className="mt-1 text-sm text-warn">More than was unpaid. Count that extra cash in the notes, and it shows as excess.</p> : null}
    </div>
  );
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
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
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
      <dd className={cn("tabular-nums", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-accent")}>{value}</dd>
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

function ProfitMonth({ date, row, closes }: { date: string; row: CashClose; closes: CashClose[] }) {
  const month = date.slice(0, 7);
  const lines = [...closes.filter((item) => item.date !== date), row]
    .filter((item) => item.date.startsWith(month) && (item.profitTaken ?? 0) > 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = lines.reduce((sum, item) => sum + (item.profitTaken ?? 0), 0);
  if (total <= 0) return null;
  return (
    <div className="mt-4">
      <p className="text-sm text-muted">Transferred this month <span className="font-medium tabular-nums text-ink">{inr(total)}</span></p>
      <ul className="mt-2 divide-y divide-line">
        {lines.map((item) => (
          <li key={item.date} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {formatDay(item.date)}
              {item.profitNote ? <span className="mt-0.5 block text-xs text-faint">{item.profitNote}</span> : null}
            </span>
            <span className="tabular-nums">{inr(item.profitTaken ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
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

type AdvanceDraft = { id: string; customer: string; mobile: string; service: string; amount: string };

function saveClosingAdvance(
  edit: AdvanceDraft,
  date: string,
  setPending: (value: boolean) => void,
  setEdit: (value: AdvanceDraft | null) => void,
  setLive: (value: { held: number; lastDate: string; lastHeld: number; received: number; used: number; served: number; open: AdvanceLine[]; paid: AdvanceLine[] }) => void,
  setResult: (value: Result | null) => void,
) {
  const amount = Number(edit.amount);
  if (!edit.customer.trim() || !edit.service.trim() || !amount) {
    setResult({ ok: false, message: "Enter the customer, the service, and the amount." });
    return;
  }
  setPending(true);
  void updateAdvance({ data: { id: edit.id, customer: edit.customer, mobile: edit.mobile, service: edit.service, amount } })
    .then(() => closingAdvance({ data: date }))
    .then((advance) => {
      setLive(advance);
      setEdit(null);
      setResult({ ok: true, message: "Advance successfully updated." });
    })
    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Advance not updated." }))
    .finally(() => setPending(false));
}

function AdvanceEditFields({
  edit,
  pending,
  onChange,
  onCancel,
  onSave,
}: {
  edit: AdvanceDraft;
  pending: boolean;
  onChange: (value: AdvanceDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <form
      className="no-print mt-2 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <input aria-label="Customer name" className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={edit.customer} onChange={(event) => onChange({ ...edit, customer: event.target.value })} />
      <input aria-label="Mobile" inputMode="numeric" placeholder="Mobile, if any" className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={edit.mobile} onChange={(event) => onChange({ ...edit, mobile: event.target.value })} />
      <input aria-label="Service" className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={edit.service} onChange={(event) => onChange({ ...edit, service: event.target.value })} />
      <input aria-label="Amount" inputMode="numeric" className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={edit.amount} onChange={(event) => onChange({ ...edit, amount: event.target.value.replace(/[^\d]/g, "") })} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function downloadUnpaid(
  centre: string,
  asOf: string,
  report: { lines: UnpaidCreditLine[]; listed: number; book: number },
) {
  const rows: (string | number)[][] = [
    ["Centre", centre],
    ["Report", "Unpaid credit"],
    ["As of", asOf],
    ["Closing unpaid", report.book],
    ["Listed unpaid", report.lines.reduce((sum, line) => sum + line.balance, 0)],
    [],
    ["Date given", "Customer", "Staff", "Given", "Already paid", "Still unpaid"],
  ];
  if (report.lines.length === 0) {
    rows.push(["", "None", "", 0, 0, 0]);
  }
  for (const line of report.lines) {
    rows.push([
      line.date,
      line.customer || "Customer not entered",
      line.staff || "Staff not entered",
      line.given,
      line.paid,
      line.balance,
    ]);
  }
  const listed = report.lines.reduce((sum, line) => sum + line.balance, 0);
  rows.push(["", "", "Total", "", "", listed]);
  if (report.book !== listed) {
    rows.push([]);
    rows.push(["Note", "The closing unpaid figure and the named lines do not match. The closing figure is the one in the cash total."]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `unpaid-credit-${asOf}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
