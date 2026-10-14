import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResultDialog, type Result } from "@/components/result-dialog";
import { authClient, storeSessionToken } from "@/lib/auth/client";
import { rememberOwnPassword } from "@/lib/centre.functions";

export function PasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const setNotice = (message: string) => {
    const ok = !/wrong|do not match|needs at least|could not|sign out, sign in/i.test(message);
    setResult({ ok, message });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Change password" description="Use the current password, then choose a new one.">
      <form
        className="grid gap-2"
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
            .then((result) => {
              if (result.error) {
                const message = result.error.message ?? "";
                setNotice(
                  /invalid password/i.test(message)
                    ? "Current password is wrong."
                    : /not fresh/i.test(message)
                      ? "Sign out, sign in again, then change the password."
                      : message || "Could not change the password.",
                );
                return;
              }
              storeSessionToken(result.data?.token);
              void rememberOwnPassword({ data: nextPassword }).catch(() => undefined);
              setCurrentPassword("");
              setNextPassword("");
              setConfirmPassword("");
              setNotice("Password changed. Sign in with it next time.");
            })
            .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not change the password."))
            .finally(() => setChanging(false));
        }}
      >
        <input
          aria-label="Current password"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <input
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="New password, 8 or more characters"
          className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={nextPassword}
          onChange={(event) => setNextPassword(event.target.value)}
        />
        <input
          aria-label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <Button type="submit" disabled={changing}>
          {changing ? "Changing…" : "Change password"}
        </Button>
      </form>
      <ResultDialog result={result} onClose={() => setResult(null)} />
    </Modal>
  );
}
