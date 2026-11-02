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
  const [openDay, setOpenDay] = useState("");
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

  const todayRows = rows.filter((row) => row.date === date && (role !== "employee" || row.mine));
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
      <section className="mb-4 rounded-xl border border-line bg-surface p-5">
        <p className="text-xs font-semibold tracking-widest text-faint">PAID TODAY</p>
        <p className="mt-1 font-display text-5xl tabular-nums">{inr(total)}</p>
        {role !== "employee" && monthTotal > total ? <p className="mt-2 text-sm text-muted">This month {inr(monthTotal)}</p> : null}
      </section>
      {locked ? <p className="mb-4 text-sm text-muted">This day is closed. A new day starts tomorrow.</p> : null}
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3"
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
        <input
          aria-label="What was paid"
          className="h-12 min-w-40 flex-1 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent disabled:bg-surface-2"
          value={paid}
          disabled={locked}
          placeholder="Tea, stationery…"
          onChange={(event) => setPaid(event.target.value.slice(0, 80))}
        />
        <div className="w-32">
          <MoneyField label="Amount paid" value={amount} disabled={locked} onChange={setAmount} />
        </div>
        <Button type="submit" className="min-h-12" disabled={locked || pending}>
          Add
        </Button>
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
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
            {earlierDays.map((day) => {
              const rows = monthRows.filter((row) => row.date === day);
              const dayTotal = rows.reduce((sum, row) => sum + row.amount, 0);
              const open = openDay === day;
              return (
                <li key={day}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm" onClick={() => setOpenDay(open ? "" : day)}>
                    <span className="font-medium">{formatDay(day)}</span>
                    <span className="tabular-nums">{inr(dayTotal)}</span>
                  </button>
                  {open ? (
                    <ul className="divide-y divide-line border-t border-line">
                      {rows.map((row) => (
                        <PaymentLine key={row.id} row={row} canRemove={canRemove(row)} onRemove={() => remove(row.id)} />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
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
