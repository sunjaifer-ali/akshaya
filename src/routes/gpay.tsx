import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MonthBar } from "@/components/month-bar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { personalGpayMonth, type GpayLine } from "@/lib/centre.functions";
import { useRefresh } from "@/lib/use-refresh";
import { downloadWorkbook } from "@/lib/excel";
import { inr } from "@/lib/format";
import { formatDay, formatMonth } from "@/lib/ledger/dates";
import { readMonth } from "@/lib/search";
import { useResolvedMonth } from "@/lib/use-today";

export const Route = createFileRoute("/gpay")({
  validateSearch: readMonth,
  component: GpayPage,
});

function GpayPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = useResolvedMonth(search.m ?? "");
  const [lines, setLines] = useState<GpayLine[]>([]);
  const [notice, setNotice] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const service = lines.reduce((sum, line) => sum + line.amount, 0);
  const department = lines.reduce((sum, line) => sum + line.department, 0);

  useRefresh(() => {
    return personalGpayMonth({ data: month })
      .then((book) => setLines(book.lines))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Personal GPay did not open."));
  }, 15000, [month]);

  return (
    <div>
      <PageHeader
        kicker="GPAY"
        title="Personal GPay"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={downloading || lines.length === 0}
              onClick={() => {
                setDownloading(true);
                void downloadWorkbook(`Personal-GPay-${month}.xlsx`, [
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
            <MonthBar
              month={month}
              onChange={(next) => {
                void navigate({ search: { m: next } });
              }}
            />
          </div>
        }
      />
      <section className="grid gap-3 sm:grid-cols-3">
        <Figure label="Service charge" value={inr(service)} />
        <Figure label="Department" value={inr(department)} />
        <Figure label="On your phone" value={inr(service + department)} />
      </section>
      <section className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
        {notice ? <p className="px-4 py-3 text-sm text-bad">{notice}</p> : null}
        {lines.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No personal GPay in {formatMonth(month)}.</p> : null}
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
