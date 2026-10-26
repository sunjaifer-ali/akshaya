import { useEffect, useState, type ReactNode } from "react";
import { MoneyField } from "@/components/money-field";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createEmployeeAccount, DEFAULT_STAFF_PASSWORD } from "@/lib/centre.functions";
import { DESK_LABEL, deskOf } from "@/lib/ledger/calc";
import { useLedger } from "@/lib/ledger/store";
import type { Desk, Employee } from "@/lib/ledger/types";

export function StaffDialog({
  open,
  employee,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  employee: Employee | null;
  onOpenChange: (open: boolean) => void;
  onResult: (result: { ok: boolean; message: string }) => void;
}) {
  const saveEmployee = useLedger((state) => state.saveEmployee);
  const [draft, setDraft] = useState<Employee>(() => employee ?? fresh());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState(DEFAULT_STAFF_PASSWORD);
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(employee ? { ...employee, desk: employee.desk ?? deskOf(employee) } : fresh());
      setUsername("");
      setPassword(DEFAULT_STAFF_PASSWORD);
      setUsernameEdited(false);
      setPending(false);
    }
  }, [open, employee]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={employee ? "Edit employee" : "Add employee"}
      description={employee ? "Salary is basic minus unpaid leave at basic ÷ 30." : "A sign-in is created with the name. You stay signed in as admin."}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name = draft.name.trim();
          if (!name) {
            onResult({ ok: false, message: "Not added. Enter a name." });
            return;
          }
          if (!draft.desk) {
            onResult({ ok: false, message: "Not added. Choose the desk." });
            return;
          }
          const desk = draft.desk;
          const save = () => {
            saveEmployee({ ...draft, name, desk, role: DESK_LABEL[desk] });
            onOpenChange(false);
          };
          if (employee) {
            save();
            onResult({ ok: true, message: `${name} successfully updated.` });
            return;
          }
          const login = (usernameEdited ? username : suggestUsername(name) || username).trim().toLowerCase();
          if (login.length < 3) {
            onResult({ ok: false, message: "Not added. The sign-in needs at least 3 letters." });
            return;
          }
          if (password.length < 8) {
            onResult({ ok: false, message: "Not added. The password needs at least 8 characters." });
            return;
          }
          setPending(true);
          void createEmployeeAccount({ data: { name, username: login, password } })
            .then(() => {
              save();
              const starter = password === DEFAULT_STAFF_PASSWORD ? ` Starting password is ${DEFAULT_STAFF_PASSWORD}.` : "";
              onResult({ ok: true, message: `${name} successfully added. Sign-in is ${login}.${starter}` });
            })
            .catch((error: unknown) => {
              setPending(false);
              onResult({ ok: false, message: error instanceof Error ? error.message : "Could not create the sign-in." });
            });
        }}
      >
        <Field label="Name">
          <input
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={draft.name}
            onChange={(event) => {
              const name = event.target.value;
              setDraft({ ...draft, name });
              if (!employee && !usernameEdited) setUsername(suggestUsername(name));
            }}
          />
        </Field>
        {employee ? null : (
          <>
            <Field label="Sign-in name">
              <input
                autoComplete="off"
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={username}
                onChange={(event) => {
                  setUsernameEdited(true);
                  setUsername(event.target.value.toLowerCase());
                }}
              />
            </Field>
            <Field label="Password">
              <input
                type="text"
                autoComplete="new-password"
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="Desk">
          <select
            required
            className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
            value={draft.desk ?? ""}
            onChange={(event) => setDraft({ ...draft, desk: event.target.value as Desk })}
          >
            <option value="">Choose the desk</option>
            <option value="aadhaar">Aadhaar desk</option>
            <option value="service">Service desk</option>
            <option value="support">Support desk</option>
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Basic salary">
            <MoneyField label="Basic salary" value={draft.basic} onChange={(basic) => setDraft({ ...draft, basic: basic ?? 0 })} />
          </Field>
          <Field label="Monthly incentive">
            <MoneyField
              label="Monthly incentive"
              value={draft.incentive}
              onChange={(incentive) => setDraft({ ...draft, incentive: incentive ?? 0 })}
            />
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
          On the current pay list
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {employee ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const name = draft.name.trim() || employee.name;
                const active = !draft.active;
                const desk = draft.desk;
                saveEmployee({ ...draft, name, role: desk ? DESK_LABEL[desk] : draft.role, desk, active });
                onOpenChange(false);
                onResult({
                  ok: true,
                  message: active
                    ? `${name} is active again.`
                    : `${name} is deactivated. Past collection and pay stay in the book.`,
                });
              }}
            >
              {draft.active ? "Deactivate" : "Activate"}
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}

function suggestUsername(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
}

function fresh(): Employee {
  return {
    id: crypto.randomUUID(),
    name: "",
    role: "Staff",
    basic: 10000,
    incentive: 0,
    active: true,
  };
}
