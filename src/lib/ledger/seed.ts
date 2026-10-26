import { salaryTotal, staffMonthRows } from "@/lib/ledger/calc";
import { dateKey, datesInMonth, isSunday, monthKey } from "@/lib/ledger/dates";
import {
  DEFAULT_CATEGORIES,
  type CollectionDay,
  type Employee,
  type LeaveMark,
  type LedgerData,
} from "@/lib/ledger/types";

const SAMPLE_END = "2026-10-04";

const HOLIDAYS = [
  "2025-04-14",
  "2025-08-15",
  "2025-10-02",
  "2025-12-25",
  "2026-01-26",
  "2026-04-14",
  "2026-08-15",
  "2026-10-02",
];

type StaffSeed = Employee & { weight: number };

const STAFF: StaffSeed[] = [
  {
    id: "anjali",
    name: "Anjali Menon",
    role: "Senior operator",
    basic: 14000,
    incentive: 2000,
    active: true,
    weight: 0.44,
  },
  {
    id: "rafi",
    name: "Mohammed Rafi",
    role: "Operator",
    basic: 11000,
    incentive: 1500,
    active: true,
    weight: 0.34,
  },
  {
    id: "sreeja",
    name: "Sreeja P",
    role: "Assistant",
    basic: 9500,
    incentive: 1000,
    active: true,
    weight: 0.22,
  },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function monthsThrough(end: string): string[] {
  const out: string[] = [];
  let cursor = "2025-04";
  while (cursor <= end.slice(0, 7)) {
    out.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    const next = new Date(y ?? 2025, (m ?? 1) - 1 + 1, 1);
    cursor = monthKey(dateKey(next));
  }
  return out;
}

function season(monthNum: number): number {
  if (monthNum === 4 || monthNum === 5) return 1.16;
  if (monthNum === 6) return 1.04;
  if (monthNum === 12) return 0.84;
  if (monthNum === 1) return 0.9;
  return 1;
}

function eachDate(end: string): string[] {
  const out: string[] = [];
  const start = new Date(2025, 3, 1);
  const stop = end;
  for (let d = start; dateKey(d) <= stop; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(dateKey(d));
  }
  return out;
}

export function buildSample(): LedgerData {
  const rng = mulberry32(20261005);
  const holidaySet = new Set(HOLIDAYS);
  const leaves: LeaveMark[] = [];
  const leaveKey = new Set<string>();

  for (const month of monthsThrough(SAMPLE_END)) {
    const work = datesInMonth(month).filter(
      (d) => d <= SAMPLE_END && !isSunday(d) && !holidaySet.has(d),
    );
    for (const person of STAFF) {
      const cl = rng();
      const sl = rng();
      const lwp = rng();
      const place = (code: LeaveMark["code"]) => {
        if (work.length === 0) return;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const date = work[Math.floor(rng() * work.length)] ?? work[0];
          if (!date) return;
          const key = `${person.id}|${date}`;
          if (leaveKey.has(key)) continue;
          leaveKey.add(key);
          leaves.push({ employeeId: person.id, date, code });
          return;
        }
      };
      if (cl < 0.62) place("CL");
      if (sl < 0.16) place("SL");
      if (lwp < 0.07) place("LWP");
    }
  }

  const days: CollectionDay[] = [];
  for (const date of eachDate(SAMPLE_END)) {
    if (isSunday(date) || holidaySet.has(date)) continue;
    const monthNum = Number(date.slice(5, 7));
    const yearFactor = date >= "2026-04-01" ? 1.11 : 1;
    const sat = new Date(
      Number(date.slice(0, 4)),
      monthNum - 1,
      Number(date.slice(8, 10)),
    ).getDay() === 6
      ? 0.76
      : 1;
    const noise = 0.86 + rng() * 0.28;
    const amount = Math.round((6400 * yearFactor * season(monthNum) * sat * noise) / 10) * 10;
    const present = STAFF.filter((person) => !leaveKey.has(`${person.id}|${date}`));
    const splits: Record<string, number> = {};
    if (present.length > 0) {
      const attributed = Math.round(amount * (0.9 + rng() * 0.05));
      const weights = present.map((person) => person.weight * (0.82 + rng() * 0.36));
      const weightSum = weights.reduce((sum, n) => sum + n, 0);
      let used = 0;
      present.forEach((person, index) => {
        if (index === present.length - 1) {
          splits[person.id] = Math.max(0, attributed - used);
          return;
        }
        const share = Math.round((attributed * (weights[index] ?? 0)) / weightSum / 10) * 10;
        splits[person.id] = share;
        used += share;
      });
    }
    days.push({ date, amount, note: "", splits });
  }

  const expenses: Record<string, Record<string, number>> = {};
  for (const month of monthsThrough(SAMPLE_END)) {
    if (month === SAMPLE_END.slice(0, 7)) continue;
    const monthNum = Number(month.slice(5, 7));
    const elecBase = [3, 4, 5].includes(monthNum) ? 2900 : [11, 12, 1].includes(monthNum) ? 1750 : 2200;
    const row: Record<string, number> = {
      rent: 7500,
      electricity: Math.round((elecBase + rng() * 500) / 10) * 10,
      internet: 799,
      paper: Math.round((1400 + rng() * 900) / 10) * 10,
      ink: Math.round((650 + rng() * 700) / 10) * 10,
      tea: Math.round((1900 + rng() * 700) / 10) * 10,
    };
    if (rng() < 0.45) row.maintenance = Math.round((800 + rng() * 2800) / 10) * 10;
    if (rng() < 0.4) row.courier = Math.round((250 + rng() * 700) / 10) * 10;
    expenses[month] = row;
  }

  return {
    centreName: "Akshaya Centre Thrikkadeeri",
    deductLwp: true,
    sample: true,
    sampleBanner: true,
    employees: STAFF.map(({ weight: _weight, ...employee }) => employee),
    days,
    categories: [
      ...DEFAULT_CATEGORIES,
      { id: "courier", name: "Courier", builtin: false },
    ],
    expenses,
    leaves,
    holidays: HOLIDAYS,
    perfOverrides: [],
    lyOverrides: {},
    cashCloses: [],
    salaryPaid: [],
  };
}

export function emptyBook(centreName: string): LedgerData {
  return {
    centreName,
    deductLwp: true,
    sample: false,
    sampleBanner: false,
    employees: [],
    days: [],
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    expenses: {},
    leaves: [],
    holidays: [],
    perfOverrides: [],
    lyOverrides: {},
    cashCloses: [],
    salaryPaid: [],
  };
}

const CENTRE_STAFF: Employee[] = [
  { id: "ajitha", name: "Ajitha", role: "Aadhaar desk", desk: "aadhaar", basic: 15000, incentive: 0, active: true },
  { id: "haseena", name: "Haseena", role: "Aadhaar desk", desk: "aadhaar", basic: 16500, incentive: 0, active: true },
  { id: "sajini", name: "Sajini", role: "Service desk", desk: "service", basic: 12000, incentive: 0, active: true },
  { id: "sheena", name: "Sheena", role: "Service desk", desk: "service", basic: 12500, incentive: 0, active: true },
  { id: "rubeena", name: "Rubeena", role: "Support desk", desk: "support", basic: 10000, incentive: 0, active: true },
];

// Usual mix from the expense calculator. Monthly totals are scaled to this mix
// so rent, paper, tea and the rest stay in proportion.
const EXPENSE_MIX: { id: string; weight: number }[] = [
  { id: "rent", weight: 3500 },
  { id: "electricity", weight: 1500 },
  { id: "internet", weight: 1000 },
  { id: "paper", weight: 4500 },
  { id: "ink", weight: 2000 },
  { id: "tea", weight: 3000 },
  { id: "maintenance", weight: 2500 },
];

type MonthActual = {
  month: string;
  collection: number;
  spent: number;
  splits: Record<string, number>;
};

const MONTH_ACTUALS: MonthActual[] = [
  {
    month: "2026-01",
    collection: 289084,
    spent: 89584,
    splits: { ajitha: 77420, haseena: 74140, sheena: 51210, sajini: 48730, rubeena: 30138 },
  },
  {
    month: "2026-02",
    collection: 175737,
    spent: 70500,
    splits: { ajitha: 41772, haseena: 49257, sheena: 29545, sajini: 32662, rubeena: 19141 },
  },
  {
    month: "2026-03",
    collection: 156795,
    spent: 62333,
    splits: { ajitha: 44941, haseena: 49220, sheena: 29410, sajini: 18190, rubeena: 10193 },
  },
  {
    month: "2026-04",
    collection: 160203,
    spent: 74500,
    splits: { ajitha: 40946, haseena: 45397, sheena: 25380, sajini: 27532, rubeena: 19003 },
  },
  {
    month: "2026-05",
    collection: 209402,
    spent: 74500,
    splits: { ajitha: 52435, haseena: 52087, sheena: 36855, sajini: 35871, rubeena: 28339 },
  },
  {
    month: "2026-06",
    collection: 264732,
    spent: 78000,
    splits: { ajitha: 57399, haseena: 69282, sheena: 42505, sajini: 45887, rubeena: 42594 },
  },
  {
    month: "2026-07",
    collection: 262419,
    spent: 83000,
    splits: { ajitha: 75160, haseena: 58903, sheena: 40225, sajini: 41216, rubeena: 43879 },
  },
  {
    month: "2026-08",
    collection: 208593,
    spent: 78593,
    splits: { ajitha: 52946, haseena: 64755, sheena: 28775, sajini: 30186, rubeena: 30691 },
  },
  {
    month: "2026-09",
    collection: 242473,
    spent: 82473,
    splits: { ajitha: 57821, haseena: 70920, sheena: 37850, sajini: 40449, rubeena: 35173 },
  },
];

const LAST_YEAR: Record<string, number> = {
  "2026-01": 173413,
  "2026-02": 163157,
  "2026-03": 164193,
  "2026-04": 144146,
  "2026-05": 189562,
  "2026-06": 205245,
  "2026-07": 196134,
  "2026-08": 167884,
  "2026-09": 145000,
  "2026-10": 184685,
  "2026-11": 244712,
  "2026-12": 205000,
};

const LEAVE_DAYS: Record<string, Record<string, number[]>> = {
  ajitha: {
    "2026-02": [12, 23],
    "2026-04": [8],
    "2026-05": [28],
    "2026-06": [15],
  },
  sheena: {
    "2026-01": [3],
    "2026-02": [12],
    "2026-03": [7, 31],
    "2026-04": [29],
    "2026-05": [28],
    "2026-06": [29],
    "2026-07": [4, 31],
  },
  sajini: {
    "2026-03": daysFrom(8, 22),
  },
  rubeena: {
    "2026-03": daysFrom(6, 22),
    "2026-07": [28],
    "2026-08": [1],
  },
};

function daysFrom(start: number, end: number): number[] {
  const days: number[] = [];
  for (let day = start; day <= end; day += 1) days.push(day);
  return days;
}

function spreadExpense(total: number): Record<string, number> {
  if (total <= 0) return {};
  const weightSum = EXPENSE_MIX.reduce((sum, item) => sum + item.weight, 0);
  const parts = EXPENSE_MIX.map((item) => {
    const exact = (total * item.weight) / weightSum;
    return { id: item.id, amount: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  let used = parts.reduce((sum, item) => sum + item.amount, 0);
  const order = [...parts].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  let index = 0;
  while (used < total) {
    const target = order[index % order.length];
    if (!target) break;
    target.amount += 1;
    used += 1;
    index += 1;
  }
  const row: Record<string, number> = {};
  for (const item of parts) {
    if (item.amount > 0) row[item.id] = item.amount;
  }
  return row;
}

function centreLeaves(): LeaveMark[] {
  const marks: LeaveMark[] = [];
  for (const [employeeId, months] of Object.entries(LEAVE_DAYS)) {
    for (const [month, days] of Object.entries(months)) {
      for (const day of days) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        if (isSunday(date)) continue;
        marks.push({ employeeId, date, code: "LWP" });
      }
    }
  }
  return marks;
}

function monthSalary(leaves: LeaveMark[], month: string): number {
  const rows = staffMonthRows(CENTRE_STAFF, [], [], leaves, [], month, 0, true, "");
  return salaryTotal(rows);
}

export function buildCentreBook(): LedgerData {
  const leaves = centreLeaves();
  const expenses: LedgerData["expenses"] = {};
  const days: CollectionDay[] = [];

  for (const actual of MONTH_ACTUALS) {
    const salary = monthSalary(leaves, actual.month);
    const running = Math.max(0, actual.spent - salary);
    expenses[actual.month] = spreadExpense(running);
    const dates = datesInMonth(actual.month);
    const date = dates[dates.length - 1] ?? `${actual.month}-01`;
    days.push({
      date,
      amount: actual.collection,
      note: "Month total from the centre sheet. Daily breakup was not included.",
      splits: { ...actual.splits },
    });
  }

  return {
    centreName: "Akshaya Centre Thrikkadeeri",
    deductLwp: true,
    sample: false,
    sampleBanner: false,
    employees: CENTRE_STAFF.map((employee) => ({ ...employee })),
    days,
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    expenses,
    leaves,
    holidays: [],
    perfOverrides: [],
    lyOverrides: { ...LAST_YEAR },
    cashCloses: [],
    salaryPaid: [],
  };
}
