import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export type Result = { ok: boolean; message: string };

export function ResultDialog({ result, onClose }: { result: Result | null; onClose: () => void }) {
  return (
    <Modal open={result != null} onOpenChange={(open) => { if (!open) onClose(); }} title={result?.ok ? "Done" : "Not done"}>
      <p className="text-sm text-ink">{result?.message}</p>
      <Button className="mt-4" onClick={onClose}>
        OK
      </Button>
    </Modal>
  );
}
