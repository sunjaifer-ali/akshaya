import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export function MoneyField({
  value,
  onChange,
  label,
  className,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(display(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(display(value));
  }, [value]);

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      className={cn(
        "h-11 w-full rounded-sm border border-line bg-bg px-3 text-base tabular-nums text-ink outline-none placeholder:text-faint focus:border-accent disabled:bg-surface-2",
        className,
      )}
      value={text}
      placeholder="0"
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        if (disabled) return;
        if (!text.trim()) {
          onChange(null);
          setText("");
          return;
        }
        onChange(Number(text));
        setText(display(Number(text)));
      }}
      onChange={(event) => {
        if (disabled) return;
        const next = event.target.value.replace(/[^\d]/g, "");
        setText(next);
        if (next) onChange(Number(next));
      }}
    />
  );
}

function display(value: number | null): string {
  if (value == null || value <= 0) return "";
  return String(Math.round(value));
}

export function PercentField({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base tabular-nums text-ink outline-none focus:border-accent"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const n = Math.min(100, Math.max(0, Number(text) || 0));
        onChange(n);
        setText(String(n));
      }}
      onChange={(event) => {
        const next = event.target.value.replace(/[^\d]/g, "").slice(0, 3);
        setText(next);
        if (next) onChange(Math.min(100, Number(next)));
      }}
    />
  );
}
