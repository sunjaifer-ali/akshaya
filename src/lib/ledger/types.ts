export type LeaveCode = "CL" | "SL" | "LWP" | "HD" | "WO";

export type Employee = {
  id: string;
  name: string;
  role: string;
  basic: number;
  incentive: number;
  active: boolean;
};

export type CollectionDay = {
  date: string;
  amount: number;
  note: string;
  splits: Record<string, number>;
  personalGpay?: number;
  departmentGpay?: number;
  bankDepartment?: number;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  builtin: boolean;
};

export type NoteCounts = {
  n10: number;
  n20: number;
  n50: number;
  n100: number;
  n200: number;
  n500: number;
};

export type CreditPayment = {
  name: string;
  amount: number;
};

export type CreditGiven = {
  employeeId: string;
  customer: string;
  amount: number;
};

export type CashClose = {
  date: string;
  notes: NoteCounts;
  eDistrict: number;
  csc: number;
  credits: number;
  bank: number;
  fixed: number;
  creditPaid: CreditPayment[];
  creditGiven: CreditGiven[];
  countedBy: string;
  accepted: boolean;
  advanceHeld?: number;
  advanceServed?: number;
  profitTaken?: number;
  profitNote?: string;
  creditSeparate?: boolean;
};

export type CentrePayout = {
  id: string;
  date: string;
  category: string;
  amount: number;
  note: string;
  by: string;
};

export const PAYOUT_KINDS = [
  { id: "tea", label: "Tea" },
  { id: "ink", label: "Ink" },
  { id: "stationery", label: "Stationery" },
  { id: "donation", label: "Donation" },
  { id: "other", label: "Other" },
] as const;

export function payoutLabel(category: string): string {
  return PAYOUT_KINDS.find((item) => item.id === category)?.label ?? "Other";
}

export function payoutKind(text: string): string {
  const value = text.toLowerCase();
  if (value.includes("tea")) return "tea";
  if (value.includes("ink")) return "ink";
  if (value.includes("station")) return "stationery";
  if (value.includes("donat")) return "donation";
  return "other";
}

export type LeaveMark = {
  employeeId: string;
  date: string;
  code: LeaveCode;
};

export type PerfOverride = {
  employeeId: string;
  month: string;
  amount: number;
};

export type LedgerData = {
  centreName: string;
  deductLwp: boolean;
  sample: boolean;
  sampleBanner: boolean;
  employees: Employee[];
  days: CollectionDay[];
  categories: ExpenseCategory[];
  expenses: Record<string, Record<string, number>>;
  leaves: LeaveMark[];
  holidays: string[];
  perfOverrides: PerfOverride[];
  lyOverrides: Record<string, number>;
  cashCloses: CashClose[];
  payouts?: CentrePayout[];
};

export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: "rent", name: "Rent", builtin: true },
  { id: "electricity", name: "Electricity", builtin: true },
  { id: "internet", name: "Internet", builtin: true },
  { id: "paper", name: "Paper", builtin: true },
  { id: "ink", name: "Ink and others", builtin: true },
  { id: "stationery", name: "Stationery", builtin: true },
  { id: "tea", name: "Tea and others", builtin: true },
  { id: "donation", name: "Donation", builtin: true },
  { id: "maintenance", name: "Maintenance", builtin: true },
];

export function withCategories(categories: ExpenseCategory[] | undefined): ExpenseCategory[] {
  const present = new Map((categories ?? []).map((item) => [item.id, item]));
  for (const category of DEFAULT_CATEGORIES) {
    if (!present.has(category.id)) present.set(category.id, { ...category });
  }
  const order = DEFAULT_CATEGORIES.map((item) => item.id);
  const builtins = order.flatMap((id) => {
    const category = present.get(id);
    return category ? [category] : [];
  });
  const extra = [...present.values()].filter((item) => !order.includes(item.id));
  return [...builtins, ...extra];
}

export const LEAVE_LABEL: Record<LeaveCode, string> = {
  CL: "Casual leave",
  SL: "Sick leave",
  LWP: "Unpaid leave",
  HD: "Half day",
  WO: "Weekly off",
};
