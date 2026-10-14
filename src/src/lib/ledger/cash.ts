import { addDays, isSunday } from "@/lib/ledger/dates";
import type { CashClose, CollectionDay, NoteCounts } from "@/lib/ledger/types";
import { calculateCentreReconciliation } from "@/lib/ledger/reconciliation";

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

/** Repayments reduce customer debt regardless of destination, but only centre receipts reconcile centre balances. */
export function creditPaidToCentreTotal(row: CashClose): number {
  return (row.creditPaid ?? []).reduce(
    (sum, item) => sum + (item.destination === "centre" ? Math.max(0, item.amount || 0) : 0),
    0,
  );
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

export function checkClose(
  row: CashClose,
  closes: CashClose[],
  days: CollectionDay[],
  holidays: string[],
  payouts: { date: string; amount: number }[] = [],
): CloseCheck {
  const last = previousClose(closes, row.date);
  const gap = closeGap(row, last);
  if (!last) {
    return { last: null, lastDate: "", movement: null, collected: null, personalGpay: 0, departmentGpay: 0, bankDepartment: 0, paidOut: 0, receipts: 0, payments: 0, ...gap, advanceChange: 0, advanceServed: 0, advanceIn: 0, missing: [], difference: null, unfixed: null };
  }
  const span = spanDates(last.date, row.date);
  const paidOut = payouts.reduce((sum, item) => (span.includes(item.date) ? sum + (item.amount || 0) : sum), 0);
  const missing = span.filter((date) => !isSunday(date) && !holidays.includes(date) && aewsCollection(days, date) == null);
  const known = span.reduce((sum, date) => sum + (aewsCollection(days, date) ?? 0), 0);
  const personalGpay = span.reduce((sum, date) => sum + (days.find((item) => item.date === date)?.personalGpay ?? 0), 0);
  const departmentGpay = span.reduce((sum, date) => sum + (days.find((item) => item.date === date)?.departmentGpay ?? 0), 0);
  const bankDepartment = span.reduce((sum, date) => sum + (days.find((item) => item.date === date)?.bankDepartment ?? 0), 0);
  let previous = closeBase(last);
  let movement = closeBase(row) - previous;
  if (!countStarted(row) && !row.accepted) {
    return { last: closeBase(last), lastDate: last.date, movement: null, collected: missing.length > 0 ? null : known, personalGpay, departmentGpay, bankDepartment, paidOut, receipts: 0, payments: 0, ...gap, missing, difference: null, unfixed: null, advanceIn: 0 };
  }
  if (missing.length > 0) {
    return { last: closeBase(last), lastDate: last.date, movement, collected: null, personalGpay, departmentGpay, bankDepartment, paidOut, receipts: 0, payments: 0, ...gap, missing, difference: null, unfixed: null, advanceIn: 0 };
  }
  const spanRows = [...closes.filter((item) => span.includes(item.date) && item.date !== row.date), row];
  const creditPaid = spanRows.reduce((sum, item) => sum + creditPaidToCentreTotal(item), 0);
  // Difference = (today centre balance − last centre balance) − receipts + payments.
  // A service, an old advance, or a credit is not cash. Only money that entered or left the centre counts.
  // Counter stores service charges, not department fees. Remove personal-GPay entries.
  // Credit and advance services are tracked separately and are not inferred from counter amounts.
  const advanceIn =
    typeof row.advanceIn === "number" ? Math.max(0, row.advanceIn) : Math.max(0, gap.advanceChange + (row.advanceServed ?? 0));
  const reconciliation = calculateCentreReconciliation({
    movement,
    counterServiceCharges: known,
    personalGpayServiceCharges: personalGpay,
    // Credit is entered only in the Credit screen, never in Counter; no amount-based matching.
    creditServiceCharges: 0,
    creditRepaymentsToCentre: creditPaid,
    advancesReceivedIntoCentre: advanceIn,
    departmentFeesPaidFromCentre: bankDepartment,
    otherPaymentsFromCentre: paidOut,
    transfersOutOfCentre: row.profitTaken ?? 0,
  });
  const { receipts, payments, difference } = reconciliation;
  return {
    last: previous,
    lastDate: last.date,
    movement,
    collected: known,
    personalGpay,
    departmentGpay,
    bankDepartment,
    paidOut,
    receipts,
    payments,
    ...gap,
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
