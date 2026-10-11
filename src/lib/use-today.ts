import { useSyncExternalStore } from "react";
import { todayKey } from "@/lib/ledger/dates";

export function useTodayKey(): string {
  return useSyncExternalStore(
    () => () => {},
    () => todayKey(new Date()),
    () => "",
  );
}

export function useResolvedMonth(requested: string): string {
  const today = useTodayKey();
  if (requested) return requested;
  if (today) return today.slice(0, 7);
  return "2026-10";
}
