import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createEmployeeAccount, listAccounts, removeEmployeeAccount, resetEmployeePassword, revealStaffPassword, type CentreRole } from "@/lib/centre.functions";
import { authClient, storeSessionToken } from "@/lib/auth/client";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { useLedger } from "@/lib/ledger/store";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const book = useLedger();
  const [result, setResult] = useState<Result | null>(null);
  const setNotice = (message: string) => {
    if (!message) {
      setResult(null);
      return;
    }
    const ok = !/could not|wrong|do not match|needs at least|sign out, sign in/i.test(message);
    setResult({ ok, message });
  };
  const [accounts, setAccounts] = useState<{ userId: string; role: CentreRole; name: string; username: string }[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [resetFor, setResetFor] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listAccounts()
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch((error: unknown) => {
        setAccounts([]);
        setNotice(error instanceof Error ? error.message : "Could not load accounts.");
      });
  }, [open]);

  const refreshAccounts = () => {
    void listAccounts()
      .then((rows) => setAccounts(Array.isArray(rows) ? rows : []))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load accounts."));
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Centre settings"
      description="Staff sign in with their own name. Press and hold Show to see the password."
    >
      <div className="rounded-lg border border-line p-3">
        <p className="text-sm font-medium">User accounts</p>
        <p className="mt-1 text-xs text-muted">Press and hold Show to see a staff password. A password chosen before this update appears after they change it, or after you set it back to Akshaya@1.</p>
        {accounts.length === 0 ? <p className="mt-3 text-sm text-muted">No accounts loaded yet.</p> : null}
        <ul className="mt-3 divide-y divide-line">
          {accounts.map((account) => (
            <li key={account.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{account.name}</span>
                <span className="mt-0.5 block text-xs text-faint">
                  {account.username} · {account.role === "admin" ? "Admin" : "Counter"}
                </span>
              </span>
              {account.role === "employee" ? (
                resetFor === account.userId ? (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        void resetEmployeePassword({ data: account.userId })
                          .then(() => {
                            setResetFor("");
                            setNotice(`${account.name} can sign in with username ${account.username} and password Akshaya@1.`);
                          })
                          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not reset that password."));
                      }}
                    >
                      Reset
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setResetFor("")}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <span className="flex gap-2">
                    <HoldPassword userId={account.userId} />
                    <Button size="sm" variant="ghost" onClick={() => setResetFor(account.userId)}>
                      Set to Akshaya@1
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void removeEmployeeAccount({ data: account.userId })
                          .then(() => refreshAccounts())
                          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not remove that account."));
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <form
        className="mt-4 grid gap-2 rounded-lg border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!staffName.trim() || !staffUsername.trim()) {
            setNotice("Enter the staff name and username.");
            return;
          }
          if (staffPassword.length < 8) {
            setNotice("The password needs at least 8 characters.");
            return;
          }
          void createEmployeeAccount({ data: { name: staffName.trim(), username: staffUsername.trim().toLowerCase(), password: staffPassword } })
            .then(() => {
              setStaffName("");
              setStaffUsername("");
              setStaffPassword("");
              refreshAccounts();
              setNotice("Staff account added.");
            })
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not add that account."));
        }}
      >
        <p className="text-sm font-medium">Add a staff login</p>
        <input
          aria-label="Staff name"
          placeholder="Name"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={staffName}
          onChange={(event) => setStaffName(event.target.value)}
        />
        <input
          aria-label="Staff username"
          placeholder="Username"
          autoComplete="off"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={staffUsername}
          onChange={(event) => setStaffUsername(event.target.value.toLowerCase())}
        />
        <input
          aria-label="Staff account password"
          type="text"
          autoComplete="new-password"
          placeholder="Password, 8 or more characters"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={staffPassword}
          onChange={(event) => setStaffPassword(event.target.value)}
        />
        <Button type="submit">Add account</Button>
      </form>

      <form
        className="mt-4 grid gap-2 rounded-lg border border-line p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (nextPassword.length < 8) {
            setNotice("The new password needs at least 8 characters.");
            return;
          }
          if (nextPassword !== confirmPassword) {
            setNotice("The new password and the confirmation do not match.");
            return;
          }
          setChanging(true);
          void authClient
            .changePassword({ currentPassword, newPassword: nextPassword, revokeOtherSessions: true })
            .then((changed) => {
              if (changed.error) {
                const message = changed.error.message ?? "";
                setNotice(
                  /invalid password/i.test(message)
                    ? "Current password is wrong."
                    : /not fresh/i.test(message)
                      ? "Sign out, sign in again, then change the password."
                      : message || "Could not change the password.",
                );
                return;
              }
              storeSessionToken(changed.data?.token);
              setCurrentPassword("");
              setNextPassword("");
              setConfirmPassword("");
              setNotice("Password changed. Other devices must sign in with the new password.");
            })
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not change the password."))
            .finally(() => setChanging(false));
        }}
      >
        <p className="text-sm font-medium">Admin password</p>
        <p className="text-xs text-muted">Enter the current password, then a new one. Staff passwords stay as they are.</p>
        <input
          aria-label="Current password"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <input
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="New password, 8 or more characters"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
        />
        <input
          aria-label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          className="h-11 rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <Button type="submit" disabled={changing}>
          {changing ? "Changing…" : "Change password"}
        </Button>
      </form>

      <div className="mt-4 rounded-lg border border-line p-3">
        <p className="text-sm font-medium">Book</p>
        <p className="mt-1 text-xs text-muted">Unpaid leave {book.deductLwp ? "reduces" : "does not reduce"} basic pay.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => book.setDeductLwp(!book.deductLwp)}>
            {book.deductLwp ? "Stop deducting unpaid leave" : "Deduct unpaid leave"}
          </Button>
        </div>
      </div>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </Modal>
  );
}

function HoldPassword({ userId }: { userId: string }) {
  const [holding, setHolding] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const down = () => {
    setHolding(true);
    if (password !== null) return;
    void revealStaffPassword({ data: userId })
      .then((found) => setPassword(found.password || ""))
      .catch(() => setPassword(""));
  };
  return (
    <button
      type="button"
      className="min-h-8 max-w-40 truncate rounded-sm px-2 text-sm text-muted hover:bg-surface-2"
      onMouseDown={down}
      onMouseUp={() => setHolding(false)}
      onMouseLeave={() => setHolding(false)}
      onTouchStart={(event) => {
        event.preventDefault();
        down();
      }}
      onTouchEnd={() => setHolding(false)}
    >
      {holding ? (password === null ? "…" : password || "Not saved yet") : "Show"}
    </button>
  );
}
