import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { myRole } from "@/lib/centre.functions";
import {
  centreSnapshot,
  DESK_LABEL,
  deskOf,
  monthCollection,
  monthNote,
  recordedAttendance,
  staffMonthRows,
  workingDaysInMonth,
} from "@/lib/ledger/calc";
import { addMonths, datesInMonth, formatMonth, isSunday } from "@/lib/ledger/dates";
import { useLedger } from "@/lib/ledger/store";
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

  useEffect(() => {
    void myRole()
      .then((result) => setRole(result.role === "admin" ? "admin" : "employee"))
      .catch(() => setRole("employee"));
  }, []);

  const people = book.employees.filter((employee) => employee.active);
  const own = people.find((employee) => employee.name.trim().toLowerCase() === (user?.displayName ?? "").trim().toLowerCase());
  const selected = role === "admin" ? (people.find((employee) => employee.id === picked) ?? people[0]) : own;
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
  );
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
  ).growthPct;
  const through = today && today.startsWith(month) ? today : (datesInMonth(month).at(-1) ?? `${month}-28`);
  const pace = {
    elapsed: workedDays(month, book.holidays, through),
    monthDays: workingDaysInMonth(month, book.holidays),
    lastDays: workingDaysInMonth(priorMonth, book.holidays),
    inProgress: Boolean(today && today.startsWith(month)),
  };
  const attendance = selected ? recordedAttendance(book.days, book.leaves, selected.id, month, book.holidays) : null;
  const presentPct = attendance && attendance.working > 0 ? (attendance.present / attendance.working) * 100 : null;
  const card = selected ? monthNote(selected, rows, priorRows, presentPct, centreGrowthPct, pace) : null;

  return (
    <div>
      <PageHeader
        kicker="NOTE"
        title={selected ? selected.name : "Month note"}
        lede={role === "admin" ? "What each person sees on their own login. No amounts." : "Your month. Share of your desk, your pace, and the centre."}
        actions={
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
        }
      />
      {!selected || !card ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">Your name is not on the staff list yet.</p>
      ) : (
        <article className="mx-auto mt-2 max-w-xl rounded-xl border border-line bg-surface p-6">
          <div className="no-print mb-4">
            <Button
              onClick={() =>
                void downloadMonthNote({
                  centre: book.centreName,
                  name: selected.name,
                  month: formatMonth(month),
                  desk: DESK_LABEL[card.desk],
                  sentence: card.sentence,
                  lines: card.lines,
                })
              }
            >
              Download image
            </Button>
          </div>
          <img src="/akshaya-logo.png" alt="" className="mx-auto h-auto w-20" />
          <p className="mt-3 text-center text-sm text-muted">{book.centreName}</p>
          <h2 className="text-center font-display text-3xl">{selected.name}</h2>
          <p className="text-center text-sm text-muted">
            {formatMonth(month)} · {DESK_LABEL[deskOf(selected)]}
          </p>
          <p className="mt-4 text-sm">{card.sentence}</p>
          <dl className="mt-4 border-t border-line">
            {card.lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                <dt className="text-sm text-muted">{line.label}</dt>
                <dd className="font-display text-2xl tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
        </article>
      )}
    </div>
  );
}

function workedDays(month: string, holidays: string[], through: string): number {
  const closed = new Set(holidays);
  return datesInMonth(month).filter((date) => date <= through && !isSunday(date) && !closed.has(date)).length;
}

function downloadMonthNote(note: {
  centre: string;
  name: string;
  month: string;
  desk: string;
  sentence: string;
  lines: { label: string; value: string }[];
}): Promise<void> {
  return Promise.all([document.fonts.load("600 72px Newsreader"), loadLogo("/akshaya-logo.png")]).then(([, logo]) => {
    const width = 1080;
    const pad = 80;
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
    const sentenceLines = wrap(note.sentence, sentenceFont, width - pad * 2);
    const logoW = 220;
    const logoH = logo ? (logo.height / logo.width) * logoW : 0;
    canvas.width = width;
    canvas.height = 88 + logoH + 280 + sentenceLines.length * 52 + note.lines.length * 120;
    ctx.fillStyle = "#fbfaf7";
    ctx.fillRect(0, 0, width, canvas.height);
    let y = 72;
    if (logo) {
      ctx.drawImage(logo, (width - logoW) / 2, y, logoW, logoH);
      y += logoH + 40;
    }
    ctx.fillStyle = "#5c574f";
    ctx.font = "500 28px \"Source Sans 3\", sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(note.centre, width / 2, y);
    y += 78;
    ctx.fillStyle = "#1c1b19";
    ctx.font = "600 72px Newsreader, Georgia, serif";
    ctx.fillText(note.name, width / 2, y);
    y += 52;
    ctx.fillStyle = "#5c574f";
    ctx.font = "500 32px \"Source Sans 3\", sans-serif";
    ctx.fillText(`${note.month} · ${note.desk}`, width / 2, y);
    y += 72;
    ctx.textAlign = "left";
    ctx.fillStyle = "#1c1b19";
    ctx.font = sentenceFont;
    for (const line of sentenceLines) {
      ctx.fillText(line, pad, y);
      y += 52;
    }
    y += 20;
    for (const line of note.lines) {
      ctx.strokeStyle = "#e3ddd3";
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
      y += 64;
      ctx.fillStyle = "#5c574f";
      ctx.font = "500 30px \"Source Sans 3\", sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(line.label, pad, y);
      ctx.fillStyle = "#1e6b43";
      ctx.font = "600 48px Newsreader, Georgia, serif";
      ctx.textAlign = "right";
      ctx.fillText(line.value, width - pad, y);
      y += 72;
    }
    const file = `${note.name}-${note.month}`.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.download = `${file || "month-note"}.jpg`;
    link.click();
  });
}

function loadLogo(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
