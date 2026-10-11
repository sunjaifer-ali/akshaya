import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { inr, pct, signedInr } from "@/lib/format";
import { centreSnapshot, recordedAttendance, staffMonthRows, type CentreSnapshot, type MonthAttendance, type StaffMonthRow } from "@/lib/ledger/calc";
import { addDays, formatDay, formatMonthShort, fyLabel, fyMonths, fyStartYear } from "@/lib/ledger/dates";
import { loginLog } from "@/lib/centre.functions";
import { useLedger } from "@/lib/ledger/store";
import { readReport, type ReportKind } from "@/lib/search";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/reports")({
  validateSearch: readReport,
  component: ReportsPage,
});

const MENU: { id: ReportKind; label: string }[] = [
  { id: "centre", label: "Centre" },
  { id: "staff", label: "Staff and pay" },
  { id: "expenses", label: "Expenses" },
  { id: "leave", label: "Leave" },
  { id: "logins", label: "Logins" },
];

function ReportsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useTodayKey();
  const book = useLedger();
  const anchor = today ? today.slice(0, 7) : "2026-10";
  const fy = Number(search.fy || fyStartYear(anchor));
  const kind: ReportKind = search.r ?? "centre";
  const logDate = search.d || today || "";
  const months = fyMonths(fy);
  const snaps = months.map((month) =>
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
  const shown = snaps.filter((row) => monthCounts(row, anchor, book.leaves));
  const people = shown.map((row) => ({
    month: row.month,
    rows: staffMonthRows(
      book.employees,
      book.days,
      book.perfOverrides,
      book.leaves,
      book.holidays,
      row.month,
      row.collection,
      book.deductLwp,
      today,
    ),
  }));

  const go = (nextFy: number, nextKind: ReportKind, nextDate = logDate) => {
    void navigate({ search: { fy: String(nextFy), r: nextKind, d: nextDate || undefined } });
  };

  return (
    <div className="report-sheet">
      <PageHeader
        kicker="REPORTS"
        title={titleOf(kind)}
        lede={ledeOf(kind, fyLabel(fy))}
        actions={
          kind === "logins" ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="icon" aria-label="Previous day" onClick={() => go(fy, kind, addDays(logDate, -1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <input
                type="date"
                aria-label="Login date"
                className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={logDate}
                onChange={(event) => {
                  if (event.target.value) go(fy, kind, event.target.value);
                }}
              />
              <Button variant="secondary" size="icon" aria-label="Next day" onClick={() => go(fy, kind, addDays(logDate, 1))}>
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="secondary" className="no-print" onClick={() => window.print()}>
                Print
              </Button>
            </div>
          ) : (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous year" onClick={() => go(fy - 1, kind)}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="min-w-28 text-center text-sm font-medium">{fyLabel(fy)}</p>
            <Button variant="secondary" size="icon" aria-label="Next year" onClick={() => go(fy + 1, kind)}>
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="secondary" className="no-print" onClick={() => window.print()}>
              Print
            </Button>
          </div>
          )
        }
      />

      <p className="no-print mb-3 text-xs text-faint">Prints on landscape A4 so every column stays on the page.</p>
      <div className="no-print mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Consolidated reports">
        {MENU.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={kind === item.id}
            className={cn(
              "min-h-11 rounded-sm px-4 text-sm",
              kind === item.id ? "bg-accent font-medium text-accent-ink" : "border border-line bg-surface text-ink hover:bg-surface-2",
            )}
            onClick={() => go(fy, item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {kind === "logins" ? (
        <LoginStatement date={logDate} />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">Nothing entered for {fyLabel(fy)}.</p>
      ) : kind === "centre" ? (
        <CentreStatement rows={shown} />
      ) : kind === "staff" ? (
        <StaffStatement shown={shown} people={people} />
      ) : kind === "expenses" ? (
        <ExpenseStatement shown={shown} />
      ) : (
        <LeaveStatement shown={shown} />
      )}
    </div>
  );
}

function monthCounts(row: CentreSnapshot, anchor: string, leaves: { date: string }[]): boolean {
  if (row.collection > 0 || row.expense > 0) return true;
  if (row.month === anchor) return true;
  return leaves.some((mark) => mark.date.startsWith(row.month));
}

function titleOf(kind: ReportKind): string {
  if (kind === "staff") return "Staff and pay";
  if (kind === "expenses") return "Expenses";
  if (kind === "leave") return "Leave";
  if (kind === "logins") return "Login log";
  return "Centre statement";
}

function ledeOf(kind: ReportKind, year: string): string {
  if (kind === "staff") return `${year}. Collection, pay, and salary as a percentage of what each person brought in.`;
  if (kind === "expenses") return `${year}. Rent, power, paper, and every other column, then salary and margin.`;
  if (kind === "leave") return `${year}. Present days over the days already entered. Unpaid days reduce basic pay.`;
  if (kind === "logins") return "Who signed in, on which device, and the city of that network when it is known. Pick a date.";
  return `${year}. Net collection, costs, margin, and growth against last year. Total cost is expenses plus salary.`;
}

function LoginStatement({ date }: { date: string }) {
  const [rows, setRows] = useState<{ name: string; role: string; at: string; device: string; place: string; ip: string; screen: string }[]>([]);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!date) return;
    void loginLog({ data: date })
      .then((next) => {
        setRows(next);
        setNotice("");
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "The login log did not open."));
  }, [date]);
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">{date ? formatDay(date) : "Pick a date"}</h2>
      {notice ? <p className="mt-2 text-sm text-muted">{notice}</p> : null}
      {rows.length === 0 && !notice ? <p className="mt-2 text-sm text-muted">No one signed in on this date.</p> : null}
      <ul className="mt-3 divide-y divide-line">
        {rows.map((row, index) => (
          <li key={`${row.at}-${index}`} className="flex items-start justify-between gap-3 py-3 text-sm">
            <span>
              <span className="font-medium">{row.name}</span>
              <span className="text-muted"> · {row.role}</span>
              {row.device || row.screen ? (
                <span className="mt-0.5 block text-xs text-muted">
                  {[row.device, row.screen ? `screen ${row.screen}` : ""].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {row.place || row.ip ? (
                <span className="mt-0.5 block text-xs text-faint">{[row.place, row.ip].filter(Boolean).join(" · ")}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {new Date(row.at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CentreStatement({ rows }: { rows: CentreSnapshot[] }) {
  const totals = rows.reduce(
    (sum, row) => ({
      collection: sum.collection + row.collection,
      expense: sum.expense + row.expense,
      salary: sum.salary + row.salary,
      margin: sum.margin + row.margin,
    }),
    { collection: 0, expense: 0, salary: 0, margin: 0 },
  );
  const cost = totals.expense + totals.salary;
  const paired = rows.filter((row) => row.lastYear != null && row.collection > 0);
  const pairedCollection = paired.reduce((sum, row) => sum + row.collection, 0);
  const pairedLast = paired.reduce((sum, row) => sum + (row.lastYearCompared ?? 0), 0);
  const growth = paired.length > 0 ? pairedCollection - pairedLast : null;
  const growthPct = pairedLast > 0 && growth != null ? (growth / pairedLast) * 100 : null;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[58rem] text-left text-sm">
        <caption className="sr-only">Consolidated centre statement</caption>
        <thead className="text-xs tracking-wide text-faint">
          <tr className="border-b border-line">
            {["Month", "Net collection", "Expenses", "Total salary", "Total cost", "Margin", "Cost %", "Last year", "Growth", "Growth %"].map((head) => (
              <th key={head} className="px-3 py-3 font-medium whitespace-nowrap">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const totalCost = row.expense + row.salary;
            const started = row.collection > 0;
            return (
              <tr key={row.month} className="border-b border-line">
                <th className="px-3 py-3 font-medium whitespace-nowrap">{formatMonthShort(row.month)}</th>
                <Cell>{inr(row.collection)}</Cell>
                <Cell>{inr(row.expense)}</Cell>
                <Cell>{inr(row.salary)}</Cell>
                <Cell>{inr(totalCost)}</Cell>
                <Cell tone={toneOf(row.margin)}>{inr(row.margin)}</Cell>
                <Cell>{started ? pct((totalCost / row.collection) * 100) : "—"}</Cell>
                <Cell>{row.lastYear == null ? "—" : inr(row.lastYear)}</Cell>
                <Cell tone={toneOf(row.growth)}>{started ? signedInr(row.growth) : "—"}</Cell>
                <Cell tone={toneOf(row.growthPct)}>{started ? pct(row.growthPct) : "—"}</Cell>
              </tr>
            );
          })}
          <tr className="bg-surface-2 font-medium">
            <th className="px-3 py-3">Total</th>
            <Cell>{inr(totals.collection)}</Cell>
            <Cell>{inr(totals.expense)}</Cell>
            <Cell>{inr(totals.salary)}</Cell>
            <Cell>{inr(cost)}</Cell>
            <Cell tone={toneOf(totals.margin)}>{inr(totals.margin)}</Cell>
            <Cell>{totals.collection > 0 ? pct((cost / totals.collection) * 100) : "—"}</Cell>
            <Cell>{pairedLast > 0 ? inr(pairedLast) : "—"}</Cell>
            <Cell tone={toneOf(growth)}>{signedInr(growth)}</Cell>
            <Cell tone={toneOf(growthPct)}>{pct(growthPct)}</Cell>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StaffStatement({
  shown,
  people,
}: {
  shown: CentreSnapshot[];
  people: { month: string; rows: StaffMonthRow[] }[];
}) {
  const staff = people[0]?.rows.map((row) => row.employee) ?? [];
  const centre = shown.reduce((sum, row) => sum + row.collection, 0);

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Staff collection and pay</caption>
          <thead className="text-xs tracking-wide text-faint">
            <tr className="border-b border-line">
              {["Staff", "Collection", "Share", "Salary", "Salary %", "Incentive", "Total salary", "Unpaid days"].map((head) => (
                <th key={head} className="px-3 py-3 font-medium whitespace-nowrap">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((employee) => {
              const mine = people.flatMap((month) => month.rows.filter((row) => row.employee.id === employee.id));
              const collection = mine.reduce((sum, row) => sum + row.collection, 0);
              const salary = mine.reduce((sum, row) => sum + row.pay.basicPayable, 0);
              const incentive = mine.reduce((sum, row) => sum + row.pay.incentive, 0);
              const lwp = mine.reduce((sum, row) => sum + row.pay.lwpDays, 0);
              return (
                <tr key={employee.id} className="border-b border-line last:border-0">
                  <th className="px-3 py-3 text-left font-medium">{employee.name}</th>
                  <Cell>{inr(collection)}</Cell>
                  <Cell>{pct(centre > 0 ? (collection / centre) * 100 : null)}</Cell>
                  <Cell>{inr(salary)}</Cell>
                  <Cell>{collection > 0 ? pct((salary / collection) * 100) : "—"}</Cell>
                  <Cell>{inr(incentive)}</Cell>
                  <Cell>{inr(salary + incentive)}</Cell>
                  <Cell>{String(lwp)}</Cell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Monthly collection by staff</caption>
          <thead className="text-xs tracking-wide text-faint">
            <tr className="border-b border-line">
              <th className="sticky left-0 bg-surface px-3 py-3 font-medium">Collection</th>
              {shown.map((row) => (
                <th key={row.month} className="px-3 py-3 font-medium whitespace-nowrap">
                  {formatMonthShort(row.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((employee) => (
              <tr key={employee.id} className="border-b border-line last:border-0">
                <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">{employee.name}</th>
                {people.map((month) => {
                  const hit = month.rows.find((row) => row.employee.id === employee.id);
                  return <Cell key={month.month}>{hit && hit.collection > 0 ? inr(hit.collection) : "—"}</Cell>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpenseStatement({ shown }: { shown: CentreSnapshot[] }) {
  const book = useLedger();
  const categories = book.categories.filter(
    (category) =>
      category.builtin || shown.some((row) => (book.expenses[row.month]?.[category.id] ?? 0) > 0),
  );
  const centre = shown.reduce((sum, row) => sum + row.collection, 0);
  const expense = shown.reduce((sum, row) => sum + row.expense, 0);
  const salary = shown.reduce((sum, row) => sum + row.salary, 0);

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Consolidated expenses</caption>
        <thead className="text-xs tracking-wide text-faint">
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-surface px-3 py-3 font-medium">Column</th>
            {shown.map((row) => (
              <th key={row.month} className="px-3 py-3 font-medium whitespace-nowrap">
                {formatMonthShort(row.month)}
              </th>
            ))}
            <th className="px-3 py-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => {
            const amounts = shown.map((row) => book.expenses[row.month]?.[category.id] ?? 0);
            const total = amounts.reduce((sum, amount) => sum + amount, 0);
            return (
              <tr key={category.id} className="border-b border-line">
                <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium whitespace-nowrap">{category.name}</th>
                {amounts.map((amount, index) => (
                  <Cell key={shown[index]?.month ?? index}>{amount > 0 ? inr(amount) : "—"}</Cell>
                ))}
                <Cell>{total > 0 ? inr(total) : "—"}</Cell>
              </tr>
            );
          })}
          <tr className="border-b border-line bg-surface-2 font-medium">
            <th className="sticky left-0 bg-surface-2 px-3 py-3 text-left">Expenses</th>
            {shown.map((row) => (
              <Cell key={row.month}>{inr(row.expense)}</Cell>
            ))}
            <Cell>{inr(expense)}</Cell>
          </tr>
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">Salary</th>
            {shown.map((row) => (
              <Cell key={row.month}>{inr(row.basicPay)}</Cell>
            ))}
            <Cell>{inr(shown.reduce((sum, row) => sum + row.basicPay, 0))}</Cell>
          </tr>
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">Incentive</th>
            {shown.map((row) => (
              <Cell key={row.month}>{inr(row.incentive)}</Cell>
            ))}
            <Cell>{inr(shown.reduce((sum, row) => sum + row.incentive, 0))}</Cell>
          </tr>
          <tr className="border-b border-line bg-surface-2 font-medium">
            <th className="sticky left-0 bg-surface-2 px-3 py-3 text-left">Total salary</th>
            {shown.map((row) => (
              <Cell key={row.month}>{inr(row.salary)}</Cell>
            ))}
            <Cell>{inr(salary)}</Cell>
          </tr>
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">Total cost</th>
            {shown.map((row) => (
              <Cell key={row.month}>{inr(row.expense + row.salary)}</Cell>
            ))}
            <Cell>{inr(expense + salary)}</Cell>
          </tr>
          <tr>
            <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">Margin</th>
            {shown.map((row) => (
              <Cell key={row.month} tone={toneOf(row.margin)}>
                {inr(row.margin)}
              </Cell>
            ))}
            <Cell tone={toneOf(centre - expense - salary)}>{inr(centre - expense - salary)}</Cell>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function LeaveStatement({ shown }: { shown: CentreSnapshot[] }) {
  const book = useLedger();
  const people = book.employees.filter((employee) => employee.active);
  const rows = people.map((employee) => {
    const months = shown.map((row) =>
      recordedAttendance(book.days, book.leaves, employee.id, row.month, book.holidays),
    );
    const year = months.reduce(
      (sum, item) => ({
        present: sum.present + item.present,
        working: sum.working + item.working,
        unpaid: sum.unpaid + item.tally.LWP,
      }),
      { present: 0, working: 0, unpaid: 0 },
    );
    return { employee, months, year };
  });

  return (
    <div>
      <p className="no-print mb-3 text-sm text-muted">
        <Link to="/leave" className="font-medium text-accent">
          Day register
        </Link>{" "}
        marks a holiday or prints one person’s attendance. 21/22 means present out of the working days already entered.
      </p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Present days and leave</caption>
          <thead className="text-xs tracking-wide text-faint">
            <tr className="border-b border-line">
              <th className="sticky left-0 bg-surface px-3 py-3 font-medium">Staff</th>
              {shown.map((row) => (
                <th key={row.month} className="px-3 py-3 font-medium whitespace-nowrap">
                  {formatMonthShort(row.month)}
                </th>
              ))}
              <th className="px-3 py-3 font-medium">Present</th>
              <th className="px-3 py-3 font-medium">Unpaid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee.id} className="border-b border-line last:border-0">
                <th className="sticky left-0 bg-surface px-3 py-3 text-left font-medium">{row.employee.name}</th>
                {row.months.map((item, index) => (
                  <AttendanceCell key={shown[index]?.month ?? index} item={item} />
                ))}
                <Cell>{row.year.working > 0 ? `${countLabel(row.year.present)}/${row.year.working}` : "—"}</Cell>
                <Cell>{String(row.year.unpaid)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttendanceCell({ item }: { item: MonthAttendance }) {
  const codes = leaveBits(item.tally);
  if (item.working === 0) {
    return <td className="px-3 py-3 whitespace-nowrap text-muted">{codes || "—"}</td>;
  }
  return (
    <td className="px-3 py-3 whitespace-nowrap text-muted">
      <span className="tabular-nums text-ink">
        {countLabel(item.present)}/{item.working}
      </span>
      {codes ? <span className="mt-0.5 block text-xs text-faint">{codes}</span> : null}
    </td>
  );
}

function leaveBits(tally: { CL: number; SL: number; LWP: number; HD: number }): string {
  const parts: string[] = [];
  if (tally.CL) parts.push(`${tally.CL} CL`);
  if (tally.SL) parts.push(`${tally.SL} SL`);
  if (tally.LWP) parts.push(`${tally.LWP} LWP`);
  if (tally.HD) parts.push(`${tally.HD} HD`);
  return parts.join(" · ");
}

function countLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Cell({ children, tone = "ink" }: { children: string; tone?: "ink" | "good" | "bad" }) {
  return (
    <td className={cn("px-3 py-3 tabular-nums whitespace-nowrap", tone === "good" && "text-accent", tone === "bad" && "text-bad")}>
      {children}
    </td>
  );
}

function toneOf(value: number | null): "ink" | "good" | "bad" {
  if (value == null || value === 0) return "ink";
  return value > 0 ? "good" : "bad";
}
