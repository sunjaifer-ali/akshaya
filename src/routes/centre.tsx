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
import { checkClose } from "@/lib/ledger/cash";
import { fyLabel, fyMonths, fyStartYear, formatDay, formatMonthShort } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { readYear } from "@/lib/search";
import { useMounted } from "@/lib/use-mounted";
import { useTodayKey } from "@/lib/use-today";
import { downloadWorkbook } from "@/lib/excel";
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
      book.payouts ?? [],
    ),
  );
  const visible = rows.filter((row) => row.month <= anchor || row.collection > 0 || row.expense > 0);
  const [picked, setPicked] = useState(anchor);
  const [view, setView] = useState<"day" | "month" | "year">("year");
  const [day, setDay] = useState(today || "");
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
  const yearLast = visible.reduce((sum, row) => sum + (row.lastYear ?? 0), 0);
  const yearLastKnown = visible.some((row) => row.lastYear != null);

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
        actions={
          <div className="no-print flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous year" onClick={() => void navigate({ search: { fy: String(fy - 1) } })}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="min-w-28 text-center text-sm font-medium">{fyLabel(fy)}</p>
            <Button variant="secondary" size="icon" aria-label="Next year" onClick={() => void navigate({ search: { fy: String(fy + 1) } })}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void downloadWorkbook(`Centre-${fyLabel(fy).replace(/\s+/g, "")}.xlsx`, [
                  {
                    name: "Centre",
                    rows: [
                      ["Month", "Net collection", "Expense", "Salary", "Margin", "Expense %", "Last year", "Growth", "Growth %"],
                      ...rows.map((row) => {
                        const future = row.month > anchor && row.collection === 0 && row.expense === 0;
                        return [
                          formatMonthShort(row.month),
                          future ? "—" : row.collection,
                          future ? "—" : row.expense + row.salary,
                          future ? "—" : row.salary,
                          future ? "—" : row.margin,
                          future ? "—" : pct(costPct(row)),
                          row.lastYear ?? "—",
                          row.collection > 0 ? row.growth ?? 0 : "—",
                          row.collection > 0 ? pct(row.growthPct) : "—",
                        ];
                      }),
                    ],
                  },
                ])
              }
            >
              Excel
            </Button>
          </div>
        }
      />

      <section className="print-stats grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Net collection" value={inr(totals.collection)} />
        <Mini label="Expenses" value={inr(totals.expense + totals.salary)} />
        <Mini label="Margin" value={inr(totals.margin)} />
        <Mini label="Growth" value={growth == null ? "—" : `${signedInr(growth)} · ${pct(growthPct)}`} />
      </section>
      <div className="no-print mt-4 flex flex-wrap items-center gap-2">
        {(["day", "month", "year"] as const).map((item) => (
          <Button key={item} variant={view === item ? "primary" : "secondary"} onClick={() => setView(item)}>
            {item === "day" ? "Date" : item === "month" ? "Month" : "Year"}
          </Button>
        ))}
        {view === "day" ? (
          <input type="date" aria-label="Statement date" className="h-11 rounded-sm border border-line bg-bg px-3 text-base" value={day || today} onChange={(event) => setDay(event.target.value)} />
        ) : null}
      </div>
      {view === "day" ? <DayStatement date={day || today} /> : null}
      {view === "month" && selected ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">{formatMonthShort(selected.month)}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Mini label="Collection" value={inr(selected.collection)} />
            <Mini label="Expense" value={inr(selected.expense)} />
            <Mini label="Salary" value={inr(selected.salary)} />
            <Mini label="Growth vs last year" value={selected.growth == null ? "—" : `${signedInr(selected.growth)} · ${pct(selected.growthPct)}`} />
          </div>
        </section>
      ) : null}

      {view === "year" ? (
      <>
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
      </section>

      <section className="mt-4">
        <h2 className="font-display text-2xl">Each month</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[52rem] text-left text-base">
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
              {visible.map((row) => (
                <tr
                  key={row.month}
                  className={cn("cursor-pointer border-b border-line last:border-0", selected?.month === row.month && "bg-accent-soft")}
                  onClick={() => setPicked(row.month)}
                >
                  <th className="px-3 py-3 font-medium">{formatMonthShort(row.month)}</th>
                  <Cell>{inr(row.collection)}</Cell>
                  <Cell>{inr(row.expense + row.salary)}</Cell>
                  <Cell>{inr(row.salary)}</Cell>
                  <Cell tone={toneOf(row.margin)}>{inr(row.margin)}</Cell>
                  <Cell>{pct(costPct(row))}</Cell>
                  <Cell>{row.lastYear == null ? "—" : inr(row.lastYear)}</Cell>
                  <Cell tone={toneOf(row.growth)}>{row.collection > 0 ? signedInr(row.growth) : "—"}</Cell>
                  <Cell tone={toneOf(row.growthPct)}>{row.collection > 0 ? pct(row.growthPct) : "—"}</Cell>
                </tr>
              ))}
              <tr className="border-t border-line">
                <th className="px-3 py-3 font-medium">Year</th>
                <Cell>{inr(totals.collection)}</Cell>
                <Cell>{inr(totals.expense + totals.salary)}</Cell>
                <Cell>{inr(totals.salary)}</Cell>
                <Cell tone={toneOf(totals.margin)}>{inr(totals.margin)}</Cell>
                <Cell>{pct(totals.collection > 0 ? ((totals.expense + totals.salary) / totals.collection) * 100 : null)}</Cell>
                <Cell>{yearLastKnown ? inr(yearLast) : "—"}</Cell>
                <Cell tone={toneOf(growth)}>{growth == null ? "—" : signedInr(growth)}</Cell>
                <Cell tone={toneOf(growthPct)}>{pct(growthPct)}</Cell>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}

      {view !== "day" && selected ? <MonthDetail row={selected} onCommit={(amount) => book.setLastYear(selected.month, amount)} /> : null}
    </div>
  );
}

function DayStatement({ date }: { date: string }) {
  const book = useLedger();
  const amount = book.days.find((item) => item.date === date)?.amount ?? 0;
  const close = book.cashCloses.find((item) => item.date === date);
  const check = close ? checkClose(close, book.cashCloses, book.days, book.holidays, book.payouts ?? []) : null;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">{formatDay(date)}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Mini label="Counter collection" value={inr(amount)} />
        <Mini label="Closing" value={check?.difference == null ? "Not closed" : check.difference === 0 ? "Balanced" : check.difference < 0 ? `Short ${inr(Math.abs(check.difference))}` : `Excess ${inr(check.difference)}`} />
      </div>
    </section>
  );
}

function MonthDetail({ row, onCommit }: { row: CentreSnapshot; onCommit: (amount: number | null) => void }) {
  return (
    <section className="print-keep mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">{formatMonthShort(row.month)} in detail</h2>
      <div className="print-stats mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Net collection" value={inr(row.collection)} />
        <Mini label="Expense %" value={pct(costPct(row))} />
        <Mini label="Salary %" value={pct(row.salaryPct)} />
        <Mini label="Margin %" value={pct(row.marginPct)} />
      </div>
      <label className="mt-4 block max-w-xs text-sm">
        <span className="mb-1 block text-muted">Last year, full month</span>
        <MoneyField label="Last year collection" value={row.lastYear} disabled={row.lastYearSource === "book"} onChange={onCommit} />
      </label>
    </section>
  );
}

function costPct(row: CentreSnapshot): number | null {
  if (row.collection <= 0) return null;
  return ((row.expense + row.salary) / row.collection) * 100;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg p-4">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
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
