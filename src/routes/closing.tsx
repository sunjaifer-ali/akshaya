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
  closingTotal,
  countStarted,
  creditGivenInMonth,
  creditPaidTotal,
  emptyNotes,
  previousClose,
  unpaidCreditReport,
  type UnpaidCreditLine,
} from "@/lib/ledger/cash";
import { addDays, formatDay, formatFull } from "@/lib/ledger/dates";
import { pushClose } from "@/lib/ledger/share";
import { myRole, closingCredit } from "@/lib/centre.functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLedger } from "@/lib/ledger/store";
import type { CashClose, CreditGiven, CreditPayment, Employee } from "@/lib/ledger/types";
import { readDate } from "@/lib/search";
import { useTodayKey } from "@/lib/use-today";
import { useEffect, useState, type ReactNode } from "react";

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
  const [role, setRole] = useState<"admin" | "employee">("admin");
  const saved = book.cashCloses.find((item) => item.date === date);
  const accepted = Boolean(saved?.accepted);
  const locked = role === "employee" && accepted;
  const previous = previousClose(book.cashCloses, date);
  const [draft, setDraft] = useState<CashClose>(() => saved ?? blank(date, previous?.credits ?? 0));
  const [editing, setEditing] = useState(!saved);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [liveCredit, setLiveCredit] = useState<{ given: CreditGiven[]; paid: CreditPayment[]; unpaid: number } | null>(null);

  useEffect(() => {
    void myRole()
      .then((result) => setRole(result.role === "employee" ? "employee" : "admin"))
      .catch(() => setRole("admin"));
  }, []);

  useEffect(() => {
    const current = book.cashCloses.find((item) => item.date === date);
    const prev = previousClose(book.cashCloses, date);
    setDraft(current ?? blank(date, prev?.credits ?? 0, counterName(book.employees, user?.displayName)));
    setEditing(!current);
    setConfirmClear(false);
    // Only when the day changes. A shared save must not wipe the count being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    let stop = false;
    const pull = () => {
      void closingCredit({ data: date })
        .then((credit) => {
          if (!stop) setLiveCredit({ given: credit.given, paid: credit.paid, unpaid: credit.unpaid });
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [date]);

  const base = editing ? draft : (saved ?? draft);
  const row = liveCredit
    ? { ...base, creditGiven: liveCredit.given, creditPaid: liveCredit.paid, credits: liveCredit.unpaid }
    : base;
  const closing = closingTotal(row);
  const cash = cashInHand(row.notes);
  const paid = creditPaidTotal(row);
  const counted = countStarted(row);
  const tallyReady = counted;
  const previewCloses = tallyReady ? [...book.cashCloses.filter((item) => item.date !== date), row] : book.cashCloses;
  const check = checkClose(row, previewCloses, book.days, book.holidays);
  const lines = accountLines(book.cashCloses, book.days, book.holidays);
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
        lede="Notes, wallets, credit, and bank. Today’s movement should match the counter collection."
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
      {tallyReady && check.difference != null && check.difference !== 0 ? (
        <p className={cn("mb-4 text-sm font-medium", (check.unfixed ?? 0) < 0 ? "text-bad" : "text-warn")}>
          This day · {(check.unfixed ?? 0) < 0 ? "Short" : "Excess"} {inr(Math.abs(check.unfixed ?? 0))}
        </p>
      ) : null}
      {!tallyReady && (given.length > 0 || (liveCredit?.unpaid ?? 0) > 0) ? (
        <p className="mb-4 text-sm text-muted">Credit is recorded. It is not a shortage. Short and excess start after the notes, wallets, or bank are entered.</p>
      ) : null}

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
        <Field label="Credits still unpaid">
          <MoneyField label="Credits still unpaid" value={row.credits} disabled onChange={() => undefined} />
        </Field>
        <Field label="Bank balance">
          <MoneyField label="Bank balance" value={row.bank} disabled={!editing} onChange={(amount) => patch({ bank: amount ?? 0 })} />
        </Field>
      </section>

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
        <p className="mt-2 text-sm text-muted">Staff enter credit and later payments on Credit. This balance is what is still unpaid.</p>
        <CreditGiven
          editing={false}
          rows={given}
          staff={book.employees}
          stillUnpaid={row.credits}
          monthGiven={monthGiven}
          onChange={(creditGiven, credits) => patch({ creditGiven, credits })}
        />
        <CreditPaid
          editing={false}
          payments={payments}
          paid={paid}
          lastCredits={previous?.credits ?? 0}
          stillUnpaid={row.credits}
          onChange={(creditPaid, credits) => patch({ creditPaid, credits })}
        />
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Total closing</h2>
        <p className="mt-1 font-display text-3xl tabular-nums">{inr(closing)}</p>
        <p className="mt-1 text-sm text-muted">Notes {inr(cash)} + wallets, credits, and bank {inr(closing - cash)}.</p>
      </section>

      <CheckCard date={date} check={check} fixed={row.fixed} paid={paid} locked={!editing} hold={!tallyReady} onFixed={(fixed) => patch({ fixed })} />

      {shorts.length + excesses.length > 0 ? (
        <details className="short-report mt-4 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Open days · Short {shorts.length} · Excess {excesses.length}
          </summary>
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
  locked,
  hold,
  onFixed,
}: {
  date: string;
  check: ReturnType<typeof checkClose>;
  fixed: number;
  paid: number;
  locked: boolean;
  hold: boolean;
  onFixed: (amount: number) => void;
}) {
  if (check.last == null) {
    return (
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-medium">Opening</h2>
        <p className="mt-1 text-sm text-muted">First closing. The next day is checked against this.</p>
      </section>
    );
  }

  const shown = hold ? { ...check, difference: null, unfixed: null } : check;

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-medium">Against last closing</h2>
      <dl className="mt-3 grid gap-2 text-sm">
        <Pair label={`Last closing, ${formatDay(check.lastDate)}`} value={inr(check.last)} />
        <Pair label="Movement" value={signedInr(check.movement)} />
        <Pair label="Counter collection" value={check.collected == null ? "—" : inr(check.collected)} />
        <Pair label="GPay received in personal number" value={inr(check.personalGpay)} />
        {check.personalGpay > 0 ? (
          <p className="text-xs text-muted">All staff together. This money is not in the centre cash, so it is left out of the match.</p>
        ) : null}
        {paid > 0 ? <Pair label="Credit paid today" value={inr(paid)} /> : null}
        <Pair
          label="Difference"
          value={diffLabel(shown.difference)}
          tone={shown.difference == null ? "ink" : shown.difference < 0 ? "bad" : shown.difference > 0 ? "warn" : "good"}
        />
      </dl>
      {hold ? (
        <p className="mt-3 text-sm text-muted">Enter the notes and wallets. Short or excess is counted from that.</p>
      ) : shown.missing.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          Counter missing: {check.missing.map((item) => formatDay(item)).join(", ")}. Enter the charges for those days.
        </p>
      ) : shown.difference === 0 ? (
        <p className="mt-3 text-sm text-accent">Matches the counter.</p>
      ) : (
        <div className="mt-3">
          <label className="block max-w-xs text-sm">
            <span className="mb-1 block text-muted">Fixed</span>
            <MoneyField label="Amount fixed" value={fixed} disabled={locked} onChange={(amount) => onFixed(amount ?? 0)} />
          </label>
          <p className="mt-2 text-sm">
            Still open {(check.unfixed ?? 0) < 0 ? "short" : "excess"}{" "}
            <span className={cn("font-medium tabular-nums", (check.unfixed ?? 0) < 0 ? "text-bad" : "text-warn")}>{inr(Math.abs(check.unfixed ?? 0))}</span>
          </p>
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
      <p className="mt-2 text-sm text-muted">
        Paid {inr(paid)} · Unpaid {inr(stillUnpaid)}
      </p>
      {paid > lastCredits ? <p className="mt-1 text-sm text-warn">More than was unpaid. Count that extra cash in the notes, and it shows as excess.</p> : null}
    </div>
  );
}

function AccountTile({ label, count, total, tone }: { label: string; count: number; total: number; tone: "bad" | "warn" }) {
  return (
    <div className={cn("rounded-xl border border-line p-5", tone === "bad" ? "bg-bad-soft" : "bg-warn-soft")}>
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className={cn("mt-1 font-display text-3xl tabular-nums", tone === "bad" ? "text-bad" : "text-warn")}>
        {count === 0 ? "None" : inr(total)}
      </p>
      <p className="mt-1 text-sm text-muted">{count === 0 ? "No open days" : `${count} ${count === 1 ? "day" : "days"}`}</p>
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
  };
}

function counterName(employees: Employee[], displayName: string | null | undefined): string {
  const name = (displayName ?? "").trim();
  const match = employees.find((employee) => employee.active && employee.name.toLowerCase() === name.toLowerCase());
  return match?.name ?? "";
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
