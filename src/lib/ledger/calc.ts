import { datesInMonth, isSunday, lastYearMonth } from "@/lib/ledger/dates";
import type {
  CentrePayout,
  CollectionDay,
  Employee,
  LeaveCode,
  LeaveMark,
  PerfOverride,
  SalaryPaid,
} from "@/lib/ledger/types";

export function monthDays(days: CollectionDay[], month: string): CollectionDay[] {
  return days.filter((day) => day.date.startsWith(month));
}

export function monthCollection(days: CollectionDay[], month: string): number {
  return collectionRows(days, month).reduce((sum, day) => sum + day.amount, 0);
}

/** Daily counter rows win. A month-total sheet is used only when that month has no daily rows. One row per date. */
function collectionRows(days: CollectionDay[], month: string): CollectionDay[] {
  const rows = monthDays(days, month);
  const daily = rows.filter((day) => !/centre sheet|month total/i.test(day.note));
  const chosen = daily.some((day) => day.amount > 0) ? daily : rows;
  const byDate = new Map<string, CollectionDay>();
  for (const day of chosen) {
    const prev = byDate.get(day.date);
    if (!prev || rankDay(day) >= rankDay(prev)) byDate.set(day.date, day);
  }
  return [...byDate.values()];
}

function rankDay(day: CollectionDay): number {
  if (/entered on the counter/i.test(day.note)) return 2;
  if (/imported from aewskerala/i.test(day.note)) return 1;
  return 0;
}

/** The one row that counts for a date. A month sheet is ignored once daily rows exist. */
export function dayOn(days: CollectionDay[], date: string): CollectionDay | null {
  return collectionRows(days, date.slice(0, 7)).find((day) => day.date === date) ?? null;
}

function isLump(rows: CollectionDay[]): boolean {
  return rows.length > 0 && rows.every((day) => /centre sheet|month total/i.test(day.note));
}

export function daysEntered(days: CollectionDay[], month: string): number {
  return collectionRows(days, month).filter((day) => day.amount > 0).length;
}

export function splitSum(splits: Record<string, number>): number {
  return Object.values(splits).reduce((sum, amount) => sum + amount, 0);
}

/** One row per date. A centre-sheet lump is used only when that month has no daily rows. */
function staffDays(days: CollectionDay[], month: string): CollectionDay[] {
  const byDate = new Map<string, CollectionDay>();
  for (const day of collectionRows(days, month)) byDate.set(day.date, day);
  return [...byDate.values()];
}

export function employeeSplitSum(
  days: CollectionDay[],
  employeeId: string,
  month: string,
): number {
  return staffDays(days, month).reduce((sum, day) => sum + (day.splits[employeeId] ?? 0), 0);
}

export function performanceOf(
  days: CollectionDay[],
  overrides: PerfOverride[],
  employeeId: string,
  month: string,
): { amount: number; source: "book" | "entered" } {
  const fromBook = employeeSplitSum(days, employeeId, month);
  const countedOnCounter = staffDays(days, month).some(
    (day) => !/centre sheet|month total/i.test(day.note) && (day.splits[employeeId] ?? 0) > 0,
  );
  if (countedOnCounter) return { amount: fromBook, source: "book" };
  const hit = overrides.find((item) => item.employeeId === employeeId && item.month === month);
  if (hit) return { amount: hit.amount, source: "entered" };
  return { amount: fromBook, source: "book" };
}

export function workingDaysInMonth(month: string, holidays: string[]): number {
  const closed = new Set(holidays);
  return datesInMonth(month).filter((date) => !isSunday(date) && !closed.has(date)).length;
}

export function leaveTally(
  leaves: LeaveMark[],
  employeeId: string,
  month: string,
): Record<LeaveCode, number> {
  const tally: Record<LeaveCode, number> = { CL: 0, SL: 0, LWP: 0, HD: 0, WO: 0 };
  for (const mark of leaves) {
    if (mark.employeeId === employeeId && mark.date.startsWith(month)) tally[mark.code] += 1;
  }
  return tally;
}

export function presentDays(
  leaves: LeaveMark[],
  employeeId: string,
  month: string,
  holidays: string[],
): number {
  const tally = leaveTally(leaves, employeeId, month);
  const working = workingDaysInMonth(month, holidays);
  const off = tally.CL + tally.SL + tally.LWP + tally.WO + tally.HD * 0.5;
  return Math.max(0, Math.round((working - off) * 2) / 2);
}

export type MonthAttendance = {
  present: number;
  working: number;
  tally: Record<LeaveCode, number>;
};

/** Present days only on dates that were actually imported. Unimported days stay blank. */
export function recordedAttendance(
  days: CollectionDay[],
  leaves: LeaveMark[],
  employeeId: string,
  month: string,
  holidays: string[],
): MonthAttendance {
  const closed = new Set(holidays);
  const recorded = new Set(
    collectionRows(days, month)
      .map((day) => day.date)
      .filter((date) => !isSunday(date) && !closed.has(date)),
  );
  const tally: Record<LeaveCode, number> = { CL: 0, SL: 0, LWP: 0, HD: 0, WO: 0 };
  for (const mark of leaves) {
    if (mark.employeeId === employeeId && recorded.has(mark.date)) tally[mark.code] += 1;
  }
  const off = tally.CL + tally.SL + tally.LWP + tally.WO + tally.HD * 0.5;
  const working = recorded.size;
  return {
    present: Math.max(0, Math.round((working - off) * 2) / 2),
    working,
    tally,
  };
}

export type PayBreakdown = {
  basic: number;
  basicPayable: number;
  incentive: number;
  gross: number;
  salaryPct: number | null;
  incentivePct: number | null;
  payPct: number | null;
  lwpDays: number;
  workingDays: number;
  elapsedDays: number;
};

export function payFor(
  employee: Employee,
  collection: number,
  lwpDays: number,
  fullWorkingDays: number,
  elapsedDays: number,
  deductLwp: boolean,
): PayBreakdown {
  const full = Math.max(fullWorkingDays, 0);
  const elapsed = Math.min(Math.max(elapsedDays, 0), full || elapsedDays);
  const unpaid = deductLwp ? Math.min(Math.max(lwpDays, 0), elapsed) : 0;
  const deduction = Math.round((unpaid * employee.basic) / 30);
  const earned = full === 0 || elapsed >= full ? employee.basic : Math.round((employee.basic * elapsed) / full);
  const basicPayable = Math.max(0, earned - deduction);
  const incentiveFull = Math.max(0, employee.incentive);
  const incentive = full === 0 || elapsed >= full ? incentiveFull : Math.round((incentiveFull * elapsed) / full);
  const gross = basicPayable + incentive;
  return {
    basic: employee.basic,
    basicPayable,
    incentive,
    gross,
    salaryPct: collection > 0 ? (basicPayable / collection) * 100 : null,
    incentivePct: collection > 0 ? (incentive / collection) * 100 : null,
    payPct: collection > 0 ? (gross / collection) * 100 : null,
    lwpDays: unpaid,
    workingDays: full,
    elapsedDays: elapsed,
  };
}

export function expenseTotal(
  expenses: Record<string, Record<string, number>>,
  month: string,
): number {
  const row = expenses[month];
  if (!row) return 0;
  return Object.values(row).reduce((sum, amount) => sum + amount, 0);
}

export function payoutTotal(payouts: CentrePayout[] | undefined, month: string, categoryId?: string): number {
  return (payouts ?? []).reduce((sum, item) => {
    if (!item.date.startsWith(month)) return sum;
    if (categoryId && item.category !== categoryId) return sum;
    return sum + (item.amount || 0);
  }, 0);
}

export function lastYearFigure(
  days: CollectionDay[],
  lyOverrides: Record<string, number>,
  month: string,
  asOf = "",
): { amount: number | null; source: "book" | "entered" | "none"; partial: boolean } {
  const priorMonth = lastYearMonth(month);
  const inProgress = Boolean(asOf) && asOf.slice(0, 7) === month;
  const rows = collectionRows(days, priorMonth);
  const lump = isLump(rows);
  // A running month is compared with the same dates last year. A single month-total stays whole and is scaled later.
  const bookDays = !inProgress || lump ? rows : rows.filter((day) => day.date.slice(8) <= asOf.slice(8));
  const book = bookDays.reduce((sum, day) => sum + day.amount, 0);
  if (book > 0) return { amount: book, source: "book", partial: inProgress };
  if (Object.prototype.hasOwnProperty.call(lyOverrides, month)) {
    return { amount: lyOverrides[month] ?? 0, source: "entered", partial: false };
  }
  return { amount: null, source: "none", partial: inProgress };
}

export function growthOf(current: number, last: number | null): {
  diff: number | null;
  pct: number | null;
} {
  if (last == null) return { diff: null, pct: null };
  const diff = current - last;
  return { diff, pct: last > 0 ? (diff / last) * 100 : null };
}

function comparableLastYear(
  days: CollectionDay[],
  lyOverrides: Record<string, number>,
  holidays: string[],
  month: string,
  asOf: string,
) {
  const prior = lastYearFigure(days, lyOverrides, month, asOf);
  const inProgress = Boolean(asOf) && asOf.slice(0, 7) === month;
  if (!inProgress || prior.amount == null) return prior;
  const priorDays = monthDays(days, lastYearMonth(month));
  const lump = prior.source === "entered" || (priorDays.length > 0 && priorDays.every((day) => /centre sheet|month total/i.test(day.note)));
  if (!lump) return prior;
  const full = workingDaysInMonth(month, holidays);
  const closed = new Set(holidays);
  const elapsed = datesInMonth(month).filter((date) => date <= asOf && !isSunday(date) && !closed.has(date)).length;
  if (full <= 0 || elapsed >= full) return prior;
  return { amount: Math.round((prior.amount * elapsed) / full), source: "entered" as const, partial: true };
}

export function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return (part / whole) * 100;
}

export type StaffMonthRow = {
  employee: Employee;
  collection: number;
  source: "book" | "entered";
  sharePct: number | null;
  pay: PayBreakdown;
};

export function staffMonthRows(
  employees: Employee[],
  days: CollectionDay[],
  overrides: PerfOverride[],
  leaves: LeaveMark[],
  holidays: string[],
  month: string,
  centreCollection: number,
  deductLwp: boolean,
  asOf = "",
  salaryPaid: SalaryPaid[] = [],
): StaffMonthRow[] {
  const full = workingDaysInMonth(month, holidays);
  const inProgress = Boolean(asOf) && asOf.slice(0, 7) === month;
  const closed = new Set(holidays);
  const elapsed = inProgress
    ? datesInMonth(month).filter((date) => date <= asOf && !isSunday(date) && !closed.has(date)).length
    : full;
  return employees
    .filter((employee) => {
      if (employee.active) return true;
      return performanceOf(days, overrides, employee.id, month).amount > 0;
    })
    .map((employee) => {
      const perf = performanceOf(days, overrides, employee.id, month);
      const lwp = leaves.filter(
        (mark) =>
          mark.employeeId === employee.id &&
          mark.code === "LWP" &&
          mark.date.startsWith(month) &&
          (!inProgress || mark.date <= asOf),
      ).length;
      const half = leaves.filter(
        (mark) =>
          mark.employeeId === employee.id &&
          mark.code === "HD" &&
          mark.date.startsWith(month) &&
          (!inProgress || mark.date <= asOf),
      ).length;
      const pay = applyPaidSalary(
        payFor(employee, perf.amount, lwp + half * 0.5, full, elapsed, deductLwp),
        salaryPaid.find((item) => item.confirmed && item.employeeId === employee.id && item.month === month),
        perf.amount,
      );
      return {
        employee,
        collection: perf.amount,
        source: perf.source,
        sharePct: ratio(perf.amount, centreCollection),
        pay,
      };
    });
}

export function salaryTotal(rows: StaffMonthRow[]): number {
  return rows.reduce((sum, row) => sum + row.pay.gross, 0);
}

function applyPaidSalary(pay: PayBreakdown, paid: SalaryPaid | undefined, collection: number): PayBreakdown {
  if (!paid) return pay;
  const basicPayable = Math.max(0, Math.round(paid.basic) || 0);
  const incentive = Math.max(0, Math.round(paid.incentive) || 0);
  const gross = basicPayable + incentive;
  return {
    ...pay,
    basicPayable,
    incentive,
    gross,
    salaryPct: collection > 0 ? (basicPayable / collection) * 100 : null,
    incentivePct: collection > 0 ? (incentive / collection) * 100 : null,
    payPct: collection > 0 ? (gross / collection) * 100 : null,
  };
}

export type Desk = "aadhaar" | "service" | "new";

export function deskOf(employee: Employee): Desk {
  const name = employee.name.trim().toLowerCase();
  const role = employee.role.toLowerCase();
  if (role.includes("aadhaar") || role.includes("aadhar")) return "aadhaar";
  if (role.includes("new") || role.includes("trainee") || role.includes("joinee")) return "new";
  if (role.includes("service") || role.includes("middle")) return "service";
  if (name.includes("ajitha") || name.includes("haseena") || name.includes("hasena")) return "aadhaar";
  if (name.includes("rubeena")) return "new";
  return "service";
}

export const DESK_LABEL: Record<Desk, string> = {
  aadhaar: "Aadhaar desk",
  service: "Service desk",
  new: "New joinee",
};

export type NoteTone = "good" | "warn" | "ink";
export type NoteKind = "share" | "pace" | "centre" | "days";
export type NoteHonour = "lead" | "even" | "room" | "own" | "soon";

export type MonthNote = {
  desk: Desk;
  honour: NoteHonour;
  lines: { label: string; value: string; tone: NoteTone; kind: NoteKind; fill?: number }[];
  sentence: string;
};

/** Shares and growth stay percentages. Working days are a count, like 7/7. No rupees. */
export function monthNote(
  employee: Employee,
  rows: StaffMonthRow[],
  previous: StaffMonthRow[],
  attendance: { present: number; working: number } | null,
  centreGrowthPct: number | null = null,
  pace?: { elapsed: number; monthDays: number; lastDays: number; inProgress: boolean },
): MonthNote {
  const desk = deskOf(employee);
  const mine = rows.find((row) => row.employee.id === employee.id);
  const peers = rows.filter((row) => deskOf(row.employee) === desk);
  const group = peers.reduce((sum, row) => sum + row.collection, 0);
  const share = peers.length > 1 && group > 0 && mine ? (mine.collection / group) * 100 : null;
  const earlier = previous.find((row) => row.employee.id === employee.id);
  const lines: MonthNote["lines"] = [];
  if (share != null) {
    lines.push({
      label: `Your share of the ${DESK_LABEL[desk].toLowerCase()}`,
      value: `${Math.round(share)}%`,
      tone: share >= 55 ? "good" : "ink",
      kind: "share",
      fill: Math.max(0, Math.min(100, share)),
    });
  }
  const growth = paceLine(mine?.collection ?? 0, earlier?.collection ?? 0, pace);
  if (growth) lines.push(growth);
  const centre = centreGrowthLine(centreGrowthPct);
  if (centre) lines.push(centre);
  if (attendance && attendance.working > 0) {
    const present = Number.isInteger(attendance.present) ? String(attendance.present) : attendance.present.toFixed(1);
    const full = attendance.present >= attendance.working;
    lines.push({
      label: "Working days you were in",
      value: `${present}/${attendance.working}`,
      tone: full ? "good" : "ink",
      kind: "days",
      fill: Math.max(0, Math.min(100, (attendance.present / attendance.working) * 100)),
    });
  }

  let honour: NoteHonour = "soon";
  let sentence: string;
  if (desk === "new" && peers.length < 2) {
    honour = "own";
    sentence = growth
      ? "You are compared only with your own last month, not with the Aadhaar desk or the service desk."
      : "This month is your base. From next month the note compares you with yourself, not with the senior desks.";
  } else if (share == null) {
    sentence = "Once this desk has counter charges, this note shows your share of that desk only.";
  } else if (share >= 55) {
    honour = "lead";
    sentence = `You are leading the ${DESK_LABEL[desk].toLowerCase()} this month.`;
  } else if (share >= 45) {
    honour = "even";
    sentence = `The ${DESK_LABEL[desk].toLowerCase()} is level this month.`;
  } else {
    honour = "room";
    sentence = `There is room to come up on the ${DESK_LABEL[desk].toLowerCase()}.`;
  }
  return { desk, honour, lines, sentence };
}

function paceLine(
  current: number,
  previous: number,
  pace?: { elapsed: number; monthDays: number; lastDays: number; inProgress: boolean },
): MonthNote["lines"][number] | null {
  if (previous <= 0) return null;
  const running = Boolean(pace?.inProgress && pace.elapsed > 0 && pace.monthDays > 0 && pace.elapsed < pace.monthDays && pace.lastDays > 0);
  const change = running
    ? ((current / pace!.elapsed) / (previous / pace!.lastDays) - 1) * 100
    : ((current - previous) / previous) * 100;
  const label = running ? "Your pace against last month" : "Against your own last month";
  const rounded = Math.round(change);
  if (rounded > 100) return { label, value: "More than double", tone: "good", kind: "pace" };
  if (rounded > 0) return { label, value: `Up ${rounded}%`, tone: "good", kind: "pace" };
  if (rounded < 0) return { label, value: `Down ${Math.abs(rounded)}%`, tone: "warn", kind: "pace" };
  return { label, value: "Level", tone: "ink", kind: "pace" };
}

function centreGrowthLine(pct: number | null): MonthNote["lines"][number] | null {
  if (pct == null) return null;
  const rounded = Math.round(pct);
  const label = "Centre growth this month";
  if (rounded > 0) return { label, value: `Up ${rounded}%`, tone: "good", kind: "centre" };
  if (rounded < 0) return { label, value: `Down ${Math.abs(rounded)}%`, tone: "warn", kind: "centre" };
  return { label, value: "Level", tone: "ink", kind: "centre" };
}

export type CentreSnapshot = {
  month: string;
  collection: number;
  entered: number;
  workingDays: number;
  expense: number;
  salary: number;
  basicPay: number;
  incentive: number;
  margin: number;
  expensePct: number | null;
  salaryPct: number | null;
  marginPct: number | null;
  lastYear: number | null;
  lastYearCompared: number | null;
  lastYearSource: "book" | "entered" | "none";
  lastYearPartial: boolean;
  growth: number | null;
  growthPct: number | null;
};

export function centreSnapshot(
  employees: Employee[],
  days: CollectionDay[],
  overrides: PerfOverride[],
  leaves: LeaveMark[],
  holidays: string[],
  expenses: Record<string, Record<string, number>>,
  lyOverrides: Record<string, number>,
  month: string,
  deductLwp: boolean,
  asOf = "",
  payouts: CentrePayout[] = [],
  salaryPaid: SalaryPaid[] = [],
): CentreSnapshot {
  const collection = monthCollection(days, month);
  const rows = staffMonthRows(
    employees,
    days,
    overrides,
    leaves,
    holidays,
    month,
    collection,
    deductLwp,
    asOf,
    salaryPaid,
  );
  const expense = expenseTotal(expenses, month) + payoutTotal(payouts, month);
  const basicPay = rows.reduce((sum, row) => sum + row.pay.basicPayable, 0);
  const incentivePay = rows.reduce((sum, row) => sum + row.pay.incentive, 0);
  const salary = basicPay + incentivePay;
  const margin = collection - expense - salary;
  const fullPrior = lastYearFigure(days, lyOverrides, month, asOf);
  const prior = comparableLastYear(days, lyOverrides, holidays, month, asOf);
  const growth = growthOf(collection, prior.amount);
  return {
    month,
    collection,
    entered: daysEntered(days, month),
    workingDays: workingDaysInMonth(month, holidays),
    expense,
    salary,
    basicPay,
    incentive: incentivePay,
    margin,
    expensePct: ratio(expense, collection),
    salaryPct: ratio(salary, collection),
    marginPct: ratio(margin, collection),
    lastYear: fullPrior.amount,
    lastYearCompared: prior.amount,
    lastYearSource: fullPrior.source,
    lastYearPartial: prior.partial,
    growth: growth.diff,
    growthPct: growth.pct,
  };
}
