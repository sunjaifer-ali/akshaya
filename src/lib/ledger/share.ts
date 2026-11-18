import {
  loadSharedBook,
  saveSharedBook,
  saveSharedClose,
  saveSharedDay,
  type CentreRole,
} from "@/lib/centre.functions";
import { useLedger } from "@/lib/ledger/store";
import type { CashClose, CollectionDay, LedgerData } from "@/lib/ledger/types";
import { withCategories } from "@/lib/ledger/types";

let touches: Record<string, string> = {};
let applying = false;
let role: CentreRole | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let missing = false;
const REDACTED = "centre-redacted";

export function sharedBookMissing(): boolean {
  return missing;
}

function snapshot(): LedgerData {
  const state = useLedger.getState();
  return {
    centreName: state.centreName,
    deductLwp: state.deductLwp,
    sample: false,
    sampleBanner: false,
    employees: state.employees,
    days: state.days,
    categories: state.categories,
    expenses: state.expenses,
    leaves: state.leaves,
    holidays: state.holidays,
    perfOverrides: state.perfOverrides,
    lyOverrides: state.lyOverrides,
    cashCloses: state.cashCloses,
    payouts: state.payouts ?? [],
  };
}

function asBook(book: LedgerData): LedgerData {
  return {
    ...book,
    sample: false,
    sampleBanner: false,
    lyOverrides: book.lyOverrides ?? {},
    cashCloses: book.cashCloses ?? [],
    payouts: book.payouts ?? [],
    categories: withCategories(book.categories),
  };
}

export async function startSharing(next: CentreRole): Promise<void> {
  role = next;
  missing = false;
  const remote = await loadSharedBook();
  const state = useLedger.getState();
  const local = snapshot();
  if (!remote) {
    if (next !== "admin") {
      missing = true;
      return;
    }
    const now = new Date().toISOString();
    for (const close of local.cashCloses) touches[close.date] = touches[close.date] || now;
    const saved = await saveSharedBook({ data: { book: local, touches } });
    touches = saved.touches;
    return;
  }
  touches = { ...(remote.touches ?? {}) };
  const redacted = sessionStorage.getItem(REDACTED) === "1";
  if (next !== "admin" || state.sample || redacted) {
    applying = true;
    useLedger.getState().replaceBook(asBook(remote.book));
    applying = false;
    if (next === "admin") sessionStorage.removeItem(REDACTED);
    else sessionStorage.setItem(REDACTED, "1");
    return;
  }
  const days = new Map((remote.book.days ?? []).map((day) => [day.date, day]));
  const closes = new Map((remote.book.cashCloses ?? []).map((close) => [close.date, close]));
  let extra = false;
  const now = new Date().toISOString();
  for (const day of local.days) {
    if (days.has(day.date) || day.amount <= 0) continue;
    days.set(day.date, day);
    touches[`day:${day.date}`] = now;
    extra = true;
  }
  for (const close of local.cashCloses) {
    if (closes.has(close.date)) continue;
    closes.set(close.date, close);
    touches[close.date] = now;
    extra = true;
  }
  applying = true;
  useLedger.getState().replaceBook(
    asBook({
      ...remote.book,
      days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      cashCloses: [...closes.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    }),
  );
  applying = false;
  if (!extra) return;
  const saved = await saveSharedBook({ data: { book: snapshot(), touches } });
  touches = saved.touches;
}

export function watchAdminBook(): () => void {
  return useLedger.subscribe(() => {
    if (applying || role !== "admin") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void saveSharedBook({ data: { book: snapshot(), touches } })
        .then((saved) => {
          touches = saved.touches;
          applying = true;
          useLedger.setState({
            days: saved.book.days ?? [],
            leaves: saved.book.leaves ?? [],
          });
          applying = false;
        })
        .catch(() => undefined);
    }, 700);
  });
}

export async function pullSharedCloses(): Promise<void> {
  if (role !== "admin" && role !== "closer") return;
  const remote = await loadSharedBook();
  if (!remote) return;
  const remotePayouts = remote.book.payouts ?? [];
  const localPayouts = useLedger.getState().payouts ?? [];
  const payoutsChanged =
    remotePayouts.length !== localPayouts.length ||
    remotePayouts.some((item, index) => item.id !== localPayouts[index]?.id || item.amount !== localPayouts[index]?.amount);
  const map = new Map(useLedger.getState().cashCloses.map((close) => [close.date, close]));
  const days = new Map(useLedger.getState().days.map((day) => [day.date, day]));
  const touchedDays = new Set<string>();
  let changed = false;
  for (const [date, touch] of Object.entries(remote.touches ?? {})) {
    if (date.startsWith("day:")) continue;
    if (touch <= (touches[date] ?? "")) continue;
    const close = (remote.book.cashCloses ?? []).find((item) => item.date === date);
    if (close) map.set(date, close);
    else map.delete(date);
    touches[date] = touch;
    changed = true;
  }
  for (const [key, touch] of Object.entries(remote.touches ?? {})) {
    if (!key.startsWith("day:")) continue;
    if (touch <= (touches[key] ?? "")) continue;
    const date = key.slice(4);
    const day = (remote.book.days ?? []).find((item) => item.date === date);
    if (day) days.set(date, day);
    else days.delete(date);
    touches[key] = touch;
    touchedDays.add(date);
    changed = true;
  }
  if (!changed && !payoutsChanged) return;
  const state = useLedger.getState();
  const leaves = state.leaves.filter((mark) => !touchedDays.has(mark.date));
  for (const mark of remote.book.leaves ?? []) {
    if (touchedDays.has(mark.date)) leaves.push(mark);
  }
  applying = true;
  useLedger.setState({
    cashCloses: [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    leaves,
    payouts: remotePayouts,
  });
  applying = false;
}

export async function pushClose(date: string, close: CashClose | null): Promise<void> {
  if (!role) return;
  const saved = await saveSharedClose({ data: { date, close } });
  touches = saved.touches;
  if (role === "employee") {
    applying = true;
    useLedger.getState().replaceBook(asBook(saved.book));
    applying = false;
  }
}

export async function pushDay(date: string, day: CollectionDay | null): Promise<void> {
  if (!role) return;
  const saved = await saveSharedDay({ data: { date, day } });
  touches = saved.touches;
  if (role === "employee") {
    applying = true;
    useLedger.getState().replaceBook(asBook(saved.book));
    applying = false;
  }
}
