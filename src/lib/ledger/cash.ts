import { addDays, isSunday } from "@/lib/ledger/dates";
import { dayOn } from "@/lib/ledger/calc";
import type { CashClose, CollectionDay, NoteCounts } from "@/lib/ledger/types";

export const NOTE_ROWS = [
  { key: "n10", face: 10 },
  { key: "n20", face: 20 },
  { key: "n50", face: 50 },
  { key: "n100", face: 100 },
  { key: "n200", face: 200 },
  { key: "n500", face: 500 },
] as const;

export function emptyNotes(): NoteCounts {
  return { n10: 0, n20: 0, n50: 0, n100: 0, n200: 0, n500: 0 };
}

export function creditPaidTotal(row: CashClose): number {
  return (row.creditPaid ?? []).reduce((sum, item) => sum + (item.amount || 0), 0);
}

export function creditGivenTotal(row: CashClose): number {
  return (row.creditGiven ?? []).reduce((sum, item) => sum + (item.amount || 0), 0);
}

export function creditGivenInMonth(closes: CashClose[], month: string): { employeeId: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const row of closes) {
    if (!row.date.startsWith(month)) continue;
    for (const item of row.creditGiven ?? []) {
      if (!item.amount) continue;
      const key = item.employeeId || "";
      totals.set(key, (totals.get(key) ?? 0) + item.amount);
    }
  }
  return [...totals.entries()]
    .map(([employeeId, amount]) => ({ employeeId, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export type UnpaidCreditLine = {
  date: string;
  customer: string;
  staff: string;
  given: number;
  paid: number;
  balance: number;
};

export function unpaidCreditReport(
  closes: CashClose[],
  staffName: (employeeId: string) => string,
): { lines: UnpaidCreditLine[]; listed: number; book: number } {
  const ordered = [...closes].sort((a, b) => (a.date < b.date ? -1 : 1));
  const open: UnpaidCreditLine[] = [];
  for (const close of ordered) {
    for (const item of close.creditGiven ?? []) {
      if (!item.amount) continue;
      open.push({
        date: close.date,
        customer: (item.customer ?? "").trim(),
        staff: item.employeeId ? staffName(item.employeeId) : "",
        given: item.amount,
        paid: 0,
        balance: item.amount,
      });
    }
    for (const payment of close.creditPaid ?? []) {
      let left = payment.amount || 0;
      if (left <= 0) continue;
      const key = payment.name.trim().toLowerCase();
      const named = key ? open.filter((line) => line.customer.toLowerCase() === key && line.balance > 0) : [];
      const targets = named.length > 0 ? named : open.filter((line) => line.balance > 0);
      for (const line of targets) {
        if (left <= 0) break;
        const take = Math.min(line.balance, left);
        line.paid += take;
        line.balance -= take;
        left -= take;
      }
    }
  }
  const latest = ordered.at(-1);
  const book = latest?.credits ?? 0;
  let lines = open.filter((line) => line.balance > 0);
  const listed = lines.reduce((sum, line) => sum + line.balance, 0);
  if (book > listed) {
    lines = [
      ...lines,
      {
        date: latest?.date ?? "",
        customer: "",
        staff: "",
        given: book - listed,
        paid: 0,
        balance: book - listed,
      },
    ];
  }
  return { lines, listed, book };
}

export function cashInHand(notes: NoteCounts): number {
  return NOTE_ROWS.reduce((sum, row) => sum + row.face * (notes[row.key] || 0), 0);
}

export function countStarted(row: CashClose): boolean {
  return cashInHand(row.notes) > 0 || row.eDistrict > 0 || row.csc > 0 || row.bank > 0;
}

export function closingTotal(row: CashClose): number {
  return moneyInHand(row) + (row.credits || 0);
}

export function moneyInHand(row: CashClose): number {
  return cashInHand(row.notes) + row.eDistrict + row.csc + row.bank;
}

function closeBase(row: CashClose): number {
  // Credit is not cash. A customer who has not paid must not change the closing figure.
  return moneyInHand(row);
}

export function previousClose(rows: CashClose[], date: string): CashClose | null {
  let best: CashClose | null = null;
  for (const row of rows) {
    if (row.date < date && (!best || row.date > best.date)) best = row;
  }
  return best;
}

export function aewsCollection(days: CollectionDay[], date: string): number | null {
  const day = dayOn(days, date);
  if (!day || day.amount <= 0) return null;
  if (/centre sheet|month total/i.test(day.note)) return null;
  return day.amount;
}

export function spanDates(fromExclusive: string, toInclusive: string): string[] {
  const out: string[] = [];
  let cursor = addDays(fromExclusive, 1);
  while (cursor <= toInclusive) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function unfixedAmount(difference: number, fixed: number): number {
  if (!difference) return 0;
  const settled = Math.min(Math.max(fixed, 0), Math.abs(difference));
  return difference > 0 ? difference - settled : difference + settled;
}

export type AccountBook = {
  opening: number;
  collections: number;
  otherReceipts: number;
  transfersIn: number;
  expenses: number;
  department: number;
  transfersOut: number;
  expected: number;
  actual: number | null;
  difference: number | null;
};

export type CloseCheck = {
  last: number | null;
  lastDate: string;
  movement: number | null;
  collected: number | null;
  personalGpay: number;
  departmentGpay: number;
  bankDepartment: number;
  advanceHeld: number;
  advanceChange: number;
  advanceServed: number;
  advanceIn: number;
  profitTaken: number;
  paidOut: number;
  receipts: number;
  payments: number;
  serviceEarned: number;
  income: number;
  cashBook: AccountBook;
  centreBook: AccountBook;
  personalBook: AccountBook;
  walletBook: AccountBook;
  missing: string[];
  difference: number | null;
  unfixed: number | null;
};

function closeGap(row: CashClose, last: CashClose | null) {
  return {
    advanceHeld: row.advanceHeld ?? 0,
    advanceChange: (row.advanceHeld ?? 0) - (last?.advanceHeld ?? 0),
    advanceServed: row.advanceServed ?? 0,
    profitTaken: row.profitTaken ?? 0,
  };
}

function accountBook(input: Omit<AccountBook, "expected" | "difference">): AccountBook {
  const expected =
    input.opening + input.collections + input.otherReceipts + input.transfersIn - input.expenses - input.department - input.transfersOut;
  return { ...input, expected, difference: input.actual == null ? null : input.actual - expected };
}

function idleBook(): AccountBook {
  return accountBook({ opening: 0, collections: 0, otherReceipts: 0, transfersIn: 0, expenses: 0, department: 0, transfersOut: 0, actual: null });
}

export function checkClose(
  row: CashClose,
  closes: CashClose[],
  days: CollectionDay[],
  holidays: string[],
  payouts: { date: string; amount: number; category?: string }[] = [],
): CloseCheck {
  const last = previousClose(closes, row.date);
  const gap = closeGap(row, last);
  const idle = idleBook();
  const empty = { last: null as number | null, lastDate: "", movement: null as number | null, collected: null as number | null, personalGpay: 0, departmentGpay: 0, bankDepartment: 0, paidOut: 0, receipts: 0, payments: 0, serviceEarned: 0, income: 0, cashBook: idle, centreBook: idle, personalBook: idle, walletBook: idle, ...gap, advanceChange: 0, advanceServed: 0, advanceIn: 0, missing: [] as string[], difference: null as number | null, unfixed: null as number | null };
  if (!last) return empty;
  const span = spanDates(last.date, row.date);
  const counterDay = (date: string) => {
    const day = dayOn(days, date);
    return day && day.note.startsWith("Entered on the counter") ? day : undefined;
  };
  const paidOut = payouts.reduce((sum, item) => (span.includes(item.date) ? sum + (item.amount || 0) : sum), 0);
  const missing = span.filter((date) => !isSunday(date) && !holidays.includes(date) && !counterDay(date));
  const known = span.reduce((sum, date) => sum + (counterDay(date)?.amount ?? 0), 0);
  const personalGpay = span.reduce((sum, date) => sum + (counterDay(date)?.personalGpay ?? 0), 0);
  const departmentGpay = span.reduce((sum, date) => sum + (counterDay(date)?.departmentGpay ?? 0), 0);
  const bankDepartment = span.reduce((sum, date) => sum + (counterDay(date)?.bankDepartment ?? 0), 0);
  const base = { personalGpay, departmentGpay, bankDepartment, paidOut, ...gap };
  const opening = closeBase(last);
  const movement = closeBase(row) - opening;
  if (!countStarted(row) && !row.accepted) {
    return { ...empty, last: opening, lastDate: last.date, collected: missing.length > 0 ? null : known, ...base, missing };
  }
  if (missing.length > 0) {
    return { ...empty, last: opening, lastDate: last.date, movement, ...base, missing };
  }
  // Credit given, a repayment, an advance received, and a service from that advance
  // belong only to their own date. They are not added again on later days.
  const creditGiven = creditGivenTotal(row);
  const creditPaid = creditPaidTotal(row);
  const advanceIn = typeof row.advanceIn === "number" ? Math.max(0, row.advanceIn) : Math.max(0, gap.advanceChange + (row.advanceServed ?? 0));
  const advanceServed = row.advanceServed ?? 0;
  const transfer = row.profitTaken ?? 0;
  // A Personal GPay payment lands entirely in the personal account. None of it is expected
  // in the centre cash, wallets, or bank. The service-charge part is inside the counter
  // total, so it comes out with the department part that has already left the centre bank.
  const personalWhole = personalGpay + departmentGpay;
  const centreService = Math.max(0, known - personalGpay);
  const departmentOut = departmentGpay + bankDepartment;
  const expected = opening + known - personalWhole - bankDepartment + creditPaid + advanceIn - creditGiven - advanceServed - paidOut - transfer;
  const actual = closeBase(row);
  const difference = actual - expected;
  return {
    last: opening,
    lastDate: last.date,
    movement,
    collected: known,
    ...base,
    receipts: centreService,
    payments: paidOut + transfer + departmentOut,
    serviceEarned: known,
    income: known - paidOut,
    cashBook: idle,
    centreBook: idle,
    personalBook: idle,
    walletBook: idle,
    advanceIn,
    missing: [],
    difference,
    unfixed: unfixedAmount(difference, row.fixed),
  };
}

export type AccountLine = {
  date: string;
  difference: number;
  unfixed: number;
};

export function accountLines(
  closes: CashClose[],
  days: CollectionDay[],
  holidays: string[],
  payouts: { date: string; amount: number }[] = [],
): AccountLine[] {
  return [...closes]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .flatMap((row) => {
      const check = checkClose(row, closes, days, holidays, payouts);
      if (check.difference == null || check.unfixed == null || check.difference === 0) return [];
      return [{ date: row.date, difference: check.difference, unfixed: check.unfixed }];
    });
}
