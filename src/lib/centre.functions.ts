import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { CashClose, CentrePayout, CollectionDay, LedgerData } from "@/lib/ledger/types";
import { PAYOUT_KINDS, withCategories } from "@/lib/ledger/types";
import { isSunday } from "@/lib/ledger/dates";
import { centreEmail, cleanUsername } from "@/lib/username";
import { withTransaction } from "@/lib/db";

export type CentreRole = "admin" | "employee" | "closer";

export type SharedBook = {
  book: LedgerData;
  touches: Record<string, string>;
};

const STAFF_LOGINS = [
  { name: "Ajitha", username: "ajitha" },
  { name: "Haseena", username: "haseena" },
  { name: "Sheena", username: "sheena" },
  { name: "Sajini", username: "sajini" },
  { name: "Rubeena", username: "rubeena" },
] as const;

export const DEFAULT_STAFF_PASSWORD = "Akshaya@1";

async function openStaffLogin(name: string, username: string, password: string) {
  const { auth } = await import("@/lib/auth/server");
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const taken = await sql<{ id: string }>`select id from "user" where username = ${username} or email = ${centreEmail(username)} limit 1`;
  if (taken[0]) throw new Error("That username is already used.");
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  const created = await ctx.internalAdapter.createUser({
    email: centreEmail(username),
    name,
    emailVerified: true,
  });
  if (!created?.id) throw new Error("Could not create that sign-in.");
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hash,
  });
  await sql`update "user" set username = ${username}, "displayUsername" = ${username} where id = ${created.id}`;
  await sql`delete from "session" where "userId" = ${created.id}`;
  const { savePasswordCopy } = await import("@/lib/password-copy.server");
  await savePasswordCopy(sql, created.id, password);
  return created.id as string;
}

async function ensureStaffLogins() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await ensureUsernames(sql);
  for (const person of STAFF_LOGINS) {
    const existing = await sql<{ id: string }>`select id from "user" where username = ${person.username} or email = ${centreEmail(person.username)} limit 1`;
    let userId = existing[0]?.id;
    if (!userId) {
      try {
        userId = await openStaffLogin(person.name, person.username, DEFAULT_STAFF_PASSWORD);
      } catch {
        const again = await sql<{ id: string }>`select id from "user" where username = ${person.username} or email = ${centreEmail(person.username)} limit 1`;
        userId = again[0]?.id;
      }
    }
    if (!userId) continue;
    const member = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${userId}`;
    if (member[0]?.role === "admin" || member[0]?.role === "closer") continue;
    await sql`insert into centre_member (user_id, role, name) values (${userId}, 'employee', ${person.name}) on conflict (user_id) do update set role = 'employee', name = ${person.name}`;
  }
}

export const centreHasAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await ensureUsernames(sql);
  const rows = await sql<{ count: number }>`select count(*)::int as count from centre_member where role = 'admin'`;
  return { hasAdmin: Number(rows[0]?.count ?? 0) > 0 };
});

export type LoginChoice = { name: string; username: string; role: CentreRole };

export const loginChoices = createServerFn({ method: "GET" }).handler(async () => {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await ensureUsernames(sql);
  const rows = await sql<{ role: CentreRole; name: string; username: string | null; email: string | null }>`
    select m.role, m.name, u.username, u.email
    from centre_member m
    left join "user" u on u.id = m.user_id
    order by case m.role when 'admin' then 0 when 'closer' then 1 else 2 end, lower(m.name)
  `;
  return rows
    .map((row) => ({
      role: row.role,
      name: row.name || "Account",
      username: (row.username || (row.email ?? "").split("@")[0] || "").trim().toLowerCase(),
    }))
    .filter((row) => row.username);
});

export const claimAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const existing = await sql<{ count: number }>`select count(*)::int as count from centre_member where role = 'admin'`;
    if (Number(existing[0]?.count ?? 0) > 0) {
      const mine = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${context.userId}`;
      return { role: mine[0]?.role ?? null };
    }
    const user = await sql<{ name: string }>`select name from "user" where id = ${context.userId}`;
    const claimed = await withTransaction(async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(804271)`);
      const again = await tx<{ count: number }>`select count(*)::int as count from centre_member where role = 'admin'`;
      if (Number(again[0]?.count ?? 0) > 0) return false;
      await tx`insert into centre_member (user_id, role, name) values (${context.userId}, 'admin', ${user[0]?.name ?? "Admin"}) on conflict (user_id) do nothing`;
      return true;
    });
    if (!claimed) {
      const mine = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${context.userId}`;
      return { role: mine[0]?.role ?? null };
    }
    try {
      await ensureStaffLogins();
    } catch {
      // The first staff names can be added from Settings if this pass fails.
    }
    return { role: "admin" as const };
  });

export const myRole = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureUsernames(sql);
    const rows = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${context.userId}`;
    return { role: rows[0]?.role ?? null };
  });

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    try {
      await ensureUsernames(sql);
    } catch {
      // A username repair must not hide the account list.
    }
    const rows = await sql<{ userId: string; role: CentreRole; name: string; username: string | null; email: string | null }>`
      select m.user_id as "userId", m.role, m.name, u.username, u.email as email
      from centre_member m
      left join "user" u on u.id = m.user_id
      order by case m.role when 'admin' then 0 when 'closer' then 1 else 2 end, m.name
    `;
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      name: row.name || "Account",
      username: (row.username || (row.email ?? "").split("@")[0] || row.name).trim().toLowerCase(),
    }));
  });

export const createEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; username: string; password: string; role?: CentreRole }) => {
    const name = input.name.trim().slice(0, 80);
    const username = cleanUsername(input.username);
    const password = input.password;
    const role = input.role === "closer" ? "closer" : "employee";
    if (!name) throw new Error("Enter a name.");
    if (password.length < 8) throw new Error("Password needs at least 8 characters.");
    return { name, username, password, role };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureMemberRoles(sql);
    const userId = await openStaffLogin(data.name, data.username, data.password);
    await sql`insert into centre_member (user_id, role, name) values (${userId}, ${data.role}, ${data.name}) on conflict (user_id) do update set role = ${data.role}, name = ${data.name}`;
    return { ok: true, username: data.username };
  });

export const changeAdminUsername = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((username: string) => cleanUsername(username))
  .handler(async ({ context, data: username }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureUsernames(sql);
    const taken = await sql<{ id: string }>`select id from "user" where (username = ${username} or email = ${centreEmail(username)}) and id <> ${context.userId} limit 1`;
    if (taken[0]) throw new Error("That username is already used.");
    await sql`update "user" set username = ${username}, "displayUsername" = ${username}, email = ${centreEmail(username)} where id = ${context.userId}`;
    return { ok: true, username };
  });

export const removeEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((userId: string) => userId.trim())
  .handler(async ({ context, data: userId }) => {
    await requireAdmin(context.userId);
    if (userId === context.userId) throw new Error("You cannot remove your own admin account.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${userId}`;
    if (rows[0]?.role === "admin") throw new Error("The admin account stays.");
    await sql`delete from centre_member where user_id = ${userId}`;
    await sql`delete from "session" where "userId" = ${userId}`;
    await sql`delete from "account" where "userId" = ${userId}`;
    await sql`delete from "user" where id = ${userId}`;
    const { forgetPasswordCopy } = await import("@/lib/password-copy.server");
    await forgetPasswordCopy(sql, userId);
    return { ok: true };
  });

export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((userId: string) => userId.trim())
  .handler(async ({ context, data: userId }) => {
    await requireAdmin(context.userId);
    if (userId === context.userId) throw new Error("Change your own password from the form below.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${userId}`;
    if (rows[0]?.role !== "employee" && rows[0]?.role !== "closer") throw new Error("Only a staff or closing password can be reset.");
    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(DEFAULT_STAFF_PASSWORD);
    const updated = await sql`update "account" set password = ${hash} where "userId" = ${userId} and "providerId" = 'credential' returning id`;
    if (updated.length === 0) throw new Error("That account has no password to reset.");
    await sql`delete from "session" where "userId" = ${userId}`;
    const { savePasswordCopy } = await import("@/lib/password-copy.server");
    await savePasswordCopy(sql, userId, DEFAULT_STAFF_PASSWORD);
    return { ok: true, password: DEFAULT_STAFF_PASSWORD };
  });

export const rememberOwnPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((password: string) => {
    const next = password.slice(0, 80);
    if (next.length < 8) throw new Error("Password needs at least 8 characters.");
    return next;
  })
  .handler(async ({ context, data: password }) => {
    await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const { auth } = await import("@/lib/auth/server");
    const ctx = await auth.$context;
    const accounts = await sql<{ password: string | null }>`select password from "account" where "userId" = ${context.userId} and "providerId" = 'credential'`;
    const hash = accounts[0]?.password;
    if (!hash || !(await ctx.password.verify({ hash, password }))) throw new Error("Password was not saved.");
    const { savePasswordCopy } = await import("@/lib/password-copy.server");
    await savePasswordCopy(sql, context.userId, password);
    return { ok: true };
  });

export const revealStaffPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((userId: string) => userId.trim())
  .handler(async ({ context, data: userId }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${userId}`;
    if (rows[0]?.role !== "employee" && rows[0]?.role !== "closer") throw new Error("Only a staff or closing password can be shown.");
    const { readPasswordCopy } = await import("@/lib/password-copy.server");
    const password = await readPasswordCopy(sql, userId);
    return { password };
  });

function optionalMobile(value: string): string {
  const mobile = value.replace(/\D/g, "").slice(0, 10);
  if (mobile.length > 0 && mobile.length !== 10) throw new Error("Enter a 10 digit mobile number, or leave it blank.");
  return mobile;
}

function departmentFee(personal: boolean, value: unknown): number {
  if (!personal) return 0;
  const amount = Math.round(Number(value) || 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw new Error("Enter the department amount, or leave it empty.");
  return amount;
}

export type OpenCredit = { customer: string; mobile: string; staff: string; balance: number; date: string };

export const addCustomerMove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { kind: string; customer: string; mobile: string; amount: number }) => {
    const kind = input.kind === "debit" ? "debit" : input.kind === "credit" ? "credit" : "";
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    const amount = Math.round(Number(input.amount));
    if (!kind) throw new Error("Choose credit or debit.");
    if (!customer) throw new Error("Enter the customer name.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount.");
    return { kind, customer, mobile, amount };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    if (role === "closer") throw new Error("This login is only for the closing.");
    const date = indiaToday();
    return withTransaction(async (sql) => {
      await ensureCustomerTable(sql);
      const open = await openCredits(sql);
      if (data.kind === "debit") {
        const due = open.find((line) => line.customer.toLowerCase() === data.customer.toLowerCase());
        if (!due || due.balance < data.amount) throw new Error("That customer does not owe this much.");
      }
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      const id = crypto.randomUUID();
      await sql`insert into customer_move (id, taken_on, user_id, staff_name, customer, mobile, kind, amount)
        values (${id}, ${date}, ${context.userId}, ${staff}, ${data.customer}, ${data.mobile}, ${data.kind}, ${data.amount})`;
      await rollCreditDay(sql, date);
      return creditDesk(sql, context.userId, false, date);
    });
  });

export const customerCreditDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a month.");
    return month;
  })
  .handler(async ({ context, data: month }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureCustomerTable(sql);
    return creditDesk(sql, context.userId, role === "admin", indiaToday(), month);
  });

export const creditRegister = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureCustomerTable(sql);
    const stored = await sql<{ taken_on: string; staff: string; customer: string; mobile: string; kind: string; amount: number }>`
      select taken_on::text as taken_on, staff_name as staff, customer, mobile, kind, amount
      from customer_move order by taken_on, created_at
    `;
    const lines = stored.map((line) => ({
      date: String(line.taken_on).slice(0, 10),
      staff: line.staff,
      customer: line.customer,
      mobile: line.mobile,
      kind: line.kind === "debit" ? "Payment" : "Credit",
      amount: Number(line.amount),
    }));
    const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
    const book = bookRow[0] ? asJson(bookRow[0].data) : null;
    const names = new Map((book?.employees ?? []).map((employee) => [employee.id, employee.name]));
    const moveDates = new Set(lines.map((line) => line.date));
    for (const close of book?.cashCloses ?? []) {
      if (moveDates.has(close.date)) continue;
      for (const item of close.creditGiven ?? []) {
        if (!item.amount || !item.customer?.trim()) continue;
        lines.push({
          date: close.date,
          staff: names.get(item.employeeId) ?? "",
          customer: item.customer.trim(),
          mobile: "",
          kind: "Credit",
          amount: item.amount,
        });
      }
      for (const item of close.creditPaid ?? []) {
        if (!item.amount || !item.name?.trim()) continue;
        lines.push({
          date: close.date,
          staff: "",
          customer: item.name.trim(),
          mobile: "",
          kind: "Payment",
          amount: item.amount,
        });
      }
    }
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const open = await openCredits(sql);
    return { lines, open };
  });

export const closingCredit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    await requireClose(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureCustomerTable(sql);
    const position = await positionAsOf(sql, date);
    return { given: position.given, paid: position.paid, unpaid: position.unpaid };
  });

export const removeCustomerMove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    await requireAdmin(context.userId);
    await withTransaction(async (sql) => {
      await ensureCustomerTable(sql);
      const rows = await sql<{ taken_on: string }>`select taken_on::text as taken_on from customer_move where id = ${id}`;
      await sql`delete from customer_move where id = ${id}`;
      const date = rows[0]?.taken_on?.slice(0, 10);
      if (date) await rollCreditDay(sql, date);
    });
    return { ok: true };
  });

function dayText(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value ?? "");
  const found = text.match(/\d{4}-\d{2}-\d{2}/);
  return found ? found[0] : text.slice(0, 10);
}

async function ensureCustomerTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists customer_move (
      id text primary key,
      taken_on date not null,
      user_id text not null,
      staff_name text not null,
      customer text not null,
      mobile text not null,
      kind text not null,
      amount integer not null,
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(`create index if not exists customer_move_taken_on on customer_move (taken_on)`);
}

type OpenRow = { key: string; customer: string; mobile: string; staff: string; balance: number; date: string };

async function openCredits(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>): Promise<OpenCredit[]> {
  const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = bookRow[0] ? asJson(bookRow[0].data) : null;
  const names = new Map((book?.employees ?? []).map((employee) => [employee.id, employee.name]));
  const moves = await sql<{ taken_on: string; customer: string; mobile: string; staff_name: string; kind: string; amount: number }>`
    select taken_on::text as taken_on, customer, mobile, staff_name, kind, amount from customer_move order by created_at
  `;
  const moveDates = new Set(moves.map((move) => dayText(move.taken_on)));
  const lines: OpenRow[] = [];
  for (const close of [...(book?.cashCloses ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (moveDates.has(close.date)) continue;
    for (const item of close.creditGiven ?? []) {
      if (!item.amount || !item.customer?.trim()) continue;
      const key = item.customer.trim().toLowerCase();
      const existing = lines.find((line) => line.key === key);
      if (existing) {
        if (existing.balance <= 0) existing.date = close.date;
        existing.balance += item.amount;
      } else lines.push({ key, customer: item.customer.trim(), mobile: "", staff: names.get(item.employeeId) ?? "", balance: item.amount, date: close.date });
    }
    for (const item of close.creditPaid ?? []) {
      let left = item.amount || 0;
      const named = (item.name ?? "").trim().toLowerCase();
      const targets = named ? lines.filter((line) => line.key === named && line.balance > 0) : lines.filter((line) => line.balance > 0);
      for (const line of targets) {
        if (left <= 0) break;
        const take = Math.min(line.balance, left);
        line.balance -= take;
        left -= take;
      }
    }
  }
  for (const move of moves) {
    const amount = Number(move.amount) || 0;
    const key = move.customer.trim().toLowerCase();
    const taken = dayText(move.taken_on);
    if (move.kind === "credit") {
      const existing = lines.find((line) => line.key === key);
      if (existing) {
        if (existing.balance <= 0) existing.date = taken;
        existing.balance += amount;
        if (!existing.mobile) existing.mobile = move.mobile;
      } else lines.push({ key, customer: move.customer.trim(), mobile: move.mobile, staff: move.staff_name, balance: amount, date: taken });
    } else {
      let left = amount;
      const targets = lines.filter((line) => line.key === key && line.balance > 0);
      for (const line of targets) {
        if (left <= 0) break;
        const take = Math.min(line.balance, left);
        line.balance -= take;
        left -= take;
        if (!line.mobile) line.mobile = move.mobile;
      }
    }
  }
  return lines.filter((line) => line.balance > 0).map(({ customer, mobile, staff, balance, date }) => ({ customer, mobile, staff, balance, date }));
}

async function creditDesk(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  userId: string,
  admin: boolean,
  date: string,
  month = date.slice(0, 7),
) {
  const mine = await sql<{ kind: string; total: number }>`
    select kind, coalesce(sum(amount), 0)::int as total from customer_move
    where taken_on = ${date} and (${admin}::boolean or user_id = ${userId})
    group by kind
  `;
  const open = await openCredits(sql);
  const credit = Number(mine.find((row) => row.kind === "credit")?.total ?? 0);
  const debit = Number(mine.find((row) => row.kind === "debit")?.total ?? 0);
  if (!admin) {
    return {
      role: "employee" as const,
      credit,
      debit,
      open,
      lines: [] as { id: string; date: string; staff: string; customer: string; mobile: string; kind: string; amount: number }[],
    };
  }
  const lines = await sql<{ id: string; taken_on: string; staff: string; customer: string; mobile: string; kind: string; amount: number }>`
    select id, taken_on::text as taken_on, staff_name as staff, customer, mobile, kind, amount from customer_move
    where to_char(taken_on, 'YYYY-MM') = ${month}
    order by taken_on desc, created_at desc
  `;
  return {
    role: "admin" as const,
    credit,
    debit,
    open,
    lines: lines.map((line) => ({
      id: line.id,
      date: String(line.taken_on).slice(0, 10),
      staff: line.staff,
      customer: line.customer,
      mobile: line.mobile,
      kind: line.kind,
      amount: Number(line.amount),
    })),
  };
}

async function rollCreditDay(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, date: string) {
  const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
    select data, touches from centre_book where id = 'centre' for update
  `;
  const row = readRow(current[0]);
  if (!row) return;
  const close = (row.data.cashCloses ?? []).find((item) => item.date === date);
  if (!close) return;
  const position = await positionAsOf(sql, date);
  const cashCloses = (row.data.cashCloses ?? []).map((item) =>
    item.date === date
      ? { ...item, creditGiven: position.given, creditPaid: position.paid, credits: position.unpaid }
      : item,
  );
  const touches = { ...row.touches, [date]: new Date().toISOString() };
  await writeBook(sql, { ...row.data, cashCloses }, touches);
}

async function positionAsOf(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, asOf: string) {
  const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = bookRow[0] ? asJson(bookRow[0].data) : null;
  const employees = book?.employees ?? [];
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  const moves = await sql<{ taken_on: string; customer: string; mobile: string; staff_name: string; kind: string; amount: number }>`
    select taken_on::text as taken_on, customer, mobile, staff_name, kind, amount
    from customer_move where taken_on <= ${asOf} order by created_at
  `;
  const lines: OpenRow[] = [];
  const closes = [...(book?.cashCloses ?? [])].filter((item) => item.date <= asOf).sort((a, b) => (a.date < b.date ? -1 : 1));
  const movesByDate = new Map<string, typeof moves>();
  for (const move of moves) {
    const date = dayText(move.taken_on);
    const list = movesByDate.get(date) ?? [];
    list.push(move);
    movesByDate.set(date, list);
  }
  const dates = [...new Set([...closes.map((close) => close.date), ...movesByDate.keys()])].filter((date) => date <= asOf).sort();
  for (const date of dates) {
    const dayMoves = movesByDate.get(date) ?? [];
    const close = closes.find((item) => item.date === date);
    const sqlCredit = dayMoves.filter((move) => move.kind === "credit");
    const sqlDebit = dayMoves.filter((move) => move.kind === "debit");
    if (sqlCredit.length > 0) {
      for (const move of sqlCredit) {
        const amount = Number(move.amount) || 0;
        const key = move.customer.trim().toLowerCase();
        const existing = lines.find((line) => line.key === key);
        if (existing) {
          if (existing.balance <= 0) existing.date = date;
          existing.balance += amount;
          if (!existing.mobile) existing.mobile = move.mobile;
        } else lines.push({ key, customer: move.customer.trim(), mobile: move.mobile, staff: move.staff_name, balance: amount, date });
      }
    } else {
      for (const item of close?.creditGiven ?? []) {
        if (!item.amount || !item.customer?.trim()) continue;
        const key = item.customer.trim().toLowerCase();
        const existing = lines.find((line) => line.key === key);
        if (existing) {
          if (existing.balance <= 0) existing.date = date;
          existing.balance += item.amount;
        } else lines.push({ key, customer: item.customer.trim(), mobile: "", staff: names.get(item.employeeId) ?? "", balance: item.amount, date });
      }
    }
    const payments =
      sqlDebit.length > 0
        ? sqlDebit.map((move) => ({ name: move.customer, amount: Number(move.amount) || 0 }))
        : (close?.creditPaid ?? []);
    for (const item of payments) {
      let left = item.amount || 0;
      if (left <= 0) continue;
      const named = (item.name ?? "").trim().toLowerCase();
      const targets = named ? lines.filter((line) => line.key === named && line.balance > 0) : lines.filter((line) => line.balance > 0);
      for (const line of targets) {
        if (left <= 0) break;
        const take = Math.min(line.balance, left);
        line.balance -= take;
        left -= take;
      }
    }
  }
  const todayMoves = movesByDate.get(asOf) ?? [];
  const todayClose = closes.find((item) => item.date === asOf);
  const given = todayMoves.some((move) => move.kind === "credit")
    ? todayMoves
        .filter((move) => move.kind === "credit")
        .map((move) => ({
          employeeId: employees.find((person) => person.name.trim().toLowerCase() === move.staff_name.trim().toLowerCase())?.id ?? "",
          customer: move.customer,
          amount: Number(move.amount) || 0,
        }))
    : (todayClose?.creditGiven ?? []);
  const paid = todayMoves.some((move) => move.kind === "debit")
    ? todayMoves.filter((move) => move.kind === "debit").map((move) => ({ name: move.customer, amount: Number(move.amount) || 0 }))
    : (todayClose?.creditPaid ?? []);
  const unpaid = lines.reduce((sum, line) => sum + (line.balance > 0 ? line.balance : 0), 0);
  return { given, paid, unpaid };
}

export type OpenAdvance = {
  id: string;
  date: string;
  staff: string;
  customer: string;
  mobile: string;
  service: string;
  amount: number;
  mine: boolean;
};

export const advanceDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureAdvanceTable(sql);
    const date = indiaToday();
    const open = await openAdvances(sql, context.userId);
    const paid = role === "admin" ? await paidAdvances(sql) : [];
    const received = await sql<{ total: number }>`
      select coalesce(sum(amount), 0)::int as total from customer_advance where taken_on = ${date}
    `;
    return { role, held: open.reduce((sum, line) => sum + line.amount, 0), received: Number(received[0]?.total ?? 0), open, paid };
  });

export const closingAdvance = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    await requireClose(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureAdvanceTable(sql);
    const released = await releaseAdvanceCharges(sql);
    if (released.length > 0) {
      try {
        await stampAdvanceHeld(sql, released);
      } catch {
        // Live figures below are taken from the advance rows.
      }
    }
    const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
    const book = bookRow[0] ? asJson(bookRow[0].data) : null;
    const last = [...(book?.cashCloses ?? [])].filter((item) => item.date < date).sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
    const rows = await sql<{ id: string; taken_on: string; used_on: string | null; staff_name: string; customer: string; mobile: string; service: string; amount: number }>`
      select id, taken_on::text as taken_on, used_on::text as used_on, staff_name, customer, mobile, service, amount from customer_advance
    `;
    const heldOf = (asOf: string) =>
      rows.reduce((sum, row) => {
        const taken = String(row.taken_on).slice(0, 10);
        const used = row.used_on ? String(row.used_on).slice(0, 10) : "";
        if (taken > asOf || (used && used <= asOf)) return sum;
        return sum + Number(row.amount);
      }, 0);
    const open = rows
      .filter((row) => {
        const taken = String(row.taken_on).slice(0, 10);
        const used = row.used_on ? String(row.used_on).slice(0, 10) : "";
        return taken <= date && (!used || used > date);
      })
      .map((row) => ({
        id: row.id,
        date: String(row.taken_on).slice(0, 10),
        staff: row.staff_name,
        customer: row.customer,
        mobile: row.mobile,
        service: row.service,
        amount: Number(row.amount),
      }));
    const paid = rows
      .filter((row) => row.used_on && String(row.used_on).slice(0, 10) === date)
      .map((row) => ({
        id: row.id,
        date: String(row.taken_on).slice(0, 10),
        staff: row.staff_name,
        customer: row.customer,
        mobile: row.mobile,
        service: row.service,
        amount: Number(row.amount),
      }));
    const received = rows.reduce((sum, row) => (String(row.taken_on).slice(0, 10) === date ? sum + Number(row.amount) : sum), 0);
    const used = rows.reduce((sum, row) => (row.used_on && String(row.used_on).slice(0, 10) === date ? sum + Number(row.amount) : sum), 0);
    const lastDate = last?.date ?? "";
    const taken = rows.reduce((sum, row) => {
      const on = String(row.taken_on).slice(0, 10);
      if (!lastDate || on <= lastDate || on > date) return sum;
      return sum + Number(row.amount);
    }, 0);
    const served = rows.reduce((sum, row) => {
      const taken = String(row.taken_on).slice(0, 10);
      const usedOn = row.used_on ? String(row.used_on).slice(0, 10) : "";
      if (!lastDate || !usedOn || usedOn > date || usedOn <= lastDate || taken > lastDate) return sum;
      return sum + Number(row.amount);
    }, 0);
    return { held: heldOf(date), lastDate, lastHeld: last ? heldOf(last.date) : 0, received, used, served, taken, open, paid, tracked: rows.length > 0 };
  });

export const addAdvance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { customer: string; mobile: string; service: string; amount: number }) => {
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    const service = input.service.trim().slice(0, 60);
    const amount = Math.round(Number(input.amount));
    if (!customer) throw new Error("Enter the customer name.");
    if (!service) throw new Error("Enter the service.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount received.");
    return { customer, mobile, service, amount };
  })
  .handler(async ({ context, data }) => {
    await requireMember(context.userId);
    const date = indiaToday();
    await withTransaction(async (sql) => {
      await ensureAdvanceTable(sql);
      const role = await requireMember(context.userId);
      if (role === "closer") throw new Error("This login is only for the closing.");
      if (role === "employee" && (await dayIsClosed(sql, date))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      await sql`insert into customer_advance (id, taken_on, user_id, staff_name, customer, mobile, service, amount)
        values (${crypto.randomUUID()}, ${date}, ${context.userId}, ${staff}, ${data.customer}, ${data.mobile}, ${data.service}, ${data.amount})`;
      await stampAdvanceHeld(sql);
    });
    return { ok: true };
  });

export const giveAdvanceService = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; amount: number }) => {
    const id = input.id.trim();
    const amount = Math.round(Number(input.amount));
    if (!id) throw new Error("That advance was not found.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount served.");
    return { id, amount };
  })
  .handler(async ({ context, data }) => {
    await requireMember(context.userId);
    const date = indiaToday();
    const result = await withTransaction(async (sql) => {
      await ensureAdvanceTable(sql);
      const role = await requireMember(context.userId);
      if (role === "closer") throw new Error("This login is only for the closing.");
      const rows = await sql<{ id: string; taken_on: string; user_id: string; staff_name: string; customer: string; mobile: string; service: string; amount: number; used_on: string | null }>`
        select id, taken_on::text as taken_on, user_id, staff_name, customer, mobile, service, amount, used_on::text as used_on from customer_advance where id = ${data.id}`;
      const advance = rows[0];
      if (!advance) throw new Error("That advance was not found.");
      if (advance.used_on) throw new Error("This service is already entered.");
      const full = Number(advance.amount);
      if (data.amount > full) throw new Error("That is more than the advance.");
      const taken = String(advance.taken_on).slice(0, 10);
      if (role === "employee" && taken === date && (await dayIsClosed(sql, date))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      const served = data.amount;
      const left = full - served;
      if (left > 0) {
        await sql`update customer_advance set amount = ${served} where id = ${data.id}`;
        await sql`insert into customer_advance (id, taken_on, user_id, staff_name, customer, mobile, service, amount)
          values (${crypto.randomUUID()}, ${taken}, ${advance.user_id}, ${advance.staff_name}, ${advance.customer}, ${advance.mobile}, ${advance.service}, ${left})`;
      }
      await sql`update customer_advance set used_on = ${date}, used_entry_id = null where id = ${data.id}`;
      await stampAdvanceHeld(sql);
      return { countedToday: false, left };
    });
    return { ok: true, countedToday: result.countedToday, left: result.left };
  });

export const removeAdvance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    const role = await requireMember(context.userId);
    const date = indiaToday();
    await withTransaction(async (sql) => {
      await ensureAdvanceTable(sql);
      const rows = await sql<{ user_id: string; taken_on: string; used_on: string | null }>`
        select user_id, taken_on::text as taken_on, used_on::text as used_on from customer_advance where id = ${id}`;
      const row = rows[0];
      if (!row) throw new Error("That advance was not found.");
      if (role === "closer") throw new Error("This login is only for the closing.");
      if (row.used_on) throw new Error("The service is already entered. Delete that charge on the counter first.");
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can delete only your own advance.");
      if (role === "employee" && String(row.taken_on).slice(0, 10) !== date) throw new Error("A past day cannot be changed.");
      if (role === "employee" && (await dayIsClosed(sql, date))) throw new Error("This day is closed. A new day starts tomorrow.");
      await sql`delete from customer_advance where id = ${id}`;
      await stampAdvanceHeld(sql);
    });
    return { ok: true };
  });

export type PaidAdvance = {
  id: string;
  date: string;
  used: string;
  staff: string;
  customer: string;
  mobile: string;
  service: string;
  amount: number;
};

export const updateAdvance = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; customer: string; mobile: string; service: string; amount: number }) => {
    const id = input.id.trim();
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    const service = input.service.trim().slice(0, 60);
    const amount = Math.round(Number(input.amount));
    if (!id) throw new Error("That advance was not found.");
    if (!customer) throw new Error("Enter the customer name.");
    if (!service) throw new Error("Enter the service.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount.");
    return { id, customer, mobile, service, amount };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    await withTransaction(async (sql) => {
      await ensureAdvanceTable(sql);
      await ensureServiceTable(sql);
      const rows = await sql<{ id: string; taken_on: string; user_id: string; staff_name: string; customer: string; mobile: string; service: string; amount: number; used_on: string | null; used_entry_id: string | null }>`
        select id, taken_on::text as taken_on, user_id, staff_name, customer, mobile, service, amount, used_on::text as used_on, used_entry_id
        from customer_advance where id = ${data.id}`;
      const row = rows[0];
      if (!row) throw new Error("That advance was not found.");
      const old = Number(row.amount);
      const delta = data.amount - old;
      if (row.used_on && delta !== 0) {
        const taken = String(row.taken_on).slice(0, 10);
        const siblings = await sql<{ id: string; amount: number }>`
          select id, amount from customer_advance
          where used_on is null and taken_on = ${taken} and user_id = ${row.user_id}
            and customer = ${row.customer} and service = ${row.service} and id <> ${row.id}
          order by created_at limit 1`;
        const sibling = siblings[0];
        if (delta > 0) {
          if (!sibling || Number(sibling.amount) < delta) throw new Error("That is more than the advance still held.");
          const left = Number(sibling.amount) - delta;
          if (left === 0) await sql`delete from customer_advance where id = ${sibling.id}`;
          else await sql`update customer_advance set amount = ${left} where id = ${sibling.id}`;
        } else if (sibling) {
          await sql`update customer_advance set amount = ${Number(sibling.amount) - delta} where id = ${sibling.id}`;
        } else {
          await sql`insert into customer_advance (id, taken_on, user_id, staff_name, customer, mobile, service, amount)
            values (${crypto.randomUUID()}, ${taken}, ${row.user_id}, ${row.staff_name}, ${data.customer}, ${data.mobile}, ${data.service}, ${-delta})`;
        }
      }
      await sql`update customer_advance set customer = ${data.customer}, mobile = ${data.mobile}, service = ${data.service}, amount = ${data.amount} where id = ${data.id}`;
      if (row.used_entry_id) {
        const entries = await sql<{ taken_on: string }>`select taken_on::text as taken_on from service_entry where id = ${row.used_entry_id}`;
        await sql`update service_entry set service = ${data.service}, customer = ${data.customer}, mobile = ${data.mobile}, amount = ${data.amount} where id = ${row.used_entry_id}`;
        const entryDate = entries[0]?.taken_on?.slice(0, 10);
        if (entryDate) await rollCounterDay(sql, entryDate);
      }
      await stampAdvanceHeld(sql);
    });
    return { ok: true };
  });

async function paidAdvances(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>): Promise<PaidAdvance[]> {
  const rows = await sql<{ id: string; taken_on: string; used_on: string; staff_name: string; customer: string; mobile: string; service: string; amount: number }>`
    select id, taken_on::text as taken_on, used_on::text as used_on, staff_name, customer, mobile, service, amount
    from customer_advance where used_on is not null order by used_on desc, created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    date: String(row.taken_on).slice(0, 10),
    used: String(row.used_on).slice(0, 10),
    staff: row.staff_name,
    customer: row.customer,
    mobile: row.mobile,
    service: row.service,
    amount: Number(row.amount),
  }));
}

async function ensureAdvanceTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists customer_advance (
      id text primary key,
      taken_on date not null,
      user_id text not null,
      staff_name text not null,
      customer text not null,
      mobile text not null,
      service text not null,
      amount integer not null,
      used_on date,
      used_entry_id text,
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(`create index if not exists customer_advance_taken_on on customer_advance (taken_on)`);
}

async function openAdvances(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, userId: string): Promise<OpenAdvance[]> {
  const rows = await sql<{ id: string; taken_on: string; user_id: string; staff_name: string; customer: string; mobile: string; service: string; amount: number }>`
    select id, taken_on::text as taken_on, user_id, staff_name, customer, mobile, service, amount
    from customer_advance where used_on is null order by taken_on, created_at
  `;
  return rows.map((row) => ({
    id: row.id,
    date: String(row.taken_on).slice(0, 10),
    staff: row.staff_name,
    customer: row.customer,
    mobile: row.mobile,
    service: row.service,
    amount: Number(row.amount),
    mine: row.user_id === userId,
  }));
}

async function stampAdvanceHeld(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, extraDates: string[] = []) {
  const released = await releaseAdvanceCharges(sql);
  const healed = [...new Set([...(await healAdvanceEntries(sql)), ...extraDates, ...released])];
  const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
    select data, touches from centre_book where id = 'centre' for update
  `;
  const row = readRow(current[0]);
  if (!row) return;
  let data = row.data;
  const touches = { ...(row.touches ?? {}) };
  const now = new Date().toISOString();
  if (healed.length > 0) {
    const synced = await resyncCounterSplits(sql, data);
    data = synced.book;
    for (const date of healed) touches[`day:${date}`] = now;
  }
  const advances = await sql<{ taken_on: string; used_on: string | null; amount: number }>`
    select taken_on::text as taken_on, used_on::text as used_on, amount from customer_advance
  `;
  const ordered = [...(data.cashCloses ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  let previous = "";
  let changed = false;
  const cashCloses = ordered.map((close) => {
    const held = heldOn(advances, close.date);
    const served = servedSince(advances, previous, close.date);
    const advanceIn = advanceTakenSince(advances, previous, close.date);
    previous = close.date;
    if ((close.advanceHeld ?? 0) === held && (close.advanceServed ?? 0) === served && (close.advanceIn ?? 0) === advanceIn) return close;
    changed = true;
    touches[close.date] = now;
    return { ...close, advanceHeld: held, advanceServed: served, advanceIn };
  });
  if (!changed && healed.length === 0) return;
  await writeBook(sql, { ...data, cashCloses }, touches);
}

function heldOn(
  advances: { taken_on: string; used_on: string | null; amount: number }[],
  asOf: string,
) {
  return advances.reduce((sum, item) => {
    const taken = String(item.taken_on).slice(0, 10);
    const used = item.used_on ? String(item.used_on).slice(0, 10) : "";
    if (taken > asOf || (used && used <= asOf)) return sum;
    return sum + Number(item.amount);
  }, 0);
}

function advanceTakenSince(
  advances: { taken_on: string; used_on: string | null; amount: number }[],
  previous: string,
  closeDate: string,
) {
  if (!previous) return 0;
  return advances.reduce((sum, item) => {
    const taken = String(item.taken_on).slice(0, 10);
    if (taken <= previous || taken > closeDate) return sum;
    return sum + Number(item.amount);
  }, 0);
}

function servedSince(
  advances: { taken_on: string; used_on: string | null; amount: number }[],
  previous: string,
  closeDate: string,
) {
  if (!previous) return 0;
  return advances.reduce((sum, item) => {
    const taken = String(item.taken_on).slice(0, 10);
    const used = item.used_on ? String(item.used_on).slice(0, 10) : "";
    if (!used || used > closeDate || used <= previous || taken > previous) return sum;
    return sum + Number(item.amount);
  }, 0);
}

async function releaseAdvanceCharges(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>): Promise<string[]> {
  await ensureServiceTable(sql);
  const rows = await sql<{ taken_on: string }>`
    select e.taken_on::text as taken_on
    from customer_advance a
    join service_entry e on e.id = a.used_entry_id
    where a.used_entry_id is not null
  `;
  if (rows.length === 0) return [];
  await sql`delete from service_entry where id in (select used_entry_id from customer_advance where used_entry_id is not null)`;
  await sql`update customer_advance set used_entry_id = null where used_entry_id is not null`;
  const dates = [...new Set(rows.map((row) => String(row.taken_on).slice(0, 10)))];
  await rollCounterDay(sql, dates[0] ?? indiaToday());
  return dates;
}

async function healAdvanceEntries(_sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>): Promise<string[]> {
  void _sql;
  return [];
}

async function reopenAdvance(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, entryId: string) {
  await ensureAdvanceTable(sql);
  await sql`update customer_advance set used_on = null, used_entry_id = null where used_entry_id = ${entryId}`;
}

export type PayoutRow = CentrePayout & { mine: boolean };

export const listCentrePayouts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await readPayouts(sql, context.userId);
    const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
    const stored = bookRow[0] ? asJson(bookRow[0].data) : null;
    const saved = (stored?.payouts ?? []).map((item) => ({ ...item, mine: false }));
    const list = rows.length > 0 ? rows : saved;
    const closed = await dayIsClosed(sql, date);
    return {
      role,
      closed,
      rows: role === "employee" ? list.filter((row) => row.date === date) : list,
    };
  });

export const addCentrePayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { date: string; category: string; amount: number; note: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a date.");
    const category = PAYOUT_KINDS.some((item) => item.id === input.category) ? input.category : "";
    const amount = Math.round(Number(input.amount));
    const note = input.note.trim().slice(0, 80);
    if (!category) throw new Error("Choose what was paid.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount.");
    if (category === "other" && !note) throw new Error("Write what was paid.");
    return { date: input.date, category, amount, note };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensurePayoutTable(sql);
      if (role === "employee" && data.date !== indiaToday()) throw new Error("A past day cannot be changed.");
      if (role === "closer" && (await dayIsAccepted(sql, data.date))) throw new Error("This closing is accepted.");
      if (role === "employee" && (await dayIsClosed(sql, data.date))) throw new Error("This day is closed. A new day starts tomorrow.");
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      await sql`insert into centre_payout (id, taken_on, user_id, staff_name, category, amount, note)
        values (${crypto.randomUUID()}, ${data.date}, ${context.userId}, ${staff}, ${data.category}, ${data.amount}, ${data.note})`;
    });
    return { ok: true };
  });

export const removeCentrePayout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    const trimmed = id.trim();
    if (!trimmed) throw new Error("That payment was not found.");
    return trimmed;
  })
  .handler(async ({ context, data: id }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensurePayoutTable(sql);
      const rows = await sql<{ user_id: string; taken_on: string }>`
        select user_id, taken_on::text as taken_on from centre_payout where id = ${id}`;
      const row = rows[0];
      if (!row) throw new Error("That payment was not found.");
      const date = String(row.taken_on).slice(0, 10);
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can delete only your own payment.");
      if (role === "employee" && date !== indiaToday()) throw new Error("A past day cannot be changed.");
      if (role === "closer" && (await dayIsAccepted(sql, date))) throw new Error("This closing is accepted.");
      if (role === "employee" && (await dayIsClosed(sql, date))) throw new Error("This day is closed. A new day starts tomorrow.");
      await sql`delete from centre_payout where id = ${id}`;
    });
    return { ok: true };
  });

export type DiaryLine = {
  id: string;
  date: string;
  note: string;
  customer: string;
  mobile: string;
  by: string;
  mine: boolean;
  done: boolean;
};

export const diaryDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: { date: string; q?: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a date.");
    const q = (input.q ?? "").replace(/[%_]/g, "").trim().slice(0, 40);
    return { date: input.date, q };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureDiaryTable(sql);
    if (data.q) {
      const like = `%${data.q}%`;
      const rows = await sql<DiarySql>`
        select id, for_date::text as for_date, note, customer, mobile, staff_name, user_id, done_at::text as done_at
        from centre_diary
        where (${role} = 'admin' or user_id = ${context.userId})
          and (note ilike ${like} or customer ilike ${like} or mobile like ${like})
        order by for_date desc, created_at desc
        limit 40
      `;
      return { role, earlier: [], day: [], coming: [], found: rows.map((row) => diaryLine(row, context.userId)) };
    }
    const earlier = await sql<DiarySql>`
      select id, for_date::text as for_date, note, customer, mobile, staff_name, user_id, done_at::text as done_at
      from centre_diary
      where done_at is null and for_date < ${data.date}::date
        and (${role} = 'admin' or user_id = ${context.userId})
      order by for_date, created_at
      limit 30
    `;
    const day = await sql<DiarySql>`
      select id, for_date::text as for_date, note, customer, mobile, staff_name, user_id, done_at::text as done_at
      from centre_diary
      where for_date = ${data.date}::date
        and (${role} = 'admin' or user_id = ${context.userId})
      order by done_at nulls first, created_at
    `;
    const coming = await sql<DiarySql>`
      select id, for_date::text as for_date, note, customer, mobile, staff_name, user_id, done_at::text as done_at
      from centre_diary
      where done_at is null and for_date > ${data.date}::date and for_date <= (${data.date}::date + interval '7 days')
        and (${role} = 'admin' or user_id = ${context.userId})
      order by for_date, created_at
      limit 20
    `;
    const map = (rows: DiarySql[]) => rows.map((row) => diaryLine(row, context.userId));
    return { role, earlier: map(earlier), day: map(day), coming: map(coming), found: [] };
  });

export const addDiary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { date: string; note: string; customer: string; mobile: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a date.");
    const note = input.note.trim().slice(0, 240);
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    if (!note) throw new Error("Write the note.");
    return { date: input.date, note, customer, mobile };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    if (role === "closer") throw new Error("This login is only for the closing.");
    await withTransaction(async (sql) => {
      await ensureDiaryTable(sql);
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      await sql`insert into centre_diary (id, for_date, note, customer, mobile, user_id, staff_name)
        values (${crypto.randomUUID()}, ${data.date}, ${data.note}, ${data.customer}, ${data.mobile}, ${context.userId}, ${staff})`;
    });
    return { ok: true };
  });

export const setDiaryDone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; done: boolean }) => {
    const id = input.id.trim();
    if (!id) throw new Error("That note was not found.");
    return { id, done: Boolean(input.done) };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensureDiaryTable(sql);
      const rows = await sql<{ user_id: string }>`select user_id from centre_diary where id = ${data.id}`;
      const row = rows[0];
      if (!row) throw new Error("That note was not found.");
      if (role === "closer") throw new Error("This login is only for the closing.");
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can change only your own note.");
      if (data.done) await sql`update centre_diary set done_at = now() where id = ${data.id}`;
      else await sql`update centre_diary set done_at = null where id = ${data.id}`;
    });
    return { ok: true };
  });

export const removeDiary = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    const trimmed = id.trim();
    if (!trimmed) throw new Error("That note was not found.");
    return trimmed;
  })
  .handler(async ({ context, data: id }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensureDiaryTable(sql);
      const rows = await sql<{ user_id: string }>`select user_id from centre_diary where id = ${id}`;
      const row = rows[0];
      if (!row) throw new Error("That note was not found.");
      if (role === "closer") throw new Error("This login is only for the closing.");
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can delete only your own note.");
      await sql`delete from centre_diary where id = ${id}`;
    });
    return { ok: true };
  });

type DiarySql = {
  id: string;
  for_date: string;
  note: string;
  customer: string;
  mobile: string;
  staff_name: string;
  user_id: string;
  done_at: string | null;
};

function diaryLine(row: DiarySql, userId: string): DiaryLine {
  return {
    id: row.id,
    date: String(row.for_date).slice(0, 10),
    note: row.note,
    customer: row.customer || "",
    mobile: row.mobile || "",
    by: row.staff_name,
    mine: row.user_id === userId,
    done: Boolean(row.done_at),
  };
}

async function ensureDiaryTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists centre_diary (
      id text primary key,
      for_date date not null,
      note text not null,
      customer text not null default '',
      mobile text not null default '',
      user_id text not null,
      staff_name text not null,
      done_at timestamptz,
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(`create index if not exists centre_diary_date on centre_diary (for_date)`);
}

async function ensurePayoutTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists centre_payout (
      id text primary key,
      taken_on date not null,
      user_id text not null,
      staff_name text not null,
      category text not null,
      amount integer not null,
      note text not null default '',
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(`create index if not exists centre_payout_taken_on on centre_payout (taken_on)`);
}

async function readPayouts(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  userId: string,
): Promise<PayoutRow[]> {
  await ensurePayoutTable(sql);
  const rows = await sql<{ id: string; taken_on: string; category: string; amount: number; note: string; staff_name: string; user_id: string }>`
    select id, taken_on::text as taken_on, category, amount, note, staff_name, user_id
    from centre_payout order by taken_on, created_at
  `;
  return rows.map((row) => ({
    id: row.id,
    date: String(row.taken_on).slice(0, 10),
    category: row.category,
    amount: Number(row.amount) || 0,
    note: row.note || "",
    by: row.staff_name,
    mine: row.user_id === userId,
  }));
}

export const loadSharedBook = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ data: LedgerData; touches: Record<string, string> }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const row = rows[0];
    if (!row) return null;
    const stored = asJson(row.data);
    const savedPayouts = stored.payouts ?? [];
    delete stored.payouts;
    const fromTable = role === "employee" ? [] : (await readPayouts(sql, context.userId)).map(({ mine: _mine, ...item }) => item);
    if (role === "admin" && fromTable.length === 0 && savedPayouts.length > 0) {
      await replacePayouts(sql, savedPayouts, context.userId);
    }
    const payouts = role === "employee" ? [] : fromTable.length > 0 ? fromTable : savedPayouts;
    const storedBook = role === "admin" ? stored : role === "closer" ? closerView(stored) : staffView(stored);
    const book = { ...storedBook, payouts: role === "employee" ? [] : payouts };
    return { book, touches: role === "employee" ? {} : (asJson(row.touches) ?? {}) } satisfies SharedBook;
  });

export type ServiceLine = {
  id: string;
  staff: string;
  service: string;
  customer: string;
  mobile: string;
  amount: number;
  personalGpay: boolean;
  department: number;
  bankDepartment: number;
};

export const addServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { service: string; customer: string; mobile: string; amount: number; personalGpay?: boolean; department?: number; bankDepartment?: number }) => {
    const service = input.service.trim().slice(0, 60);
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    const amount = Math.round(Number(input.amount));
    const personalGpay = Boolean(input.personalGpay);
    const department = departmentFee(personalGpay, input.department);
    const bankDepartment = departmentFee(true, input.bankDepartment);
    if (!service) throw new Error("Enter the service.");
    if (!customer) throw new Error("Enter the customer name.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the service charge.");
    return { service, customer, mobile, amount, personalGpay, department, bankDepartment };
  })
  .handler(async ({ context, data }) => {
    await requireMember(context.userId);
    const date = indiaToday();
    const total = await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      const role = await requireMember(context.userId);
      if (role === "closer") throw new Error("This login cannot enter a charge.");
      if (role === "employee" && (await dayIsClosed(sql, date))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      const id = crypto.randomUUID();
      await sql`insert into service_entry (id, taken_on, user_id, staff_name, service, customer, mobile, amount, personal_gpay, department, bank_department)
        values (${id}, ${date}, ${context.userId}, ${staff}, ${data.service}, ${data.customer}, ${data.mobile}, ${data.amount}, ${data.personalGpay}, ${data.department}, ${data.bankDepartment})`;
      await rollCounterDay(sql, date);
      const mine = await sql<{ total: number }>`
        select coalesce(sum(amount), 0)::int as total from service_entry
        where taken_on = ${date} and user_id = ${context.userId}`;
      return Number(mine[0]?.total ?? 0);
    });
    return { total };
  });

export type GpayLine = {
  date: string;
  staff: string;
  customer: string;
  mobile: string;
  service: string;
  amount: number;
  department: number;
};

export const personalGpayMonth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a month.");
    return month;
  })
  .handler(async ({ context, data: month }) => {
    await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureServiceTable(sql);
    const rows = await sql<{ taken_on: string; staff: string; customer: string; mobile: string; service: string; amount: number; department: number }>`
      select taken_on::text as taken_on, staff_name as staff, customer, mobile, service, amount, department
      from service_entry
      where personal_gpay and to_char(taken_on, 'YYYY-MM') = ${month}
      order by taken_on desc, created_at desc
    `;
    return {
      lines: rows.map((row) => ({
        date: String(row.taken_on).slice(0, 10),
        staff: row.staff,
        customer: row.customer,
        mobile: row.mobile,
        service: row.service,
        amount: Number(row.amount) || 0,
        department: Number(row.department) || 0,
      })),
    };
  });

export const serviceDay = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureServiceTable(sql);
    const closed = await dayIsClosed(sql, date);
    if (role === "employee") {
      const rows = await sql<ServiceLine>`
        select id, staff_name as staff, service, customer, mobile, amount, personal_gpay as "personalGpay", department, bank_department as "bankDepartment"
        from service_entry where taken_on = ${date} and user_id = ${context.userId}
        order by created_at desc`;
      const lines = rows.map((line) => ({ ...line, amount: Number(line.amount), personalGpay: Boolean(line.personalGpay), department: Number(line.department) || 0, bankDepartment: Number(line.bankDepartment) || 0 }));
      return { role, total: lines.reduce((sum, line) => sum + line.amount, 0), lines, closed };
    }
    await withTransaction(async (tx) => {
      await rollCounterDay(tx, date);
    });
    const lines = await sql<ServiceLine>`
      select id, staff_name as staff, service, customer, mobile, amount, personal_gpay as "personalGpay", department, bank_department as "bankDepartment"
      from service_entry where taken_on = ${date} order by created_at desc`;
    return {
      role,
      total: lines.reduce((sum, line) => sum + Number(line.amount), 0),
      lines: lines.map((line) => ({ ...line, amount: Number(line.amount), personalGpay: Boolean(line.personalGpay), department: Number(line.department) || 0, bankDepartment: Number(line.bankDepartment) || 0 })),
      closed,
    };
  });

export const removeServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    await requireAdmin(context.userId);
    await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      const rows = await sql<{ taken_on: string }>`select taken_on::text as taken_on from service_entry where id = ${id}`;
      await sql`delete from service_entry where id = ${id}`;
      await reopenAdvance(sql, id);
      const date = rows[0]?.taken_on?.slice(0, 10);
      if (date) await rollCounterDay(sql, date);
      await stampAdvanceHeld(sql);
    });
    return { ok: true };
  });

export const updateServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; service: string; customer: string; mobile: string; amount: number; personalGpay?: boolean; department?: number; bankDepartment?: number }) => {
    const id = input.id.trim();
    const service = input.service.trim().slice(0, 60);
    const customer = input.customer.trim().slice(0, 80);
    const mobile = optionalMobile(input.mobile);
    const amount = Math.round(Number(input.amount));
    const personalGpay = Boolean(input.personalGpay);
    const department = departmentFee(personalGpay, input.department);
    const bankDepartment = departmentFee(true, input.bankDepartment);
    if (!id) throw new Error("That charge was not found.");
    if (!service) throw new Error("Enter the service.");
    if (!customer) throw new Error("Enter the customer name.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the service charge.");
    return { id, service, customer, mobile, amount, personalGpay, department, bankDepartment };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      const rows = await sql<{ user_id: string; taken_on: string }>`
        select user_id, taken_on::text as taken_on from service_entry where id = ${data.id}`;
      const row = rows[0];
      if (!row) throw new Error("That charge was not found.");
      if (role === "closer") throw new Error("This login cannot change a charge.");
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can edit only your own charge.");
      if (role === "employee" && (await dayIsClosed(sql, row.taken_on.slice(0, 10)))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      if (role === "employee" && row.taken_on.slice(0, 10) !== indiaToday()) throw new Error("A past day cannot be changed.");
      await ensureAdvanceTable(sql);
      const linked = await sql<{ id: string }>`select id from customer_advance where used_entry_id = ${data.id}`;
      if (linked[0] && data.personalGpay) throw new Error("This charge was paid in advance. It is already in the centre, not a personal GPay.");
      await sql`update service_entry set service = ${data.service}, customer = ${data.customer}, mobile = ${data.mobile}, amount = ${data.amount}, personal_gpay = ${data.personalGpay}, department = ${data.department}, bank_department = ${data.bankDepartment} where id = ${data.id}`;
      await sql`update customer_advance set service = ${data.service}, customer = ${data.customer}, mobile = ${data.mobile}, amount = ${data.amount} where used_entry_id = ${data.id}`;
      await rollCounterDay(sql, row.taken_on.slice(0, 10));
      await stampAdvanceHeld(sql);
    });
    return { ok: true };
  });

async function dayIsClosed(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, date: string) {
  const current = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = current[0] ? asJson(current[0].data) : null;
  return (book?.cashCloses ?? []).some((close) => close.date === date);
}

async function dayIsAccepted(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, date: string) {
  const current = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = current[0] ? asJson(current[0].data) : null;
  return Boolean((book?.cashCloses ?? []).find((close) => close.date === date)?.accepted);
}

async function ensureLoginTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists login_log (
      id text primary key,
      user_id text not null,
      name text not null,
      role text not null,
      at timestamptz not null default now()
    )`,
  );
  await sql.query(`alter table login_log add column if not exists device text not null default ''`);
  await sql.query(`alter table login_log add column if not exists place text not null default ''`);
  await sql.query(`alter table login_log add column if not exists ip text not null default ''`);
  await sql.query(`alter table login_log add column if not exists screen text not null default ''`);
}

function deviceLabel(agent: string, mobile: string | null) {
  let device = "Unknown device";
  if (/iPad/i.test(agent)) device = "iPad";
  else if (/iPhone/i.test(agent)) device = "iPhone";
  else if (/Android/i.test(agent)) device = /Mobile/i.test(agent) ? "Android phone" : "Android tablet";
  else if (/Windows/i.test(agent)) device = "Windows computer";
  else if (/Mac OS/i.test(agent)) device = "Mac";
  else if (/CrOS/i.test(agent)) device = "Chromebook";
  else if (/Linux/i.test(agent)) device = "Linux computer";
  if (mobile === "?1" && !/phone|iPhone|iPad|Android/i.test(device)) device = `${device} phone`;
  let browser = "";
  if (/Edg\//i.test(agent)) browser = "Edge";
  else if (/OPR\//i.test(agent) || /Opera/i.test(agent)) browser = "Opera";
  else if (/Chrome\//i.test(agent)) browser = "Chrome";
  else if (/Firefox\//i.test(agent)) browser = "Firefox";
  else if (/Safari\//i.test(agent)) browser = "Safari";
  return browser ? `${browser} on ${device}` : device;
}

function isAppHost(ip: string) {
  const match = /^(\d+)\.(\d+)\./.exec(ip);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return first === 8 && second >= 228 && second <= 237;
}

function listedIps(value: string | null) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function clientIp(headers: Headers) {
  const candidates = [
    ...listedIps(headers.get("cf-connecting-ip")),
    ...listedIps(headers.get("true-client-ip")),
    ...listedIps(headers.get("x-vercel-forwarded-for")),
    ...listedIps(headers.get("x-real-ip")),
    ...listedIps(headers.get("x-forwarded-for")),
  ];
  const usable = candidates.filter(
    (ip) => ip !== "::1" && !ip.startsWith("127.") && !ip.startsWith("10.") && !ip.startsWith("192.168.") && !ip.startsWith("172.") && !isAppHost(ip),
  );
  return (usable[0] ?? "").slice(0, 64);
}

async function networkPlace(ip: string) {
  if (!ip) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: ctrl.signal });
    if (!response.ok) return "";
    const data = (await response.json()) as { success?: boolean; city?: string; region?: string; country?: string };
    if (data.success === false) return "";
    return [data.city, data.region, data.country].filter(Boolean).join(", ").slice(0, 120);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export const recordLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { screen?: string } | undefined) => ({ screen: (input?.screen ?? "").slice(0, 40) }))
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureLoginTable(sql);
    const recent = await sql<{ id: string }>`
      select id from login_log where user_id = ${context.userId} and at > now() - interval '2 minutes' limit 1
    `;
    if (recent[0]) return { ok: true };
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const headers = request?.headers;
    const device = headers ? deviceLabel(headers.get("user-agent") ?? "", headers.get("sec-ch-ua-mobile")) : "";
    const ip = headers ? clientIp(headers) : "";
    const place = await networkPlace(ip);
    const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
    await sql`
      insert into login_log (id, user_id, name, role, device, place, ip, screen)
      values (${crypto.randomUUID()}, ${context.userId}, ${member[0]?.name || "Account"}, ${role}, ${device}, ${place}, ${ip}, ${data.screen})
    `;
    return { ok: true };
  });

export const loginLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureLoginTable(sql);
    const rows = await sql<{ name: string; role: string; at: string; device: string; place: string; ip: string; screen: string }>`
      select name, role, at::text as at, device, place, ip, screen from login_log
      where (at at time zone 'Asia/Kolkata')::date = ${date}::date
      order by at desc
    `;
    return rows.map((row) => ({
      name: row.name,
      role: row.role === "admin" ? "Admin" : row.role === "closer" ? "Closing" : "Staff",
      at: row.at,
      device: row.device || "",
      place: row.place || "",
      ip: row.ip || "",
      screen: row.screen || "",
    }));
  });

async function rollCounterDay(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, date: string) {
  const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
    select data, touches from centre_book where id = 'centre' for update
  `;
  const row = readRow(current[0]);
  if (!row) return;
  const synced = await resyncCounterSplits(sql, row.data);
  const touches = { ...row.touches, [`day:${date}`]: new Date().toISOString() };
  await writeBook(sql, synced.book, touches);
}

function normStaffName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function resyncCounterSplits(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  book: LedgerData,
): Promise<{ book: LedgerData; dates: string[] }> {
  await ensureServiceTable(sql);
  const rows = await sql<{ taken_on: string; staff_name: string; amount: number }>`
    select taken_on::text as taken_on, staff_name, coalesce(sum(amount), 0)::int as amount
    from service_entry group by taken_on, staff_name
  `;
  const clocks = await sql<{ taken_on: string; staff_name: string; first_at: string; last_at: string }>`
    select taken_on::text as taken_on, staff_name,
      to_char(min(created_at at time zone 'Asia/Kolkata'), 'HH24:MI:SS') as first_at,
      to_char(max(created_at at time zone 'Asia/Kolkata'), 'HH24:MI:SS') as last_at
    from service_entry group by taken_on, staff_name
  `;
  const clockByDate = new Map<string, Map<string, { first: string; last: string }>>();
  for (const entry of clocks) {
    const date = String(entry.taken_on).slice(0, 10);
    const employee = (book.employees ?? []).find((person) => normStaffName(person.name) === normStaffName(entry.staff_name));
    if (!employee) continue;
    const byStaff = clockByDate.get(date) ?? new Map<string, { first: string; last: string }>();
    byStaff.set(employee.id, { first: entry.first_at, last: entry.last_at });
    clockByDate.set(date, byStaff);
  }
  const gpayRows = await sql<{ taken_on: string; amount: number; department: number }>`
    select taken_on::text as taken_on, coalesce(sum(amount), 0)::int as amount, coalesce(sum(department), 0)::int as department
    from service_entry where personal_gpay group by taken_on
  `;
  const gpayByDate = new Map(gpayRows.map((entry) => [String(entry.taken_on).slice(0, 10), Number(entry.amount) || 0]));
  const bankRows = await sql<{ taken_on: string; amount: number }>`
    select taken_on::text as taken_on, coalesce(sum(bank_department), 0)::int as amount
    from service_entry group by taken_on
  `;
  const bankByDate = new Map(bankRows.map((entry) => [String(entry.taken_on).slice(0, 10), Number(entry.amount) || 0]));
  if (rows.length === 0) return { book, dates: [] };
  await ensureCustomerTable(sql);
  const creditRows = await sql<{ taken_on: string; amount: number }>`
    select s.taken_on::text as taken_on, coalesce(sum(s.amount), 0)::int as amount
    from service_entry s
    where not s.personal_gpay
      and exists (
        select 1 from customer_move m
        where m.kind = 'credit'
          and m.taken_on = s.taken_on
          and lower(trim(m.customer)) = lower(trim(s.customer))
      )
    group by s.taken_on
  `;
  const creditByDate = new Map(creditRows.map((entry) => [String(entry.taken_on).slice(0, 10), Number(entry.amount) || 0]));
  const departmentByDate = new Map(gpayRows.map((entry) => [String(entry.taken_on).slice(0, 10), Number(entry.department) || 0]));
  const byDate = new Map<string, { amount: number; splits: Record<string, number>; personalGpay: number; departmentGpay: number; bankDepartment: number }>();
  for (const entry of rows) {
    const date = String(entry.taken_on).slice(0, 10);
    const bucket = byDate.get(date) ?? { amount: 0, splits: {}, personalGpay: gpayByDate.get(date) ?? 0, departmentGpay: departmentByDate.get(date) ?? 0, bankDepartment: bankByDate.get(date) ?? 0 };
    const value = Number(entry.amount) || 0;
    bucket.amount += value;
    const employee = (book.employees ?? []).find((person) => normStaffName(person.name) === normStaffName(entry.staff_name));
    if (employee && value > 0) bucket.splits[employee.id] = (bucket.splits[employee.id] ?? 0) + value;
    byDate.set(date, bucket);
  }
  const seen = new Set<string>();
  let days = (book.days ?? []).flatMap((day) => {
    const fresh = byDate.get(day.date);
    if (!fresh) return day.note.startsWith("Entered on the counter") ? [] : [day];
    seen.add(day.date);
    const creditService = creditByDate.get(day.date) ?? 0;
    if (!day.note.startsWith("Entered on the counter")) {
      return [{ ...day, personalGpay: fresh.personalGpay, departmentGpay: fresh.departmentGpay, bankDepartment: fresh.bankDepartment, creditService }];
    }
    if (fresh.amount <= 0) return [];
    return [{ ...day, amount: fresh.amount, splits: fresh.splits, personalGpay: fresh.personalGpay, departmentGpay: fresh.departmentGpay, bankDepartment: fresh.bankDepartment, creditService }];
  });
  for (const [date, fresh] of byDate) {
    if (seen.has(date) || fresh.amount <= 0) continue;
    days.push({ date, amount: fresh.amount, note: "Entered on the counter", splits: fresh.splits, personalGpay: fresh.personalGpay, departmentGpay: fresh.departmentGpay, bankDepartment: fresh.bankDepartment, creditService: creditByDate.get(date) ?? 0 });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  let next: LedgerData = { ...book, days };
  const today = indiaToday();
  for (const date of byDate.keys()) {
    if (date < today) next = applyImportedLeave(next, date, clockByDate.get(date));
  }
  return { book: next, dates: [...byDate.keys()] };
}

function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

async function ensureServiceTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists service_entry (
      id text primary key,
      taken_on date not null,
      user_id text not null,
      staff_name text not null,
      service text not null,
      customer text not null,
      mobile text not null,
      amount integer not null,
      created_at timestamptz not null default now()
    )`,
  );
  await sql.query(`alter table service_entry add column if not exists personal_gpay boolean not null default false`);
  await sql.query(`alter table service_entry add column if not exists department integer not null default 0`);
  await sql.query(`alter table service_entry add column if not exists bank_department integer not null default 0`);
  await sql.query(`create index if not exists service_entry_taken_on on service_entry (taken_on)`);
}

export const saveSharedBook = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: SharedBook) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    if (!data?.book || !Array.isArray(data.book.cashCloses)) throw new Error("Book is incomplete.");
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const merged = mergeBook(readRow(current[0]), data);
    const synced = await resyncCounterSplits(sql, merged.book);
    const now = new Date().toISOString();
    const touches = { ...merged.touches };
    for (const date of synced.dates) touches[`day:${date}`] = now;
    await writeBook(sql, synced.book, touches);
    await ensureAdvanceTable(sql);
    await stampAdvanceHeld(sql);
    const fresh = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const savedRow = readRow(fresh[0]);
    const saved = { book: savedRow?.data ?? synced.book, touches: savedRow?.touches ?? touches };
    try {
      await keepDailyBackup(sql, saved.book);
    } catch {
      // A backup problem must not lock the book.
    }
    return saved;
  });

export const saveSharedClose = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { date: string; close: CashClose | null }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a date.");
    return { date: input.date, close: input.close };
  })
  .handler(async ({ context, data }) => {
    const role = await requireClose(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const row = readRow(current[0]);
    if (!row) throw new Error("The admin has to sign in once before a closing can be saved.");
    const existing = (row.data.cashCloses ?? []).find((item) => item.date === data.date);
    if (role === "closer" && existing?.accepted) throw new Error("This closing is accepted.");
    const touches = { ...(row.touches ?? {}) };
    const closes = (row.data.cashCloses ?? []).filter((item) => item.date !== data.date);
    if (data.close) {
      const sent = role === "closer" ? { ...data.close, accepted: false, profitTaken: existing?.profitTaken ?? 0, profitNote: existing?.profitNote ?? "" } : data.close;
      const profitTaken = Math.round(Number(sent.profitTaken) || 0);
      closes.push({
        ...sent,
        date: data.date,
        countedBy: (sent.countedBy ?? "").trim().slice(0, 80),
        accepted: role === "closer" ? false : Boolean(sent.accepted),
        profitTaken: Number.isFinite(profitTaken) && profitTaken > 0 ? Math.min(profitTaken, 10000000) : 0,
        profitNote: (sent.profitNote ?? "").trim().slice(0, 80),
      });
    }
    closes.sort((a, b) => (a.date < b.date ? -1 : 1));
    touches[data.date] = new Date().toISOString();
    await ensureCustomerTable(sql);
    const position = await positionAsOf(sql, data.date);
    const stamped = closes.map((item) =>
      item.date === data.date ? { ...item, creditGiven: position.given, creditPaid: position.paid, credits: position.unpaid } : item,
    );
    const book = { ...row.data, cashCloses: stamped };
    await writeBook(sql, book, touches);
    await ensureAdvanceTable(sql);
    await stampAdvanceHeld(sql);
    const fresh = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const savedRow = readRow(fresh[0]);
    const saved = { book: savedRow?.data ?? book, touches: savedRow?.touches ?? touches };
    try {
      await keepDailyBackup(sql, saved.book);
    } catch {
      // A backup problem must not lock the book.
    }
    return saved;
  });

export const saveSharedDay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { date: string; day: CollectionDay | null }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Pick a date.");
    if (input.day && input.day.date !== input.date) throw new Error("The file can be saved only for this day.");
    return { date: input.date, day: input.day };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const row = readRow(current[0]);
    if (!row) throw new Error("The admin has to sign in once before a day can be saved.");
    const touches = { ...(row.touches ?? {}) };
    const days = (row.data.days ?? []).filter((item) => item.date !== data.date);
    if (data.day && data.day.amount > 0) days.push({ ...data.day, date: data.date });
    days.sort((a, b) => (a.date < b.date ? -1 : 1));
    touches[`day:${data.date}`] = new Date().toISOString();
    const book = applyImportedLeave({ ...row.data, days }, data.date);
    await writeBook(sql, book, touches);
    try {
      await keepDailyBackup(sql, book);
    } catch {
      // A backup problem must not lock the book.
    }
    return { book, touches } satisfies SharedBook;
  });

export const exportCentreArchive = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
    const stored = rows[0] ? asJson(rows[0].data) : null;
    if (!stored?.centreName) throw new Error("The centre book is not there.");
    const fromTable = (await readPayouts(sql, context.userId)).map(({ mine: _mine, ...item }) => item);
    const payouts = fromTable.length > 0 ? fromTable : (stored.payouts ?? []);
    const records = await readArchiveRecords(sql);
    return {
      kind: "akshaya-thrikkadeeri-book" as const,
      version: 2 as const,
      book: { ...stored, payouts },
      ...records,
    };
  });

export const importCentreArchive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => input)
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const file = (data ?? {}) as { book?: unknown; services?: unknown; credits?: unknown; advances?: unknown; diary?: unknown };
    const book = archiveBook(file.book ?? data);
    if (!book) throw new Error("That file is not a centre book.");
    const saved = await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      await ensureCustomerTable(sql);
      await ensureAdvanceTable(sql);
      await ensurePayoutTable(sql);
      await ensureDiaryTable(sql);
      if (Array.isArray(file.services)) await replaceServices(sql, file.services, context.userId);
      if (Array.isArray(file.credits)) await replaceCredits(sql, file.credits, context.userId);
      if (Array.isArray(file.advances)) await replaceAdvances(sql, file.advances, context.userId);
      if (Array.isArray(file.diary)) await replaceDiary(sql, file.diary, context.userId);
      if (Array.isArray(book.payouts)) await replacePayouts(sql, book.payouts, context.userId);
      const synced = await resyncCounterSplits(sql, book);
      const now = new Date().toISOString();
      const touches: Record<string, string> = {};
      for (const close of synced.book.cashCloses ?? []) touches[close.date] = now;
      for (const day of synced.book.days ?? []) touches[`day:${day.date}`] = now;
      const payouts = synced.book.payouts ?? [];
      await writeBook(sql, synced.book, touches);
      return { ...synced.book, payouts };
    });
    return { book: saved, touches: {} } satisfies SharedBook;
  });

export const listBackups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureBackupTable(sql);
    return sql<{ id: string; takenOn: string }>`
      select id, taken_on as "takenOn" from centre_backup order by taken_on desc limit 30
    `;
  });

export const restoreBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id.trim())
  .handler(async ({ context, data: id }) => {
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureBackupTable(sql);
    const rows = await sql<{ data: LedgerData | string }>`select data from centre_backup where id = ${id}`;
    const stored = rows[0] ? asJson(rows[0].data) : null;
    const wrapped = archiveFile(stored);
    const book = archiveBook(wrapped?.book ?? stored);
    if (!book) throw new Error("That copy is not there.");
    const saved = await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      await ensureCustomerTable(sql);
      await ensureAdvanceTable(sql);
      await ensurePayoutTable(sql);
      await ensureDiaryTable(sql);
      if (wrapped) {
        if (Array.isArray(wrapped.services)) await replaceServices(sql, wrapped.services, context.userId);
        if (Array.isArray(wrapped.credits)) await replaceCredits(sql, wrapped.credits, context.userId);
        if (Array.isArray(wrapped.advances)) await replaceAdvances(sql, wrapped.advances, context.userId);
        if (Array.isArray(wrapped.diary)) await replaceDiary(sql, wrapped.diary, context.userId);
        if (Array.isArray(book.payouts)) await replacePayouts(sql, book.payouts, context.userId);
      }
      const synced = await resyncCounterSplits(sql, book);
      const now = new Date().toISOString();
      const touches: Record<string, string> = {};
      for (const close of synced.book.cashCloses ?? []) touches[close.date] = now;
      for (const day of synced.book.days ?? []) touches[`day:${day.date}`] = now;
      const payouts = synced.book.payouts ?? [];
      await writeBook(sql, synced.book, touches);
      return { ...synced.book, payouts };
    });
    return { book: saved, touches: {} } satisfies SharedBook;
  });

async function keepDailyBackup(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  book: LedgerData,
) {
  await ensureBackupTable(sql);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const records = await readArchiveRecords(sql);
  const payload = { kind: "akshaya-thrikkadeeri-book", version: 2, book, ...records };
  await sql.query(
    `insert into centre_backup (id, taken_on, data)
     values ($1, $1::date, $2::jsonb)
     on conflict (id) do update set data = excluded.data, created_at = now()`,
    [day, JSON.stringify(payload)],
  );
  await sql.query(`delete from centre_backup where taken_on < ($1::date - interval '90 days')`, [day]);
}

type SqlClient = Awaited<ReturnType<typeof import("@/lib/db").getSql>>;

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function isoDay(value: unknown): string {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function rupees(value: unknown): number {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return 0;
  return amount;
}

function archiveBook(value: unknown): LedgerData | null {
  if (!value || typeof value !== "object") return null;
  const book = value as Partial<LedgerData>;
  if (typeof book.centreName !== "string" || !Array.isArray(book.employees) || !Array.isArray(book.days)) return null;
  return {
    centreName: book.centreName,
    deductLwp: book.deductLwp !== false,
    sample: false,
    sampleBanner: false,
    employees: book.employees,
    days: book.days,
    categories: withCategories(book.categories),
    expenses: book.expenses && typeof book.expenses === "object" ? book.expenses : {},
    leaves: Array.isArray(book.leaves) ? book.leaves : [],
    holidays: Array.isArray(book.holidays) ? book.holidays : [],
    perfOverrides: Array.isArray(book.perfOverrides) ? book.perfOverrides : [],
    lyOverrides: book.lyOverrides ?? {},
    cashCloses: Array.isArray(book.cashCloses) ? book.cashCloses : [],
    payouts: Array.isArray(book.payouts) ? book.payouts : [],
  };
}

function archiveFile(value: unknown): { book: unknown; services?: unknown; credits?: unknown; advances?: unknown; diary?: unknown } | null {
  if (!value || typeof value !== "object" || !("book" in value)) return null;
  const file = value as { book?: unknown; services?: unknown; credits?: unknown; advances?: unknown; diary?: unknown };
  if (!file.book || typeof file.book !== "object") return null;
  return file as { book: unknown; services?: unknown; credits?: unknown; advances?: unknown; diary?: unknown };
}

async function readArchiveRecords(sql: SqlClient) {
  await ensureServiceTable(sql);
  await ensureCustomerTable(sql);
  await ensureAdvanceTable(sql);
  await ensureDiaryTable(sql);
  const services = await sql<{
    id: string;
    taken_on: string;
    user_id: string;
    staff_name: string;
    service: string;
    customer: string;
    mobile: string;
    amount: number;
    personal_gpay: boolean;
    department: number;
    bank_department: number;
  }>`select id, taken_on::text as taken_on, user_id, staff_name, service, customer, mobile, amount, personal_gpay, department, bank_department from service_entry order by created_at`;
  const credits = await sql<{
    id: string;
    taken_on: string;
    user_id: string;
    staff_name: string;
    customer: string;
    mobile: string;
    kind: string;
    amount: number;
  }>`select id, taken_on::text as taken_on, user_id, staff_name, customer, mobile, kind, amount from customer_move order by created_at`;
  const advances = await sql<{
    id: string;
    taken_on: string;
    user_id: string;
    staff_name: string;
    customer: string;
    mobile: string;
    service: string;
    amount: number;
    used_on: string | null;
    used_entry_id: string | null;
  }>`select id, taken_on::text as taken_on, user_id, staff_name, customer, mobile, service, amount, used_on::text as used_on, used_entry_id from customer_advance order by created_at`;
  const diary = await sql<{
    id: string;
    for_date: string;
    note: string;
    customer: string;
    mobile: string;
    user_id: string;
    staff_name: string;
    done_at: string | null;
  }>`select id, for_date::text as for_date, note, customer, mobile, user_id, staff_name, done_at::text as done_at from centre_diary order by created_at`;
  return {
    services: services.map((row) => ({
      id: row.id,
      date: String(row.taken_on).slice(0, 10),
      userId: row.user_id,
      staff: row.staff_name,
      service: row.service,
      customer: row.customer,
      mobile: row.mobile,
      amount: Number(row.amount) || 0,
      personalGpay: Boolean(row.personal_gpay),
      department: Number(row.department) || 0,
      bankDepartment: Number(row.bank_department) || 0,
    })),
    credits: credits.map((row) => ({
      id: row.id,
      date: String(row.taken_on).slice(0, 10),
      userId: row.user_id,
      staff: row.staff_name,
      customer: row.customer,
      mobile: row.mobile,
      kind: row.kind === "debit" ? "debit" : "credit",
      amount: Number(row.amount) || 0,
    })),
    advances: advances.map((row) => ({
      id: row.id,
      date: String(row.taken_on).slice(0, 10),
      userId: row.user_id,
      staff: row.staff_name,
      customer: row.customer,
      mobile: row.mobile,
      service: row.service,
      amount: Number(row.amount) || 0,
      usedOn: row.used_on ? String(row.used_on).slice(0, 10) : "",
      usedEntryId: row.used_entry_id || "",
    })),
    diary: diary.map((row) => ({
      id: row.id,
      date: String(row.for_date).slice(0, 10),
      note: row.note,
      customer: row.customer,
      mobile: row.mobile,
      userId: row.user_id,
      staff: row.staff_name,
      done: Boolean(row.done_at),
    })),
  };
}

async function replaceServices(sql: SqlClient, rows: unknown[], fallbackUser: string) {
  await sql`delete from service_entry`;
  for (const item of rows.slice(0, 20000)) {
    const row = item as Record<string, unknown>;
    const id = clip(row.id, 80);
    const date = isoDay(row.date);
    const amount = rupees(row.amount);
    if (!id || !date || amount <= 0) continue;
    await sql`insert into service_entry (id, taken_on, user_id, staff_name, service, customer, mobile, amount, personal_gpay, department, bank_department)
      values (${id}, ${date}, ${clip(row.userId, 80) || fallbackUser}, ${clip(row.staff, 80) || "Staff"}, ${clip(row.service, 60)}, ${clip(row.customer, 80)}, ${clip(row.mobile, 15)}, ${amount}, ${Boolean(row.personalGpay)}, ${rupees(row.department)}, ${rupees(row.bankDepartment)})
      on conflict (id) do nothing`;
  }
}

async function replaceCredits(sql: SqlClient, rows: unknown[], fallbackUser: string) {
  await sql`delete from customer_move`;
  for (const item of rows.slice(0, 20000)) {
    const row = item as Record<string, unknown>;
    const id = clip(row.id, 80);
    const date = isoDay(row.date);
    const amount = rupees(row.amount);
    if (!id || !date || amount <= 0) continue;
    const kind = row.kind === "debit" ? "debit" : "credit";
    await sql`insert into customer_move (id, taken_on, user_id, staff_name, customer, mobile, kind, amount)
      values (${id}, ${date}, ${clip(row.userId, 80) || fallbackUser}, ${clip(row.staff, 80) || "Staff"}, ${clip(row.customer, 80)}, ${clip(row.mobile, 15)}, ${kind}, ${amount})
      on conflict (id) do nothing`;
  }
}

async function replaceAdvances(sql: SqlClient, rows: unknown[], fallbackUser: string) {
  await sql`delete from customer_advance`;
  for (const item of rows.slice(0, 20000)) {
    const row = item as Record<string, unknown>;
    const id = clip(row.id, 80);
    const date = isoDay(row.date);
    const amount = rupees(row.amount);
    if (!id || !date || amount <= 0) continue;
    const usedOn = isoDay(row.usedOn);
    await sql`insert into customer_advance (id, taken_on, user_id, staff_name, customer, mobile, service, amount, used_on, used_entry_id)
      values (${id}, ${date}, ${clip(row.userId, 80) || fallbackUser}, ${clip(row.staff, 80) || "Staff"}, ${clip(row.customer, 80)}, ${clip(row.mobile, 15)}, ${clip(row.service, 80)}, ${amount}, ${usedOn || null}, ${clip(row.usedEntryId, 80) || null})
      on conflict (id) do nothing`;
  }
}

async function replacePayouts(sql: SqlClient, rows: CentrePayout[], fallbackUser: string) {
  await sql`delete from centre_payout`;
  for (const row of rows.slice(0, 20000)) {
    const date = isoDay(row.date);
    const amount = rupees(row.amount);
    if (!row.id || !date || amount <= 0) continue;
    await sql`insert into centre_payout (id, taken_on, user_id, staff_name, category, amount, note)
      values (${clip(row.id, 80)}, ${date}, ${fallbackUser}, ${clip(row.by, 80) || "Admin"}, ${clip(row.category, 40)}, ${amount}, ${clip(row.note, 80)})
      on conflict (id) do nothing`;
  }
}

async function replaceDiary(sql: SqlClient, rows: unknown[], fallbackUser: string) {
  await sql`delete from centre_diary`;
  for (const item of rows.slice(0, 20000)) {
    const row = item as Record<string, unknown>;
    const id = clip(row.id, 80);
    const date = isoDay(row.date);
    const note = clip(row.note, 500);
    if (!id || !date || !note) continue;
    await sql`insert into centre_diary (id, for_date, note, customer, mobile, user_id, staff_name, done_at)
      values (${id}, ${date}, ${note}, ${clip(row.customer, 80)}, ${clip(row.mobile, 15)}, ${clip(row.userId, 80) || fallbackUser}, ${clip(row.staff, 80) || "Staff"}, ${row.done ? new Date().toISOString() : null})
      on conflict (id) do nothing`;
  }
}

async function ensureBackupTable(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(
    `create table if not exists centre_backup (
      id text primary key,
      taken_on date not null,
      data jsonb not null,
      created_at timestamptz not null default now()
    )`,
  );
}

async function ensureUsernames(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  await sql.query(`alter table "user" add column if not exists username text`);
  await sql.query(`alter table "user" add column if not exists "displayUsername" text`);
  await sql.query(`create unique index if not exists user_username_unique on "user" (username)`);
  await sql.query(
    `update "user" u
     set username = lower(split_part(u.email, '@', 1)),
         "displayUsername" = split_part(u.email, '@', 1)
     where u.username is null
       and not exists (
         select 1 from "user" o where o.username = lower(split_part(u.email, '@', 1))
       )`,
  );
}

function closerView(book: LedgerData): LedgerData {
  const employees = Array.isArray(book.employees) ? book.employees : [];
  return {
    ...book,
    expenses: {},
    perfOverrides: [],
    lyOverrides: {},
    leaves: [],
    employees: employees.map((employee) => ({ ...employee, basic: 0, incentive: 0 })),
    days: Array.isArray(book.days) ? book.days : [],
    cashCloses: Array.isArray(book.cashCloses) ? book.cashCloses : [],
    holidays: Array.isArray(book.holidays) ? book.holidays : [],
  };
}

function staffView(book: LedgerData): LedgerData {
  const employees = Array.isArray(book.employees) ? book.employees : [];
  return {
    ...book,
    cashCloses: [],
    expenses: {},
    payouts: [],
    employees: employees.map((employee) => ({ ...employee, basic: 0, incentive: 0 })),
    days: Array.isArray(book.days) ? book.days : [],
    leaves: Array.isArray(book.leaves) ? book.leaves : [],
    holidays: Array.isArray(book.holidays) ? book.holidays : [],
  };
}

async function ensureMemberRoles(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>) {
  const rows = await sql<{ name: string }>`
    select con.conname as name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'centre_member' and con.contype = 'c'
  `;
  for (const row of rows) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.name)) continue;
    await sql.query(`alter table centre_member drop constraint if exists "${row.name}"`);
  }
  await sql.query(
    `alter table centre_member add constraint centre_member_role_check check (role in ('admin', 'employee', 'closer'))`,
  );
}

async function requireMember(userId: string): Promise<CentreRole> {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  const rows = await sql<{ role: CentreRole }>`select role from centre_member where user_id = ${userId}`;
  const role = rows[0]?.role;
  if (!role) throw new Error("This account is not on the centre book.");
  return role;
}

async function requireAdmin(userId: string): Promise<void> {
  const role = await requireMember(userId);
  if (role !== "admin") throw new Error("Only the admin can do that.");
}

async function requireClose(userId: string): Promise<CentreRole> {
  const role = await requireMember(userId);
  if (role !== "admin" && role !== "closer") throw new Error("Only the closing can do that.");
  return role;
}

function readRow(
  row: { data: LedgerData | string; touches: Record<string, string> | string } | undefined,
): { data: LedgerData; touches: Record<string, string> } | null {
  if (!row) return null;
  return { data: asJson(row.data), touches: asJson(row.touches) ?? {} };
}

function asJson<T>(value: T | string): T {
  if (typeof value !== "string") return value;
  return JSON.parse(value) as T;
}

function mergeBook(
  current: { data: LedgerData; touches: Record<string, string> } | null,
  incoming: SharedBook,
): SharedBook {
  if (!current) return incoming;
  const touches = { ...(current.touches ?? {}) };
  const closes = new Map((current.data.cashCloses ?? []).map((close) => [close.date, close]));
  for (const close of incoming.book.cashCloses ?? []) {
    const serverTouch = touches[close.date] ?? "";
    const clientTouch = incoming.touches?.[close.date] ?? "";
    if (clientTouch >= serverTouch) closes.set(close.date, close);
  }
  for (const date of Object.keys(touches)) {
    const known = incoming.touches?.[date];
    const stillThere = (incoming.book.cashCloses ?? []).some((close) => close.date === date);
    if (known && known >= touches[date] && !stillThere) closes.delete(date);
  }
  for (const [date, touch] of Object.entries(incoming.touches ?? {})) {
    if (touch >= (touches[date] ?? "")) touches[date] = touch;
  }
  const cashCloses = [...closes.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const days = new Map((incoming.book.days ?? []).map((day) => [day.date, day]));
  const keptDates = new Set<string>();
  for (const day of current.data.days ?? []) {
    const key = `day:${day.date}`;
    if ((touches[key] ?? "") > (incoming.touches?.[key] ?? "")) {
      days.set(day.date, day);
      keptDates.add(day.date);
    }
  }
  for (const key of Object.keys(touches)) {
    if (!key.startsWith("day:")) continue;
    const date = key.slice(4);
    if ((touches[key] ?? "") > (incoming.touches?.[key] ?? "") && !(current.data.days ?? []).some((day) => day.date === date)) {
      days.delete(date);
      keptDates.add(date);
    }
  }
  let leaves = [...(incoming.book.leaves ?? [])];
  if (keptDates.size > 0) {
    leaves = leaves.filter((mark) => !keptDates.has(mark.date));
    for (const mark of current.data.leaves ?? []) {
      if (keptDates.has(mark.date)) leaves.push(mark);
    }
  }
  return {
    book: {
      ...incoming.book,
      cashCloses,
      days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      leaves,
    },
    touches,
  };
}

function applyImportedLeave(
  book: LedgerData,
  date: string,
  clocks: Map<string, { first: string; last: string }> = new Map(),
): LedgerData {
  const day = book.days.find((item) => item.date === date);
  const closed = book.holidays.includes(date) || isSunday(date);
  let leaves = book.leaves.filter((mark) => mark.date !== date || mark.code !== "LWP");
  if (day && day.amount > 0 && /^(Imported from aewskerala|Entered on the counter)/i.test(day.note) && !closed) {
    for (const employee of book.employees) {
      if (!employee.active) continue;
      const worked = (day.splits[employee.id] ?? 0) > 0;
      const clock = clocks.get(employee.id);
      // Half day only when the first entry is after 12 pm. A last entry before 2 pm is a normal morning, not a half day.
      const half = Boolean(clock && clock.first > "12:00:00");
      if (worked) {
        const previous = book.leaves.find((mark) => mark.employeeId === employee.id && mark.date === date);
        if (previous && previous.code !== "LWP" && previous.code !== "HD") continue;
        leaves = leaves.filter((mark) => mark.employeeId !== employee.id || mark.date !== date);
        if (half) leaves.push({ employeeId: employee.id, date, code: "HD" });
        continue;
      }
      const previous = book.leaves.find((mark) => mark.employeeId === employee.id && mark.date === date);
      if (previous && previous.code !== "LWP") continue;
      if (!leaves.some((mark) => mark.employeeId === employee.id && mark.date === date)) {
        leaves.push({ employeeId: employee.id, date, code: "LWP" });
      }
    }
  }
  return { ...book, leaves };
}

async function writeBook(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  book: LedgerData,
  touches: Record<string, string>,
) {
  await sql.query(
    `insert into centre_book (id, data, touches, updated_at)
     values ('centre', $1::jsonb, $2::jsonb, now())
     on conflict (id) do update set data = excluded.data, touches = excluded.touches, updated_at = now()`,
    [JSON.stringify(book), JSON.stringify(touches)],
  );
}
