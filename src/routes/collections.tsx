import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { MonthBar } from "@/components/month-bar";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { monthCollection, monthDays, staffMonthRows } from "@/lib/ledger/calc";
import { formatDay, formatMonth } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/collections")({
  validateSearch: readMonth,
  component: CollectionsPage,
});

function CollectionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const today = useTodayKey();
  const book = useLedger();
  const total = monthCollection(book.days, month);
  const rows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    month,
    total,
    book.deductLwp,
    today,
  );
  const attributed = rows.reduce((sum, row) => sum + row.collection, 0);
  const gap = total - attributed;
  const savedDays = monthDays(book.days, month).filter((day) => day.amount > 0);
  const sheetOnly = savedDays.length === 1 && /centre sheet|month total from/i.test(savedDays[0]?.note ?? "");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        kicker="COLLECTIONS"
        title="Collections"
        lede="The counter is the collection. Each charge is added to that person and to the centre total."
        actions={
          <MonthBar
            month={month}
            onChange={(next) => {
              void navigate({ search: { m: next } });
            }}
          />
        }
      />

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">{formatMonth(month)}</h2>
        <p className="mt-1 text-sm text-muted">
          {sheetOnly
            ? "This month is still one total entered by hand."
            : savedDays.length > 0
              ? "Month net is the sum of the counter days."
              : "No charges saved for this month yet."}
        </p>
        {sheetOnly ? (
          <div className="mt-3 max-w-xs">
            <MoneyField
              label={`Net collection for ${formatMonth(month)}`}
              value={total > 0 ? total : null}
              onChange={(amount) => book.setMonthCollection(month, amount)}
            />
          </div>
        ) : null}
        {savedDays.length > 0 && !sheetOnly ? (
          <ul className="mt-3 divide-y divide-line">
            {savedDays.map((day) => (
              <li key={day.date} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>{formatDay(day.date)}</span>
                <span className="flex flex-wrap items-center gap-3">
                  <span className="tabular-nums">{inr(day.amount)}</span>
                  {day.note.startsWith("Entered on the counter") ? (
                    <span className="text-xs text-faint">Counter</span>
                  ) : pendingDelete === day.date ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          book.removeDay(day.date);
                          setPendingDelete(null);
                        }}
                      >
                        Delete {formatDay(day.date)}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPendingDelete(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setPendingDelete(day.date)}>
                      Delete
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <Mini label="Net collection" value={inr(total)} />
        <Mini label="Staff collection" value={inr(attributed)} />
        <Mini label="Not split" value={gap === 0 ? "—" : inr(gap)} />
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">By person</h2>
            <p className="text-sm text-muted">Sum of each person’s daily totals. Salary uses this figure.</p>
            {gap !== 0 ? (
              <p className="mt-1 text-sm text-warn">
                {inr(Math.abs(gap))} is in the centre total but not on a person. The sign-in name and the salary name must be the same.
              </p>
            ) : null}
          </div>
          <Link to="/salary" search={{ m: month }} className="text-sm font-medium text-accent">
            Open salary
          </Link>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {rows.length === 0 ? <li className="py-3 text-sm text-muted">Add staff from Salary.</li> : null}
          {rows.map((row) => (
            <li key={row.employee.id} className="flex items-center justify-between gap-3 py-3">
              <p className="text-sm font-medium">{row.employee.name}</p>
              <p className="text-sm tabular-nums">{inr(row.collection)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
    </div>
  );
}
