import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CentreCredit } from "@/components/centre-credit";
import { authClient, markDeskOpen } from "@/lib/auth/client";
import { centreHasAdmin, claimAdmin, loginChoices, recordLogin, type LoginChoice } from "@/lib/centre.functions";
import { centreEmail, cleanUsername } from "@/lib/username";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function keepSessionToken(token: string | null | undefined) {
  if (!token) return;
  try {
    sessionStorage.setItem("grok-auth.bearer-token", token);
  } catch {
    /* the cookie still signs them in when the browser keeps it */
  }
}

function LoginPage() {
  const [mode, setMode] = useState<"sign-in" | "create" | "loading">("loading");
  const [choices, setChoices] = useState<LoginChoice[]>([]);
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const chosen = choices.find((person) => person.username === picked);

  useEffect(() => {
    void centreHasAdmin()
      .then(async (status) => {
        if (!status.hasAdmin) {
          setMode("create");
          return;
        }
        const people = await loginChoices();
        setChoices(people);
        setMode("sign-in");
      })
      .catch(() => setMode("sign-in"));
  }, []);

  const submit = async () => {
    setError("");
    setPending(true);
    try {
      if (mode === "create") {
        const chosen = cleanUsername(username);
        const result = await authClient.signUp.email({
          name: name.trim(),
          email: centreEmail(chosen),
          password,
          username: chosen,
          rememberMe: false,
        } as never);
        if (result.error) throw new Error(result.error.message ?? "Could not create the admin account.");
        keepSessionToken(result.data?.token);
        markDeskOpen();
        await claimAdmin();
        await recordLogin({ data: { screen: `${window.screen.width}×${window.screen.height}` } }).catch(() => undefined);
      } else {
        if (!chosen && choices.length > 0) throw new Error("Choose who is signing in.");
        const loginName = chosen?.role === "admin" ? cleanUsername(username) : chosen?.username || cleanUsername(username);
        if (chosen?.role === "admin" && loginName !== chosen.username) throw new Error("That username does not match the admin account.");
        if (!loginName) throw new Error("Choose who is signing in.");
        const result = await authClient.signIn.username({
          username: loginName,
          password,
          rememberMe: false,
        });
        if (result.error) throw new Error(result.error.message ?? "Username or password is wrong.");
        keepSessionToken(result.data?.token);
        markDeskOpen();
        await recordLogin({ data: { screen: `${window.screen.width}×${window.screen.height}` } }).catch(() => undefined);
      }
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center px-4 py-10">
      <form
        className="w-full rounded-xl border border-line bg-surface px-6 py-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <img src="/akshaya-logo.png" alt="Akshaya" className="mx-auto mb-4 h-auto w-28" />
        <p className="text-center text-xs font-semibold tracking-widest text-accent">AKSHAYA</p>
        <h1 className="text-center font-display text-4xl leading-tight">Thrikkadeeri</h1>
        <p className="mt-2 text-center text-sm text-muted">
          {mode === "create"
            ? "Create the admin account. Staff accounts are added later from Settings."
            : "Choose your name. Staff enter the password. The admin also enters the username."}
        </p>
        {mode === "loading" ? <p className="mt-6 text-sm text-muted">Opening…</p> : null}
        {mode !== "loading" ? (
          <div className="mt-6 grid gap-3">
            {mode === "create" ? (
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Your name</span>
                <input
                  className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                  value={name}
                  autoComplete="name"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            ) : (
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Who is signing in</span>
                <select
                  className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                  value={picked}
                  onChange={(event) => {
                    setPicked(event.target.value);
                    setUsername("");
                    setPassword("");
                    setError("");
                  }}
                >
                  <option value="">Select a name</option>
                  {choices.map((person) => (
                    <option key={person.username} value={person.username}>
                      {person.role === "admin" ? `${person.name} (Admin)` : person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === "create" || chosen?.role === "admin" || (mode === "sign-in" && choices.length === 0) ? (
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Username</span>
                <input
                  autoComplete="username"
                  className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
            ) : null}
            <label className="block text-sm">
              <span className="mb-1 block text-muted">Password</span>
              <input
                type="password"
                autoComplete={mode === "create" ? "new-password" : "current-password"}
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Please wait…" : mode === "create" ? "Create admin account" : "Sign in"}
            </Button>
          </div>
        ) : null}
      </form>
      <CentreCredit />
    </main>
  );
}
