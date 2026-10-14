import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, formatMonth } from "@/lib/ledger/dates";

export function MonthBar({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="icon" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))}>
        <ChevronLeft className="size-4" />
      </Button>
      <p className="min-w-36 text-center text-sm font-medium tabular-nums">{formatMonth(month)}</p>
      <Button variant="secondary" size="icon" aria-label="Next month" onClick={() => onChange(addMonths(month, 1))}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
