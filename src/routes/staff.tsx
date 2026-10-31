import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { StaffDialog } from "@/components/staff-dialog";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { Button } from "@/components/ui/button";
import { chartColors } from "@/lib/chart-colors";
import { inr, pct } from "@/lib/format";
import { centreSnapshot, dayOn, DESK_LABEL, deskOf, monthCollection, recordedAttendance, staffMonthRows } from "@/lib/ledger/calc";
import { formatMonthShort, fyLabel, fyMonths, fyStartYear, isSunday } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { LEAVE_LABEL, type Employee } from "@/lib/ledger/types";
import { readStaff } from "@/lib/search";
import { useMounted } from "@/lib/use-mounted";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/staff")({
  validateSearch: readStaff,
  component: StaffPage,
});

function StaffPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const today = useTodayKey();
  const book = useLedger();
  const mounted = useMounted();
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
  ).sort((a, b) => b.collection - a.collection);
  const selectedId = rows.some((row) => row.employee.id === search.e) ? (search.e ?? "") : (rows[0]?.employee.id ?? "");
  const selected = rows.find((row) => row.employee.id === selectedId);
  const fy = fyStartYear(month);
  const yearRows = selected
    ? fyMonths(fy).map((item) => {
        const collection = monthCollection(book.days, item);
        const people = staffMonthRows(
          book.employees,
          book.days,
          book.perfOverrides,
          book.leaves,
          book.holidays,
          item,
          collection,
          book.deductLwp,
          today,
          book.salaryPaid ?? [],
        );
        const mine = people.find((person) => person.employee.id === selected.employee.id);
        return {
          label: formatMonthShort(item),
          month: item,
          collection: mine?.collection ?? 0,
          gross: mine?.pay.gross ?? 0,
          salaryPct: mine?.pay.salaryPct,
          share: mine?.sharePct,
        };
      })
    : [];
  const cutoff = today ? today.slice(0, 7) : month;
  const yearVisible = yearRows.filter((row) => row.month <= cutoff || row.collection > 0);
  const ytdCollection = yearVisible.reduce((sum, row) => sum + row.collection, 0);
  const ytdPay = yearVisible.reduce((sum, row) => sum + row.gross, 0);
  const centreYear = yearVisible.reduce((sum, row) => {
    const snap = centreSnapshot(
      book.employees,
      book.days,
      book.perfOverrides,
      book.leaves,
      book.holidays,
      book.expenses,
      book.lyOverrides,
      row.month,
      book.deductLwp,
      today,
      book.payouts ?? [],
      book.salaryPaid ?? [],
      book.expenseLines ?? [],
    );
    return sum + snap.collection;
  }, 0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [day, setDay] = useState(today || "");
  const left = book.employees.filter((employee) => !employee.active && !rows.some((row) => row.employee.id === employee.id));

  return (
    <div>
      <PageHeader
        kicker="STAFF"
        title="Performance"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              Add employee
            </Button>
            <MonthBar
              month={month}
              onChange={(next) => {
                void navigate({ search: { m: next, e: selectedId } });
              }}
            />
            <input type="date" aria-label="Staff date" className="h-11 rounded-sm border border-line bg-bg px-3 text-base" value={day || today} onChange={(event) => setDay(event.target.value)} />
          </div>
        }
      />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">No employees yet. Add a person to open a performance report.</p>
      ) : (
        <>
          <TodayLine mounted={mounted} today={today} />
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Employee performance for the month</caption>
              <thead className="text-xs text-faint">
                <tr className="border-b border-line">
                  {["Rank", "Staff", "Present", "Collection", "Share", "Salary", "Salary %", "Incentive"].map((head) => (
                    <th key={head} className="px-3 py-3 font-medium">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.employee.id}
                    className={cn(
                      "cursor-pointer border-b border-line last:border-0",
                      row.employee.id === selectedId && "bg-accent-soft",
                    )}
                    onClick={() => {
                      void navigate({ search: { m: month, e: row.employee.id } });
                    }}
                  >
                    <td className="px-3 py-3 tabular-nums">{index + 1}</td>
                    <td className="px-3 py-3">
                      <span className="font-medium">{row.employee.name}</span>
                      <span className="mt-0.5 block text-xs text-faint">
                        {DESK_LABEL[deskOf(row.employee)]}
                        {row.employee.active ? "" : " · Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{attendanceLabel(book.days, book.leaves, row.employee.id, month, book.holidays)}</td>
                    <td className="px-3 py-3 tabular-nums">{inr(row.collection)}</td>
                    <td className="px-3 py-3 tabular-nums">{pct(row.sharePct)}</td>
                    <td className="px-3 py-3 tabular-nums">{inr(row.pay.basicPayable)}</td>
                    <td className="px-3 py-3 tabular-nums">{pct(row.pay.salaryPct)}</td>
                    <td className="px-3 py-3 tabular-nums">{inr(row.pay.incentive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected ? (
            <section className="mt-4 rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold tracking-widest text-accent">{fyLabel(fy)}</p>
                  <h2 className="font-display text-2xl">{selected.employee.name}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(selected.employee);
                      setOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  {selected.employee.active ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        book.setEmployeeActive(selected.employee.id, false);
                        setResult({
                          ok: true,
                          message: `${selected.employee.name} is deactivated. Past collection and pay stay in the book.`,
                        });
                      }}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        book.setEmployeeActive(selected.employee.id, true);
                        setResult({ ok: true, message: `${selected.employee.name} is active again.` });
                      }}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <Mini label="That day" value={inr(dayOn(book.days, day || today)?.splits[selected.employee.id] ?? 0)} />
                <Mini label="Year collection" value={inr(ytdCollection)} />
                <Mini label="Year salary" value={inr(ytdPay)} />
                <Mini label="Pay % of their work" value={ytdCollection > 0 ? pct((ytdPay / ytdCollection) * 100) : "—"} />
                <Mini label="Share of centre" value={centreYear > 0 ? pct((ytdCollection / centreYear) * 100) : "—"} />
              </div>
              <div className="print-chart mt-4 h-56">
                {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yearVisible}>
                      <XAxis dataKey="label" tick={{ fill: chartColors.faint, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip
                        formatter={(value) => [inr(Number(value)), "Collection"]}
                        contentStyle={{ border: `1px solid ${chartColors.line}`, borderRadius: 8, background: chartColors.surface }}
                      />
                      <Bar dataKey="collection" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </section>
          ) : null}
        </>
      )}
      {left.length > 0 ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-medium">Inactive</h2>
          <ul className="mt-3 divide-y divide-line">
            {left.map((employee) => (
              <li key={employee.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {employee.name}
                  <span className="mt-0.5 block text-xs text-faint">{DESK_LABEL[deskOf(employee)]}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => book.setEmployeeActive(employee.id, true)}>
                  Activate
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <StaffDialog open={open} employee={editing} onOpenChange={setOpen} onResult={setResult} />
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="font-display text-3xl tabular-nums">{value}</p>
    </div>
  );
}

function TodayLine({ mounted, today }: { mounted: boolean; today: string }) {
  const holidays = useLedger((state) => state.holidays);
  const leaves = useLedger((state) => state.leaves);
  const employees = useLedger((state) => state.employees);
  let text = "—";
  if (mounted && today) {
    if (isSunday(today) || holidays.includes(today)) text = "Holiday today.";
    else {
      const marks = leaves.filter((mark) => mark.date === today);
      text =
        marks.length === 0
          ? "No leave marked today."
          : `Off today: ${marks
              .map((mark) => `${employees.find((employee) => employee.id === mark.employeeId)?.name ?? "Staff"} ${LEAVE_LABEL[mark.code]}`)
              .join(" · ")}`;
    }
  }
  return <p className="mb-3 text-sm text-muted">{text}</p>;
}

function attendanceLabel(
  days: Parameters<typeof recordedAttendance>[0],
  leaves: Parameters<typeof recordedAttendance>[1],
  employeeId: string,
  month: string,
  holidays: string[],
): string {
  const item = recordedAttendance(days, leaves, employeeId, month, holidays);
  if (item.working === 0) return "—";
  const present = Number.isInteger(item.present) ? String(item.present) : item.present.toFixed(1);
  return `${present}/${item.working}`;
}
