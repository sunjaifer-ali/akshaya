import { format } from "date-fns";

export function todayKey(d = new Date()): string {
  return dateKey(d);
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

export function weekdayIndex(date: string): number {
  return parseDate(date).getDay();
}

export function isSunday(date: string): boolean {
  return weekdayIndex(date) === 0;
}

export function formatDay(date: string): string {
  return format(parseDate(date), "EEE d MMM");
}

export function formatFull(date: string): string {
  return format(parseDate(date), "EEEE, d MMMM yyyy");
}

export function formatMonth(month: string): string {
  return format(parseDate(`${month}-01`), "MMMM yyyy");
}

export function formatMonthShort(month: string): string {
  return format(parseDate(`${month}-01`), "MMM yy");
}

export function addDays(date: string, delta: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + delta);
  return dateKey(d);
}

export function addMonths(month: string, delta: number): string {
  const d = parseDate(`${month}-01`);
  d.setMonth(d.getMonth() + delta);
  return monthKey(dateKey(d));
}

export function datesInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y ?? 2026, m ?? 1, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export function lastYearMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${Number(y) - 1}-${m}`;
}

export function fyStartYear(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return (m ?? 1) >= 4 ? (y ?? 2026) : (y ?? 2026) - 1;
}

export function fyMonths(startYear: number): string[] {
  const out: string[] = [];
  for (let m = 4; m <= 12; m += 1) out.push(`${startYear}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m += 1) out.push(`${startYear + 1}-${String(m).padStart(2, "0")}`);
  return out;
}

export function fyLabel(startYear: number): string {
  const end = String(startYear + 1).slice(2);
  return `FY ${startYear}–${end}`;
}

export function shiftYear(month: string, delta: number): string {
  const [y, m] = month.split("-");
  return `${Number(y) + delta}-${m}`;
}
