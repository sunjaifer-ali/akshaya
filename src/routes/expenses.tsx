import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { inr } from "@/lib/format";
import { expenseTotal, monthCollection, payoutTotal, staffMonthRows } from "@/lib/ledger/calc";
import { payoutLabel } from "@/lib/ledger/types";
import { addMonths } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/expenses")({
  validateSearch: readMonth,
  component: ExpensesPage,
});

function ExpensesPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const today = useTodayKey();
  const book = useLedger();
  const [adding, setAdding] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const paidOut = payoutTotal(book.payouts, month);
  const total = expenseTotal(book.expenses, month) + paidOut;
  const otherPaid = payoutTotal(book.payouts, month, "other");
  const collection = monthCollection(book.days, month);
  const previous = addMonths(month, -1);
  const previousTotal = expenseTotal(book.expenses, previous);
  const row = book.expenses[month] ?? {};
  const payRows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    month,
    collection,
    book.deductLwp,
    today,
    book.salaryPaid ?? [],
  );
  const salary = payRows.reduce((sum, item) => sum + item.pay.basicPayable, 0);
  const incentive = payRows.reduce((sum, item) => sum + item.pay.incentive, 0);
  const totalSalary = salary + incentive;
  const outflow = total + totalSalary;

  return (
    <div>
      <PageHeader
        kicker="SPEND"
        title="Expenses"
        actions={
          <MonthBar
            month={month}
            onChange={(next) => {
              void navigate({ search: { m: next } });
            }}
          />
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={previousTotal <= 0}
          onClick={() => {
            book.copyExpenses(previous, month);
            setResult({ ok: true, message: "Successfully copied from last month." });
          }}
        >
          Copy last month
        </Button>
      </div>

      <div className="rounded-xl border border-line bg-surface px-4">
        {book.categories.map((category) => {
          const counter = payoutTotal(book.payouts, month, category.id);
          return (
          <div key={category.id} className="grid items-center gap-2 border-b border-line py-3 sm:grid-cols-[1fr_12rem_auto]">
            {category.builtin ? (
              <div>
                <p className="text-sm font-medium">{category.name}</p>
                {counter > 0 ? <p className="text-xs text-faint">Paid out {inr(counter)}</p> : null}
              </div>
            ) : (
              <input
                aria-label={`Rename ${category.name}`}
                className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={category.name}
                onChange={(event) => book.renameCategory(category.id, event.target.value)}
              />
            )}
            <MoneyField
              label={category.name}
              value={row[category.id] ?? null}
              onChange={(amount) => book.setExpense(month, category.id, amount)}
            />
            {category.builtin ? (
              <span className="hidden w-16 sm:block" />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => book.removeCategory(category.id)}>
                Remove
              </Button>
            )}
          </div>
          );
        })}
        {otherPaid > 0 ? (
          <div className="grid items-center gap-2 border-b border-line py-3 sm:grid-cols-[1fr_12rem]">
            <div>
              <p className="text-sm font-medium">{payoutLabel("other")}</p>
              <p className="text-xs text-faint">Paid out during the month.</p>
            </div>
            <p className="text-base font-medium tabular-nums sm:text-right">{inr(otherPaid)}</p>
          </div>
        ) : null}
        <form
          className="flex flex-wrap gap-2 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const ok = book.addCategory(adding);
            if (!ok) {
              setResult({ ok: false, message: "Not added. That column is already there, or the name is empty." });
              return;
            }
            setAdding("");
            setResult({ ok: true, message: "Expense successfully added." });
          }}
        >
          <input
            aria-label="New expense column"
            placeholder="Add another expense"
            className="h-11 min-w-48 flex-1 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
          />
          <Button type="submit" variant="secondary">
            Add column
          </Button>
        </form>
        <PayLine label="Salary" value={inr(salary)} />
        <PayLine label="Incentive" value={inr(incentive)} />
        <PayLine label="Total salary" value={inr(totalSalary)} strong />
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Mini label="Expenses" value={inr(total)} />
        <Mini label="Total salary" value={inr(totalSalary)} />
        <Mini label="Expenses + salary" value={inr(outflow)} />
        <Mini label="Left" value={collection > 0 ? inr(collection - outflow) : "—"} />
      </section>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function PayLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`grid items-center gap-2 border-t border-line py-3 sm:grid-cols-[1fr_12rem] ${strong ? "bg-surface-2 -mx-4 px-4" : ""}`}>
      <p className={`text-base ${strong ? "font-semibold" : "font-medium"}`}>{label}</p>
      <p className={`text-lg tabular-nums sm:text-right ${strong ? "font-semibold" : "font-medium"}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}
