import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { chartColors } from "@/lib/chart-colors";
import { inr, inrShort, pct, signedInr } from "@/lib/format";
import { centreSnapshot, type CentreSnapshot } from "@/lib/ledger/calc";
import { fyLabel, fyMonths, fyStartYear, formatMonthShort } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { readYear } from "@/lib/search";
import { useMounted } from "@/lib/use-mounted";
import { useTodayKey } from "@/lib/use-today";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/centre")({
  validateSearch: readYear,
  component: CentrePage,
});

function CentrePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useTodayKey();
  const anchor = today ? today.slice(0, 7) : "2026-10";
  const fy = Number(search.fy || fyStartYear(anchor));
  const book = useLedger();
  const mounted = useMounted();
  const months = fyMonths(fy);
  const rows = months.map((month) =>
    centreSnapshot(
      book.employees,
      book.days,
      book.perfOverrides,
      book.leaves,
      book.holidays,
      book.expenses,
      book.lyOverrides,
      month,
      book.deductLwp,
      today,
    ),
  );
  const visible = rows.filter((row) => row.month <= anchor || row.collection > 0 || row.expense > 0);
  const [picked, setPicked] = useState(anchor);
  const inThisYear = rows.find((row) => row.month === picked);
  const selected = inThisYear ?? visible[visible.length - 1] ?? rows[0];

  const totals = visible.reduce(
    (sum, row) => ({
      collection: sum.collection + row.collection,
      expense: sum.expense + row.expense,
      salary: sum.salary + row.salary,
      margin: sum.margin + row.margin,
    }),
    { collection: 0, expense: 0, salary: 0, margin: 0 },
  );
  const paired = visible.filter((row) => row.lastYear != null && row.collection > 0);
  const pairedCollection = paired.reduce((sum, row) => sum + row.collection, 0);
  const pairedLast = paired.reduce((sum, row) => sum + (row.lastYearCompared ?? 0), 0);
  const growth = paired.length > 0 ? pairedCollection - pairedLast : null;
  const growthPct = pairedLast > 0 && growth != null ? (growth / pairedLast) * 100 : null;

  const chartRows = visible.map((row) => ({
    label: formatMonthShort(row.month),
    collection: row.collection,
    lastYear: row.lastYearCompared ?? 0,
    margin: row.margin,
  }));

  return (
    <div className="report-sheet">
      <PageHeader
        kicker="CENTRE"
        title="Month performance"
        lede="Net collection, expenses, staff pay, margin, and growth against the same month last year."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous year" onClick={() => void navigate({ search: { fy: String(fy - 1) } })}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="min-w-28 text-center text-sm font-medium">{fyLabel(fy)}</p>
            <Button variant="secondary" size="icon" aria-label="Next year" onClick={() => void navigate({ search: { fy: String(fy + 1) } })}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="secondary" className="no-print" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <section className="print-stats grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Net collection" value={inr(totals.collection)} />
        <Mini
          label="Expenses"
          value={inr(totals.expense + totals.salary)}
          hint={`${pct(totals.collection > 0 ? ((totals.expense + totals.salary) / totals.collection) * 100 : null)} · including salary`}
        />
        <Mini label="Margin" value={inr(totals.margin)} hint="After expenses, including salary" />
        <Mini label="Growth" value={growth == null ? "—" : signedInr(growth)} hint={pct(growthPct)} />
      </section>

      <section className="print-chart mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">Collection against last year</h2>
        <div className="mt-3 h-64">
          {mounted ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows}>
                <CartesianGrid vertical={false} stroke={chartColors.line} />
                <XAxis dataKey="label" tick={{ fill: chartColors.faint, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => inrShort(Number(value))} tick={{ fill: chartColors.faint, fontSize: 12 }} axisLine={false} tickLine={false} width={56} />
                <Tooltip
                  formatter={(value, name) => [inr(Number(value)), name === "lastYear" ? "Last year" : name === "margin" ? "Margin" : "Collection"]}
                  contentStyle={{ border: `1px solid ${chartColors.line}`, borderRadius: 8, background: chartColors.surface }}
                />
                <Bar dataKey="lastYear" fill={chartColors.muted} radius={[4, 4, 0, 0]} />
                <Bar dataKey="collection" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                <Line dataKey="margin" stroke={chartColors.ink} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-faint">Grey is last year. Green is this year. The line is margin after expenses, including salary.</p>
      </section>

      {selected ? <MonthDetail row={selected} onCommit={(amount) => book.setLastYear(selected.month, amount)} /> : null}

      <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Month wise centre performance</caption>
          <thead className="text-xs tracking-wide text-faint">
            <tr className="border-b border-line">
              {["Month", "Net collection", "Expense", "Salary", "Margin", "Expense %", "Last year", "Growth", "Growth %"].map((head) => (
                <th key={head} className="px-3 py-3 font-medium">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const future = row.month > anchor && row.collection === 0 && row.expense === 0;
              return (
                <tr
                  key={row.month}
                  className={cn("cursor-pointer border-b border-line last:border-0", selected?.month === row.month && "bg-accent-soft")}
                  onClick={() => setPicked(row.month)}
                >
                  <th className="px-3 py-3 font-medium">{formatMonthShort(row.month)}</th>
                  <Cell>{future ? "—" : inr(row.collection)}</Cell>
                  <Cell>{future ? "—" : inr(row.expense + row.salary)}</Cell>
                  <Cell>{future ? "—" : inr(row.salary)}</Cell>
                  <Cell>{future ? "—" : inr(row.margin)}</Cell>
                  <Cell>{future ? "—" : pct(costPct(row))}</Cell>
                  <Cell>{row.lastYear == null ? "—" : inr(row.lastYear)}</Cell>
                  <Cell tone={toneOf(row.growth)}>{row.collection > 0 ? signedInr(row.growth) : "—"}</Cell>
                  <Cell tone={toneOf(row.growthPct)}>{row.collection > 0 ? pct(row.growthPct) : "—"}</Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Expenses include salary. The salary column is the staff pay inside that figure, not an extra amount.</p>
    </div>
  );
}

function MonthDetail({ row, onCommit }: { row: CentreSnapshot; onCommit: (amount: number | null) => void }) {
  return (
    <section className="print-keep mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">{formatMonthShort(row.month)} in detail</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {row.collection > 0
          ? `Margin is ${inr(row.margin)} after ${inr(row.expense + row.salary)} of expenses, including ${inr(row.salary)} of salary. That is ${pct(costPct(row))} of collection.`
          : "No collection entered for this month yet."}
        {row.collection > 0 && row.growthPct != null ? ` Growth is ${pct(row.growthPct)} against last year.` : ""}
      </p>
      <div className="print-stats mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Net collection" value={inr(row.collection)} hint="Month total" />
        <Mini label="Expense %" value={pct(costPct(row))} hint={`${inr(row.expense + row.salary)} including salary`} />
        <Mini label="Salary %" value={pct(row.salaryPct)} hint={inr(row.salary)} />
        <Mini label="Margin %" value={pct(row.marginPct)} hint={inr(row.margin)} />
      </div>
      <label className="mt-4 block max-w-xs text-sm">
        <span className="mb-1 block text-muted">
          Last year, full month
          {row.lastYearSource === "book" ? " (from last year’s month total — type to replace)" : row.lastYearSource === "entered" ? " (typed in)" : " (not in the book yet)"}
        </span>
        <MoneyField label="Last year collection" value={row.lastYear} onChange={onCommit} />
        {row.lastYearPartial && row.lastYear != null && row.lastYearCompared != null ? (
          <p className="mt-2 text-xs text-muted">
            Growth uses the same working days so far, {inr(row.lastYearCompared)} of this {inr(row.lastYear)}. The full month stays {inr(row.lastYear)}.
          </p>
        ) : null}
      </label>
    </section>
  );
}

function costPct(row: CentreSnapshot): number | null {
  if (row.collection <= 0) return null;
  return ((row.expense + row.salary) / row.collection) * 100;
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg p-4">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Cell({ children, tone = "ink" }: { children: string; tone?: "ink" | "good" | "bad" }) {
  return (
    <td className={cn("px-3 py-3 tabular-nums", tone === "good" && "text-accent", tone === "bad" && "text-bad")}>{children}</td>
  );
}

function toneOf(value: number | null): "ink" | "good" | "bad" {
  if (value == null || value === 0) return "ink";
  return value > 0 ? "good" : "bad";
}
