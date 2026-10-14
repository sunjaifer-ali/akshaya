const inrFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function inr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return inrFormat.format(Math.round(n));
}

export function inrShort(n: number): string {
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (a >= 10000000) return `${sign}₹${trimNum(a / 10000000)} Cr`;
  if (a >= 100000) return `${sign}₹${trimNum(a / 100000)} L`;
  if (a >= 1000) return `${sign}₹${trimNum(a / 1000)}k`;
  return `${sign}₹${Math.round(a)}`;
}

function trimNum(n: number): string {
  const t = n >= 10 ? n.toFixed(0) : n.toFixed(1);
  return t.endsWith(".0") ? t.slice(0, -2) : t;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function signedInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n > 0) return `+${inr(n)}`;
  return inr(n);
}
