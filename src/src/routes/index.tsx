import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { chartColors } from "@/lib/chart-colors";
import { cn } from "@/lib/cn";
import { inr, signedInr } from "@/lib/format";
import { diaryDesk, advanceDesk, customerCreditDesk, type OpenCredit } from "@/lib/centre.functions";
import { accountLines, aewsCollection, checkClose, unpaidCreditReport } from "@/lib/ledger/cash";
import { centreSnapshot, monthCollection, staffMonthRows } from "@/lib/ledger/calc";
import { addDays, formatDay, formatFull, formatMonthShort, fyMonths, fyStartYear, isSunday } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import type { CashClose, CollectionDay, Employee, LeaveMark } from "@/lib/ledger/types";
import { useMounted } from "@/lib/use-mounted";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/")({ component: DeskPage });

function DeskPage() {
  const today = useTodayKey();
  const month = today ? today.slice(0, 7) : "2026-10";
  const book = useLedger();
  const [diaryOpen, setDiaryOpen] = useState(0);
  const [advanceHeld, setAdvanceHeld] = useState(0);
  const [warnDays, setWarnDays] = useState(7);
  const [liveOpen, setLiveOpen] = useState<OpenCredit[] | null>(null);
  const mounted = useMounted();
  const snap = centreSnapshot(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    book.expenses,
    book.lyOverrides,
    month,
    book.deductLwp,
    today,
    book.payouts ?? [],
  );
  const rows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    month,
    snap.collection,
    book.deductLwp,
    today,
  );
  const onLeave = today
    ? book.leaves.filter((mark) => mark.date === today && mark.code !== "HD")
    : [];
  const points = fyMonths(fyStartYear(month))
    .filter((item) => item <= month)
    .map((item) => ({
      label: formatMonthShort(item),
      amount: monthCollection(book.days, item),
    }));

  const lines = accountLines(book.cashCloses, book.days, book.holidays, book.payouts ?? []).filter((line) => line.unfixed !== 0);
  const shortOpen = lines.filter((line) => line.unfixed < 0).reduce((sum, line) => sum + line.unfixed, 0);
  const excessOpen = lines.filter((line) => line.unfixed > 0).reduce((sum, line) => sum + line.unfixed, 0);
  const imported = today ? aewsCollection(book.days, today) : null;
  const close = today ? book.cashCloses.find((row) => row.date === today) : undefined;
  const check = close ? checkClose(close, book.cashCloses, book.days, book.holidays, book.payouts ?? []) : null;
  const closeWord = closeWordOf(check);
  const review = today ? morningReview(book, today) : [];
  const creditLines = liveOpen
    ? liveOpen.map((line) => ({ date: line.date, customer: line.customer, staff: line.staff, balance: line.balance }))
    : unpaidCreditReport(book.cashCloses, (id) => book.employees.find((employee) => employee.id === id)?.name ?? "Staff").lines;
  const oldCutoff = today ? addDays(today, -warnDays) : "";
  const oldCredit = creditLines.filter((line) => line.date && line.balance > 0 && line.date <= oldCutoff);
  const oldTotal = oldCredit.reduce((sum, line) => sum + line.balance, 0);
  const attention = diaryOpen > 0 ? [...review, { text: `Diary · ${diaryOpen} open`, tone: "warn" as const, to: "/diary" as const }] : review;
  if (advanceHeld > 0) attention.push({ text: `Advance still to serve ${inr(advanceHeld)}`, tone: "warn", to: "/credit" });

  useEffect(() => {
    if (!today) return;
    void diaryDesk({ data: { date: today } })
      .then((desk) => setDiaryOpen(desk.earlier.length + desk.day.filter((line) => !line.done).length))
      .catch(() => undefined);
    void advanceDesk()
      .then((desk) => setAdvanceHeld(desk.held))
      .catch(() => undefined);
    void customerCreditDesk({ data: month })
      .then((desk) => setLiveOpen(desk.open))
      .catch(() => setLiveOpen(null));
  }, [today]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("credit-old-days"));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 365) setWarnDays(saved);
  }, []);

  return (
    <div>
      <PageHeader
        kicker="DESK"
        title={book.centreName}
        lede={today ? formatFull(today) : "Centre book"}
      />

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">Needs attention</h2>
        {attention.length > 0 ? (
          <ul className="mt-2 divide-y divide-line">
            {attention.map((item) => (
              <li key={item.text}>
                <ReviewLink item={item} />
              </li>
            ))}
          </ul>
        ) : !mounted || oldCredit.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{mounted ? "Nothing outstanding." : "Checking the book…"}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-sm">
            Credit older than
            <input
              type="number"
              min={1}
              max={365}
              aria-label="Days before a credit is shown"
              className="h-11 w-20 rounded-sm border border-line bg-bg px-3 text-right text-base tabular-nums outline-none focus:border-accent"
              value={warnDays}
              onChange={(event) => {
                const next = Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 1)));
                setWarnDays(next);
                window.localStorage.setItem("credit-old-days", String(next));
              }}
            />
            days
          </label>
          <p className="text-sm font-medium tabular-nums">{oldCredit.length === 0 ? "None" : `${oldCredit.length} · ${inr(oldTotal)}`}</p>
        </div>
        {oldCredit.length > 0 ? (
          <ul className="divide-y divide-line">
            {oldCredit.slice(0, 8).map((line) => (
              <li key={`${line.date}-${line.customer}-${line.balance}`}>
                <ReviewLink
                  item={{
                    tone: "bad",
                    text: `${line.customer || "A customer"} still owes ${inr(line.balance)} from ${formatDay(line.date)}${line.staff ? `, ${line.staff}` : ""}.`,
                    to: "/credit",
                  }}
                />
              </li>
            ))}
            {oldCredit.length > 8 ? (
              <li>
                <ReviewLink item={{ tone: "warn", text: `${oldCredit.length - 8} more credits are older than ${warnDays} days.`, to: "/credit" }} />
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatusLink
          to="/collections"
          search={{ m: month }}
          label="Today"
          value={mounted ? (imported == null ? (today && isSunday(today) ? "Sunday" : "Not in") : inr(imported)) : "—"}
          hint={mounted ? (imported == null ? (today && isSunday(today) ? "Holiday" : "No charges yet") : "From the counter") : "Collection"}
          tone={mounted && imported == null && !(today && isSunday(today)) ? "warn" : "ink"}
        />
        <StatusLink
          to="/closing"
          search={{ d: today || `${month}-01` }}
          label="Closing"
          value={mounted ? closeWord.value : "—"}
          hint={mounted ? closeWord.hint : "Notes and wallets"}
          tone={mounted ? closeWord.tone : "ink"}
        />
        <StatusLink
          to="/closing"
          search={{ d: lines.at(-1)?.date || today || `${month}-01` }}
          label="Still open"
          value={mounted ? (shortOpen || excessOpen ? signedInr(shortOpen + excessOpen) : "Clear") : "—"}
          hint={
            mounted
              ? shortOpen || excessOpen
                ? `Short ${inr(Math.abs(shortOpen))} · Excess ${inr(excessOpen)}`
                : "No short or excess left"
              : "Accounts"
          }
          tone={mounted && shortOpen < 0 ? "bad" : mounted && excessOpen > 0 ? "warn" : "ink"}
        />
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Net collection" value={inr(snap.collection)} />
        <Stat label="Expenses" value={inr(snap.expense)} />
        <Stat label="Staff salary" value={inr(snap.salary)} />
        <Stat
          label="Margin"
          value={inr(snap.margin)}
          tone={snap.margin < 0 ? "bad" : "good"}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-surface p-5 lg:col-span-3">
          <h2 className="font-display text-2xl">This year, month by month</h2>
          <div className="print-chart mt-3 h-52">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} barCategoryGap={8}>
                  <XAxis dataKey="label" tick={{ fill: chartColors.faint, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: chartColors.line }}
                    formatter={(value) => [inr(Number(value)), "Collection"]}
                    contentStyle={{ border: `1px solid ${chartColors.line}`, borderRadius: 8, background: chartColors.surface }}
                  />
                  <Bar dataKey="amount" fill={chartColors.accent} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="font-display text-2xl">Staff</h2>
          <ul className="mt-3 divide-y divide-line">
            {rows.length === 0 ? <li className="py-3 text-sm text-muted">Add staff from Salary.</li> : null}
            {rows.map((row) => {
              const mark = onLeave.find((item) => item.employeeId === row.employee.id);
              return (
                <li key={row.employee.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium">{row.employee.name}</p>
                    <p className="text-xs text-faint">{mark ? leaveWord(mark.code) : row.employee.role}</p>
                  </div>
                  <p className="text-lg font-medium tabular-nums">{inr(row.collection)}</p>
                </li>
              );
            })}
          </ul>
          <Link to="/salary" search={{ m: month }} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent">
            Work out salary
          </Link>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/closing" search={{ d: today || `${month}-01` }} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
          <CardText title="Closing" value={mounted ? closeWord.value : "—"} note="Cash, wallets and bank" />
        </Link>
        <Link to="/expenses" search={{ m: month }} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
          <CardText title="Expenses" value={snap.expense > 0 ? inr(snap.expense) : "—"} note="Bills for this month" />
        </Link>
        <Link to="/centre" className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
          <CardText title="Centre month" value={snap.collection > 0 ? inr(snap.collection) : "—"} note="Collection and margin" />
        </Link>
        <Link to="/reports" className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
          <CardText title="Reports" value={inr(snap.margin)} note="Each month and each person" />
        </Link>
      </section>
    </div>
  );
}

function StatusLink({
  to,
  search,
  label,
  value,
  hint,
  tone,
}: {
  to: "/collections" | "/closing";
  search: { m: string } | { d: string };
  label: string;
  value: string;
  hint: string;
  tone: "ink" | "warn" | "bad";
}) {
  return (
    <Link
      to={to}
      search={search}
      className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong"
    >
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className={cn("mt-2 font-display text-4xl tabular-nums", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
    </Link>
  );
}

type ReviewItem =
  | { text: string; tone: "bad" | "warn"; to: "/collections"; search: { m: string } }
  | { text: string; tone: "bad" | "warn"; to: "/closing"; search: { d: string } }
  | { text: string; tone: "bad" | "warn"; to: "/leave" }
  | { text: string; tone: "warn"; to: "/diary" }
  | { text: string; tone: "bad" | "warn"; to: "/credit" };

function ReviewLink({ item }: { item: ReviewItem }) {
  const className = cn("flex min-h-11 items-center py-2 text-sm", item.tone === "bad" ? "text-bad" : "text-ink");
  if (item.to === "/collections") {
    return (
      <Link to="/collections" search={item.search} className={className}>
        {item.text}
      </Link>
    );
  }
  if (item.to === "/closing") {
    return (
      <Link to="/closing" search={item.search} className={className}>
        {item.text}
      </Link>
    );
  }
  if (item.to === "/diary") {
    return (
      <Link to="/diary" className={className}>
        {item.text}
      </Link>
    );
  }
  if (item.to === "/credit") {
    return (
      <Link to="/credit" className={className}>
        {item.text}
      </Link>
    );
  }
  return (
    <Link to="/leave" className={className}>
      {item.text}
    </Link>
  );
}

function morningReview(
  book: { days: CollectionDay[]; holidays: string[]; cashCloses: CashClose[]; employees: Employee[]; leaves: LeaveMark[]; payouts?: { date: string; amount: number }[] },
  today: string,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const holidays = new Set(book.holidays);
  const counterDays = book.days
    .filter((day) => day.amount > 0 && /entered on the counter/i.test(day.note))
    .map((day) => day.date)
    .sort();
  const counterStart = counterDays[0] ?? today;
  const missing: string[] = [];
  let cursor = addDays(today, -1);
  for (let step = 0; step < 12 && missing.length < 3; step += 1) {
    if (cursor < counterStart) break;
    if (!isSunday(cursor) && !holidays.has(cursor) && aewsCollection(book.days, cursor) == null) missing.push(cursor);
    cursor = addDays(cursor, -1);
  }
  if (missing.length > 0) {
    items.push({
      tone: "warn",
      text: missing.length === 1 ? `No charges on ${formatDay(missing[0] ?? today)}.` : `No charges: ${missing.map((date) => formatDay(date)).join(", ")}.`,
      to: "/collections",
      search: { m: missing[0]?.slice(0, 7) ?? today.slice(0, 7) },
    });
  }

  const yesterday = addDays(today, -1);
  if (!isSunday(yesterday) && !holidays.has(yesterday)) {
    const close = book.cashCloses.find((row) => row.date === yesterday);
    if (!close) {
      items.push({ tone: "warn", text: "Yesterday was not closed.", to: "/closing", search: { d: yesterday } });
    } else {
      const check = checkClose(close, book.cashCloses, book.days, book.holidays, book.payouts ?? []);
      const who = close.countedBy ? ` Counted by ${close.countedBy}.` : "";
      if (check.missing.length > 0) {
        items.push({ tone: "warn", text: `Yesterday’s closing is waiting for the counter.${who}`, to: "/closing", search: { d: yesterday } });
      } else if ((check.unfixed ?? 0) < 0) {
        items.push({
          tone: "bad",
          text: `Yesterday was short by ${inr(Math.abs(check.unfixed ?? 0))}.${who}`,
          to: "/closing",
          search: { d: yesterday },
        });
      } else if ((check.unfixed ?? 0) > 0) {
        items.push({ tone: "warn", text: `Yesterday was excess by ${inr(check.unfixed ?? 0)}.${who}`, to: "/closing", search: { d: yesterday } });
      }
    }
  }

  const lastWorking = (() => {
    let day = addDays(today, -1);
    for (let step = 0; step < 8; step += 1) {
      if (!isSunday(day) && !holidays.has(day)) return day;
      day = addDays(day, -1);
    }
    return "";
  })();
  const worked = lastWorking ? book.days.find((day) => day.date === lastWorking && day.amount > 0 && /entered on the counter/i.test(day.note)) : undefined;
  if (worked) {
    const planned = new Set(book.leaves.filter((mark) => mark.date === worked.date && mark.code !== "HD").map((mark) => mark.employeeId));
    const absent = book.employees.filter((employee) => employee.active && (worked.splits[employee.id] ?? 0) <= 0 && !planned.has(employee.id));
    if (absent.length > 0) {
      const names = absent
        .slice(0, 4)
        .map((employee) => employee.name)
        .join(", ");
      const more = absent.length > 4 ? ` and ${absent.length - 4} more` : "";
      items.push({
        tone: "warn",
        text: `On ${formatDay(worked.date)}, ${names}${more} collected nothing and were not on leave.`,
        to: "/leave",
      });
    }
  }

  return items;
}

function closeWordOf(check: ReturnType<typeof checkClose> | null): { value: string; hint: string; tone: "ink" | "warn" | "bad" } {
  if (!check) return { value: "Not closed", hint: "Count the notes", tone: "warn" };
  if (check.last == null) return { value: "Saved", hint: "First closing", tone: "ink" };
  if (check.missing.length > 0) return { value: "Waiting", hint: "Import missing days", tone: "warn" };
  if (check.difference === 0) return { value: "Balanced", hint: "Matches the counter", tone: "ink" };
  if ((check.unfixed ?? 0) < 0) return { value: inr(Math.abs(check.unfixed ?? 0)), hint: "Short", tone: "bad" };
  if ((check.unfixed ?? 0) > 0) return { value: inr(check.unfixed ?? 0), hint: "Excess", tone: "warn" };
  return { value: "Fixed", hint: "Explained", tone: "ink" };
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className={`mt-2 font-display text-4xl tabular-nums ${tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function CardText({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <>
      <p className="text-xs font-semibold tracking-widest text-faint">{title.toUpperCase()}</p>
      <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
      <p className="mt-2 text-sm text-muted">{note}</p>
    </>
  );
}

function leaveWord(code: string): string {
  if (code === "CL") return "Casual leave today";
  if (code === "SL") return "Sick leave today";
  if (code === "LWP") return "Unpaid leave today";
  if (code === "WO") return "Weekly off today";
  return "Half day today";
}
