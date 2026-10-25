import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MonthBar } from "@/components/month-bar";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { downloadWorkbook } from "@/lib/excel";
import { inr } from "@/lib/format";
import { dayOn, employeeSplitSum, monthCollection, monthDays } from "@/lib/ledger/calc";
import { datesInMonth, formatDay, formatMonth, fyMonths, fyStartYear } from "@/lib/ledger/dates";
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
  const [reportMonth, setReportMonth] = useState((today || monthFromUrl).slice(0, 7));
  const [person, setPerson] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const month = end.slice(0, 7);
  const yearMonths = fyMonths(fyStartYear(month));
  const selected = dayOn(book.days, end);
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
        className="no-print"
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

        <section className="no-print mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label={`${formatDay(start)} – ${formatDay(end)}`} value={inr(one ? one.period : totals.period)} />
          <Mini label={formatDay(end)} value={inr(one ? one.day : totals.day)} />
          <Mini label={formatMonth(month)} value={inr(one ? one.month : totals.month)} />
          <Mini label={`${fyStartYear(month)}–${String(fyStartYear(month) + 1).slice(2)}`} value={inr(one ? one.year : totals.year)} />
        </section>

      <section className="no-print mt-4 rounded-xl border border-line bg-surface p-5">
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

      <DailySheet centre={book.centreName} month={reportMonth} onMonth={setReportMonth} people={people} days={book.days} />
    </div>
  );
}

function DailySheet({
  centre,
  month,
  onMonth,
  people,
  days,
}: {
  centre: string;
  month: string;
  onMonth: (month: string) => void;
  people: { id: string; name: string }[];
  days: { date: string; amount: number; note?: string; splits: Record<string, number> }[];
}) {
  const staff = people.slice().sort((a, b) => a.name.localeCompare(b.name));
  const rows = datesInMonth(month)
    .map((date) => {
      const saved = days.find((item) => item.date === date && !/centre sheet|month total/i.test(item.note ?? ""));
      const amounts = staff.map((person) => saved?.splits[person.id] ?? 0);
      const total = amounts.reduce((sum, amount) => sum + amount, 0);
      return { date, amounts, total };
    })
    .filter((row) => row.total > 0);
  const columnTotals = staff.map((_, index) => rows.reduce((sum, row) => sum + row.amounts[index], 0));
  const grand = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-faint">DAILY SERVICE CHARGE</p>
          <h2 className="font-display text-3xl">{formatMonth(month)}</h2>
          <p className="mt-1 text-sm text-muted">{centre}</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <MonthBar month={month} onChange={onMonth} />
          <Button
            variant="secondary"
            onClick={() => {
              void downloadWorkbook(`Staff-daily-${month}.xlsx`, [
                {
                  name: "Daily",
                  rows: [
                    ["Date", ...staff.map((person) => person.name), "All staff"],
                    ...rows.map((row) => [formatDay(row.date), ...row.amounts, row.total]),
                    ["Total", ...columnTotals, grand],
                  ],
                },
              ]);
            }}
          >
            Excel
          </Button>
          <Button onClick={() => window.print()}>PDF</Button>
        </div>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">No collection in this month.</p> : null}
      {rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-widest text-faint">
                <th className="sticky left-0 bg-surface py-2 pr-3 text-left font-semibold">Date</th>
                {staff.map((person) => (
                  <th key={person.id} className="px-2 py-2 text-right font-semibold">{person.name}</th>
                ))}
                <th className="py-2 pl-3 text-right font-semibold">All staff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className="border-b border-line">
                  <td className="sticky left-0 bg-surface py-2 pr-3 font-medium whitespace-nowrap">{formatDay(row.date)}</td>
                  {row.amounts.map((amount, index) => (
                    <td key={staff[index]?.id ?? index} className="px-2 py-2 text-right tabular-nums">{amount ? inr(amount) : "—"}</td>
                  ))}
                  <td className="py-2 pl-3 text-right text-base font-medium tabular-nums">{inr(row.total)}</td>
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 bg-surface py-3 font-medium">Total</td>
                {columnTotals.map((amount, index) => (
                  <td key={staff[index]?.id ?? index} className="px-2 py-3 text-right font-medium tabular-nums">{inr(amount)}</td>
                ))}
                <td className="py-3 pl-3 text-right font-display text-2xl tabular-nums">{inr(grand)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function rangeSplit(days: { date: string; note?: string; splits: Record<string, number> }[], employeeId: string, start: string, end: string): number {
  const months = new Set<string>();
  for (const day of days) {
    if (day.date >= start && day.date <= end) months.add(day.date.slice(0, 7));
  }
  const skipSheet = new Set<string>();
  for (const month of months) {
    const hasDaily = days.some(
      (day) => day.date.startsWith(month) && !/centre sheet|month total/i.test(day.note ?? "") && Object.values(day.splits).some((amount) => amount > 0),
    );
    if (hasDaily) skipSheet.add(month);
  }
  const seen = new Set<string>();
  return days.reduce((sum, day) => {
    if (day.date < start || day.date > end || seen.has(day.date)) return sum;
    if (skipSheet.has(day.date.slice(0, 7)) && /centre sheet|month total/i.test(day.note ?? "")) return sum;
    seen.add(day.date);
    return sum + (day.splits[employeeId] ?? 0);
  }, 0);
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}
