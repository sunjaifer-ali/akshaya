import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useTodayKey } from "@/lib/use-today";

export const Route = createFileRoute("/bill")({
  component: BillPage,
});

function BillPage() {
  const today = useTodayKey();
  const { user } = useCurrentUserState();
  const [date, setDate] = useState(today || "");
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState("");
  const [department, setDepartment] = useState("");
  const [charge, setCharge] = useState("");
  const [ready, setReady] = useState(false);
  const departmentPay = rupee(department);
  const serviceCharge = rupee(charge);
  const total = departmentPay + serviceCharge;
  const staff = user?.displayName?.trim() || "";

  return (
    <div>
      <section className="no-print mx-auto max-w-lg">
        <h1 className="font-display text-3xl">Bill</h1>
        <p className="mt-1 text-sm text-muted">Print only. This is not added to the counter or the closing.</p>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!customer.trim() || !service.trim()) return;
            setReady(true);
            window.setTimeout(() => window.print(), 50);
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Date</span>
            <input type="date" required className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Customer name</span>
            <input required className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={customer} onChange={(event) => setCustomer(event.target.value.slice(0, 80))} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Service type</span>
            <input required className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={service} onChange={(event) => setService(event.target.value.slice(0, 80))} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Departmental pay</span>
              <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-right text-base tabular-nums outline-none focus:border-accent" value={department} onChange={(event) => setDepartment(event.target.value.replace(/[^\d]/g, "").slice(0, 7))} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Service charge</span>
              <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-right text-base tabular-nums outline-none focus:border-accent" value={charge} onChange={(event) => setCharge(event.target.value.replace(/[^\d]/g, "").slice(0, 7))} />
            </label>
          </div>
          <p className="text-right font-display text-3xl tabular-nums">Total {inr(total)}</p>
          <Button type="submit">Print bill</Button>
        </form>
      </section>

      {ready ? (
        <article className="bill-sheet mx-auto mt-6 bg-white text-black">
          <header className="flex items-center gap-3 border-b border-black pb-3">
            <img src="/akshaya-logo.png" alt="" className="h-14 w-auto" />
            <div className="min-w-0 flex-1 text-center">
              <p className="text-[11px] font-semibold tracking-[0.18em]">AKSHAYA</p>
              <h2 className="font-display text-xl leading-tight">AKSHAYA COMMON SERVICE CENTRE</h2>
              <p className="mt-1 text-[11px] leading-snug">CITY CENTRE COMPLEX, THRIKKADEERI, PALAKKAD-679502</p>
              <p className="text-[11px]">E-mail akspkd209@gmail.com · Mob 9495663369</p>
            </div>
          </header>
          <div className="mt-3 flex items-end justify-between gap-4 text-sm">
            <p className="font-semibold tracking-wide">SERVICE BILL</p>
            <p>Date {showDate(date)}</p>
          </div>
          <p className="mt-3 text-sm">Customer <span className="font-medium">{customer.trim()}</span></p>
          <p className="mt-1 text-sm">Service <span className="font-medium">{service.trim()}</span></p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-y border-black">
                <th className="py-1.5 text-left font-medium">Particulars</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1.5">Departmental pay</td>
                <td className="py-1.5 text-right tabular-nums">{inr(departmentPay)}</td>
              </tr>
              <tr>
                <td className="py-1.5">Service charge</td>
                <td className="py-1.5 text-right tabular-nums">{inr(serviceCharge)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-black">
                <th className="py-2 text-left text-base">Total</th>
                <th className="py-2 text-right text-base tabular-nums">{inr(total)}</th>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-xs">{rupeesInWords(total)}</p>
          <footer className="mt-8 flex items-end justify-between text-xs">
            <p>{staff ? `Prepared by ${staff}` : ""}</p>
            <p className="text-right">Authorised signature</p>
          </footer>
        </article>
      ) : null}
    </div>
  );
}

function rupee(value: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount);
}

function showDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}-${month}-${year}`;
}

function rupeesInWords(amount: number): string {
  if (amount <= 0) return "Rupees zero only";
  return `Rupees ${words(amount)} only`;
}

function words(amount: number): string {
  if (amount < 100) return under100(amount);
  if (amount < 1000) return join(under100(Math.floor(amount / 100)), "hundred", amount % 100);
  if (amount < 100000) return join(words(Math.floor(amount / 1000)), "thousand", amount % 1000);
  return join(words(Math.floor(amount / 100000)), "lakh", amount % 100000);
}

function join(head: string, unit: string, rest: number): string {
  return rest > 0 ? `${head} ${unit} ${words(rest)}` : `${head} ${unit}`;
}

function under100(amount: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (amount < 20) return ones[amount] || "zero";
  const ten = tens[Math.floor(amount / 10)] ?? "";
  const one = ones[amount % 10] ?? "";
  return one ? `${ten} ${one}` : ten;
}
