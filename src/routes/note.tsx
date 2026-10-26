import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLedger } from "@/lib/ledger/store";
import { addNotice, listNotices, markNoticesSeen, myRole, removeNotice } from "@/lib/centre.functions";
import { cn } from "@/lib/cn";
import {
  centreSnapshot,
  DESK_LABEL,
  deskOf,
  monthCollection,
  monthNote,
  recordedAttendance,
  staffMonthRows,
  workingDaysInMonth,
  type NoteKind,
  type NoteTone,
} from "@/lib/ledger/calc";
import { addMonths, datesInMonth, formatMonth, isSunday } from "@/lib/ledger/dates";
import { readMonth } from "@/lib/search";
import { useResolvedMonth, useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/note")({
  validateSearch: readMonth,
  component: NotePage,
});

function NotePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = useTodayKey();
  const month = useResolvedMonth(search.m || "");
  const book = useLedger();
  const { user } = useCurrentUserState();
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [picked, setPicked] = useState("");
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    void myRole()
      .then((result) => setRole(result.role === "admin" ? "admin" : "employee"))
      .catch(() => setRole("employee"));
  }, []);

  const centre = monthCollection(book.days, month);
  const rows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    month,
    centre,
    book.deductLwp,
    today,
    book.salaryPaid ?? [],
  );
  const people = rows.map((row) => row.employee);
  const own = book.employees.find((employee) => employee.name.trim().toLowerCase() === (user?.displayName ?? "").trim().toLowerCase());
  const selected = role === "admin" ? (people.find((employee) => employee.id === picked) ?? people[0]) : (people.find((employee) => employee.id === own?.id) ?? null);
  const priorMonth = addMonths(month, -1);
  const priorRows = staffMonthRows(
    book.employees,
    book.days,
    book.perfOverrides,
    book.leaves,
    book.holidays,
    priorMonth,
    monthCollection(book.days, priorMonth),
    book.deductLwp,
    "",
    book.salaryPaid ?? [],
  );
  const centreGrowthPct = centreSnapshot(
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
    book.salaryPaid ?? [],
  ).growthPct;
  const through = today && today.startsWith(month) ? today : (datesInMonth(month).at(-1) ?? `${month}-28`);
  const pace = {
    elapsed: workedDays(month, book.holidays, through),
    monthDays: workingDaysInMonth(month, book.holidays),
    lastDays: workingDaysInMonth(priorMonth, book.holidays),
    inProgress: Boolean(today && today.startsWith(month)),
  };
  const attendance = selected ? recordedAttendance(book.days, book.leaves, selected.id, month, book.holidays) : null;
  const card = selected ? monthNote(selected, rows, priorRows, attendance, centreGrowthPct, pace) : null;

  return (
    <div>
      <PageHeader
        kicker="MESSAGE"
        title="Message"
        actions={
          cardOpen ? (
          <div className="flex flex-wrap items-center gap-2">
            {role === "admin" ? (
              <select
                aria-label="Staff"
                className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={selected?.id ?? ""}
                onChange={(event) => setPicked(event.target.value)}
              >
                {people.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            ) : null}
            <MonthBar month={month} onChange={(next) => void navigate({ search: { m: next } })} />
          </div>
          ) : null
        }
      />
      <NoticeBoard admin={role === "admin"} />
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setCardOpen((open) => !open)}>
          {cardOpen ? "Hide month card" : "Month card"}
        </Button>
      </div>
      {!cardOpen ? null : !selected || !card ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">Your name is not on the staff list yet.</p>
      ) : (
        <div className="mx-auto mt-2 max-w-xl">
          <div className="no-print mb-4">
            <Button
              onClick={() =>
                void downloadMonthNote({
                  centre: book.centreName,
                  name: selected.name,
                  month: formatMonth(month),
                  desk: DESK_LABEL[card.desk],
                  sentence: card.sentence,
                  honour: card.honour,
                  lines: card.lines,
                })
              }
            >
              Download image
            </Button>
          </div>
          <article className="relative overflow-hidden rounded-xl border border-[#2e9ad6] bg-surface px-5 py-8 sm:px-8">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-accent" />
            <div className="pointer-events-none absolute inset-2.5 rounded-lg border border-[#b7d7ef]" />
            <div className="relative">
              {card.honour === "lead" ? <LeadMark /> : null}
              <img src="/akshaya-logo.png" alt="" className="mx-auto h-auto w-20" />
              <p className="mt-3 text-center text-sm text-muted">{book.centreName}</p>
              <h2 className="text-center font-display text-4xl">{selected.name}</h2>
              <p className="text-center text-sm text-muted">
                {formatMonth(month)} · {DESK_LABEL[deskOf(selected)]}
              </p>
              <p className={cn("mt-5 text-center text-base", card.honour === "lead" && "rounded-lg bg-[#d9ebf8] px-4 py-3")}>{card.sentence}</p>
              <dl className="mt-3">
                {card.lines.map((line) => (
                  <div key={line.label} className="border-b border-line py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm text-muted">{line.label}</dt>
                      <dd className={cn("font-display text-2xl tabular-nums", toneClass(line.tone))}>{line.value}</dd>
                    </div>
                    {line.kind === "share" && line.fill != null ? <Meter value={line.fill} /> : null}
                    {line.kind === "days" && line.fill != null && line.fill >= 99.5 ? (
                      <p className="mt-1 text-right text-xs font-medium tracking-wide text-accent">Every working day</p>
                    ) : null}
                  </div>
                ))}
              </dl>
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

function NoticeBoard({ admin }: { admin: boolean }) {
  const employees = useLedger((state) => state.employees);
  const people = employees.filter((person) => person.active);
  const [lines, setLines] = useState<{ id: string; body: string; author: string; to: string; at: string }[]>([]);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>(["all"]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(false);

  const load = () => {
    void listNotices()
      .then((book) => {
        setLines(book.lines);
        if (!admin && book.unread > 0) {
          setReceived(true);
          void markNoticesSeen()
            .then(() => window.dispatchEvent(new Event("messages-seen")))
            .catch(() => undefined);
        }
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Messages did not open."));
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = (id: string) => {
    setPicked((current) => {
      if (id === "all") return current.includes("all") ? [] : ["all"];
      const rest = current.filter((item) => item !== "all");
      return rest.includes(id) ? rest.filter((item) => item !== id) : [...rest, id];
    });
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      {admin ? (
        <form
          className="mb-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked.length === 0) {
              setError("Choose who should get this message.");
              return;
            }
            setPending(true);
            setError("");
            void addNotice({ data: { body: text, to: picked } })
              .then(() => {
                setText("");
                setPicked(["all"]);
                load();
              })
              .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "The message was not sent."))
              .finally(() => setPending(false));
          }}
        >
          <textarea
            aria-label="Message to staff"
            className="min-h-24 w-full rounded-sm border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
            value={text}
            placeholder="Message to staff"
            onChange={(event) => setText(event.target.value.slice(0, 400))}
          />
          <div className="flex flex-wrap gap-2">
            <Pick on={picked.includes("all")} label="Everyone" onToggle={() => toggle("all")} />
            <Pick on={picked.includes("desk:aadhaar")} label="Aadhaar desk" onToggle={() => toggle("desk:aadhaar")} />
            <Pick on={picked.includes("desk:service")} label="Service desk" onToggle={() => toggle("desk:service")} />
            <Pick on={picked.includes("desk:support")} label="Support desk" onToggle={() => toggle("desk:support")} />
            {people.map((person) => (
              <Pick key={person.id} on={picked.includes(`staff:${person.id}`)} label={person.name} onToggle={() => toggle(`staff:${person.id}`)} />
            ))}
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      ) : null}
      {received ? <p className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">Message received</p> : null}
      {error ? <p className="mb-3 text-sm text-bad">{error}</p> : null}
      {lines.length === 0 ? <p className="text-sm text-muted">No message yet.</p> : null}
      <ul className="divide-y divide-line">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start justify-between gap-3 py-3">
            <div>
              <p className="text-base">{line.body}</p>
              <p className="mt-1 text-xs text-faint">
                {line.to} · {line.at}
              </p>
            </div>
            {admin ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void removeNotice({ data: line.id }).then(load).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Not deleted."));
                }}
              >
                Delete
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Pick({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-full border px-3 text-sm ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg text-ink"}`}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

function workedDays(month: string, holidays: string[], through: string): number {
  const closed = new Set(holidays);
  return datesInMonth(month).filter((date) => date <= through && !isSunday(date) && !closed.has(date)).length;
}

function LeadMark() {
  return (
    <div className="mb-4 flex flex-col items-center">
      <span className="grid size-16 place-items-center rounded-full border-2 border-[#1a4f9c] bg-[#d9ebf8] text-[#1a4f9c]">
        <svg viewBox="0 0 24 24" className="size-8" aria-hidden="true">
          <path fill="currentColor" d="M12 2.2 14.7 8l6.3.6-4.8 4.2 1.5 6.2L12 15.8 6.3 19l1.5-6.2L3 8.6 9.3 8z" />
        </svg>
      </span>
      <p className="mt-2 text-[11px] font-semibold tracking-[0.22em] text-[#1a4f9c]">DESK LEAD</p>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
    </div>
  );
}

function toneClass(tone: NoteTone) {
  if (tone === "good") return "text-accent";
  if (tone === "warn") return "text-warn";
  return "text-ink";
}

const NOTE_INK = { good: "#1a4f9c", warn: "#8a5a12", ink: "#102a4c" } as const;

function downloadMonthNote(note: {
  centre: string;
  name: string;
  month: string;
  desk: string;
  sentence: string;
  honour: "lead" | "even" | "room" | "own" | "soon";
  lines: { label: string; value: string; tone: NoteTone; kind: NoteKind; fill?: number }[];
}): Promise<void> {
  return Promise.all([
    document.fonts.load("600 72px Newsreader"),
    document.fonts.load("600 48px Newsreader"),
    document.fonts.load('600 28px "Source Sans 3"'),
    document.fonts.load('500 32px "Source Sans 3"'),
    loadLogo("/akshaya-logo.png"),
  ]).then(([, , , , logo]) => {
    const width = 1080;
    const pad = 88;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const wrap = (text: string, font: string, max: number) => {
      ctx.font = font;
      const lines: string[] = [];
      let line = "";
      for (const word of text.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > max && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
      return lines.length > 0 ? lines : [""];
    };
    const sentenceFont = "500 36px \"Source Sans 3\", sans-serif";
    const sentenceLines = wrap(note.sentence, sentenceFont, width - pad * 2 - 48);
    const logoW = 200;
    const logoH = logo ? (logo.height / logo.width) * logoW : 0;
    const lead = note.honour === "lead";
    const step = (line: (typeof note.lines)[number]) => {
      const share = line.kind === "share" && line.fill != null;
      const full = line.kind === "days" && (line.fill ?? 0) >= 99.5;
      return 58 + (share ? 22 : 0) + (full ? 36 : 0) + (share || full ? 52 : 74);
    };
    let content = 88 + (lead ? 208 : 0) + (logo ? logoH + 36 : 0) + 190 + sentenceLines.length * 54 + (lead ? 28 : 16);
    for (const line of note.lines) content += step(line);
    canvas.width = width;
    canvas.height = content + 84;
    ctx.fillStyle = "#f4f9fd";
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = "#1a4f9c";
    ctx.fillRect(0, 0, width, 16);
    ctx.strokeStyle = "#2e9ad6";
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 40, width - 72, canvas.height - 76);
    ctx.strokeStyle = "#b7d7ef";
    ctx.lineWidth = 1;
    ctx.strokeRect(48, 52, width - 96, canvas.height - 100);
    ctx.fillStyle = "#2e9ad6";
    diamond(ctx, 36, 40, 6);
    diamond(ctx, width - 36, 40, 6);
    diamond(ctx, 36, canvas.height - 36, 6);
    diamond(ctx, width - 36, canvas.height - 36, 6);

    let y = 88;
    if (lead) {
      drawMedal(ctx, width / 2, y + 58);
      y += 160;
      ctx.fillStyle = "#1a4f9c";
      ctx.font = "600 22px \"Source Sans 3\", sans-serif";
      ctx.textAlign = "center";
      trackText(ctx, "DESK LEAD", width / 2, y, 6);
      y += 48;
    }
    if (logo) {
      ctx.drawImage(logo, (width - logoW) / 2, y, logoW, logoH);
      y += logoH + 36;
    }
    ctx.fillStyle = "#3e5874";
    ctx.font = "500 28px \"Source Sans 3\", sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(note.centre, width / 2, y);
    y += 78;
    ctx.fillStyle = "#102a4c";
    ctx.font = "600 72px Newsreader, Georgia, serif";
    ctx.fillText(note.name, width / 2, y);
    y += 48;
    ctx.fillStyle = "#3e5874";
    ctx.font = "500 32px \"Source Sans 3\", sans-serif";
    ctx.fillText(`${note.month} · ${note.desk}`, width / 2, y);
    y += 64;
    if (lead) {
      const bandH = sentenceLines.length * 54 + 28;
      roundRect(ctx, pad, y - 36, width - pad * 2, bandH, 16);
      ctx.fillStyle = "#d9ebf8";
      ctx.fill();
    }
    ctx.fillStyle = "#102a4c";
    ctx.font = sentenceFont;
    ctx.textAlign = "center";
    for (const line of sentenceLines) {
      ctx.fillText(line, width / 2, y);
      y += 54;
    }
    y += lead ? 28 : 16;
    for (const line of note.lines) {
      ctx.strokeStyle = "#c5d9ec";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
      y += 58;
      ctx.fillStyle = "#3e5874";
      ctx.font = "500 30px \"Source Sans 3\", sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(line.label, pad, y);
      ctx.fillStyle = NOTE_INK[line.tone];
      ctx.font = "600 48px Newsreader, Georgia, serif";
      ctx.textAlign = "right";
      ctx.fillText(line.value, width - pad, y);
      if (line.kind === "share" && line.fill != null) {
        y += 22;
        const barW = 280;
        roundRect(ctx, pad, y, barW, 10, 5);
        ctx.fillStyle = "#d7e8f6";
        ctx.fill();
        roundRect(ctx, pad, y, Math.max(12, barW * (line.fill / 100)), 10, 5);
        ctx.fillStyle = "#1a4f9c";
        ctx.fill();
      }
      if (line.kind === "days" && line.fill != null && line.fill >= 99.5) {
        y += 36;
        ctx.fillStyle = "#1a4f9c";
        ctx.font = "600 22px \"Source Sans 3\", sans-serif";
        ctx.textAlign = "right";
        ctx.fillText("Every working day", width - pad, y);
      }
      y += line.kind === "share" || (line.kind === "days" && (line.fill ?? 0) >= 99.5) ? 52 : 74;
    }
    const file = `${note.name}-${note.month}`.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.download = `${file || "month-note"}.jpg`;
    link.click();
  });
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function trackText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number) {
  const align = ctx.textAlign;
  ctx.textAlign = "left";
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (chars.length - 1);
  let cursor = x - total / 2;
  chars.forEach((char, index) => {
    ctx.fillText(char, cursor, y);
    cursor += widths[index] + gap;
  });
  ctx.textAlign = align;
}

function drawMedal(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy + 8);
  ctx.lineTo(cx - 10, cy + 64);
  ctx.lineTo(cx, cy + 48);
  ctx.lineTo(cx + 10, cy + 64);
  ctx.lineTo(cx + 26, cy + 8);
  ctx.closePath();
  ctx.fillStyle = "#1a4f9c";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - 6, 46, 0, Math.PI * 2);
  ctx.fillStyle = "#d9ebf8";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#1a4f9c";
  ctx.stroke();
  ctx.beginPath();
  const outer = 22;
  const inner = 9;
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy - 6 + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#1a4f9c";
  ctx.fill();
}

function loadLogo(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
