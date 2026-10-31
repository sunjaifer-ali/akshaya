import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useRefresh } from "@/lib/use-refresh";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addAdvance, addCustomerMove, advanceDesk, creditRegister, customerCreditDesk, giveAdvanceService, removeAdvance, removeCustomerMove, updateAdvance, type OpenAdvance, type OpenCredit, type PaidAdvance } from "@/lib/centre.functions";
import { downloadWorkbook } from "@/lib/excel";
import { inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import { formatDay, formatMonth } from "@/lib/ledger/dates";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/credit")({
  validateSearch: readMonth,
  component: CreditPage,
});

type Line = { id: string; date: string; staff: string; customer: string; mobile: string; kind: string; amount: number };

function CreditPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [payFor, setPayFor] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMobile, setPayMobile] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [credit, setCredit] = useState(0);
  const [debit, setDebit] = useState(0);
  const [open, setOpen] = useState<OpenCredit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<"credit" | "advance">("credit");
  const [day, setDay] = useState("");

  const load = () => {
    void customerCreditDesk({ data: month })
      .then((result) => {
        setRole(result.role === "admin" ? "admin" : "employee");
        setCredit(result.credit);
        setDebit(result.debit);
        setOpen(result.open);
        setLines(result.lines);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Credit did not open."));
  };

  useRefresh(load, 15000, [month]);

  const givenLines = lines.filter((line) => line.kind === "credit" && (!day || line.date === day));
  const paidLines = lines.filter((line) => line.kind === "debit" && (!day || line.date === day));
  const monthGiven = lines.filter((line) => line.kind === "credit").reduce((sum, line) => sum + line.amount, 0);
  const monthPaid = lines.filter((line) => line.kind === "debit").reduce((sum, line) => sum + line.amount, 0);
  const stillUnpaid = open.reduce((sum, line) => sum + line.balance, 0);
  const movementDates = [...new Set(lines.map((line) => line.date))].sort((a, b) => (a < b ? 1 : -1));

  return (
    <div>
      <PageHeader
        kicker="CREDIT"
        title="Credit and advances"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {role === "admin" && tab === "credit" ? (
              <Button
                variant="secondary"
                disabled={downloading}
                onClick={() => {
                  setDownloading(true);
                  void creditRegister()
                    .then((book) =>
                      downloadWorkbook("Credits.xlsx", [
                        {
                          name: "Credits",
                          rows: [
                            ["Date", "Staff", "Customer", "Mobile", "Type", "Amount"],
                            ...book.lines.map((line) => [line.date, line.staff, line.customer, line.mobile, line.kind, line.amount]),
                          ],
                        },
                        {
                          name: "Still unpaid",
                          rows: [
                            ["Started", "Staff", "Customer", "Mobile", "Balance"],
                            ...book.open.map((line) => [line.date, line.staff, line.customer, line.mobile, line.balance]),
                          ],
                        },
                      ]),
                    )
                    .then(() => setResult({ ok: true, message: "All credit details downloaded." }))
                    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "The file was not downloaded." }))
                    .finally(() => setDownloading(false));
                }}
              >
                {downloading ? "Downloading…" : "Download"}
              </Button>
            ) : null}
            <MonthBar
              month={month}
              onChange={(next) => {
                setDay("");
                void navigate({ search: { m: next } });
              }}
            />
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Credit and advances">
        {(
          [
            ["credit", "Credit"],
            ["advance", "Advances"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "min-h-14 rounded-lg px-4 text-lg font-medium",
              tab === id ? "bg-accent text-accent-ink" : "border border-line bg-surface text-ink",
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "advance" ? <AdvanceBlock month={month} /> : null}
      {tab === "credit" ? (
      <>
      <section className="grid gap-3 sm:grid-cols-3">
        <TotalTile label="Still unpaid" value={stillUnpaid} note="Open credit" tone="ink" />
        <TotalTile label="Credit given" value={role === "admin" ? monthGiven : credit} note={role === "admin" ? `${formatMonth(month)} · today ${inr(credit)}` : "Today"} tone="bad" />
        <TotalTile label="Credit received" value={role === "admin" ? monthPaid : debit} note={role === "admin" ? `${formatMonth(month)} · today ${inr(debit)}` : "Today"} tone="good" />
      </section>
      {role === "admin" ? (
        <div className="mt-4">
          <DaySelect value={day} dates={movementDates} onChange={setDay} />
        </div>
      ) : null}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">Still unpaid</h2>
        {open.length === 0 ? <p className="mt-2 text-sm text-muted">Nobody owes money.</p> : null}
        {byMonth(open).map((group) => (
          <div key={group.month}>
            <h3 className="mt-4 text-xs font-semibold tracking-widest text-faint">{formatMonth(group.month)}</h3>
            <ul className="divide-y divide-line">
              {group.rows.map((line) => (
            <li key={`${line.customer}-${line.mobile}`} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {line.customer}
                  <span className="mt-0.5 block text-xs text-faint">
                    {formatDay(line.date)}
                    {line.staff ? ` · ${line.staff}` : ""}
                    {line.mobile ? ` · ${line.mobile}` : " · No mobile yet"}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-lg font-medium tabular-nums">{inr(line.balance)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPayFor(line.customer);
                      setPayAmount(String(line.balance));
                      setPayMobile(line.mobile);
                      setNotice("");
                    }}
                  >
                    Update
                  </Button>
                </span>
              </div>
              {payFor === line.customer ? (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPending(true);
                    setNotice("");
                    void addCustomerMove({
                      data: { kind: "debit", customer: line.customer, mobile: payMobile || line.mobile, amount: Number(payAmount) },
                    })
                      .then(() => {
                        setPayFor("");
                        setResult({ ok: true, message: "Payment successfully updated. The unpaid balance has changed." });
                        load();
                      })
                      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Payment not updated." }))
                      .finally(() => setPending(false));
                  }}
                >
                  <input
                    inputMode="numeric"
                    aria-label={`Amount paid by ${line.customer}`}
                    className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                    value={payAmount}
                    onChange={(event) => setPayAmount(event.target.value)}
                  />
                  <input
                    inputMode="numeric"
                    aria-label={`Mobile for ${line.customer}`}
                    placeholder="Mobile"
                    className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                    value={payMobile}
                    onChange={(event) => setPayMobile(event.target.value)}
                  />
                  <Button type="submit" disabled={pending}>
                    Paid
                  </Button>
                </form>
              ) : null}
            </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
      <section className="rounded-xl border border-line border-l-4 border-l-bad bg-surface p-5">
        <h2 className="font-display text-2xl">Credit given</h2>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setNotice("");
          void addCustomerMove({ data: { kind: "credit", customer, mobile, amount: Number(amount) } })
            .then(() => {
              setCustomer("");
              setMobile("");
              setAmount("");
              setNotice("");
              setResult({ ok: true, message: "Credit successfully saved." });
              load();
            })
            .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Credit not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Customer name</span>
          <input
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Mobile, if any</span>
          <input
            inputMode="numeric"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Amount</span>
          <input
            inputMode="numeric"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add credit"}
        </Button>
      </form>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      {role === "admin" ? <MoveList lines={givenLines} empty="No credit given in this view." onDelete={(id) => deleteMove(id, setResult, load)} /> : null}
      </section>
      <section className="rounded-xl border border-line border-l-4 border-l-accent bg-surface p-5">
        <h2 className="font-display text-2xl">Credit received</h2>
      {role === "admin" ? <MoveList lines={paidLines} empty="No credit received in this view." onDelete={(id) => deleteMove(id, setResult, load)} /> : <p className="mt-3 text-sm text-muted">Today {inr(debit)}</p>}
      </section>
      </div>
      </>
      ) : null}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function AdvanceBlock({ month }: { month: string }) {
  const today = useTodayKey();
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [service, setService] = useState("");
  const [amount, setAmount] = useState("");
  const [held, setHeld] = useState(0);
  const [received, setReceived] = useState(0);
  const [open, setOpen] = useState<OpenAdvance[]>([]);
  const [paid, setPaid] = useState<PaidAdvance[]>([]);
  const [part, setPart] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<{ id: string; customer: string; mobile: string; service: string; amount: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [servedDay, setServedDay] = useState("");

  const load = () => {
    void advanceDesk()
      .then((next) => {
        setRole(next.role === "admin" ? "admin" : "employee");
        setHeld(next.held);
        setReceived(next.received);
        setOpen(next.open);
        setPaid(next.paid ?? []);
      })
      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Advance did not open." }));
  };

  useRefresh(load, 15000, []);

  const servedMonth = paid.filter((line) => line.used.startsWith(month));
  const servedTotal = servedMonth.reduce((sum, line) => sum + line.amount, 0);
  const receivedMonth =
    open.filter((line) => line.date.startsWith(month)).reduce((sum, line) => sum + line.amount, 0) +
    paid.filter((line) => line.date.startsWith(month)).reduce((sum, line) => sum + line.amount, 0);
  const servedDates = [...new Set(servedMonth.map((line) => line.used))].sort((a, b) => (a < b ? 1 : -1));
  const shownDay = servedDay.startsWith(month) ? servedDay : "";
  const servedRows = servedMonth.filter((line) => !shownDay || line.used === shownDay);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-3">
        <TotalTile label="Advance received" value={receivedMonth} note={`${formatMonth(month)} · today ${inr(received)}`} tone="bad" />
        <TotalTile label="Service given" value={servedTotal} note={formatMonth(month)} tone="good" />
        <TotalTile label="Still to serve" value={held} note="Waiting" tone="ink" />
      </section>
      {role === "admin" ? (
        <div className="mt-4">
          <DaySelect value={shownDay} dates={servedDates} onChange={setServedDay} />
        </div>
      ) : null}
      <div className="mt-4 grid items-start gap-4 sm:grid-cols-2">
    <section className="rounded-xl border border-line border-l-4 border-l-bad bg-surface p-5">
      <h2 className="font-display text-2xl">Advance received</h2>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          void addAdvance({ data: { customer, mobile, service, amount: Number(amount) } })
            .then(() => {
              setCustomer("");
              setMobile("");
              setService("");
              setAmount("");
              setResult({ ok: true, message: "Advance successfully saved." });
              load();
            })
            .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Advance not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Customer name</span>
          <input className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={customer} onChange={(event) => setCustomer(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Mobile, if any</span>
          <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={mobile} onChange={(event) => setMobile(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Service</span>
          <input className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={service} onChange={(event) => setService(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Amount received</span>
          <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save advance"}</Button>
      </form>
      <h3 className="mt-6 font-medium">Still to serve</h3>
      {open.length === 0 ? <p className="mt-4 text-sm text-muted">No advance is waiting.</p> : null}
      {byMonth(open).map((group) => (
        <div key={group.month}>
          <h3 className="mt-4 text-xs font-semibold tracking-widest text-faint">{formatMonth(group.month)}</h3>
          <ul className="divide-y divide-line">
            {group.rows.map((line) => (
          <li key={line.id} className="py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="font-medium">{line.customer}</span>
                <span className="mt-0.5 block text-xs text-faint">
                  {line.service} · {line.staff} · {formatDay(line.date)}
                  {line.mobile ? ` · ${line.mobile}` : ""}
                </span>
              </span>
              <span className="text-lg font-medium tabular-nums">{inr(line.amount)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted">
                Amount done
                <input
                  aria-label={`Amount served for ${line.customer}`}
                  inputMode="numeric"
                  placeholder="Part or full"
                  className="h-9 w-32 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
                  value={part[line.id] ?? ""}
                  onChange={(event) => setPart((current) => ({ ...current, [line.id]: event.target.value.replace(/[^\d]/g, "") }))}
                />
              </label>
              <Button
                size="sm"
                disabled={pending}
                onClick={(event) => {
                  const field = event.currentTarget.parentElement?.querySelector("input");
                  const typed = field instanceof HTMLInputElement ? field.value : (part[line.id] ?? "");
                  const served = Number(typed);
                  if (!served || served > line.amount) {
                    setResult({ ok: false, message: served > line.amount ? "That is more than the advance." : "Enter the amount done. The balance stays in advance." });
                    return;
                  }
                  setPending(true);
                  void giveAdvanceService({ data: { id: line.id, amount: served } })
                    .then((saved) => {
                      const rest = saved.left > 0 ? ` ${inr(saved.left)} still in advance.` : "";
                      setResult({
                        ok: true,
                        message: `Service given.${rest} Reduce the bank or wallet by ${inr(served)}.`,
                      });
                      load();
                    })
                    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Service not entered." }))
                    .finally(() => setPending(false));
                }}
              >
                Service given
              </Button>
              {role === "admin" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setEdit({ id: line.id, customer: line.customer, mobile: line.mobile, service: line.service, amount: String(line.amount) })}
                >
                  Edit
                </Button>
              ) : null}
              {role === "admin" || (line.mine && line.date === today) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setPending(true);
                    void removeAdvance({ data: line.id })
                      .then(() => {
                        setResult({ ok: true, message: "Advance successfully deleted." });
                        load();
                      })
                      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Advance not deleted." }))
                      .finally(() => setPending(false));
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
            {edit?.id === line.id ? <AdvanceEdit edit={edit} pending={pending} onChange={setEdit} onCancel={() => setEdit(null)} onSave={() => saveAdvanceEdit(edit, setPending, setResult, setEdit, load)} /> : null}
            </li>
            ))}
          </ul>
        </div>
      ))}
      </section>
      <section className="rounded-xl border border-line border-l-4 border-l-accent bg-surface p-5">
        <h2 className="font-display text-2xl">Service given</h2>
      {role === "admin" ? (
        <>
          {servedRows.length === 0 ? <p className="mt-2 text-sm text-muted">No advance was served in this view.</p> : null}
          {byDay(servedRows.map((line) => ({ ...line, received: line.date, date: line.used }))).map((group) => (
            <div key={group.date}>
              <h3 className="mt-4 text-xs font-semibold tracking-widest text-faint">{formatDay(group.date)}</h3>
              <ul className="divide-y divide-line">
                {group.rows.map((line) => (
              <li key={line.id} className="py-3 text-sm">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-3">
                  <span>
                    <span className="font-medium">{line.customer}</span>
                    <span className="mt-0.5 block text-xs text-faint">
                      {line.service} · {line.staff} · received {formatDay(line.received)}
                      {line.mobile ? ` · ${line.mobile}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-lg font-medium tabular-nums">{inr(line.amount)}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setEdit({ id: line.id, customer: line.customer, mobile: line.mobile, service: line.service, amount: String(line.amount) })}
                    >
                      Edit
                    </Button>
                </div>
                {edit?.id === line.id ? <AdvanceEdit edit={edit} pending={pending} onChange={setEdit} onCancel={() => setEdit(null)} onSave={() => saveAdvanceEdit(edit, setPending, setResult, setEdit, load)} /> : null}
              </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Mark the amount done on the left. The balance stays in advance.</p>
      )}
      </section>
      </div>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

type AdvanceDraft = { id: string; customer: string; mobile: string; service: string; amount: string };

function saveAdvanceEdit(
  edit: AdvanceDraft,
  setPending: (value: boolean) => void,
  setResult: (value: Result | null) => void,
  setEdit: (value: AdvanceDraft | null) => void,
  load: () => void,
) {
  const amount = Number(edit.amount);
  if (!edit.customer.trim() || !edit.service.trim() || !amount) {
    setResult({ ok: false, message: "Enter the customer, the service, and the amount." });
    return;
  }
  setPending(true);
  void updateAdvance({ data: { id: edit.id, customer: edit.customer, mobile: edit.mobile, service: edit.service, amount } })
    .then(() => {
      setEdit(null);
      setResult({ ok: true, message: "Advance successfully updated." });
      load();
    })
    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Advance not updated." }))
    .finally(() => setPending(false));
}

function AdvanceEdit({
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
      className="mt-2 grid gap-2"
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

function deleteMove(id: string, setResult: (value: Result | null) => void, load: () => void) {
  void removeCustomerMove({ data: id })
    .then(() => {
      setResult({ ok: true, message: "Entry successfully deleted." });
      load();
    })
    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Not deleted." }));
}

function TotalTile({ label, value, note, tone }: { label: string; value: number; note: string; tone: "bad" | "good" | "ink" }) {
  return (
    <div className={cn("rounded-xl border border-line p-4", tone === "bad" ? "bg-bad-soft" : tone === "good" ? "bg-accent-soft" : "bg-surface")}>
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{inr(value)}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

function DaySelect({ value, dates, onChange }: { value: string; dates: string[]; onChange: (day: string) => void }) {
  if (dates.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">Date</span>
      <select
        aria-label="Date"
        className="h-11 rounded-sm border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All dates</option>
        {dates.map((date) => (
          <option key={date} value={date}>
            {formatDay(date)}
          </option>
        ))}
      </select>
    </label>
  );
}

function MoveList({ lines, empty, onDelete }: { lines: Line[]; empty: string; onDelete: (id: string) => void }) {
  if (lines.length === 0) return <p className="mt-4 text-sm text-muted">{empty}</p>;
  return (
    <>
      {byDay(lines).map((group) => (
        <div key={group.date}>
          <h3 className="mt-4 text-xs font-semibold tracking-widest text-faint">{formatDay(group.date)}</h3>
          <ul className="divide-y divide-line">
            {group.rows.map((line) => (
              <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-3 py-3 text-sm">
                <span>
                  <span className="font-medium">{line.customer}</span>
                  <span className="mt-0.5 block text-xs text-faint">
                    {line.staff}
                    {line.mobile ? ` · ${line.mobile}` : ""}
                  </span>
                </span>
                <span className="text-right text-lg font-medium tabular-nums">{inr(line.amount)}</span>
                <Button size="sm" variant="ghost" onClick={() => onDelete(line.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function byMonth<T extends { date: string }>(rows: T[]) {
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort((a, b) => (a < b ? 1 : -1));
  return months.map((month) => ({
    month,
    rows: rows.filter((row) => row.date.startsWith(month)).sort((a, b) => (a.date < b.date ? 1 : -1)),
  }));
}

function byDay<T extends { date: string }>(rows: T[]) {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.date);
    if (list) list.push(row);
    else {
      groups.set(row.date, [row]);
      order.push(row.date);
    }
  }
  return order.map((date) => ({ date, rows: groups.get(date) ?? [] }));
}
