import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addCustomerMove, customerCreditDesk, removeCustomerMove, type OpenCredit } from "@/lib/centre.functions";
import { inr } from "@/lib/format";

export const Route = createFileRoute("/credit")({
  component: CreditPage,
});

type Line = { id: string; staff: string; customer: string; mobile: string; kind: string; amount: number };

function CreditPage() {
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [payFor, setPayFor] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMobile, setPayMobile] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [credit, setCredit] = useState(0);
  const [debit, setDebit] = useState(0);
  const [open, setOpen] = useState<OpenCredit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = () => {
    void customerCreditDesk()
      .then((result) => {
        setRole(result.role);
        setCredit(result.credit);
        setDebit(result.debit);
        setOpen(result.open);
        setLines(result.lines);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Credit did not open."));
  };

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div>
      <PageHeader
        kicker="CREDIT"
        title="Customer credit"
        lede="Credit is money the customer still owes. When they pay later, update that row. The closing unpaid balance follows it."
      />
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-widest text-faint">{role === "admin" ? "CREDIT TODAY" : "YOUR CREDIT TODAY"}</p>
          <p className="mt-1 font-display text-4xl tabular-nums">{inr(credit)}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-widest text-faint">{role === "admin" ? "DEBIT TODAY" : "YOUR DEBIT TODAY"}</p>
          <p className="mt-1 font-display text-4xl tabular-nums">{inr(debit)}</p>
        </div>
      </section>
      <form
        className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setNotice("");
          void addCustomerMove({ data: { kind: "credit", customer, mobile, amount: Number(amount) } })
            .then(() => {
              setCustomer("");
              setMobile("");
              setAmount("");
              setNotice("");
              setResult({ ok: true, message: "Credit successfully saved." });
              load();
            })
            .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Credit not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <div className="grid grid-cols-1 gap-2">
          <p className="text-sm text-muted">New credit. A later payment is entered on the unpaid row below.</p>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Customer name</span>
          <input
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Mobile</span>
          <input
            inputMode="numeric"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Amount</span>
          <input
            inputMode="numeric"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add credit"}
        </Button>
      </form>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-display text-2xl">Still unpaid</h2>
        {open.length === 0 ? <p className="mt-2 text-sm text-muted">Nobody owes money.</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {open.map((line) => (
            <li key={`${line.customer}-${line.mobile}`} className="py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  {line.customer}
                  <span className="mt-0.5 block text-xs text-faint">{line.mobile || "No mobile yet"}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{inr(line.balance)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPayFor(line.customer);
                      setPayAmount(String(line.balance));
                      setPayMobile(line.mobile);
                      setNotice("");
                    }}
                  >
                    Update
                  </Button>
                </span>
              </div>
              {payFor === line.customer ? (
                <form
                  className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setPending(true);
                    setNotice("");
                    void addCustomerMove({
                      data: { kind: "debit", customer: line.customer, mobile: payMobile || line.mobile, amount: Number(payAmount) },
                    })
                      .then(() => {
                        setPayFor("");
                        setPayFor("");
                        setResult({ ok: true, message: "Payment successfully updated. The unpaid balance has changed." });
                        load();
                      })
                      .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Payment not updated." }))
                      .finally(() => setPending(false));
                  }}
                >
                  <input
                    inputMode="numeric"
                    aria-label={`Amount paid by ${line.customer}`}
                    className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                    value={payAmount}
                    onChange={(event) => setPayAmount(event.target.value)}
                  />
                  <input
                    inputMode="numeric"
                    aria-label={`Mobile for ${line.customer}`}
                    placeholder="Mobile"
                    className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                    value={payMobile}
                    onChange={(event) => setPayMobile(event.target.value)}
                  />
                  <Button type="submit" disabled={pending}>
                    Paid
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {role === "admin" && lines.length > 0 ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Today</h2>
          <ul className="mt-2 divide-y divide-line">
            {lines.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {line.staff} · {line.customer}
                  <span className="mt-0.5 block text-xs text-faint">
                    {line.kind === "credit" ? "Credit" : "Debit"} · {line.mobile}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">{inr(line.amount)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void removeCustomerMove({ data: line.id })
                        .then(() => {
                          setResult({ ok: true, message: "Entry successfully deleted." });
                          load();
                        })
                        .catch((error: unknown) => setResult({ ok: false, message: error instanceof Error ? error.message : "Not deleted." }));
                    }}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}
