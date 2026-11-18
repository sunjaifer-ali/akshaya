import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { MoneyField } from "@/components/money-field";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addCentrePayout, listCentrePayouts, removeCentrePayout, type PayoutRow } from "@/lib/centre.functions";
import { inr } from "@/lib/format";
import { formatDay } from "@/lib/ledger/dates";
import { payoutKind, payoutLabel } from "@/lib/ledger/types";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/payments")({
  component: PaymentsPage,
});

function PaymentsPage() {
  const today = useTodayKey();
  const date = today || "";
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [role, setRole] = useState("employee");
  const [closed, setClosed] = useState(false);
  const [paid, setPaid] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = () => {
    if (!date) return;
    void listCentrePayouts({ data: date })
      .then((desk) => {
        setRows(desk.rows);
        setRole(desk.role);
        setClosed(desk.closed);
      })
      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Payments did not open." }));
  };

  useEffect(() => {
    load();
  }, [date]);

  const todayRows = rows.filter((row) => row.date === date);
  const monthRows = rows.filter((row) => row.date !== date && row.date.startsWith(date.slice(0, 7)));
  const earlierDays = [...new Set(monthRows.map((row) => row.date))].sort((a, b) => (a < b ? 1 : -1));
  const total = todayRows.reduce((sum, row) => sum + row.amount, 0);
  const monthTotal = monthRows.reduce((sum, row) => sum + row.amount, 0) + total;
  const locked = closed;
  const canRemove = (row: PayoutRow) => role === "admin" || (row.mine && row.date === date && !locked);

  return (
    <div>
      <PageHeader
        kicker="PAYMENTS"
        title="Paid from the centre"
      />
      <p className="mb-4 font-display text-3xl tabular-nums">{inr(total)}</p>
      {locked ? <p className="mb-4 text-sm text-muted">This day is closed. A new day starts tomorrow.</p> : null}
      <form
        className="grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!date || locked) return;
          const written = paid.trim();
          if (!written) {
            setResult({ ok: false, message: "Write what was paid." });
            return;
          }
          setPending(true);
          void addCentrePayout({ data: { date, category: payoutKind(written), amount: amount ?? 0, note: written } })
            .then(() => {
              setAmount(null);
              setPaid("");
              setResult({ ok: true, message: "Payment successfully saved." });
              load();
            })
            .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Payment was not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">What was paid</span>
          <input
            aria-label="What was paid"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:bg-surface-2"
            value={paid}
            disabled={locked}
            placeholder="eg. tea, stationery, donation"
            onChange={(event) => setPaid(event.target.value.slice(0, 80))}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Amount</span>
          <MoneyField label="Amount paid" value={amount} disabled={locked} onChange={setAmount} />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={locked || pending}>
            Add payment
          </Button>
        </div>
      </form>
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
        {todayRows.length === 0 ? <li className="px-4 py-4 text-sm text-muted">Nothing paid out today.</li> : null}
        {todayRows.map((row) => (
          <PaymentLine key={row.id} row={row} canRemove={canRemove(row)} onRemove={() => remove(row.id)} />
        ))}
      </ul>
      {role !== "employee" && earlierDays.length > 0 ? (
        <section className="mt-4">
          <h2 className="font-medium">This month</h2>
          <p className="mt-1 text-sm text-muted">{inr(monthTotal)} paid out, including today.</p>
          {earlierDays.map((day) => (
            <div key={day} className="mt-3">
              <h3 className="text-xs font-semibold tracking-widest text-faint">{formatDay(day)}</h3>
              <ul className="mt-1 divide-y divide-line rounded-xl border border-line bg-surface">
                {monthRows
                  .filter((row) => row.date === day)
                  .map((row) => (
                    <PaymentLine key={row.id} row={row} canRemove={canRemove(row)} onRemove={() => remove(row.id)} />
                  ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );

  function remove(id: string) {
    void removeCentrePayout({ data: id })
      .then(() => {
        setResult({ ok: true, message: "Payment successfully deleted." });
        load();
      })
      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Payment was not deleted." }));
  }
}

function PaymentLine({ row, canRemove, onRemove }: { row: PayoutRow; canRemove: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span>
        <span className="font-medium">{row.note || payoutLabel(row.category)}</span>
        <span className="text-muted"> · {row.by}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="tabular-nums">{inr(row.amount)}</span>
        {canRemove ? (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Delete
          </Button>
        ) : null}
      </span>
    </li>
  );
}
