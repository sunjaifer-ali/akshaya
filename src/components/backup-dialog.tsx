import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { exportArchiveSlice, importArchivePart, listBackups, restoreBackup } from "@/lib/centre.functions";
import { useLedger } from "@/lib/ledger/store";
import type { LedgerData } from "@/lib/ledger/types";

export function BackupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const book = useLedger();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Result | null>(null);
  const setNotice = (message: string) => {
    const ok = !/not a centre|could not/i.test(message);
    setResult({ ok, message });
  };
  const [backups, setBackups] = useState<{ id: string; takenOn: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    void listBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Backup"
      description="Neon keeps the last 7 days. Download a file each month and keep it in Google Drive."
    >
      <div className="grid gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void downloadArchive(book.centreName)
              .then(() => setNotice("Book downloaded, including the counter, credit, advances, and payments."))
              .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "The book was not downloaded."));
          }}
        >
          Download book
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Restore a downloaded book
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            try {
              const parsed = JSON.parse(await file.text()) as unknown;
              const saved = await restoreArchive(parsed);
              book.replaceBook(asBook(saved.book));
              setNotice("Book restored. Counter, credit, advances, and payments are included.");
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Could not read that file.");
            }
          }}
        />
      </div>
      <div className="mt-4 rounded-lg border border-line p-3">
        <p className="text-sm font-medium">Saved copies</p>
        <p className="mt-1 text-xs text-muted">The last 7 days. Restore puts that day's closing back. Your downloaded file is the long copy.</p>
        {backups.length === 0 ? <p className="mt-2 text-sm text-muted">No copy yet. It is saved the next time the book changes.</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {backups.map((copy) => (
            <li key={copy.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{copy.takenOn}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void restoreBackup({ data: copy.id })
                    .then((saved) => {
                      book.replaceBook(saved.book);
                      setNotice(`Restored the copy from ${copy.takenOn}.`);
                    })
                    .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not restore that copy."));
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </Modal>
  );
}

function asBook(data: LedgerData): LedgerData {
  return {
    centreName: data.centreName,
    deductLwp: data.deductLwp !== false,
    sample: false,
    sampleBanner: false,
    employees: data.employees,
    days: data.days,
    categories: data.categories,
    expenses: data.expenses,
    leaves: data.leaves,
    holidays: data.holidays,
    perfOverrides: data.perfOverrides,
    lyOverrides: data.lyOverrides ?? {},
    cashCloses: data.cashCloses ?? [],
    salaryPaid: data.salaryPaid ?? [],
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "centre";
}

async function downloadArchive(centreName: string): Promise<void> {
  const file: { kind: string; version: number; book?: unknown; services: unknown[]; credits: unknown[]; advances: unknown[]; diary: unknown[] } = {
    kind: "akshaya-thrikkadeeri-book",
    version: 2,
    services: [],
    credits: [],
    advances: [],
    diary: [],
  };
  const head = await exportArchiveSlice({ data: { section: "book", offset: 0 } });
  file.book = head.book;
  for (const section of ["services", "credits", "advances", "diary"] as const) {
    let offset = 0;
    for (;;) {
      const part = await exportArchiveSlice({ data: { section, offset } });
      file[section].push(...part.rows);
      if (part.done || part.rows.length === 0) break;
      offset += part.rows.length;
    }
  }
  downloadJson(`${slug(centreName)}-book.json`, file);
}

async function restoreArchive(parsed: unknown): Promise<{ book: LedgerData }> {
  const file = parsed && typeof parsed === "object" ? (parsed as { book?: unknown; services?: unknown; credits?: unknown; advances?: unknown; diary?: unknown }) : {};
  const book = file.book ?? parsed;
  await sendPart("services", file.services);
  await sendPart("credits", file.credits);
  await sendPart("advances", file.advances);
  await sendPart("diary", file.diary);
  const saved = await importArchivePart({ data: { section: "book", book } });
  if (!saved.book) throw new Error("Could not read that file.");
  return { book: saved.book };
}

async function sendPart(section: "services" | "credits" | "advances" | "diary", rows: unknown): Promise<void> {
  if (!Array.isArray(rows)) return;
  if (rows.length === 0) {
    await importArchivePart({ data: { section, first: true, rows: [] } });
    return;
  }
  for (let index = 0; index < rows.length; index += 400) {
    await importArchivePart({ data: { section, first: index === 0, rows: rows.slice(index, index + 400) } });
  }
}

function downloadJson(filename: string, file: unknown): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
