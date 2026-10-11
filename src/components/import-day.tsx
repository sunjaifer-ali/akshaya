import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import { datesInMonth, formatDay, isSunday, weekdayIndex } from "@/lib/ledger/dates";
import { matchExport, parseAkshayaExport, splitsFromMatch, type MatchedRow, type ParsedExport } from "@/lib/ledger/import-day";
import { useLedger } from "@/lib/ledger/store";
import type { CollectionDay } from "@/lib/ledger/types";

export function ImportDay({
  focusMonth,
  today,
  onSaved,
}: {
  focusMonth: string;
  today: string;
  onSaved?: (date: string) => void;
}) {
  const book = useLedger();
  const opening = defaultDate(focusMonth, today);
  const [date, setDate] = useState(opening);
  const [picked, setPicked] = useState(false);
  const [parsed, setParsed] = useState<ParsedExport | null>(null);
  const [rows, setRows] = useState<MatchedRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dropLump, setDropLump] = useState(false);

  useEffect(() => {
    if (!picked && opening) setDate(opening);
  }, [opening, picked]);

  const choose = (next: string) => {
    setPicked(true);
    setDate(next);
    setError("");
    setNotice("");
  };

  const existing = book.days.find((day) => day.date === date);
  const imported = isImported(existing);
  const sunday = isSunday(date);
  const holiday = book.holidays.includes(date);
  const closed = sunday || holiday;
  const month = date.slice(0, 7);
  const inMonth = book.days.filter((day) => day.date.startsWith(month));
  const sheetLump = isSheetLump(inMonth);
  const paid = rows.filter((row) => row.amount > 0);
  const unmatched = paid.filter((row) => !row.employeeId);
  const quiet = rows.filter((row) => row.amount <= 0).map((row) => row.name.trim());
  const missing = missingDays(book.days, book.holidays, focusMonth, today);
  const fileBlocked = imported || closed || (Boolean(today) && date > today);

  const readFile = async (file: File | undefined) => {
    setError("");
    setNotice("");
    setParsed(null);
    setRows([]);
    setDropLump(false);
    if (!file) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Not imported. Tap the day this export belongs to, then choose the file.");
      return;
    }
    if (isImported(book.days.find((day) => day.date === date))) {
      setError(`Not imported. ${formatDay(date)} is locked. Delete that day to import it again.`);
      return;
    }
    if (isSunday(date) || book.holidays.includes(date)) {
      setError(`Not imported. ${formatDay(date)} is a holiday. Open the day if the centre worked.`);
      return;
    }
    const html = await file.text();
    const next = parseAkshayaExport(html);
    if (!next) {
      setError("Not imported. That file is not the aewskerala staff table. Export it again and choose the .xls file.");
      return;
    }
    const matched = matchExport(next, book.employees);
    if (sheetLump) {
      setParsed(next);
      setRows(matched);
      return;
    }
    apply(next, matched, false);
  };

  const apply = (next: ParsedExport, matched: MatchedRow[], drop: boolean) => {
    if (isImported(book.days.find((day) => day.date === date))) {
      setError(`Not imported. ${formatDay(date)} is locked. Delete that day to import it again.`);
      return;
    }
    const splits = splitsFromMatch(matched);
    const note = `Imported from aewskerala. ${next.services} services, service charge ${Math.round(next.charge)}, dept pay ${Math.round(next.dept)}.`;
    book.importDay(date, next.total, splits, note, drop);
    const people = matched
      .filter((row) => row.employeeId && row.amount > 0)
      .map((row) => `${book.employees.find((item) => item.id === row.employeeId)?.name ?? row.name.trim()} ${inr(row.amount)}`);
    setNotice(`Successfully imported. ${inr(next.total)} saved for ${formatDay(date)}${people.length > 0 ? `. ${people.join(", ")}.` : "."}`);
    setParsed(null);
    setRows([]);
    setDropLump(false);
    onSaved?.(date);
  };

  const save = () => {
    if (!parsed) return;
    if (sheetLump && !dropLump) {
      setError("Not imported. This month already has one total from the sheet. Tick the box if this file should start the daily record instead.");
      return;
    }
    apply(parsed, rows, sheetLump && dropLump);
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">Import a day</h2>
      <p className="mt-1 text-sm text-muted">
        Tap an open day, then choose the export. An imported day stays locked until you delete it. Sundays are holidays.
      </p>
      {missing.length > 0 ? (
        <p className="mt-3 text-sm text-bad">Not imported: {missing.map((item) => formatDay(item)).join(", ")}.</p>
      ) : null}
      <DayGrid
        month={focusMonth}
        today={today}
        selected={date}
        days={book.days}
        holidays={book.holidays}
        onPick={choose}
      />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Or type another date</span>
          <input
            type="date"
            aria-label="Date of this export"
            className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
            value={date}
            onChange={(event) => {
              if (event.target.value) choose(event.target.value);
            }}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Export file</span>
          <input
            type="file"
            accept=".xls,.html,.htm,text/html,application/vnd.ms-excel"
            aria-label="Aewskerala export file"
            disabled={fileBlocked}
            className="block h-11 max-w-full text-sm file:mr-3 file:h-11 file:rounded-sm file:border-0 file:bg-accent file:px-4 file:text-sm file:font-medium file:text-accent-ink disabled:opacity-50"
            onChange={(event) => {
              const file = event.target.files?.[0];
              void readFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {date ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">
            {imported
              ? `${formatDay(date)} is locked.`
              : sunday
                ? "Sundays are holidays."
                : holiday
                  ? `${formatDay(date)} is a holiday.`
                  : `Saving into ${formatDay(date)}.`}
          </p>
          {imported ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                book.removeDay(date);
                setParsed(null);
                setRows([]);
                setNotice("");
                setError("");
              }}
            >
              Delete {formatDay(date)}
            </Button>
          ) : !sunday ? (
            <Button size="sm" variant="secondary" onClick={() => book.toggleHoliday(date)}>
              {holiday ? "Open this day" : "Mark as holiday"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {parsed ? (
        <div className="mt-4">
          <p className="text-sm text-muted">
            {parsed.services} services. Service charge {inr(parsed.charge)}. Dept pay {inr(parsed.dept)}. Total {inr(parsed.total)}.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {paid.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {row.employeeId ? book.employees.find((item) => item.id === row.employeeId)?.name : row.name.trim()}
                  {row.employeeId ? "" : " — not on the salary list, counted only in the centre total"}
                  <span className="ml-2 text-faint">{row.services} services</span>
                </span>
                <span className="tabular-nums">{inr(row.amount)}</span>
              </li>
            ))}
          </ul>
          {quiet.length > 0 ? <p className="mt-2 text-xs text-faint">No collection: {quiet.join(", ")}.</p> : null}
          {existing && existing.amount > 0 ? (
            <p className="mt-2 text-sm text-muted">This replaces the {inr(existing.amount)} already saved for {formatDay(date)}.</p>
          ) : null}
          {sheetLump ? (
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={dropLump} onChange={(event) => setDropLump(event.target.checked)} />
              <span>
                {formatDay(inMonth[0]?.date ?? date)} already holds the whole month from the sheet. Drop that total and keep this day instead.
              </span>
            </label>
          ) : null}
          {unmatched.length > 0 ? (
            <p className="mt-2 text-sm text-bad">
              Add {unmatched.map((row) => row.name.trim()).join(", ")} on Salary if their collection should count for pay.
            </p>
          ) : null}
          <Button className="mt-3" onClick={save}>
            Save {formatDay(date)}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="status">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink" role="status">{notice}</p> : null}
    </section>
  );
}

function isSheetLump(days: CollectionDay[]): boolean {
  return days.length === 1 && /centre sheet|month total from/i.test(days[0]?.note ?? "");
}

function isImported(day: CollectionDay | undefined): boolean {
  return Boolean(day && day.amount > 0 && /^Imported from aewskerala/i.test(day.note));
}

function missingDays(days: CollectionDay[], holidays: string[], month: string, today: string): string[] {
  const inMonth = days.filter((day) => day.date.startsWith(month));
  if (isSheetLump(inMonth)) return [];
  if (!today || !month || month > today.slice(0, 7)) return [];
  const end = month < today.slice(0, 7) ? (datesInMonth(month).at(-1) ?? "") : today;
  const saved = new Set(inMonth.filter((day) => day.amount > 0).map((day) => day.date));
  return datesInMonth(month).filter((date) => date <= end && !isSunday(date) && !holidays.includes(date) && !saved.has(date));
}

function defaultDate(month: string, today: string): string {
  if (today && (!month || today.slice(0, 7) === month)) return today;
  if (month) return `${month}-01`;
  return today;
}

function DayGrid({
  month,
  today,
  selected,
  days,
  holidays,
  onPick,
}: {
  month: string;
  today: string;
  selected: string;
  days: CollectionDay[];
  holidays: string[];
  onPick: (date: string) => void;
}) {
  const dates = datesInMonth(month);
  const lead = weekdayIndex(dates[0] ?? `${month}-01`);
  return (
    <div className="mt-3">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-faint">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, index) => (
          <span key={`pad-${index}`} />
        ))}
        {dates.map((item) => {
          const future = Boolean(today) && item > today;
          const on = item === selected;
          const locked = isImported(days.find((day) => day.date === item));
          const sunday = isSunday(item);
          const holiday = holidays.includes(item);
          return (
            <button
              key={item}
              type="button"
              aria-label={
                locked
                  ? `${formatDay(item)} locked`
                  : sunday
                    ? `${formatDay(item)} Sunday holiday`
                    : holiday
                      ? `${formatDay(item)} holiday`
                      : formatDay(item)
              }
              aria-pressed={on}
              onClick={() => onPick(item)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-sm text-sm",
                on ? "bg-accent text-accent-ink" : "bg-bg text-ink",
                !on && (sunday || holiday) && "bg-warn-soft text-warn",
                future && !on && "opacity-40",
              )}
            >
              {Number(item.slice(8))}
              {locked ? (
                <span className={cn("mt-0.5 size-1 rounded-full", on ? "bg-accent-ink" : "bg-accent")} />
              ) : sunday || holiday ? (
                <span className="text-[10px] leading-none">H</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
