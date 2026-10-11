import { createFileRoute, Link } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { chartColors } from "@/lib/chart-colors";
import { cn } from "@/lib/cn";
import { inr, pct, signedInr } from "@/lib/format";
import { accountLines, aewsCollection, checkClose, unpaidCreditReport } from "@/lib/ledger/cash";
import { centreSnapshot, monthCollection, staffMonthRows } from "@/lib/ledger/calc";
import { addDays, formatDay, formatFull, formatMonth, formatMonthShort, fyMonths, fyStartYear, isSunday } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
import type { CashClose, CollectionDay, Employee, LeaveMark } from "@/lib/ledger/types";
import { useMounted } from "@/lib/use-mounted";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/")({ component: DeskPage });

function DeskPage() {
  const today = useTodayKey();
  const month = today ? today.slice(0, 7) : "2026-10";
  const book = useLedger();
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
  const top = [...rows].sort((a, b) => b.collection - a.collection)[0];
  const onLeave = today
    ? book.leaves.filter((mark) => mark.date === today && mark.code !== "HD")
    : [];
  const points = fyMonths(fyStartYear(month))
    .filter((item) => item <= month)
    .map((item) => ({
      label: formatMonthShort(item),
      amount: monthCollection(book.days, item),
    }));

  const lines = accountLines(book.cashCloses, book.days, book.holidays).filter((line) => line.unfixed !== 0);
  const shortOpen = lines.filter((line) => line.unfixed < 0).reduce((sum, line) => sum + line.unfixed, 0);
  const excessOpen = lines.filter((line) => line.unfixed > 0).reduce((sum, line) => sum + line.unfixed, 0);
  const imported = today ? aewsCollection(book.days, today) : null;
  const close = today ? book.cashCloses.find((row) => row.date === today) : undefined;
  const check = close ? checkClose(close, book.cashCloses, book.days, book.holidays) : null;
  const closeWord = closeWordOf(check);
  const review = today ? morningReview(book, today) : [];

  return (
    <div>
      <PageHeader
        kicker="DESK"
        title={book.centreName}
        lede={today ? formatFull(today) : "Centre book"}
      />

      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">Needs attention</h2>
        {!mounted || review.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{mounted ? "Nothing outstanding." : "Checking the book…"}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {review.map((item) => (
              <li key={item.text}>
                <ReviewLink item={item} />
              </li>
            ))}
          </ul>
        )}
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
        <Stat label="Net collection" value={inr(snap.collection)} hint={snap.collection > 0 ? formatMonth(month) : "Month total not entered"} />
        <Stat label="Expenses" value={inr(snap.expense)} hint={snap.expense > 0 ? `${pct(snap.expensePct)} of collection` : "Not entered yet"} />
        <Stat label="Staff salary" value={inr(snap.salary)} hint={snap.collection > 0 ? `${pct(snap.salaryPct)} of collection` : "This month"} />
        <Stat
          label="Margin"
          value={inr(snap.margin)}
          hint={
            snap.collection <= 0 || snap.growthPct == null
              ? "After expenses and pay"
              : `${signedInr(snap.growth)} vs ${snap.lastYearPartial ? "same dates last year" : "last year"}`
          }
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
          {top && top.collection > 0 ? (
            <p className="mt-1 text-sm text-muted">
              {top.employee.name} leads with {inr(top.collection)}, {pct(top.sharePct)} of the centre.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">Collection by person shows once the month has figures.</p>
          )}
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
                  <p className="text-sm tabular-nums">{inr(row.collection)}</p>
                </li>
              );
            })}
          </ul>
          <Link to="/salary" search={{ m: month }} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-accent">
            Work out salary
          </Link>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link to="/closing" search={{ d: today || `${month}-01` }} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
          <p className="font-medium">Closing</p>
          <p className="mt-1 text-sm text-muted">{mounted && close ? closeWord.hint : "Count notes, wallets, and credit"}</p>
        </Link>
        <Jump to="/expenses" title="Expenses" text={snap.expense > 0 ? `${inr(snap.expense)} this month` : "Rent, power, paper, and anything else"} />
        <Jump to="/centre" title="Centre month" text={snap.collection <= 0 || snap.growthPct == null ? "Margin, cost, and growth" : `${pct(snap.growthPct)} versus ${snap.lastYearPartial ? "the same dates last year" : "last year"}`} />
        <Jump to="/reports" title="Reports" text="Centre, staff, pay, expenses, and leave together" />
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
      <p className={cn("mt-2 font-display text-3xl tabular-nums", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </Link>
  );
}

type ReviewItem =
  | { text: string; tone: "bad" | "warn"; to: "/collections"; search: { m: string } }
  | { text: string; tone: "bad" | "warn"; to: "/closing"; search: { d: string } }
  | { text: string; tone: "bad" | "warn"; to: "/leave" };

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
  return (
    <Link to="/leave" className={className}>
      {item.text}
    </Link>
  );
}

function morningReview(
  book: { days: CollectionDay[]; holidays: string[]; cashCloses: CashClose[]; employees: Employee[]; leaves: LeaveMark[] },
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
      const check = checkClose(close, book.cashCloses, book.days, book.holidays);
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

  const credit = unpaidCreditReport(
    book.cashCloses,
    (id) => book.employees.find((employee) => employee.id === id)?.name ?? "Staff",
  );
  const old = credit.lines.filter((line) => line.date && line.date <= addDays(today, -7) && line.balance > 0);
  for (const line of old.slice(0, 4)) {
    const who = line.customer || "A customer";
    const staff = line.staff ? `, ${line.staff}` : "";
    items.push({
      tone: "bad",
      text: `${who} still owes ${inr(line.balance)} from ${formatDay(line.date)}${staff}.`,
      to: "/closing",
      search: { d: line.date },
    });
  }
  if (old.length > 4) {
    items.push({
      tone: "warn",
      text: `${old.length - 4} more credits are over a week old.`,
      to: "/closing",
      search: { d: old[4]?.date ?? today },
    });
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
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className={`mt-2 font-display text-3xl tabular-nums ${tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Jump({ to, title, text }: { to: "/expenses" | "/centre" | "/reports"; title: string; text: string }) {
  return (
    <Link to={to} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </Link>
  );
}

function leaveWord(code: string): string {
  if (code === "CL") return "Casual leave today";
  if (code === "SL") return "Sick leave today";
  if (code === "LWP") return "Unpaid leave today";
  if (code === "WO") return "Weekly off today";
  return "Half day today";
}
