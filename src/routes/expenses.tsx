import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { inr } from "@/lib/format";
import { expenseLineTotal, expenseTotal, monthCollection, payoutTotal, staffMonthRows } from "@/lib/ledger/calc";
import { EXPENSE_KINDS, expenseKindLabel, isSelfExpense, type ExpenseLine } from "@/lib/ledger/types";
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
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(EXPENSE_KINDS[0].id);
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const lines = (book.expenseLines ?? []).filter((line) => line.month === month);
  const operating = expenseLineTotal(book.expenseLines, month, "cost");
  const self = expenseLineTotal(book.expenseLines, month, "self");
  const earlier = expenseTotal(book.expenses, month);
  const closingPaid = payoutTotal(book.payouts, month);
  const expenses = operating + earlier + closingPaid;
  const collection = monthCollection(book.days, month);
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
  const salary = payRows.reduce((sum, item) => sum + item.pay.basicPayable + item.pay.incentive, 0);
  const margin = collection - expenses - salary;

  const save = () => {
    const what = name.trim().slice(0, 80);
    const rupees = Math.round(Number(amount));
    if (!what) {
      setResult({ ok: false, message: "Write what the expense is." });
      return;
    }
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setResult({ ok: false, message: "Enter the amount." });
      return;
    }
    const line: ExpenseLine = {
      id: editing || crypto.randomUUID(),
      month,
      name: what,
      category,
      amount: rupees,
    };
    if (editing) book.updateExpenseLine(line);
    else book.addExpenseLine(line);
    setName("");
    setAmount("");
    setCategory(EXPENSE_KINDS[0].id);
    setEditing("");
    setResult({ ok: true, message: isSelfExpense(category) ? "Saved under margin. This is not a centre expense." : "Expense saved." });
  };

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

      <section className="grid gap-3 sm:grid-cols-3">
        <Tile label="Expenses" value={inr(expenses)} note="Centre costs only" />
        <Tile label="Self expenses" value={inr(self)} note="Counted as margin" />
        <Tile label="Margin" value={collection > 0 ? inr(margin) : "—"} note="Collection − expenses − salary" />
      </section>

      <form
        className="mt-4 rounded-xl border border-line bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 className="font-medium">{editing ? "Edit expense" : "Add an expense"}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_auto]">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">What</span>
            <input
              className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={name}
              placeholder="Write the expense"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Category</span>
            <select
              className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {EXPENSE_KINDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Amount</span>
            <input
              inputMode="numeric"
              className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base tabular-nums outline-none focus:border-accent"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, "").slice(0, 8))}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">{editing ? "Save" : "Add"}</Button>
            {editing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing("");
                  setName("");
                  setAmount("");
                  setCategory(EXPENSE_KINDS[0].id);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
        {isSelfExpense(category) ? <p className="mt-2 text-sm text-muted">Self expenses are your personal amount. They stay in the margin and are not a centre expense.</p> : null}
      </form>

      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-surface">
        {lines.length === 0 ? <p className="p-5 text-sm text-muted">No expense entered for this month.</p> : null}
        {lines.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-faint">
              <tr className="border-b border-line">
                <th className="px-4 py-3 font-medium">What</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{line.name}</td>
                  <td className="px-4 py-3 text-muted">{isSelfExpense(line.category) ? "Self expenses · margin" : expenseKindLabel(line.category)}</td>
                  <td className="px-4 py-3 text-right text-base font-medium tabular-nums">{inr(line.amount)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(line.id);
                          setName(line.name);
                          setCategory(line.category);
                          setAmount(String(line.amount));
                        }}
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => book.removeExpenseLine(line.id)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
        <Row label="Salary" value={inr(salary)} />
        {earlier > 0 ? <Row label="Earlier monthly figures" value={inr(earlier)} /> : null}
        {closingPaid > 0 ? <Row label="Paid at closing" value={inr(closingPaid)} /> : null}
        <Row label="Centre expenses" value={inr(expenses)} strong />
        <Row label="Self expenses, in margin" value={inr(self)} />
        <Row label="Margin" value={collection > 0 ? inr(margin) : "—"} strong />
      </section>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
