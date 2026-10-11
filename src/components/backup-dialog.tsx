import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { listBackups, restoreBackup } from "@/lib/centre.functions";
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
      description="A copy is kept each day the book changes. Download a file for the Google Drive folder."
    >
      <div className="grid gap-2">
        <Button variant="secondary" onClick={() => downloadJson(`${slug(book.centreName)}-book.json`, book)}>
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
              const parsed = JSON.parse(await file.text()) as { book?: unknown };
              const data = parsed.book ?? parsed;
              if (!isBook(data)) {
                setNotice("That file is not a centre book.");
                return;
              }
              book.replaceBook(asBook(data));
              setNotice("Book restored.");
            } catch {
              setNotice("Could not read that file.");
            }
          }}
        />
      </div>
      <div className="mt-4 rounded-lg border border-line p-3">
        <p className="text-sm font-medium">Saved copies</p>
        <p className="mt-1 text-xs text-muted">The last 90 days. Restore puts that day back into the book.</p>
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
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "centre";
}

function downloadJson(filename: string, state: ReturnType<typeof useLedger.getState>): void {
  const book: LedgerData = {
    centreName: state.centreName,
    deductLwp: state.deductLwp,
    sample: false,
    sampleBanner: false,
    employees: state.employees,
    days: state.days,
    categories: state.categories,
    expenses: state.expenses,
    leaves: state.leaves,
    holidays: state.holidays,
    perfOverrides: state.perfOverrides,
    lyOverrides: state.lyOverrides,
    cashCloses: state.cashCloses,
  };
  const blob = new Blob([JSON.stringify({ kind: "akshaya-thrikkadeeri-book", version: 1, book }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function isBook(value: unknown): value is LedgerData {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<LedgerData>;
  return (
    typeof book.centreName === "string" &&
    Array.isArray(book.employees) &&
    Array.isArray(book.days) &&
    Array.isArray(book.categories) &&
    Array.isArray(book.leaves) &&
    Array.isArray(book.holidays) &&
    Array.isArray(book.perfOverrides) &&
    !!book.expenses &&
    typeof book.expenses === "object"
  );
}
