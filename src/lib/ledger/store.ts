import { create } from "zustand";
import { persist } from "zustand/middleware";
import { buildCentreBook, buildSample, emptyBook } from "@/lib/ledger/seed";
import { datesInMonth, isSunday, todayKey } from "@/lib/ledger/dates";
import type {
  CashClose,
  CollectionDay,
  Employee,
  ExpenseCategory,
  LeaveCode,
  LeaveMark,
  LedgerData,
  SalaryPaid,
} from "@/lib/ledger/types";

type LedgerState = LedgerData & {
  setCentreName: (name: string) => void;
  setDeductLwp: (value: boolean) => void;
  dismissSample: () => void;
  restoreSample: () => void;
  startEmpty: () => void;
  replaceBook: (data: LedgerData) => void;
  saveEmployee: (employee: Employee) => void;
  setEmployeeActive: (id: string, active: boolean) => void;
  setDayAmount: (date: string, amount: number | null) => void;
  setMonthCollection: (month: string, amount: number | null) => void;
  importDay: (
    date: string,
    amount: number,
    splits: Record<string, number>,
    note: string,
    dropSheetLump: boolean,
  ) => void;
  removeDay: (date: string) => void;
  setDayNote: (date: string, note: string) => void;
  setDaySplit: (date: string, employeeId: string, amount: number | null) => void;
  setExpense: (month: string, categoryId: string, amount: number | null) => void;
  addCategory: (name: string) => boolean;
  renameCategory: (id: string, name: string) => void;
  removeCategory: (id: string) => void;
  copyExpenses: (from: string, to: string) => void;
  setLeave: (employeeId: string, date: string, code: LeaveCode | null) => void;
  toggleHoliday: (date: string) => void;
  setPerformance: (employeeId: string, month: string, amount: number) => void;
  clearPerformance: (employeeId: string, month: string) => void;
  setLastYear: (month: string, amount: number | null) => void;
  setCashClose: (close: CashClose) => void;
  clearCashClose: (date: string) => void;
  setSalaryPaid: (entry: SalaryPaid) => void;
};

function sortDays(days: CollectionDay[]): CollectionDay[] {
  return [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function isDailyImport(day: CollectionDay): boolean {
  return day.amount > 0 && /^(Imported from aewskerala|Entered on the counter)/i.test(day.note);
}

function syncLeaves(state: Pick<LedgerData, "days" | "employees" | "holidays" | "leaves">): LeaveMark[] {
  const closed = new Set(state.holidays);
  const today = todayKey();
  const working = state.days.filter(
    (day) => isDailyImport(day) && day.date < today && !isSunday(day.date) && !closed.has(day.date),
  );
  const dates = new Set(working.map((day) => day.date));
  const kept = state.leaves.filter((mark) => {
    if (isSunday(mark.date) || closed.has(mark.date)) return mark.code !== "LWP";
    return !dates.has(mark.date);
  });
  const marks = [...kept];
  for (const day of working) {
    for (const employee of state.employees) {
      if (!employee.active) continue;
      const previous = state.leaves.find((mark) => mark.employeeId === employee.id && mark.date === day.date);
      if ((day.splits[employee.id] ?? 0) > 0) {
        if (previous && previous.code !== "LWP") marks.push(previous);
        continue;
      }
      const code: LeaveCode = previous && previous.code !== "LWP" && previous.code !== "HD" ? previous.code : "LWP";
      marks.push({ employeeId: employee.id, date: day.date, code });
    }
  }
  return marks;
}

function upsertDay(
  days: CollectionDay[],
  date: string,
  patch: (current: CollectionDay | undefined) => CollectionDay | null,
): CollectionDay[] {
  const current = days.find((day) => day.date === date);
  const next = patch(current);
  const rest = days.filter((day) => day.date !== date);
  if (!next) return sortDays(rest);
  const empty =
    next.amount <= 0 && !next.note.trim() && Object.keys(next.splits).length === 0;
  if (empty) return sortDays(rest);
  return sortDays([...rest, next]);
}

const opening = buildCentreBook();

export const useLedger = create<LedgerState>()(
  persist(
    (set) => ({
      ...opening,
      setCentreName: (centreName) => set({ centreName }),
      setDeductLwp: (deductLwp) => set({ deductLwp }),
      dismissSample: () => set({ sampleBanner: false }),
      restoreSample: () => set(buildSample()),
      startEmpty: () =>
        set((state) => ({
          ...emptyBook(state.centreName),
        })),
      replaceBook: (data) => set({ ...data, sample: false, sampleBanner: false }),
      saveEmployee: (employee) =>
        set((state) => {
          const exists = state.employees.some((item) => item.id === employee.id);
          const employees = exists
            ? state.employees.map((item) => (item.id === employee.id ? employee : item))
            : [...state.employees, employee];
          return { employees };
        }),
      setEmployeeActive: (id, active) =>
        set((state) => ({
          employees: state.employees.map((employee) => (employee.id === id ? { ...employee, active } : employee)),
        })),
      setDayAmount: (date, amount) =>
        set((state) => ({
          days: upsertDay(state.days, date, (current) => {
            if (amount == null) return null;
            return {
              date,
              amount,
              note: current?.note ?? "",
              splits: current?.splits ?? {},
            };
          }),
        })),
      setMonthCollection: (month, amount) =>
        set((state) => {
          const inMonth = state.days.filter((day) => day.date.startsWith(month));
          const rest = state.days.filter((day) => !day.date.startsWith(month));
          const splits: Record<string, number> = {};
          for (const day of inMonth) {
            for (const [id, value] of Object.entries(day.splits)) {
              splits[id] = (splits[id] ?? 0) + value;
            }
          }
          const note = inMonth.map((day) => day.note.trim()).filter(Boolean)[0] ?? "";
          const nextAmount = amount ?? 0;
          if (nextAmount <= 0 && !note && Object.keys(splits).length === 0) {
            return { days: sortDays(rest) };
          }
          const dates = datesInMonth(month);
          const date = dates[dates.length - 1] ?? `${month}-01`;
          return { days: sortDays([...rest, { date, amount: nextAmount, note, splits }]) };
        }),
      importDay: (date, amount, splits, note, dropSheetLump) =>
        set((state) => {
          const month = date.slice(0, 7);
          const kept = dropSheetLump
            ? state.days.filter((day) => {
                if (!day.date.startsWith(month) || day.date === date) return true;
                return !/centre sheet|month total from/i.test(day.note);
              })
            : state.days;
          const ids = new Set(Object.keys(splits));
          const days = upsertDay(kept, date, () => ({ date, amount, note, splits }));
          return {
            days,
            perfOverrides: state.perfOverrides.filter(
              (item) => item.month !== month || !ids.has(item.employeeId),
            ),
            leaves: syncLeaves({ ...state, days }),
          };
        }),
      removeDay: (date) =>
        set((state) => {
          const days = state.days.filter((day) => day.date !== date);
          return {
            days,
            leaves: syncLeaves({ ...state, days }).filter((mark) => !(mark.date === date && mark.code === "LWP")),
          };
        }),
      setDayNote: (date, note) =>
        set((state) => ({
          days: upsertDay(state.days, date, (current) => ({
            date,
            amount: current?.amount ?? 0,
            note,
            splits: current?.splits ?? {},
          })),
        })),
      setDaySplit: (date, employeeId, amount) =>
        set((state) => ({
          days: upsertDay(state.days, date, (current) => {
            const splits = { ...(current?.splits ?? {}) };
            if (amount == null || amount <= 0) delete splits[employeeId];
            else splits[employeeId] = amount;
            return {
              date,
              amount: current?.amount ?? 0,
              note: current?.note ?? "",
              splits,
            };
          }),
        })),
      setExpense: (month, categoryId, amount) =>
        set((state) => {
          const row = { ...(state.expenses[month] ?? {}) };
          if (amount == null || amount <= 0) delete row[categoryId];
          else row[categoryId] = amount;
          return { expenses: { ...state.expenses, [month]: row } };
        }),
      addCategory: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return false;
        let added = false;
        set((state) => {
          const clash = state.categories.some(
            (category) => category.name.toLowerCase() === trimmed.toLowerCase(),
          );
          if (clash) return state;
          added = true;
          const id = `c-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${state.categories.length}`;
          const category: ExpenseCategory = { id, name: trimmed, builtin: false };
          return { categories: [...state.categories, category] };
        });
        return added;
      },
      renameCategory: (id, name) =>
        set((state) => ({
          categories: state.categories.map((category) =>
            category.id === id ? { ...category, name: name.trim() || category.name } : category,
          ),
        })),
      removeCategory: (id) =>
        set((state) => {
          const target = state.categories.find((category) => category.id === id);
          if (!target || target.builtin) return state;
          const expenses: LedgerData["expenses"] = {};
          for (const [month, row] of Object.entries(state.expenses)) {
            const next = { ...row };
            delete next[id];
            expenses[month] = next;
          }
          return {
            categories: state.categories.filter((category) => category.id !== id),
            expenses,
          };
        }),
      copyExpenses: (from, to) =>
        set((state) => ({
          expenses: {
            ...state.expenses,
            [to]: { ...(state.expenses[from] ?? {}) },
          },
        })),
      setLeave: (employeeId, date, code) =>
        set((state) => {
          const leaves = state.leaves.filter(
            (mark) => !(mark.employeeId === employeeId && mark.date === date),
          );
          if (code) leaves.push({ employeeId, date, code });
          return { leaves };
        }),
      toggleHoliday: (date) =>
        set((state) => {
          const has = state.holidays.includes(date);
          const holidays = has ? state.holidays.filter((item) => item !== date) : [...state.holidays, date].sort();
          return { holidays, leaves: syncLeaves({ ...state, holidays }) };
        }),
      setPerformance: (employeeId, month, amount) =>
        set((state) => {
          const rest = state.perfOverrides.filter(
            (item) => !(item.employeeId === employeeId && item.month === month),
          );
          return { perfOverrides: [...rest, { employeeId, month, amount }] };
        }),
      clearPerformance: (employeeId, month) =>
        set((state) => ({
          perfOverrides: state.perfOverrides.filter(
            (item) => !(item.employeeId === employeeId && item.month === month),
          ),
        })),
      setLastYear: (month, amount) =>
        set((state) => {
          const lyOverrides = { ...state.lyOverrides };
          if (amount == null) delete lyOverrides[month];
          else lyOverrides[month] = amount;
          return { lyOverrides };
        }),
      setCashClose: (close) =>
        set((state) => {
          const notes = {
            n10: countOf(close.notes.n10),
            n20: countOf(close.notes.n20),
            n50: countOf(close.notes.n50),
            n100: countOf(close.notes.n100),
            n200: countOf(close.notes.n200),
            n500: countOf(close.notes.n500),
          };
          const next: CashClose = {
            date: close.date,
            notes,
            eDistrict: rupee(close.eDistrict),
            csc: rupee(close.csc),
            credits: rupee(close.credits),
            bank: rupee(close.bank),
            fixed: rupee(close.fixed),
            creditPaid: (close.creditPaid ?? [])
              .map((item) => ({ name: item.name.trim().slice(0, 80), amount: rupee(item.amount) }))
              .filter((item) => item.amount > 0),
            creditGiven: (close.creditGiven ?? [])
              .map((item) => ({
                employeeId: item.employeeId,
                customer: (item.customer ?? "").trim().slice(0, 80),
                amount: rupee(item.amount),
              }))
              .filter((item) => item.amount > 0),
            countedBy: (close.countedBy ?? "").trim().slice(0, 80),
            accepted: Boolean(close.accepted),
            advanceHeld: rupee(close.advanceHeld ?? 0),
            advanceServed: rupee(close.advanceServed ?? 0),
            ...(typeof close.advanceIn === "number" ? { advanceIn: rupee(close.advanceIn) } : {}),
            profitTaken: rupee(close.profitTaken ?? 0),
            profitNote: (close.profitNote ?? "").trim().slice(0, 80),
            creditSeparate: Boolean(close.creditSeparate),
            ...(typeof close.personalBalance === "number" ? { personalBalance: rupee(close.personalBalance) } : {}),
          };
          const rest = state.cashCloses.filter((item) => item.date !== close.date);
          const cashCloses = [...rest, next].sort((a, b) => (a.date < b.date ? -1 : 1));
          return { cashCloses };
        }),
      clearCashClose: (date) =>
        set((state) => ({
          cashCloses: state.cashCloses.filter((item) => item.date !== date),
        })),
      setSalaryPaid: (entry) =>
        set((state) => {
          const rest = (state.salaryPaid ?? []).filter(
            (item) => !(item.employeeId === entry.employeeId && item.month === entry.month),
          );
          return { salaryPaid: [...rest, entry] };
        }),
    }),
    {
      name: "akshaya-thrikkadeeri-book",
      version: 9,
      skipHydration: true,
      migrate: (persisted, version) => {
        if (version < 4) return buildCentreBook();
        const book = persisted as LedgerData;
        if (!Array.isArray(book.cashCloses)) book.cashCloses = [];
        book.salaryPaid = book.salaryPaid ?? [];
        book.cashCloses = book.cashCloses.map((row) => ({
          ...row,
          creditPaid: row.creditPaid ?? [],
          creditGiven: row.creditGiven ?? [],
          countedBy: row.countedBy ?? "",
          accepted: Boolean(row.accepted),
          advanceHeld: row.advanceHeld ?? 0,
          advanceServed: row.advanceServed ?? 0,
          profitTaken: row.profitTaken ?? 0,
          profitNote: row.profitNote ?? "",
        }));
        return book;
      },
      partialize: (state) => ({
        centreName: state.centreName,
        deductLwp: state.deductLwp,
        sample: state.sample,
        sampleBanner: state.sampleBanner,
        employees: state.employees,
        days: state.days,
        categories: state.categories,
        expenses: state.expenses,
        leaves: state.leaves,
        holidays: state.holidays,
        perfOverrides: state.perfOverrides,
        lyOverrides: state.lyOverrides,
        cashCloses: state.cashCloses,
        salaryPaid: state.salaryPaid ?? [],
      }),
    },
  ),
);

function countOf(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function rupee(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

let hydrationStarted = false;

export function hydrateLedger(): void {
  if (hydrationStarted) return;
  hydrationStarted = true;
  void Promise.resolve(useLedger.persist.rehydrate()).then(() => {
    useLedger.setState((state) => ({ leaves: syncLeaves(state) }));
  });
}
