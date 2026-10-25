import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  lede,
  actions,
  className = "",
}: {
  kicker?: string;
  title: string;
  lede?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-5 flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="max-w-2xl">
        {kicker ? <p className="text-xs font-semibold tracking-widest text-accent">{kicker}</p> : null}
        <h1 className="font-display text-3xl leading-tight text-ink">{title}</h1>
        {lede ? <p className="mt-1 text-sm text-muted">{lede}</p> : null}
      </div>
      {actions}
    </div>
  );
}
