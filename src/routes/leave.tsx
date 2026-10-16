import { createFileRoute } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { datesInMonth, formatDay, formatFull, formatMonth, formatMonthShort, isSunday, parseDate } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import { downloadWorkbook } from "@/lib/excel";
import { LEAVE_LABEL, type Employee, type LeaveCode, type LeaveMark } from "@/lib/ledger/types";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/leave")({
  validateSearch: readMonth,
  component: LeavePage,
});

const CHOICES: { code: LeaveCode | null; label: string }[] = [
  { code: null, label: "Present" },
  { code: "CL", label: "Casual leave" },
  { code: "SL", label: "Sick leave" },
  { code: "LWP", label: "Unpaid leave" },
  { code: "HD", label: "Half day" },
  { code: "WO", label: "Weekly off" },
];

function LeavePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const today = useTodayKey();
  const book = useLedger();
  const dates = datesInMonth(month);
  const people = book.employees.filter((employee) => {
    if (employee.active) return true;
    return book.leaves.some((mark) => mark.employeeId === employee.id && mark.date.startsWith(month));
  });

  return (
    <div>
      <div className="no-print">
      <PageHeader
        kicker="ATTENDANCE"
        title="Leave register"
        actions={
          <MonthBar
            month={month}
            onChange={(next) => {
              void navigate({ search: { m: next } });
            }}
          />
        }
      />

      {people.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">Add staff on the Salary page before marking leave.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="border-collapse text-sm">
            <caption className="sr-only">Day wise leave for {month}</caption>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-medium text-faint">Staff</th>
                {dates.map((date) => {
                  const sunday = isSunday(date);
                  const holiday = book.holidays.includes(date);
                  return (
                    <th key={date} className="p-1 font-medium">
                      <button
                        type="button"
                        disabled={sunday}
                        aria-label={sunday ? `${formatDay(date)} Sunday holiday` : `Toggle holiday on ${formatDay(date)}`}
                        className={cn(
                          "flex size-11 flex-col items-center justify-center gap-0.5 rounded-sm text-xs leading-none",
                          sunday || holiday ? "bg-warn-soft text-warn" : "hover:bg-surface-2",
                        )}
                        onClick={() => book.toggleHoliday(date)}
                      >
                        <span className="tabular-nums">{date.slice(8)}</span>
                        <span>{sunday || holiday ? "H" : ""}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {people.map((employee) => (
                <tr key={employee.id} className="border-t border-line">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium">{employee.name}</th>
                  {dates.map((date) => (
                    <td key={date} className="p-1">
                      <DayCell employeeId={employee.id} employeeName={employee.name} date={date} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      </div>

      {people.length > 0 ? (
        <AttendanceReport
          centre={book.centreName}
          month={month}
          today={today}
          people={people}
          leaves={book.leaves}
          holidays={book.holidays}
        />
      ) : null}
    </div>
  );
}

function AttendanceReport({
  centre,
  month,
  today,
  people,
  leaves,
  holidays,
}: {
  centre: string;
  month: string;
  today: string;
  people: Employee[];
  leaves: LeaveMark[];
  holidays: string[];
}) {
  const opening = today.startsWith(month) ? today : `${month}-01`;
  const [date, setDate] = useState(opening);
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (!picked) setDate(today.startsWith(month) ? today : `${month}-01`);
  }, [today, month, picked]);

  const reportMonth = date.slice(0, 7);
  const year = Number(date.slice(0, 4));
  const dates = datesInMonth(reportMonth);
  const months = calendarMonths(year);
  const years = yearChoices(year, today);
  const rows = people.map((employee) => ({
    employee,
    month: countAttendance(leaves, employee.id, reportMonth, holidays, today),
    year: months.map((item) => countAttendance(leaves, employee.id, item, holidays, today)),
  }));

  const chooseDate = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    setPicked(true);
    setDate(clampDate(next));
  };

  return (
    <article className="report-sheet mt-8 border-t border-line pt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-accent">ATTENDANCE REPORT</p>
          <h2 className="font-display text-3xl leading-tight">{centre}</h2>
          <p className="mt-1 text-sm text-muted">
            {formatFull(date)}. {formatMonth(reportMonth)} attendance, and leave for {year}.
          </p>
        </div>
        <div className="no-print flex gap-2">
          <Button variant="secondary" onClick={() => void saveAttendanceExcel(centre, date, reportMonth, year, dates, months, rows, leaves, holidays, today)}>
            Excel
          </Button>
          <Button onClick={() => window.print()}>Print report</Button>
        </div>
      </div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Date</span>
          <input
            type="date"
            aria-label="Report date"
            className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
            value={date}
            onChange={(event) => {
              if (event.target.value) chooseDate(event.target.value);
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Month</span>
          <select
            aria-label="Report month"
            className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
            value={reportMonth}
            onChange={(event) => chooseDate(shiftMonth(date, event.target.value))}
          >
            {months.map((item) => (
              <option key={item} value={item}>
                {formatMonth(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Year</span>
          <select
            aria-label="Report year"
            className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
            value={String(year)}
            onChange={(event) => chooseDate(shiftYear(date, Number(event.target.value)))}
          >
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="no-print mb-4 text-xs text-faint">In the print box, choose Landscape so the days stay upright on one page. Excel has the same figures.</p>

      <h3 className="font-medium">{formatFull(date)}</h3>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
        {people.map((employee) => {
          const label = dayLabel(leaves, employee.id, date, holidays, today);
          return (
            <li key={employee.id} className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-center gap-4 px-4 py-3 text-sm">
              <span className="font-medium">{employee.name}</span>
              <span className={cn("font-medium", markTone(label))}>{label}</span>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-6 font-medium">{formatMonth(reportMonth)}</h3>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span><b className="font-medium text-ink">P</b> Present</span>
        <span><b className="font-medium text-warn">H</b> Holiday</span>
        <span><b className="font-medium text-accent">HD</b> Half day</span>
        <span><b className="font-medium text-bad">LWP</b> Unpaid</span>
        <span><b className="font-medium text-ink">CL</b> Casual</span>
        <span><b className="font-medium text-warn">SL</b> Sick</span>
      </p>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="border-collapse text-sm">
          <caption className="sr-only">Monthly attendance for {formatMonth(month)}</caption>
          <thead>
            <tr className="border-b border-line text-faint">
              <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">Staff</th>
              {dates.map((item) => (
                <th key={item} className="px-1 py-2 text-center font-medium tabular-nums">
                  {Number(item.slice(8))}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Present</th>
              <th className="px-3 py-2 text-right font-medium">Casual</th>
              <th className="px-3 py-2 text-right font-medium">Sick</th>
              <th className="px-3 py-2 text-right font-medium">Unpaid</th>
              <th className="px-3 py-2 text-right font-medium">Half day</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employee.id} className="border-b border-line last:border-0">
                <th className="sticky left-0 bg-surface px-3 py-2 text-left font-medium">{row.employee.name}</th>
                {dates.map((item) => {
                  const mark = dayMark(leaves, row.employee.id, item, holidays, today);
                  return (
                    <td key={item} className={cn("px-1 py-2 text-center text-xs font-medium tabular-nums", markTone(mark))}>
                      {mark}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right text-base font-medium tabular-nums">{trimHalf(row.month.present)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.month.tally.CL}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.month.tally.SL}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.month.tally.LWP}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.month.tally.HD}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 font-medium">Leave dates this month</h3>
      <ul className="mt-2 grid gap-3">
        {rows.map((row) => (
          <li key={row.employee.id} className="rounded-xl border border-line bg-surface p-4">
            <p className="font-medium">{row.employee.name}</p>
            {row.month.dates.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No leave marked</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {row.month.dates.map((item) => (
                  <li key={item} className={cn("rounded-lg px-3 py-1 text-sm font-medium", chipTone(item))}>
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-6 font-medium">Yearly leave, {year}</h3>
      <div className="mt-2 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Yearly leave statement for {year}</caption>
          <thead>
            <tr className="border-b border-line text-faint">
              <th className="sticky left-0 bg-surface px-2 py-2 font-medium">Staff</th>
              {months.map((item) => (
                <th key={item} className="px-2 py-2 font-medium whitespace-nowrap">
                  {formatMonthShort(item)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Casual</th>
              <th className="px-2 py-2 text-right font-medium">Sick</th>
              <th className="px-2 py-2 text-right font-medium">Unpaid</th>
              <th className="px-2 py-2 text-right font-medium">Half day</th>
              <th className="px-2 py-2 text-right font-medium">Present</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.year.reduce(
                (sum, item) => ({
                  CL: sum.CL + item.tally.CL,
                  SL: sum.SL + item.tally.SL,
                  LWP: sum.LWP + item.tally.LWP,
                  HD: sum.HD + item.tally.HD,
                  present: sum.present + item.present,
                }),
                { CL: 0, SL: 0, LWP: 0, HD: 0, present: 0 },
              );
              return (
                <tr key={row.employee.id} className="border-b border-line last:border-0">
                  <th className="sticky left-0 bg-surface px-2 py-2 text-left font-medium">{row.employee.name}</th>
                  {row.year.map((item, index) => (
                    <td key={months[index]} className="px-2 py-2 whitespace-nowrap text-muted">
                      {leaveText(item.tally)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">{total.CL}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{total.SL}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{total.LWP}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{total.HD}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{trimHalf(total.present)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function markTone(mark: string): string {
  if (mark === "H" || mark === "Holiday" || mark.endsWith(" SL") || mark === "Sick leave") return "text-warn";
  if (mark === "HD" || mark.endsWith(" HD") || mark === "Half day") return "text-accent";
  if (mark === "LWP" || mark.endsWith(" LWP") || mark === "Unpaid leave") return "text-bad";
  if (mark === "CL" || mark.endsWith(" CL") || mark === "Casual leave") return "text-ink";
  if (mark === "P" || mark === "Present") return "text-ink";
  return "text-muted";
}

function chipTone(item: string): string {
  if (item.endsWith(" LWP")) return "bg-bad-soft text-bad";
  if (item.endsWith(" HD")) return "bg-accent-soft text-accent";
  if (item.endsWith(" SL")) return "bg-warn-soft text-warn";
  return "bg-surface-2 text-ink";
}

function dayLabel(leaves: LeaveMark[], employeeId: string, date: string, holidays: string[], today: string): string {
  const mark = dayMark(leaves, employeeId, date, holidays, today);
  if (mark === "H") return "Holiday";
  if (mark === "P") return "Present";
  if (!mark) return "—";
  return LEAVE_LABEL[mark as LeaveCode] ?? mark;
}

function calendarMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function yearChoices(selected: number, today: string): number[] {
  const current = Number((today || "2026-01-01").slice(0, 4));
  const start = Math.min(2024, selected);
  const end = Math.max(current + 1, selected);
  const years: number[] = [];
  for (let year = start; year <= end; year += 1) years.push(year);
  return years;
}

function shiftMonth(date: string, month: string): string {
  return clampDate(`${month}-${date.slice(8)}`);
}

function shiftYear(date: string, year: number): string {
  return clampDate(`${year}-${date.slice(5)}`);
}

function clampDate(date: string): string {
  const month = date.slice(0, 7);
  const last = datesInMonth(month).length;
  const day = Math.min(Math.max(Number(date.slice(8)) || 1, 1), last);
  return `${month}-${String(day).padStart(2, "0")}`;
}

function dayMark(leaves: LeaveMark[], employeeId: string, date: string, holidays: string[], today: string): string {
  if (isSunday(date) || holidays.includes(date)) return "H";
  const mark = leaves.find((item) => item.employeeId === employeeId && item.date === date);
  if (mark) return mark.code;
  if (today && date > today) return "";
  return "P";
}

function countAttendance(leaves: LeaveMark[], employeeId: string, month: string, holidays: string[], today: string) {
  const tally: Record<LeaveCode, number> = { CL: 0, SL: 0, LWP: 0, HD: 0, WO: 0 };
  const dates: string[] = [];
  let working = 0;
  let off = 0;
  for (const date of datesInMonth(month)) {
    const closed = isSunday(date) || holidays.includes(date);
    const mark = leaves.find((item) => item.employeeId === employeeId && item.date === date);
    if (mark && !closed) {
      tally[mark.code] += 1;
      dates.push(`${format(parseDate(date), "d MMM")} ${mark.code}`);
    }
    const elapsed = !today || date <= today;
    if (!elapsed || closed) continue;
    working += 1;
    if (!mark) continue;
    off += mark.code === "HD" ? 0.5 : 1;
  }
  return { tally, dates, present: Math.max(0, Math.round((working - off) * 2) / 2) };
}

function leaveText(tally: Record<LeaveCode, number>): string {
  const parts: string[] = [];
  if (tally.CL) parts.push(`${tally.CL} casual`);
  if (tally.SL) parts.push(`${tally.SL} sick`);
  if (tally.LWP) parts.push(`${tally.LWP} unpaid`);
  if (tally.HD) parts.push(`${tally.HD} half`);
  if (tally.WO) parts.push(`${tally.WO} off`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function trimHalf(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function saveAttendanceExcel(
  centre: string,
  date: string,
  reportMonth: string,
  year: number,
  dates: string[],
  months: string[],
  rows: {
    employee: Employee;
    month: ReturnType<typeof countAttendance>;
    year: ReturnType<typeof countAttendance>[];
  }[],
  leaves: LeaveMark[],
  holidays: string[],
  today: string,
) {
  return downloadWorkbook(`Attendance-${centre.replace(/\s+/g, "-")}-${date}.xlsx`, [
    {
      name: "Day",
      rows: [
        ["Staff", "Status"],
        ...rows.map((row) => [row.employee.name, dayLabel(leaves, row.employee.id, date, holidays, today)]),
      ],
    },
    {
      name: formatMonth(reportMonth).slice(0, 31),
      rows: [
        ["Staff", ...dates.map((item) => Number(item.slice(8))), "Present", "CL", "SL", "LWP", "HD", "Leave dates"],
        ...rows.map((row) => [
          row.employee.name,
          ...dates.map((item) => dayMark(leaves, row.employee.id, item, holidays, today)),
          row.month.present,
          row.month.tally.CL,
          row.month.tally.SL,
          row.month.tally.LWP,
          row.month.tally.HD,
          row.month.dates.join(", "),
        ]),
      ],
    },
    {
      name: `Year ${year}`,
      rows: [
        ["Staff", ...months.map((item) => formatMonthShort(item)), "CL", "SL", "LWP", "HD", "Present"],
        ...rows.map((row) => {
          const total = row.year.reduce(
            (sum, item) => ({
              CL: sum.CL + item.tally.CL,
              SL: sum.SL + item.tally.SL,
              LWP: sum.LWP + item.tally.LWP,
              HD: sum.HD + item.tally.HD,
              present: sum.present + item.present,
            }),
            { CL: 0, SL: 0, LWP: 0, HD: 0, present: 0 },
          );
          return [row.employee.name, ...row.year.map((item) => leaveText(item.tally)), total.CL, total.SL, total.LWP, total.HD, total.present];
        }),
      ],
    },
  ]).catch(() => undefined);
}

function DayCell({
  employeeId,
  employeeName,
  date,
}: {
  employeeId: string;
  employeeName: string;
  date: string;
}) {
  const holidays = useLedger((state) => state.holidays);
  const mark = useLedger((state) => state.leaves.find((item) => item.employeeId === employeeId && item.date === date));
  const setLeave = useLedger((state) => state.setLeave);
  const sunday = isSunday(date);
  const holiday = holidays.includes(date);

  if (sunday || holiday) {
    return (
      <span className="flex size-11 items-center justify-center text-xs text-faint">H</span>
    );
  }

  const code = mark?.code ?? null;
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn("size-11 rounded-sm text-xs font-medium", tone(code))}
        aria-label={`${employeeName}, ${formatDay(date)}, ${code ? LEAVE_LABEL[code] : "Present"}`}
      >
        {code ?? "·"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-40 w-44 rounded-lg border border-line bg-surface p-1 shadow-none" sideOffset={6}>
          {CHOICES.map((choice) => (
            <Popover.Close
              key={choice.label}
              className="flex min-h-11 w-full items-center rounded-sm px-3 text-left text-sm hover:bg-surface-2"
              onClick={() => setLeave(employeeId, date, choice.code)}
            >
              {choice.label}
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function tone(code: LeaveCode | null): string {
  if (code === "CL") return "bg-accent-soft text-accent";
  if (code === "SL") return "bg-warn-soft text-warn";
  if (code === "LWP") return "bg-bad-soft text-bad";
  if (code === "HD" || code === "WO") return "bg-surface-2 text-ink";
  return "text-faint hover:bg-surface-2";
}
