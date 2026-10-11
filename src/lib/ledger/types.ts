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
};

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
};

export const DEFAULT_CATEGORIES: ExpenseCategory[] = [
  { id: "rent", name: "Rent", builtin: true },
  { id: "electricity", name: "Electricity", builtin: true },
  { id: "internet", name: "Internet", builtin: true },
  { id: "paper", name: "Paper", builtin: true },
  { id: "ink", name: "Ink and others", builtin: true },
  { id: "tea", name: "Tea and others", builtin: true },
  { id: "maintenance", name: "Maintenance", builtin: true },
];

export const LEAVE_LABEL: Record<LeaveCode, string> = {
  CL: "Casual leave",
  SL: "Sick leave",
  LWP: "Unpaid leave",
  HD: "Half day",
  WO: "Weekly off",
};
