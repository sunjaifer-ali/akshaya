import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { personalGpaySpan, type GpayLine } from "@/lib/centre.functions";
import { useRefresh } from "@/lib/use-refresh";
import { downloadWorkbook } from "@/lib/excel";
import { inr } from "@/lib/format";
import { formatDay } from "@/lib/ledger/dates";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/gpay")({
  component: GpayPage,
});

function GpayPage() {
  const today = useTodayKey();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [lines, setLines] = useState<GpayLine[]>([]);
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const start = from || today;
  const end = to || today;
  const service = lines.reduce((sum, line) => sum + line.amount, 0);
  const department = lines.reduce((sum, line) => sum + line.department, 0);

  useRefresh(() => {
    if (!start || !end) return;
    return personalGpaySpan({ data: { from: start, to: end } })
      .then((book) => {
        setRole(book.role === "admin" ? "admin" : "employee");
        setLines(book.lines);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Personal GPay did not open."));
  }, 15000, [start, end]);

  return (
    <div>
      <PageHeader
        kicker="PAYMENTS"
        title="Personal GPay Payments"
        actions={
          role === "admin" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="From" className="h-11 rounded-sm border border-line bg-bg px-3 text-base" value={start} onChange={(event) => setFrom(event.target.value)} />
              <input type="date" aria-label="To" className="h-11 rounded-sm border border-line bg-bg px-3 text-base" value={end} onChange={(event) => setTo(event.target.value)} />
              <Button
                variant="secondary"
                disabled={downloading || lines.length === 0}
                onClick={() => {
                  setDownloading(true);
                  void downloadWorkbook(`Personal-GPay-${start}-to-${end}.xlsx`, [
                    {
                      name: "Personal GPay",
                      rows: [
                        ["Date", "Customer", "Mobile", "Staff", "Service", "Service charge", "Department", "Total"],
                        ...lines.map((line) => [line.date, line.customer, line.mobile, line.staff, line.service, line.amount, line.department, line.amount + line.department]),
                      ],
                    },
                  ])
                    .then(() => setResult({ ok: true, message: "Personal GPay downloaded." }))
                    .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "The file was not downloaded." }))
                    .finally(() => setDownloading(false));
                }}
              >
                {downloading ? "Downloading…" : "Download"}
              </Button>
            </div>
          ) : null
        }
      />
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="Service charge" value={inr(service)} />
        <Figure label="Department" value={inr(department)} />
        <Figure label="On the phone" value={inr(service + department)} />
      </section>
      <p className="mt-3 text-sm text-muted">{role === "admin" ? `${formatDay(start)} to ${formatDay(end)}` : "Today only"}</p>
      <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        {notice ? <p className="px-4 py-3 text-sm text-bad">{notice}</p> : null}
        {lines.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No personal GPay in this period.</p> : null}
        {lines.length > 0 ? (
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-widest text-faint">
                <th className="px-3 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Staff</th>
                <th className="px-3 py-3 text-right font-medium">Service</th>
                <th className="px-3 py-3 text-right font-medium">Department</th>
                <th className="px-3 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={`${line.date}-${line.customer}-${index}`} className="border-t border-line">
                  <td className="px-3 py-3 tabular-nums">{formatDay(line.date)}</td>
                  <td className="px-3 py-3">
                    {line.customer}
                    {line.mobile ? <span className="mt-0.5 block text-xs text-faint">{line.mobile}</span> : null}
                  </td>
                  <td className="px-3 py-3">{line.staff}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{inr(line.amount)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{inr(line.department)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{inr(line.amount + line.department)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-xs font-semibold tracking-widest text-faint">{label.toUpperCase()}</p>
      <p className="mt-1 font-display text-4xl tabular-nums">{value}</p>
    </div>
  );
}
