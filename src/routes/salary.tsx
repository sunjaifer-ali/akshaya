import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { MoneyField } from "@/components/money-field";
import { PageHeader } from "@/components/page-header";
import { StaffDialog } from "@/components/staff-dialog";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { Button } from "@/components/ui/button";
import { inr, pct } from "@/lib/format";
import { employeeSplitSum, leaveTally, monthCollection, staffMonthRows, type StaffMonthRow } from "@/lib/ledger/calc";
import { formatMonth } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import type { Employee } from "@/lib/ledger/types";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/salary")({
  validateSearch: readMonth,
  component: SalaryPage,
});

function SalaryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const today = useTodayKey();
  const book = useLedger();
  const centre = monthCollection(book.days, month);
  const rows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    month,
    centre,
    book.deductLwp,
    today,
  );
  const staffCollection = rows.reduce((sum, row) => sum + row.collection, 0);
  const salaryOnly = rows.reduce((sum, row) => sum + row.pay.basicPayable, 0);
  const incentive = rows.reduce((sum, row) => sum + row.pay.incentive, 0);
  const gross = salaryOnly + incentive;
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [slip, setSlip] = useState<string | "all" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const slipRows = slip === "all" ? rows : rows.filter((row) => row.employee.id === slip);

  return (
    <>
    <div className={slip ? "no-print" : ""}>
      <PageHeader
        kicker="PAY"
        title="Salary"
        lede="Salary is basic pay, minus unpaid leave at one day’s rate (basic ÷ 30). Incentive is a separate amount, not a percentage of collection. Salary % is the salary alone against what they collected."
        actions={
          <MonthBar
            month={month}
            onChange={(next) => {
              void navigate({ search: { m: next } });
            }}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Centre collection {inr(centre)}. Salary {inr(salaryOnly)}, incentive {inr(incentive)}, total salary {inr(gross)}
          {centre > 0 ? `. Salary is ${pct(centre > 0 ? (salaryOnly / centre) * 100 : null)} of the centre` : ""}.
          {rows[0] && rows[0].pay.elapsedDays < rows[0].pay.workingDays
            ? ` Basic is counted for ${rows[0].pay.elapsedDays} of ${rows[0].pay.workingDays} working days so far.`
            : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {rows.length > 0 ? (
            <Button variant="secondary" onClick={() => setSlip("all")}>
              Salary slips
            </Button>
          ) : null}
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            Add employee
          </Button>
        </div>
      </div>

      {centre > 0 && staffCollection > centre ? (
        <p className="mb-4 rounded-lg border border-line bg-warn-soft px-4 py-3 text-sm text-warn">
          Staff collections add up to {inr(staffCollection)}, which is above the centre total of {inr(centre)}. Check the split or the monthly figures.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-sm text-muted">No employees yet. Add each person with a basic salary. Incentive is entered separately, in rupees.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <PayCard
              key={row.employee.id}
              row={row}
              month={month}
              bookAmount={employeeSplitSum(book.days, row.employee.id, month)}
              onEdit={() => {
                setEditing(row.employee);
                setOpen(true);
              }}
              onSlip={() => setSlip(row.employee.id)}
              onRemoved={() => setResult({ ok: true, message: `${row.employee.name} successfully removed.` })}
            />
          ))}
        </div>
      )}

      {rows.length > 0 ? (
        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label="Salary" value={inr(salaryOnly)} />
          <Mini label="Incentive" value={inr(incentive)} />
          <Mini label="Total salary" value={inr(gross)} />
          <Mini
            label="Salary against their collection"
            value={staffCollection > 0 ? pct((salaryOnly / staffCollection) * 100) : "—"}
          />
        </section>
      ) : null}

      <StaffDialog
        open={open}
        employee={editing}
        onOpenChange={setOpen}
        onResult={setResult}
      />
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
    {slipRows.map((row) => (
      <SalarySlip
        key={row.employee.id}
        row={row}
        month={month}
        centreName={book.centreName}
        collection={employeeSplitSum(book.days, row.employee.id, month)}
        tally={leaveTally(book.leaves, row.employee.id, month)}
        onClose={() => setSlip(null)}
      />
    ))}
    </>
  );
}

function PayCard({
  row,
  month,
  bookAmount,
  onEdit,
  onSlip,
  onRemoved,
}: {
  row: StaffMonthRow;
  month: string;
  bookAmount: number;
  onEdit: () => void;
  onSlip: () => void;
  onRemoved: () => void;
}) {
  const setPerformance = useLedger((state) => state.setPerformance);
  const clearPerformance = useLedger((state) => state.clearPerformance);
  const saveEmployee = useLedger((state) => state.saveEmployee);
  const removeEmployee = useLedger((state) => state.removeEmployee);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const salaryPct = row.pay.salaryPct;
  const heavy = salaryPct != null && salaryPct >= 40;

  return (
    <article className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl leading-tight">{row.employee.name}</h2>
          <p className="text-sm text-muted">
            {row.employee.role}
            {row.employee.active ? "" : " · Inactive"}
            {row.pay.lwpDays > 0 ? ` · ${row.pay.lwpDays} unpaid day${row.pay.lwpDays === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onSlip}>
            Slip
          </Button>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="danger" onClick={() => { removeEmployee(row.employee.id); setConfirmDelete(false); onRemoved(); }}>
                Delete {row.employee.name}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-muted">Monthly collection</span>
          <MoneyField
            label={`${row.employee.name} collection`}
            value={row.collection}
            onChange={(amount) => setPerformance(row.employee.id, month, amount ?? 0)}
          />
          <span className="mt-1 block text-xs text-faint">
            {row.source === "book" ? "From the month figures." : "Typed for this month."}
            {row.source === "entered" ? (
              <button
                type="button"
                className="ml-2 font-medium text-accent"
                onClick={() => clearPerformance(row.employee.id, month)}
              >
                Use the month figures ({inr(bookAmount)})
              </button>
            ) : null}
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Incentive</span>
          <MoneyField
            label={`${row.employee.name} incentive`}
            value={row.employee.incentive}
            onChange={(incentive) => saveEmployee({ ...row.employee, incentive: incentive ?? 0 })}
          />
          <span className="mt-1 block text-xs text-faint">A rupee amount. Not a percentage of collection.</span>
        </label>
        <div className="text-sm">
          <p className="text-muted">Share of centre</p>
          <p className="mt-2 font-display text-2xl tabular-nums">{pct(row.sharePct)}</p>
        </div>
      </div>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Salary</dt>
          <dd className="tabular-nums font-medium">
            {inr(row.pay.basicPayable)}
            {row.pay.basicPayable !== row.pay.basic ? (
              <span className="ml-1 text-xs font-normal text-faint"> of {inr(row.pay.basic)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Incentive</dt>
          <dd className="tabular-nums font-medium">
            {inr(row.pay.incentive)}
            <span className="ml-1 text-xs font-normal text-faint">{pct(row.pay.incentivePct)} of collection</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">Total salary</dt>
          <dd className="tabular-nums font-medium">{inr(row.pay.gross)}</dd>
        </div>
        <div>
          <dt className="text-muted">Salary % of collection</dt>
          <dd className={`font-display text-2xl tabular-nums ${heavy ? "text-bad" : "text-ink"}`}>{pct(salaryPct)}</dd>
        </div>
      </dl>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${heavy ? "bg-bad" : "bg-accent"}`}
          style={{ width: `${Math.min(salaryPct ?? 0, 100)}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-muted">
        {row.collection > 0
          ? `${row.employee.name.split(" ")[0]}’s salary of ${inr(row.pay.basicPayable)} is ${pct(salaryPct)} of the ${inr(row.collection)} they collected. Incentive of ${inr(row.pay.incentive)} is separate, so total salary is ${inr(row.pay.gross)}.`
          : "Enter their collection to see what percentage of it their salary takes."}
      </p>
    </article>
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

function SalarySlip({
  row,
  month,
  centreName,
  collection,
  tally,
  onClose,
}: {
  row: StaffMonthRow;
  month: string;
  centreName: string;
  collection: number;
  tally: ReturnType<typeof leaveTally>;
  onClose: () => void;
}) {
  const pay = row.pay;
  const dayRate = Math.round(row.employee.basic / 30);
  const unpaidCut = pay.lwpDays > 0 ? Math.round(pay.lwpDays * dayRate) : 0;
  const basicCounted = pay.basicPayable + unpaidCut;
  const partial = pay.elapsedDays < pay.workingDays;
  const salaryPct = collection > 0 ? (pay.basicPayable / collection) * 100 : null;

  return (
    <article className="salary-slip mx-auto mt-4 max-w-xl rounded-xl border border-line bg-surface p-6 print:mt-0 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <div className="no-print mb-4 flex gap-2">
        <Button onClick={() => window.print()}>Print</Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      <img src="/akshaya-logo.png" alt="Akshaya" className="mx-auto h-auto w-24" />
      <p className="mt-3 text-center font-display text-2xl">{centreName}</p>
      <p className="text-center text-sm text-muted">Salary slip · {formatMonth(month)}</p>
      <div className="mt-5 flex items-end justify-between gap-3 border-b border-line pb-3">
        <div>
          <p className="font-display text-3xl leading-tight">{row.employee.name}</p>
          <p className="text-sm text-muted">{row.employee.role}</p>
        </div>
        <p className="text-sm text-muted">{partial ? "Up to today" : "Full month"}</p>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <SlipLine label="Working days" value={String(pay.workingDays)} />
        <SlipLine label="Days counted" value={String(pay.elapsedDays)} />
        <SlipLine label="Casual leave" value={String(tally.CL)} />
        <SlipLine label="Sick leave" value={String(tally.SL)} />
        <SlipLine label="Half day" value={String(tally.HD)} />
        <SlipLine label="Unpaid leave" value={String(pay.lwpDays)} />
      </dl>
      <div className="mt-5 border-t border-line pt-4">
        <SlipMoney label="Basic pay" value={inr(row.employee.basic)} />
        {partial ? <SlipMoney label={`Counted for ${pay.elapsedDays} of ${pay.workingDays} days`} value={inr(basicCounted)} /> : null}
        {pay.lwpDays > 0 ? (
          <SlipMoney label={`Unpaid leave, ${pay.lwpDays} × ${inr(dayRate)}`} value={`− ${inr(unpaidCut)}`} />
        ) : null}
        <SlipMoney label="Basic payable" value={inr(pay.basicPayable)} />
        <SlipMoney
          label={partial ? `Incentive for ${pay.elapsedDays} of ${pay.workingDays} days` : "Incentive"}
          value={inr(pay.incentive)}
        />
        <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
          <p className="font-medium">Net salary</p>
          <p className="font-display text-3xl tabular-nums">{inr(pay.gross)}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted">
        Collection from the counter: {inr(collection)}
        {salaryPct != null ? `. Basic payable is ${pct(salaryPct)} of that.` : "."} Incentive is the amount set for this person, not a share of the collection.
      </p>
      <div className="mt-10 grid grid-cols-2 gap-8 text-sm text-muted">
        <p className="border-t border-line pt-2">Employee</p>
        <p className="border-t border-line pt-2 text-right">Admin</p>
      </div>
    </article>
  );
}

function SlipLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}

function SlipMoney({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <p className="text-muted">{label}</p>
      <p className="tabular-nums font-medium">{value}</p>
    </div>
  );
}
