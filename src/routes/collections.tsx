import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { employeeSplitSum, monthCollection, monthDays } from "@/lib/ledger/calc";
import { formatDay, formatMonth, fyMonths, fyStartYear } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/collections")({
  validateSearch: readMonth,
  component: CollectionsPage,
});

function CollectionsPage() {
  const today = useTodayKey();
  const search = Route.useSearch();
  const monthFromUrl = useResolvedMonth(search.m ?? "");
  const book = useLedger();
  const [from, setFrom] = useState(today || `${monthFromUrl}-01`);
  const [to, setTo] = useState(today || `${monthFromUrl}-01`);
  const [person, setPerson] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const month = end.slice(0, 7);
  const yearMonths = fyMonths(fyStartYear(month));
  const selected = book.days.find((item) => item.date === end);
  const people = book.employees.filter((employee) => employee.active || book.days.some((item) => (item.splits[employee.id] ?? 0) > 0));
  const rows = people
    .map((employee) => ({
      id: employee.id,
      name: employee.name,
      period: rangeSplit(book.days, employee.id, start, end),
      day: selected?.splits[employee.id] ?? 0,
      month: employeeSplitSum(book.days, employee.id, month),
      year: yearMonths.reduce((sum, item) => sum + employeeSplitSum(book.days, employee.id, item), 0),
    }))
    .sort((a, b) => b.period - a.period || a.name.localeCompare(b.name));
  const shown = person ? rows.filter((row) => row.id === person) : rows;
  const totals = shown.reduce(
    (sum, row) => ({ period: sum.period + row.period, day: sum.day + row.day, month: sum.month + row.month, year: sum.year + row.year }),
    { period: 0, day: 0, month: 0, year: 0 },
  );
  const one = person ? rows.find((row) => row.id === person) : null;
  const savedDays = monthDays(book.days, month).filter((item) => item.amount > 0);
  const sheetOnly = savedDays.length === 1 && /centre sheet|month total from/i.test(savedDays[0]?.note ?? "");
  const counterDay = (selected?.note ?? "").startsWith("Entered on the counter");
  const centreMonth = monthCollection(book.days, month);

  return (
    <div>
      <PageHeader
        kicker="COLLECTIONS"
        title="Staff collection"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Staff"
              className="h-11 rounded-sm border border-line bg-bg px-3 text-base"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
            >
              <option value="">All staff</option>
              {people.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">From</span>
              <input
                type="date"
                aria-label="From date"
                className="h-11 rounded-sm border border-line bg-bg px-3 text-base"
                value={from}
                onChange={(event) => {
                  setPendingDelete(false);
                  if (event.target.value) setFrom(event.target.value);
                }}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">To</span>
              <input
                type="date"
                aria-label="To date"
                className="h-11 rounded-sm border border-line bg-bg px-3 text-base"
                value={to}
                onChange={(event) => {
                  setPendingDelete(false);
                  if (event.target.value) setTo(event.target.value);
                }}
              />
            </label>
          </div>
        }
      />

        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label={`${formatDay(start)} – ${formatDay(end)}`} value={inr(one ? one.period : totals.period)} />
          <Mini label={formatDay(end)} value={inr(one ? one.day : totals.day)} />
          <Mini label={formatMonth(month)} value={inr(one ? one.month : totals.month)} />
          <Mini label={`${fyStartYear(month)}–${String(fyStartYear(month) + 1).slice(2)}`} value={inr(one ? one.year : totals.year)} />
        </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">{one ? one.name : "All staff"}</h2>
        <p className="mt-1 text-sm text-muted">{formatDay(start)} – {formatDay(end)}</p>
        {shown.length === 0 ? <p className="mt-4 text-sm text-muted">No staff yet.</p> : null}
        {shown.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold tracking-widest text-faint">
                  <th className="py-2 font-semibold">Staff</th>
                  <th className="py-2 text-right font-semibold">From – to</th>
                  <th className="py-2 text-right font-semibold">Day</th>
                  <th className="py-2 text-right font-semibold">Month</th>
                  <th className="py-2 text-right font-semibold">Year</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id} className="border-b border-line">
                    <td className="py-3 font-medium">{row.name}</td>
                    <td className="py-3 text-right text-lg tabular-nums">{inr(row.period)}</td>
                    <td className="py-3 text-right text-lg tabular-nums">{inr(row.day)}</td>
                    <td className="py-3 text-right text-lg tabular-nums">{inr(row.month)}</td>
                    <td className="py-3 text-right text-lg tabular-nums">{inr(row.year)}</td>
                  </tr>
                ))}
                {!one ? (
                  <tr>
                    <td className="py-3 font-medium">Total</td>
                    <td className="py-3 text-right font-display text-2xl tabular-nums">{inr(totals.period)}</td>
                    <td className="py-3 text-right font-display text-2xl tabular-nums">{inr(totals.day)}</td>
                    <td className="py-3 text-right font-display text-2xl tabular-nums">{inr(totals.month)}</td>
                    <td className="py-3 text-right font-display text-2xl tabular-nums">{inr(totals.year)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
        {one ? (
          <table className="mt-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-widest text-faint">
                <th className="py-2 font-semibold">Month</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {yearMonths.map((item) => (
                <tr key={item} className="border-b border-line">
                  <td className="py-3 font-medium">{formatMonth(item)}</td>
                  <td className="py-3 text-right text-lg tabular-nums">{inr(employeeSplitSum(book.days, one.id, item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {sheetOnly && !one ? (
          <div className="mt-4 max-w-xs">
            <MoneyField label={`Net collection for ${formatMonth(month)}`} value={centreMonth > 0 ? centreMonth : null} onChange={(amount) => book.setMonthCollection(month, amount)} />
          </div>
        ) : null}
        {selected && !counterDay && (selected.amount ?? 0) > 0 && !one ? (
          <div className="mt-4">
            {pendingDelete ? (
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={() => { book.removeDay(end); setPendingDelete(false); }}>
                  Delete this day
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPendingDelete(false)}>Keep</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setPendingDelete(true)}>Delete this day</Button>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function rangeSplit(days: { date: string; splits: Record<string, number> }[], employeeId: string, start: string, end: string): number {
  return days.reduce((sum, day) => (day.date < start || day.date > end ? sum : sum + (day.splits[employeeId] ?? 0)), 0);
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}
