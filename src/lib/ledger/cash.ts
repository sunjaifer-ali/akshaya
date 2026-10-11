import { addDays, isSunday } from "@/lib/ledger/dates";
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
  return cashInHand(row.notes) + row.eDistrict + row.csc + row.credits + row.bank;
}

export function previousClose(rows: CashClose[], date: string): CashClose | null {
  let best: CashClose | null = null;
  for (const row of rows) {
    if (row.date < date && (!best || row.date > best.date)) best = row;
  }
  return best;
}

export function aewsCollection(days: CollectionDay[], date: string): number | null {
  const day = days.find((item) => item.date === date);
  if (!day) return null;
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

export type CloseCheck = {
  last: number | null;
  lastDate: string;
  movement: number | null;
  collected: number | null;
  personalGpay: number;
  missing: string[];
  difference: number | null;
  unfixed: number | null;
};

export function checkClose(
  row: CashClose,
  closes: CashClose[],
  days: CollectionDay[],
  holidays: string[],
): CloseCheck {
  const last = previousClose(closes, row.date);
  if (!last) {
    return { last: null, lastDate: "", movement: null, collected: null, personalGpay: 0, missing: [], difference: null, unfixed: null };
  }
  const span = spanDates(last.date, row.date);
  const missing = span.filter((date) => !isSunday(date) && !holidays.includes(date) && aewsCollection(days, date) == null);
  const known = span.reduce((sum, date) => sum + (aewsCollection(days, date) ?? 0), 0);
  const personalGpay = span.reduce((sum, date) => sum + (days.find((item) => item.date === date)?.personalGpay ?? 0), 0);
  const movement = closingTotal(row) - closingTotal(last);
  if (!countStarted(row) && !row.accepted) {
    return { last: closingTotal(last), lastDate: last.date, movement, collected: missing.length > 0 ? null : known, personalGpay, missing, difference: null, unfixed: null };
  }
  if (missing.length > 0) {
    return { last: closingTotal(last), lastDate: last.date, movement, collected: null, personalGpay, missing, difference: null, unfixed: null };
  }
  const difference = movement - (known - personalGpay);
  return {
    last: closingTotal(last),
    lastDate: last.date,
    movement,
    collected: known,
    personalGpay,
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

export function accountLines(closes: CashClose[], days: CollectionDay[], holidays: string[]): AccountLine[] {
  return [...closes]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .flatMap((row) => {
      const check = checkClose(row, closes, days, holidays);
      if (check.difference == null || check.unfixed == null || check.difference === 0) return [];
      return [{ date: row.date, difference: check.difference, unfixed: check.unfixed }];
    });
}
