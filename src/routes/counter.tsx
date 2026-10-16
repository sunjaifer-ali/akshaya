import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRefresh } from "@/lib/use-refresh";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { addAdvance, addCustomerMove, addServiceEntry, advanceDesk, customerCreditDesk, giveAdvanceService, removeServiceEntry, serviceDay, updateServiceEntry, type OpenAdvance, type OpenCredit, type ServiceLine } from "@/lib/centre.functions";
import { inr } from "@/lib/format";
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
  const [role, setRole] = useState<"admin" | "employee" | "closer">("employee");
  const [total, setTotal] = useState(0);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [closed, setClosed] = useState(false);
  const [service, setService] = useState("");
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [personalGpay, setPersonalGpay] = useState(false);
  const [department, setDepartment] = useState("");
  const [askGpay, setAskGpay] = useState(false);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState("");
  const [editing, setEditing] = useState<ServiceLine | null>(null);
  const [panel, setPanel] = useState<"" | "customers" | "credit" | "advance">("");
  const day = date || today || "";

  useEffect(() => {
    if (today) setDate((current) => current || today);
  }, [today]);

  const reload = () =>
    serviceDay({ data: day || today }).then((next) => {
      setRole(next.role);
      setTotal(next.total);
      setLines(next.lines);
      setClosed(Boolean(next.closed));
      return pullSharedCloses();
    });

  useRefresh(() => {
    if (!day) return;
    return serviceDay({ data: day })
      .then((next) => {
        setRole(next.role);
        setTotal(next.total);
        setLines(next.lines);
        setClosed(Boolean(next.closed));
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "The counter did not open."));
  }, 15000, [day]);

  const save = () => {
    setPending(true);
    setNotice("");
    void addServiceEntry({
      data: {
        service,
        customer,
        mobile,
        amount: Number(amount),
        personalGpay,
        department: personalGpay ? Number(department || 0) : 0,
        bankDepartment: 0,
      },
    })
      .then(() => {
        setService("");
        setCustomer("");
        setMobile("");
        setAmount("");
        setPersonalGpay(false);
        setDepartment("");
        setNotice("");
        setEditing(null);
        setResult({ ok: true, message: "Charge successfully saved." });
        return reload();
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
  const gpayLines = lines.filter((line) => line.personalGpay);
  const gpayTotal = gpayLines.reduce((sum, line) => sum + line.amount + (line.department || 0), 0);
  const gpayService = gpayLines.reduce((sum, line) => sum + line.amount, 0);
  const gpayDepartment = gpayLines.reduce((sum, line) => sum + (line.department || 0), 0);

  return (
    <div>
      <PageHeader
        kicker="COUNTER"
        title={role === "employee" ? "Service charge" : "Counter"}
        actions={
          role === "employee" ? null : (
            <input
              type="date"
              aria-label="Counter date"
              className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={day}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          )
        }
      />

      {role === "employee" ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-widest text-faint">YOUR TOTAL TODAY</p>
          <p className="mt-1 font-display text-5xl tabular-nums">{inr(total)}</p>
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs font-semibold tracking-widest text-faint">{day === today ? "ENTERED TODAY" : "ENTERED"}</p>
            <p className="mt-1 font-display text-5xl tabular-nums">{inr(total)}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs font-semibold tracking-widest text-faint">CUSTOMERS</p>
            <p className="mt-1 font-display text-5xl tabular-nums">{lines.length}</p>
          </div>
        </section>
      )}
      {gpayLines.length > 0 ? (
        <p className="mt-3 text-base tabular-nums">
          Personal GPay {inr(gpayTotal)} · Service {inr(gpayService)} · Department {inr(gpayDepartment)}
        </p>
      ) : null}
      {role === "admin" && unmatched.length > 0 ? (
        <p className="mt-2 text-sm text-warn">
          {unmatched.join(", ")} is not a staff name, so that amount is in the centre total only. Use the same name as on Salary.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {(
          [
            ["customers", "Today's customers"],
            ["credit", "Credit"],
            ["advance", "Advances"],
          ] as const
        ).map(([id, label]) => (
          <Button key={id} type="button" className="min-h-12" variant={panel === id ? "primary" : "secondary"} onClick={() => setPanel(panel === id ? "" : id)}>
            {label}
          </Button>
        ))}
      </div>

      {role === "employee" && closed ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Day closed</h2>
          <p className="mt-1 text-sm text-muted">No more charges can be entered today. Tomorrow starts fresh.</p>
        </section>
      ) : role === "employee" || (role === "admin" && day === today) ? (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Service</span>
            <input
              list="akshaya-services"
              className="h-12 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={service}
              onChange={(event) => setService(event.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {SERVICES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`min-h-9 rounded-full border px-3 text-sm ${service === item ? "border-accent bg-accent text-accent-ink" : "border-line bg-bg text-ink"}`}
                  onClick={() => setService(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <datalist id="akshaya-services">
              {SERVICES.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Customer name</span>
            <input
              className="h-12 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Mobile, if any</span>
            <input
              inputMode="numeric"
              className="h-12 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Service charge</span>
            <input
              inputMode="numeric"
              className="h-12 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={personalGpay}
              onChange={(event) => {
                if (event.target.checked) setAskGpay(true);
                else {
                  setPersonalGpay(false);
                  setDepartment("");
                }
              }}
            />
            Customer paid GPay to a personal number, not the Akshaya account
          </label>
          {personalGpay ? (
            <div className="rounded-lg border border-line bg-bg px-3 py-2 text-sm sm:col-span-2">
              <p>Total received {inr(Number(amount || 0) + Number(department || 0))}</p>
              <p className="text-muted">
                Service charge {inr(Number(amount || 0))} · Department payment {inr(Number(department || 0))}
              </p>
              <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setAskGpay(true)}>
                Change the split
              </Button>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add charge"}
            </Button>
          </div>
        </form>
      ) : role === "admin" ? (
        <p className="mt-4 text-sm text-muted">Open today to enter a charge. This date is only for viewing.</p>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
      <GpaySplitDialog
        open={askGpay}
        serviceCharge={amount}
        department={department}
        onOpenChange={setAskGpay}
        onConfirm={(charge, part) => {
          setAmount(String(charge));
          setDepartment(String(part));
          setPersonalGpay(true);
          setAskGpay(false);
        }}
      />

      {panel === "customers" && role === "employee" ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Today's customers</h2>
          {lines.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing entered for this day.</p> : null}
          <CustomerLines
            lines={lines}
            editing={editing}
            onEdit={setEditing}
            onResult={(next) => {
              setResult(next);
              setEditing(null);
              void reload();
            }}
            canDelete={false}
            locked={closed}
          />
        </section>
      ) : null}
      {panel === "customers" && role !== "employee" ? (
        <section className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="font-display text-2xl">Today's customers</h2>
          {byStaff.size === 0 ? <p className="mt-2 text-sm text-muted">Nothing entered for this day.</p> : null}
          <ul className="mt-3 max-w-xl divide-y divide-line">
            {[...byStaff.entries()].map(([name, value]) => {
              const count = lines.filter((line) => line.staff === name).length;
              const open = picked === name;
              return (
                <li key={name}>
                  <button
                    type="button"
                    className="grid w-full grid-cols-[minmax(0,1fr)_3.5rem_7.5rem] items-baseline gap-4 py-3 text-left"
                    onClick={() => {
                      setPicked(open ? "" : name);
                      setEditing(null);
                    }}
                  >
                    <span className="text-base font-medium">{name}</span>
                    <span className="text-right text-base tabular-nums text-muted">{count}</span>
                    <span className="text-right text-lg font-medium tabular-nums">{inr(value)}</span>
                  </button>
                  {open ? (
                    <CustomerLines
                      lines={lines.filter((line) => line.staff === name)}
                      editing={editing}
                      onEdit={setEditing}
                      onResult={(next) => {
                        setResult(next);
                        setEditing(null);
                        void reload();
                      }}
                      canDelete={role === "admin"}
                      locked={role !== "admin" && closed}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {panel === "credit" ? <CounterCredit month={(day || today).slice(0, 7)} onResult={setResult} /> : null}
      {panel === "advance" ? <CounterAdvance onResult={setResult} /> : null}
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-48">
                <p className="font-medium">{line.customer}</p>
                <p className="text-xs text-faint">
                  {line.service}
                  {line.mobile ? ` · ${line.mobile}` : ""}
                  {line.personalGpay
                    ? ` · Personal GPay · total ${inr(line.amount + (line.department || 0))} · service ${inr(line.amount)} · department ${inr(line.department || 0)}`
                    : ""}
                </p>
              </div>
              <span className="text-lg font-medium tabular-nums">{inr(line.amount)}</span>
              <div className="ml-auto flex items-center gap-2">
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
  const [department, setDepartment] = useState(line.department ? String(line.department) : "");
  const [askGpay, setAskGpay] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <li className="rounded-lg border border-line p-3">
      <form
        className="grid gap-2 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          void updateServiceEntry({
            data: {
              id: line.id,
              service,
              customer,
              mobile,
              amount: Number(amount),
              personalGpay,
              department: personalGpay ? Number(department || 0) : 0,
              bankDepartment: line.bankDepartment || 0,
            },
          })
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
          <input
            type="checkbox"
            checked={personalGpay}
            onChange={(event) => {
              if (event.target.checked) setAskGpay(true);
              else {
                setPersonalGpay(false);
                setDepartment("");
              }
            }}
          />
          GPay to a personal number
        </label>
        {personalGpay ? (
          <div className="text-sm sm:col-span-2">
            <p>
              Total {inr(Number(amount || 0) + Number(department || 0))} · Service {inr(Number(amount || 0))} · Department {inr(Number(department || 0))}
            </p>
            <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setAskGpay(true)}>
              Change the split
            </Button>
          </div>
        ) : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
      <GpaySplitDialog
        open={askGpay}
        serviceCharge={amount}
        department={department}
        onOpenChange={setAskGpay}
        onConfirm={(charge, part) => {
          setAmount(String(charge));
          setDepartment(String(part));
          setPersonalGpay(true);
          setAskGpay(false);
        }}
      />
    </li>
  );
}

function GpaySplitDialog({
  open,
  serviceCharge,
  department,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  serviceCharge: string;
  department: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (serviceCharge: number, department: number) => void;
}) {
  const [total, setTotal] = useState("");
  const [service, setService] = useState("");
  const [dept, setDept] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const charge = Math.round(Number(serviceCharge) || 0);
    const part = Math.round(Number(department) || 0);
    setService(charge > 0 ? String(charge) : "");
    setDept(part > 0 ? String(part) : "");
    setTotal(charge + part > 0 ? String(charge + part) : "");
    setError("");
  }, [open, serviceCharge, department]);

  const received = Math.round(Number(total) || 0);
  const charge = Math.round(Number(service) || 0);
  const part = Math.round(Number(dept) || 0);
  const matches = received > 0 && charge > 0 && part >= 0 && charge + part === received;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Personal GPay"
      description="Enter the three amounts separately. The total must be the service charge plus the department payment."
    >
      <div className="grid gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Total received on the personal number</span>
          <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={total} onChange={(event) => setTotal(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Service charge</span>
          <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={service} onChange={(event) => setService(event.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Department payment</span>
          <input inputMode="numeric" className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent" value={dept} onChange={(event) => setDept(event.target.value)} />
        </label>
        <p className={matches ? "text-sm text-muted" : "text-sm text-bad"}>
          {charge + part === received
            ? `Service ${inr(charge)} + department ${inr(part)} = total ${inr(received)}.`
            : `These do not match. Service ${inr(charge)} + department ${inr(part)} is ${inr(charge + part)}, not ${inr(received)}.`}
        </p>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <Button
          type="button"
          onClick={() => {
            if (!matches) {
              setError("Enter the total, the service charge, and the department payment so they add up.");
              return;
            }
            onConfirm(charge, part);
          }}
        >
          Use these amounts
        </Button>
      </div>
    </Modal>
  );
}

function CounterCredit({ month, onResult }: { month: string; onResult: (result: Result) => void }) {
  const [open, setOpen] = useState<OpenCredit[]>([]);
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [amount, setAmount] = useState("");
  const [payFor, setPayFor] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [pending, setPending] = useState(false);

  const load = () => {
    if (!month) return;
    void customerCreditDesk({ data: month })
      .then((book) => setOpen(book.open))
      .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Credit did not open." }));
  };
  useRefresh(load, 15000, [month]);

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">Credit</h2>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          void addCustomerMove({ data: { kind: "credit", customer, mobile, amount: Number(amount) } })
            .then(() => {
              setCustomer("");
              setMobile("");
              setAmount("");
              onResult({ ok: true, message: "Credit saved." });
              load();
            })
            .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Credit was not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <input aria-label="Credit customer" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Customer" value={customer} onChange={(event) => setCustomer(event.target.value)} />
        <input aria-label="Credit mobile" inputMode="numeric" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Mobile" value={mobile} onChange={(event) => setMobile(event.target.value)} />
        <input aria-label="Credit amount" inputMode="numeric" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Whole bill" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit" disabled={pending}>Add credit</Button>
      </form>
      {open.length === 0 ? <p className="mt-3 text-sm text-muted">No open credit.</p> : null}
      <ul className="mt-2 divide-y divide-line">
        {open.map((line) => (
          <li key={`${line.customer}-${line.mobile}`} className="py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span>
                {line.customer}
                <span className="mt-0.5 block text-xs text-faint">{line.mobile || "No mobile"} · {inr(line.balance)}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setPayFor(payFor === line.customer ? "" : line.customer)}>Repay</Button>
            </div>
            {payFor === line.customer ? (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addCustomerMove({ data: { kind: "debit", customer: line.customer, mobile: line.mobile, amount: Number(payAmount) } })
                    .then(() => {
                      setPayAmount("");
                      setPayFor("");
                      onResult({ ok: true, message: "Credit repayment saved." });
                      load();
                    })
                    .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Repayment was not saved." }));
                }}
              >
                <input aria-label="Repay amount" inputMode="numeric" className="h-11 flex-1 rounded-sm border border-line bg-bg px-3" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} />
                <Button type="submit">Save</Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CounterAdvance({ onResult }: { onResult: (result: Result) => void }) {
  const [open, setOpen] = useState<OpenAdvance[]>([]);
  const [customer, setCustomer] = useState("");
  const [mobile, setMobile] = useState("");
  const [service, setService] = useState("");
  const [amount, setAmount] = useState("");
  const [part, setPart] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const load = () => {
    void advanceDesk()
      .then((book) => setOpen(book.open))
      .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Advances did not open." }));
  };
  useRefresh(load, 15000, []);

  return (
    <section className="mt-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">Advances</h2>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          void addAdvance({ data: { customer, mobile, service, amount: Number(amount) } })
            .then(() => {
              setCustomer("");
              setMobile("");
              setService("");
              setAmount("");
              onResult({ ok: true, message: "Advance saved." });
              load();
            })
            .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "Advance was not saved." }))
            .finally(() => setPending(false));
        }}
      >
        <input aria-label="Advance customer" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Customer" value={customer} onChange={(event) => setCustomer(event.target.value)} />
        <input aria-label="Advance mobile" inputMode="numeric" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Mobile" value={mobile} onChange={(event) => setMobile(event.target.value)} />
        <input aria-label="Advance service" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Service" value={service} onChange={(event) => setService(event.target.value)} />
        <input aria-label="Advance amount" inputMode="numeric" className="h-11 rounded-sm border border-line bg-bg px-3" placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
        <Button type="submit" disabled={pending}>Add advance</Button>
      </form>
      {open.length === 0 ? <p className="mt-3 text-sm text-muted">No open advance.</p> : null}
      <ul className="mt-2 divide-y divide-line">
        {open.map((line) => (
          <li key={line.id} className="py-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span>
                {line.customer}
                <span className="mt-0.5 block text-xs text-faint">{line.service} · {inr(line.amount)}</span>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                aria-label={`Amount served for ${line.customer}`}
                inputMode="numeric"
                placeholder="Part or full"
                className="h-11 w-36 rounded-sm border border-line bg-bg px-3 text-base"
                value={part[line.id] ?? ""}
                onChange={(event) => setPart((current) => ({ ...current, [line.id]: event.target.value.replace(/[^\d]/g, "") }))}
              />
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const served = Number(part[line.id] || 0);
                  if (!served || served > line.amount) {
                    onResult({ ok: false, message: served > line.amount ? "That is more than the advance." : "Enter the amount done. The balance stays in advance." });
                    return;
                  }
                  setPending(true);
                  void giveAdvanceService({ data: { id: line.id, amount: served } })
                    .then((saved) => {
                      const rest = saved.left > 0 ? ` ${inr(saved.left)} still in advance.` : "";
                      onResult({ ok: true, message: `Service given.${rest}` });
                      setPart((current) => ({ ...current, [line.id]: "" }));
                      load();
                    })
                    .catch((error: unknown) => onResult({ ok: false, message: error instanceof Error ? error.message : "The service was not saved." }))
                    .finally(() => setPending(false));
                }}
              >
                Service given
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
