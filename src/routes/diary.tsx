import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addDiary, diaryDesk, removeDiary, setDiaryDone, type DiaryLine } from "@/lib/centre.functions";
import { addDays, formatDay, formatFull } from "@/lib/ledger/dates";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/diary")({
  component: DiaryPage,
});

function DiaryPage() {
  const today = useTodayKey();
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [forDate, setForDate] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [earlier, setEarlier] = useState<DiaryLine[]>([]);
  const [day, setDay] = useState<DiaryLine[]>([]);
  const [coming, setComing] = useState<DiaryLine[]>([]);
  const [found, setFound] = useState<DiaryLine[]>([]);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!date && today) setDate(today);
  }, [date, today]);

  useEffect(() => {
    setForDate(date);
  }, [date]);

  const load = (nextDate: string, query: string) => {
    void diaryDesk({ data: { date: nextDate, q: query } })
      .then((desk) => {
        setRole(desk.role === "admin" ? "admin" : "employee");
        setEarlier(desk.earlier);
        setDay(desk.day);
        setComing(desk.coming);
        setFound(desk.found);
      })
      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "The diary did not open." }));
  };

  useEffect(() => {
    if (!date) return;
    load(date, q);
  }, [date, q]);

  const open = day.filter((line) => !line.done);
  const done = day.filter((line) => line.done);
  const searching = q.trim().length > 0;

  const act = (work: Promise<unknown>, ok: string) => {
    void work
      .then(() => {
        setResult({ ok: true, message: ok });
        if (date) load(date, q);
      })
      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Not saved." }));
  };

  return (
    <div>
      <PageHeader
        kicker="DIARY"
        title="Diary"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Previous day" disabled={!date} onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <input
              type="date"
              aria-label="Diary date"
              className="h-11 rounded-sm border border-line bg-bg px-3 text-base text-ink outline-none focus:border-accent"
              value={date}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
            <Button variant="secondary" size="icon" aria-label="Next day" disabled={!date} onClick={() => setDate(addDays(date, 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />
      <p className="mb-4 text-sm text-muted">{date ? formatFull(date) : ""}</p>
      <input
        aria-label="Find in the diary"
        className="mb-4 h-11 w-full rounded-sm border border-line bg-surface px-3 text-base outline-none focus:border-accent"
        value={q}
        placeholder="Find a name or a note"
        onChange={(event) => setQ(event.target.value.slice(0, 40))}
      />

      {searching ? (
        <DiaryList
          title="Found"
          lines={found}
          showDate
          role={role}
          empty="Nothing found."
          onDone={(line) => act(setDiaryDone({ data: { id: line.id, done: !line.done } }), line.done ? "Opened again." : "Marked done.")}
          onDelete={(line) => act(removeDiary({ data: line.id }), "Note deleted.")}
        />
      ) : (
        <>
          <DiaryList
            title="Still open"
            lines={earlier}
            showDate
            role={role}
            onDone={(line) => act(setDiaryDone({ data: { id: line.id, done: true } }), "Marked done.")}
            onDelete={(line) => act(removeDiary({ data: line.id }), "Note deleted.")}
          />
          <form
            className="grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!forDate) return;
              setPending(true);
              void addDiary({ data: { date: forDate, note, customer, mobile } })
                .then(() => {
                  setNote("");
                  setCustomer("");
                  setMobile("");
                  setResult({ ok: true, message: "Note saved." });
                  if (forDate !== date) setDate(forDate);
                  else load(date, q);
                })
                .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Note was not saved." }))
                .finally(() => setPending(false));
            }}
          >
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-muted">Note</span>
              <input
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={note}
                placeholder="eg. call when the certificate is ready"
                onChange={(event) => setNote(event.target.value.slice(0, 240))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Customer, if any</span>
              <input
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={customer}
                onChange={(event) => setCustomer(event.target.value.slice(0, 80))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Mobile, if any</span>
              <input
                inputMode="numeric"
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">For</span>
              <input
                type="date"
                aria-label="Note date"
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={forDate}
                onChange={(event) => setForDate(event.target.value)}
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={pending}>
                Add note
              </Button>
            </div>
          </form>
          <DiaryList
            title="This day"
            lines={open}
            role={role}
            empty="Nothing for this day."
            onDone={(line) => act(setDiaryDone({ data: { id: line.id, done: true } }), "Marked done.")}
            onDelete={(line) => act(removeDiary({ data: line.id }), "Note deleted.")}
          />
          <DiaryList
            title="Done"
            lines={done}
            role={role}
            onDone={(line) => act(setDiaryDone({ data: { id: line.id, done: false } }), "Opened again.")}
            onDelete={(line) => act(removeDiary({ data: line.id }), "Note deleted.")}
          />
          <DiaryList
            title="Coming"
            lines={coming}
            showDate
            role={role}
            onDone={(line) => act(setDiaryDone({ data: { id: line.id, done: true } }), "Marked done.")}
            onDelete={(line) => act(removeDiary({ data: line.id }), "Note deleted.")}
          />
        </>
      )}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function DiaryList({
  title,
  lines,
  showDate = false,
  role,
  empty,
  onDone,
  onDelete,
}: {
  title: string;
  lines: DiaryLine[];
  showDate?: boolean;
  role: "admin" | "employee";
  empty?: string;
  onDone: (line: DiaryLine) => void;
  onDelete: (line: DiaryLine) => void;
}) {
  if (lines.length === 0 && !empty) return null;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface px-4">
      <h2 className="pt-4 font-medium">{title}</h2>
      {lines.length === 0 ? <p className="py-3 text-sm text-muted">{empty}</p> : null}
      <ul className="divide-y divide-line">
        {lines.map((line) => {
          const detail = [line.customer, line.mobile, role === "admin" ? line.by : "", showDate ? formatDay(line.date) : ""].filter(Boolean).join(" · ");
          return (
            <li key={line.id} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div>
                <p className={line.done ? "text-muted line-through" : "font-medium"}>{line.note}</p>
                {detail ? <p className="mt-0.5 text-xs text-faint">{detail}</p> : null}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="secondary" onClick={() => onDone(line)}>
                  {line.done ? "Open" : "Done"}
                </Button>
                {role === "admin" || line.mine ? (
                  <Button size="sm" variant="ghost" onClick={() => onDelete(line)}>
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
