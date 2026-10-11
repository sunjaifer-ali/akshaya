import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addServiceEntry, removeServiceEntry, serviceDay, updateServiceEntry, type ServiceLine } from "@/lib/centre.functions";
import { inr } from "@/lib/format";
import { formatFull } from "@/lib/ledger/dates";
import { pullSharedCloses } from "@/lib/ledger/share";
import { useLedger } from "@/lib/ledger/store";
import { useTodayKey } from "@/lib/use-today";

const SERVICES = ["Aadhaar", "Certificate", "E-district", "PSC", "Passport", "PAN", "Ration card", "Utility bill", "Photocopy"];

export const Route = createFileRoute("/counter")({
  component: CounterPage,
});

function CounterPage() {
  const today = useTodayKey();
  const book = useLedger();
  const [date, setDate] = useState(today || "");
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [total, setTotal] = useState(0);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [closed, setClosed] = useState(false);
  const [service, setService] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [personalGpay, setPersonalGpay] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState("");
  const [editing, setEditing] = useState<ServiceLine | null>(null);
  const day = date || today || "";

  useEffect(() => {
    if (today) setDate((current) => current || today);
  }, [today]);

  useEffect(() => {
    if (!day) return;
    let stop = false;
    const load = () => {
      void serviceDay({ data: day })
        .then((result) => {
          if (stop) return;
          setRole(result.role);
          setTotal(result.total);
          setLines(result.lines);
          setClosed(Boolean(result.closed));
        })
        .catch((error: unknown) => {
          if (!stop) setNotice(error instanceof Error ? error.message : "The counter did not open.");
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [day]);

  const save = () => {
    setPending(true);
    setNotice("");
    void addServiceEntry({
      data: { service, customer, mobile, amount: Number(amount), personalGpay },
    })
      .then((result) => {
        setService("");
        setCustomer("");
        setMobile("");
        setAmount("");
        setPersonalGpay(false);
        setNotice("");
        setEditing(null);
        setResult({ ok: true, message: "Charge successfully saved." });
        return serviceDay({ data: day || today }).then((next) => {
          setRole(next.role);
          setTotal(next.total);
          setLines(next.lines);
          setClosed(Boolean(next.closed));
          return pullSharedCloses();
        });
      })
      .catch((error: unknown) => {
        setResult({ ok: false, message: error instanceof Error ? error.message : "Charge not saved." });
      })
      .finally(() => setPending(false));
  };

  const byStaff = new Map<string, number>();
  for (const line of lines) byStaff.set(line.staff, (byStaff.get(line.staff) ?? 0) + line.amount);
  const names = new Set(book.employees.map((employee) => employee.name.trim().toLowerCase()));
  const unmatched = [...byStaff.keys()].filter((name) => !names.has(name.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        kicker="COUNTER"
        title={role === "admin" ? "Live counter" : "Service charge"}
        lede={
          role === "admin"
            ? "The day total is by person. Open a name to see that person’s customers."
            : "Enter the charge. Your customers for today are listed below, and a wrong amount can be edited."
        }
        actions={
          role === "admin" ? (
            <input
              type="date"
              aria-label="Counter date"
              className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={day}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          ) : null
        }
      />

      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="text-xs font-semibold tracking-widest text-faint">{role === "admin" ? (day === today ? "ENTERED TODAY" : "ENTERED") : "YOUR TOTAL"}</p>
        <p className="mt-1 font-display text-4xl tabular-nums">{inr(total)}</p>
        <p className="mt-1 text-sm text-muted">
          {day ? formatFull(day) : ""}
          {lines.length > 0 ? ` · ${lines.length} customer${lines.length === 1 ? "" : "s"}` : ""}
          {lines.some((line) => line.personalGpay) ? ` · Personal GPay ${inr(lines.filter((line) => line.personalGpay).reduce((sum, line) => sum + line.amount, 0))}` : ""}
        </p>
        {role === "admin" && unmatched.length > 0 ? (
          <p className="mt-2 text-sm text-warn">
            {unmatched.join(", ")} is not a staff name, so that amount is in the centre total only. Use the same name as on Salary.
          </p>
        ) : null}
      </section>

      {role === "employee" && closed ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Day closed</h2>
          <p className="mt-1 text-sm text-muted">No more charges can be entered today. Tomorrow starts fresh.</p>
        </section>
      ) : role === "employee" || day === today ? (
      <form
        className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Service</span>
          <input
            list="akshaya-services"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={service}
            onChange={(event) => setService(event.target.value)}
          />
          <datalist id="akshaya-services">
            {SERVICES.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
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
          <span className="mb-1 block text-muted">Service charge</span>
          <input
            inputMode="numeric"
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={personalGpay} onChange={(event) => setPersonalGpay(event.target.checked)} />
          Customer paid GPay to a personal number, not the Akshaya account
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add charge"}
          </Button>
        </div>
      </form>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}

      {role === "admin" ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">By person</h2>
          {byStaff.size === 0 ? <p className="mt-2 text-sm text-muted">Nothing entered for this day.</p> : null}
          <ul className="mt-2 divide-y divide-line">
            {[...byStaff.entries()].map(([name, value]) => {
              const count = lines.filter((line) => line.staff === name).length;
              const open = picked === name;
              return (
                <li key={name}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between py-2 text-left text-sm"
                    onClick={() => {
                      setPicked(open ? "" : name);
                      setEditing(null);
                    }}
                  >
                    <span className="font-medium">{name}</span>
                    <span className="tabular-nums text-muted">
                      {count} · {inr(value)}
                    </span>
                  </button>
                  {open ? (
                    <CustomerLines
                      lines={lines.filter((line) => line.staff === name)}
                      editing={editing}
                      onEdit={setEditing}
                      onResult={(next) => {
                        setResult(next);
                        if (!next.ok) return;
                        setEditing(null);
                        void serviceDay({ data: day }).then((fresh) => {
                          setTotal(fresh.total);
                          setLines(fresh.lines);
                          return pullSharedCloses();
                        });
                      }}
                      canDelete
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Your customers</h2>
          {lines.length === 0 ? <p className="mt-2 text-sm text-muted">No charge entered today.</p> : null}
          <CustomerLines
            lines={lines}
            editing={editing}
            onEdit={setEditing}
            onResult={(next) => {
              setResult(next);
              if (!next.ok) return;
              setEditing(null);
              void serviceDay({ data: day }).then((fresh) => {
                setTotal(fresh.total);
                setLines(fresh.lines);
              });
            }}
            canDelete={false}
            locked={role === "employee" && closed}
          />
        </section>
      )}
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function CustomerLines({
  lines,
  editing,
  onEdit,
  onResult,
  canDelete,
  locked = false,
}: {
  lines: ServiceLine[];
  editing: ServiceLine | null;
  onEdit: (line: ServiceLine | null) => void;
  onResult: (result: Result) => void;
  canDelete: boolean;
  locked?: boolean;
}) {
  return (
    <ul className="mb-2 grid gap-2">
      {lines.map((line) =>
        editing?.id === line.id ? (
          <EditCharge key={line.id} line={line} onClose={() => onEdit(null)} onResult={onResult} />
        ) : (
          <li key={line.id} className="rounded-lg border border-line px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{line.customer}</p>
                <p className="text-xs text-faint">
                  {line.service} · {line.mobile}
                  {line.personalGpay ? " · Personal GPay" : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="tabular-nums">{inr(line.amount)}</span>
                {locked ? null : (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(line)}>
                    Edit
                  </Button>
                )}
                {canDelete ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void removeServiceEntry({ data: line.id })
                        .then(() => onResult({ ok: true, message: "Charge successfully deleted." }))
                        .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Charge not deleted." }));
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

function EditCharge({ line, onClose, onResult }: { line: ServiceLine; onClose: () => void; onResult: (result: Result) => void }) {
  const [service, setService] = useState(line.service);
  const [customer, setCustomer] = useState(line.customer);
  const [mobile, setMobile] = useState(line.mobile);
  const [amount, setAmount] = useState(String(line.amount));
  const [personalGpay, setPersonalGpay] = useState(Boolean(line.personalGpay));
  const [pending, setPending] = useState(false);
  return (
    <li className="rounded-lg border border-line p-3">
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          void updateServiceEntry({ data: { id: line.id, service, customer, mobile, amount: Number(amount), personalGpay } })
            .then(() => onResult({ ok: true, message: "Charge successfully updated." }))
            .catch((caught: unknown) => {
              onResult({ ok: false, message: caught instanceof Error ? caught.message : "Charge not saved." });
              setPending(false);
            });
        }}
      >
        <input className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={service} onChange={(event) => setService(event.target.value)} aria-label="Service" />
        <input className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={customer} onChange={(event) => setCustomer(event.target.value)} aria-label="Customer" />
        <input className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={mobile} onChange={(event) => setMobile(event.target.value)} aria-label="Mobile" />
        <input className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Service charge" inputMode="numeric" />
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={personalGpay} onChange={(event) => setPersonalGpay(event.target.checked)} />
          GPay to a personal number
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </li>
  );
}
