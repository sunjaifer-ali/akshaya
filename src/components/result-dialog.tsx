import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export type Result = { ok: boolean; message: string };

export function ResultDialog({ result, onClose }: { result: Result | null; onClose: () => void }) {
  useEffect(() => {
    if (!result?.ok) return;
    const timer = window.setTimeout(onClose, 1600);
    return () => window.clearTimeout(timer);
    // The parent passes a new onClose each render. Restart only when the message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.ok, result?.message]);

  if (!result) return null;
  if (result.ok) {
    return (
      <p className="no-print fixed bottom-20 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-center text-sm text-accent-ink shadow md:bottom-6">
        {result.message}
      </p>
    );
  }
  return (
    <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Not done">
      <p className="text-sm text-ink">{result.message}</p>
      <Button className="mt-4" onClick={onClose}>
        OK
      </Button>
    </Modal>
  );
}
