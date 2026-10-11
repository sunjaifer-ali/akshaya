import type { Employee } from "@/lib/ledger/types";

export type ExportRow = {
  name: string;
  services: number;
  dept: number;
  charge: number;
  total: number;
};

export type ParsedExport = {
  rows: ExportRow[];
  services: number;
  dept: number;
  charge: number;
  total: number;
};

export type MatchedRow = ExportRow & {
  employeeId: string | null;
  amount: number;
};

function num(value: string): number {
  const cleaned = value.replace(/[,₹\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseAkshayaExport(html: string): ParsedExport | null {
  if (typeof DOMParser === "undefined") return null;
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const rows: ExportRow[] = [];
  let footer: ExportRow | null = null;
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("td")].map((cell) => cell.textContent?.trim() ?? "");
    if (cells.length < 6) continue;
    const name = cells[1] ?? "";
    const row: ExportRow = {
      name,
      services: num(cells[2] ?? ""),
      dept: num(cells[3] ?? ""),
      charge: num(cells[4] ?? ""),
      total: num(cells[5] ?? ""),
    };
    if (norm(name) === "total") footer = row;
    else if (name.trim()) rows.push(row);
  }
  if (rows.length === 0) return null;
  const sum = (key: keyof Pick<ExportRow, "services" | "dept" | "charge" | "total">) =>
    rows.reduce((total, row) => total + row[key], 0);
  return {
    rows,
    services: footer?.services || sum("services"),
    dept: footer?.dept || sum("dept"),
    charge: footer?.charge || sum("charge"),
    total: footer?.total || sum("total"),
  };
}

export function matchExport(parsed: ParsedExport, employees: Employee[]): MatchedRow[] {
  return parsed.rows.map((row) => {
    const key = norm(row.name);
    const employee = employees.find((item) => norm(item.name) === key);
    const amount = row.total > 0 ? row.total : row.charge;
    return { ...row, employeeId: employee?.id ?? null, amount };
  });
}

export function splitsFromMatch(rows: MatchedRow[]): Record<string, number> {
  const splits: Record<string, number> = {};
  for (const row of rows) {
    if (!row.employeeId || row.amount <= 0) continue;
    splits[row.employeeId] = (splits[row.employeeId] ?? 0) + row.amount;
  }
  return splits;
}
