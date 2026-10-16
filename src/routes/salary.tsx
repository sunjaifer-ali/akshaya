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
import { datesInMonth, formatDay, formatMonth, isSunday } from "@/lib/ledger/dates";
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
    book.salaryPaid ?? [],
  );
  const staffCollection = rows.reduce((sum, row) => sum + row.collection, 0);
  const salaryOnly = rows.reduce((sum, row) => sum + row.pay.basicPayable, 0);
  const incentive = rows.reduce((sum, row) => sum + row.pay.incentive, 0);
  const gross = salaryOnly + incentive;
  const [picked, setPicked] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [slip, setSlip] = useState<string | null>(null);
  const [payTab, setPayTab] = useState<"given" | "actual">("given");
  const [result, setResult] = useState<Result | null>(null);
  const slipRows = rows.filter((row) => row.employee.id === slip);
  const shown = rows.find((row) => row.employee.id === picked) ?? rows[0];

  return (
    <>
    <div className={slip ? "no-print" : ""}>
      <PageHeader
        kicker="PAY"
        title="Salary"
        actions={
          <MonthBar
            month={month}
            onChange={(next) => {
              void navigate({ search: { m: next } });
            }}
          />
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Mini label="Centre collection" value={inr(centre)} />
        <Mini label="Salary" value={inr(salaryOnly)} />
        <Mini label="Incentive" value={inr(incentive)} />
        <Mini label="Total salary" value={inr(gross)} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
          {shown ? (
            <Button variant="secondary" onClick={() => setSlip(shown.employee.id)}>
              Salary slip
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
          <label className="block max-w-xs text-sm">
            <span className="mb-1 block text-muted">Employee</span>
            <select
              aria-label="Employee"
              className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
              value={shown?.employee.id ?? ""}
              onChange={(event) => setPicked(event.target.value)}
            >
              {rows.map((row) => (
                <option key={row.employee.id} value={row.employee.id}>
                  {row.employee.name}
                  {row.employee.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </label>
          {shown ? (
            <PayCard
              key={shown.employee.id}
              row={shown}
              month={month}
              bookAmount={employeeSplitSum(book.days, shown.employee.id, month)}
              onEdit={() => {
                setEditing(shown.employee);
                setOpen(true);
              }}
              onSlip={() => setSlip(shown.employee.id)}
              onRemoved={() =>
                setResult({
                  ok: true,
                  message: shown.employee.active
                    ? `${shown.employee.name} is deactivated. Past collection and pay stay in the book.`
                    : `${shown.employee.name} is active again.`,
                })
              }
            />
          ) : null}
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

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={payTab === "given" ? "primary" : "secondary"} onClick={() => setPayTab("given")}>
          Salary given
        </Button>
        <Button variant={payTab === "actual" ? "primary" : "secondary"} onClick={() => setPayTab("actual")}>
          Actual salary
        </Button>
      </div>
      {payTab === "actual" ? <ActualSalary month={month} rows={rows} /> : <SalaryGiven month={month} today={today} />}

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
  const setEmployeeActive = useLedger((state) => state.setEmployeeActive);
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
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEmployeeActive(row.employee.id, !row.employee.active);
              onRemoved();
            }}
          >
            {row.employee.active ? "Deactivate" : "Activate"}
          </Button>
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
    </article>
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

function SalaryGiven({ month, today }: { month: string; today: string }) {
  const book = useLedger();
  const people = book.employees.filter((employee) => employee.active || employeeSplitSum(book.days, employee.id, month) > 0);
  const collection = monthCollection(book.days, month);
  return (
    <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
      <h2 className="px-4 pt-4 font-medium">Salary given</h2>
      <p className="px-4 pb-2 text-sm text-muted">{formatMonth(month)}. A confirmed figure is the final salary. Use the month arrows to change the month.</p>
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold tracking-widest text-faint">
            <th className="px-3 py-2 font-medium">Staff</th>
            <th className="px-3 py-2 text-right font-medium">Basic</th>
            <th className="px-3 py-2 text-right font-medium">Incentive</th>
            <th className="px-3 py-2 text-right font-medium">Given</th>
            <th className="px-3 py-2 font-medium">Figure</th>
          </tr>
        </thead>
        <tbody>
          {people.map((employee) => {
            const row = staffMonthRows(book.employees, book.days, book.perfOverrides, book.leaves, book.holidays, month, collection, book.deductLwp, today, book.salaryPaid ?? []).find((person) => person.employee.id === employee.id);
            if (!row || (row.pay.gross <= 0 && row.collection <= 0)) return null;
            const final = (book.salaryPaid ?? []).some((item) => item.confirmed && item.employeeId === employee.id && item.month === month);
            return (
              <tr key={employee.id} className="border-t border-line">
                <td className="px-3 py-2">{employee.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(row.pay.basicPayable)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{inr(row.pay.incentive)}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{inr(row.pay.gross)}</td>
                <td className="px-3 py-2">{final ? "Final" : "Calculated"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ActualSalary({ month, rows }: { month: string; rows: StaffMonthRow[] }) {
  const book = useLedger();
  const setSalaryPaid = useLedger((state) => state.setSalaryPaid);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { basic: string; incentive: string }>>({});
  const [result, setResult] = useState<Result | null>(null);
  const closed = new Set(book.holidays);
  const payday = datesInMonth(month).filter((date) => !isSunday(date) && !closed.has(date)).at(-1) ?? `${month}-28`;

  const savedOf = (id: string) => (book.salaryPaid ?? []).find((item) => item.employeeId === id && item.month === month);

  const write = (id: string, confirmed: boolean) => {
    const row = rows.find((item) => item.employee.id === id);
    if (!row) return;
    const current = savedOf(id);
    const basicText = editing === id ? (draft[id]?.basic ?? String(current?.basic ?? row.pay.basicPayable)) : String(current?.basic ?? row.pay.basicPayable);
    const incentiveText = editing === id ? (draft[id]?.incentive ?? String(current?.incentive ?? row.pay.incentive)) : String(current?.incentive ?? row.pay.incentive);
    const basic = Math.max(0, Math.round(Number(basicText) || 0));
    const incentive = Math.max(0, Math.round(Number(incentiveText) || 0));
    setSalaryPaid({ employeeId: id, month, basic, incentive, confirmed });
    setEditing(null);
    setResult({
      ok: true,
      message: confirmed
        ? `${row.employee.name}'s salary for ${formatMonth(month)} is confirmed. Centre totals use ${inr(basic + incentive)}.`
        : `${row.employee.name}'s salary is saved. Confirm it to use it in the centre totals.`,
    });
  };

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-medium">Actual salary given</h2>
      <p className="mt-1 text-sm text-muted">
        {formatMonth(month)}. Salary is transferred on the last working day, {formatDay(payday)}. Save keeps the amount. Confirm makes it the final salary for the centre totals.
      </p>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((row) => {
          const saved = savedOf(row.employee.id);
          const open = editing === row.employee.id;
          const basic = saved?.basic ?? row.pay.basicPayable;
          const incentive = saved?.incentive ?? row.pay.incentive;
          return (
            <li key={row.employee.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-medium">{row.employee.name}</p>
                <p className="text-sm text-muted">{saved?.confirmed ? "Final" : saved ? "Saved" : "Not entered"}</p>
              </div>
              {open ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">Basic</span>
                    <input
                      inputMode="numeric"
                      aria-label={`${row.employee.name} basic`}
                      className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base tabular-nums outline-none focus:border-accent"
                      value={draft[row.employee.id]?.basic ?? String(basic)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.employee.id]: {
                            basic: event.target.value.replace(/[^\d]/g, ""),
                            incentive: current[row.employee.id]?.incentive ?? String(incentive),
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted">Incentive</span>
                    <input
                      inputMode="numeric"
                      aria-label={`${row.employee.name} incentive`}
                      className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base tabular-nums outline-none focus:border-accent"
                      value={draft[row.employee.id]?.incentive ?? String(incentive)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [row.employee.id]: {
                            basic: current[row.employee.id]?.basic ?? String(basic),
                            incentive: event.target.value.replace(/[^\d]/g, ""),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              ) : (
                <p className="mt-2 text-lg tabular-nums">
                  Basic {inr(basic)} · Incentive {inr(incentive)} · Given {inr(basic + incentive)}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {open ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(null);
                    }}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDraft((current) => ({ ...current, [row.employee.id]: { basic: String(basic), incentive: String(incentive) } }));
                      setEditing(row.employee.id);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button variant="secondary" onClick={() => write(row.employee.id, false)}>
                  Save
                </Button>
                <Button onClick={() => write(row.employee.id, true)}>Confirm</Button>
              </div>
            </li>
          );
        })}
      </ul>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </section>
  );
}
