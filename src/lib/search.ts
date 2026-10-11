import { isMonthKey } from "@/lib/ledger/dates";

export function readDate(search: Record<string, unknown>): { d?: string } {
  const date = search.d;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { d: date };
  return {};
}

export function readMonth(search: Record<string, unknown>): { m?: string } {
  const month = search.m;
  if (typeof month === "string" && isMonthKey(month)) return { m: month };
  return {};
}

export function readStaff(search: Record<string, unknown>): { m?: string; e?: string } {
  const month = readMonth(search);
  const employee = search.e;
  if (typeof employee === "string" && employee) return { ...month, e: employee };
  return month;
}

export function readYear(search: Record<string, unknown>): { fy?: string } {
  const fy = search.fy;
  if (typeof fy === "string" && /^\d{4}$/.test(fy)) return { fy };
  return {};
}

const REPORTS = ["centre", "staff", "expenses", "leave", "logins"] as const;
export type ReportKind = (typeof REPORTS)[number];

export function readReport(search: Record<string, unknown>): { fy?: string; r?: ReportKind; d?: string } {
  const year = readYear(search);
  const date = readDate(search);
  const report = search.r;
  if (typeof report === "string" && (REPORTS as readonly string[]).includes(report)) {
    return { ...year, ...date, r: report as ReportKind };
  }
  return { ...year, ...date };
}
