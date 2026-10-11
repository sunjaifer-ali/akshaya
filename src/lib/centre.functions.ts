import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { CashClose, CollectionDay, LedgerData } from "@/lib/ledger/types";
import { isSunday } from "@/lib/ledger/dates";
import { centreEmail, cleanUsername } from "@/lib/username";
import { withTransaction } from "@/lib/db";

export type CentreRole = "admin" | "employee";

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
    if (member[0]?.role === "admin") continue;
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
    order by case when m.role = 'admin' then 0 else 1 end, lower(m.name)
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
    const rows = await sql<{ userId: string; role: CentreRole; name: string; email: string | null }>`
      select m.user_id as "userId", m.role, m.name, u.email as email
      from centre_member m
      left join "user" u on u.id = m.user_id
      order by m.role, m.name
    `;
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      name: row.name || "Account",
      username: (row.email ?? "").split("@")[0] || row.name,
    }));
  });

export const createEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { name: string; username: string; password: string }) => {
    const name = input.name.trim().slice(0, 80);
    const username = cleanUsername(input.username);
    const password = input.password;
    if (!name) throw new Error("Enter a name.");
    if (password.length < 8) throw new Error("Password needs at least 8 characters.");
    return { name, username, password };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.userId);
    const userId = await openStaffLogin(data.name, data.username, data.password);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql`insert into centre_member (user_id, role, name) values (${userId}, 'employee', ${data.name}) on conflict (user_id) do update set role = 'employee', name = ${data.name}`;
    return { ok: true, username: data.username };
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
    if (rows[0]?.role !== "employee") throw new Error("Only a staff password can be reset.");
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
    if (rows[0]?.role !== "employee") throw new Error("Only a staff password can be shown.");
    const { readPasswordCopy } = await import("@/lib/password-copy.server");
    const password = await readPasswordCopy(sql, userId);
    return { password };
  });

export type OpenCredit = { customer: string; mobile: string; staff: string; balance: number };

export const addCustomerMove = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { kind: string; customer: string; mobile: string; amount: number }) => {
    const kind = input.kind === "debit" ? "debit" : input.kind === "credit" ? "credit" : "";
    const customer = input.customer.trim().slice(0, 80);
    const mobile = input.mobile.replace(/\D/g, "").slice(0, 10);
    const amount = Math.round(Number(input.amount));
    if (!kind) throw new Error("Choose credit or debit.");
    if (!customer) throw new Error("Enter the customer name.");
    if (mobile.length !== 10) throw new Error("Enter a 10 digit mobile number.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the amount.");
    return { kind, customer, mobile, amount };
  })
  .handler(async ({ context, data }) => {
    await requireMember(context.userId);
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
  .handler(async ({ context }) => {
    const role = await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await ensureCustomerTable(sql);
    return creditDesk(sql, context.userId, role === "admin", indiaToday());
  });

export const closingCredit = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date.");
    return date;
  })
  .handler(async ({ context, data: date }) => {
    await requireAdmin(context.userId);
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
}

type OpenRow = { key: string; customer: string; mobile: string; staff: string; balance: number };

async function openCredits(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>): Promise<OpenCredit[]> {
  const bookRow = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = bookRow[0] ? asJson(bookRow[0].data) : null;
  const names = new Map((book?.employees ?? []).map((employee) => [employee.id, employee.name]));
  const moves = await sql<{ taken_on: string; customer: string; mobile: string; staff_name: string; kind: string; amount: number }>`
    select taken_on::text as taken_on, customer, mobile, staff_name, kind, amount from customer_move order by created_at
  `;
  const moveDates = new Set(moves.map((move) => String(move.taken_on).slice(0, 10)));
  const lines: OpenRow[] = [];
  for (const close of [...(book?.cashCloses ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (moveDates.has(close.date)) continue;
    for (const item of close.creditGiven ?? []) {
      if (!item.amount || !item.customer?.trim()) continue;
      const key = item.customer.trim().toLowerCase();
      const existing = lines.find((line) => line.key === key);
      if (existing) existing.balance += item.amount;
      else lines.push({ key, customer: item.customer.trim(), mobile: "", staff: names.get(item.employeeId) ?? "", balance: item.amount });
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
    if (move.kind === "credit") {
      const existing = lines.find((line) => line.key === key);
      if (existing) {
        existing.balance += amount;
        if (!existing.mobile) existing.mobile = move.mobile;
      } else lines.push({ key, customer: move.customer.trim(), mobile: move.mobile, staff: move.staff_name, balance: amount });
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
  return lines.filter((line) => line.balance > 0).map(({ customer, mobile, staff, balance }) => ({ customer, mobile, staff, balance }));
}

async function creditDesk(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  userId: string,
  admin: boolean,
  date: string,
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
      lines: [] as { id: string; staff: string; customer: string; mobile: string; kind: string; amount: number }[],
    };
  }
  const lines = await sql<{ id: string; staff: string; customer: string; mobile: string; kind: string; amount: number }>`
    select id, staff_name as staff, customer, mobile, kind, amount from customer_move
    where taken_on = ${date} order by created_at desc
  `;
  return {
    role: "admin" as const,
    credit,
    debit,
    open,
    lines: lines.map((line) => ({ ...line, amount: Number(line.amount) })),
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
  const names = new Map((book?.employees ?? []).map((employee) => [employee.id, employee.name]));
  const moves = await sql<{ taken_on: string; customer: string; mobile: string; staff_name: string; kind: string; amount: number }>`
    select taken_on::text as taken_on, customer, mobile, staff_name, kind, amount
    from customer_move where taken_on <= ${asOf} order by created_at
  `;
  const moveDates = new Set(moves.map((move) => String(move.taken_on).slice(0, 10)));
  const lines: OpenRow[] = [];
  for (const close of [...(book?.cashCloses ?? [])].filter((item) => item.date <= asOf).sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (moveDates.has(close.date)) continue;
    for (const item of close.creditGiven ?? []) {
      if (!item.amount || !item.customer?.trim()) continue;
      const key = item.customer.trim().toLowerCase();
      const existing = lines.find((line) => line.key === key);
      if (existing) existing.balance += item.amount;
      else lines.push({ key, customer: item.customer.trim(), mobile: "", staff: names.get(item.employeeId) ?? "", balance: item.amount });
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
    if (move.kind === "credit") {
      const existing = lines.find((line) => line.key === key);
      if (existing) {
        existing.balance += amount;
        if (!existing.mobile) existing.mobile = move.mobile;
      } else lines.push({ key, customer: move.customer.trim(), mobile: move.mobile, staff: move.staff_name, balance: amount });
    } else {
      let left = amount;
      for (const line of lines.filter((item) => item.key === key && item.balance > 0)) {
        if (left <= 0) break;
        const take = Math.min(line.balance, left);
        line.balance -= take;
        left -= take;
      }
    }
  }
  const today = moves.filter((move) => String(move.taken_on).slice(0, 10) === asOf);
  const employees = book?.employees ?? [];
  const given =
    today.length > 0
      ? today
          .filter((move) => move.kind === "credit")
          .map((move) => ({
            employeeId: employees.find((person) => person.name.trim().toLowerCase() === move.staff_name.trim().toLowerCase())?.id ?? "",
            customer: move.customer,
            amount: Number(move.amount) || 0,
          }))
      : (book?.cashCloses ?? []).find((item) => item.date === asOf)?.creditGiven ?? [];
  const paid =
    today.length > 0
      ? today
          .filter((move) => move.kind === "debit")
          .map((move) => ({ name: move.customer, amount: Number(move.amount) || 0 }))
      : (book?.cashCloses ?? []).find((item) => item.date === asOf)?.creditPaid ?? [];
  const unpaid = lines.reduce((sum, line) => sum + (line.balance > 0 ? line.balance : 0), 0);
  return { given, paid, unpaid };
}

export const loadSharedBook = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireMember(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ data: LedgerData; touches: Record<string, string> }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const row = rows[0];
    if (!row) return null;
    const role = await requireMember(context.userId);
    const book = role === "admin" ? asJson(row.data) : staffView(asJson(row.data));
    return { book, touches: role === "admin" ? (asJson(row.touches) ?? {}) : {} } satisfies SharedBook;
  });

export type ServiceLine = {
  id: string;
  staff: string;
  service: string;
  customer: string;
  mobile: string;
  amount: number;
  personalGpay: boolean;
};

export const addServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { service: string; customer: string; mobile: string; amount: number; personalGpay?: boolean }) => {
    const service = input.service.trim().slice(0, 60);
    const customer = input.customer.trim().slice(0, 80);
    const mobile = input.mobile.replace(/\D/g, "").slice(0, 10);
    const amount = Math.round(Number(input.amount));
    if (!service) throw new Error("Enter the service.");
    if (!customer) throw new Error("Enter the customer name.");
    if (mobile.length !== 10) throw new Error("Enter a 10 digit mobile number.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the service charge.");
    return { service, customer, mobile, amount, personalGpay: Boolean(input.personalGpay) };
  })
  .handler(async ({ context, data }) => {
    await requireMember(context.userId);
    const date = indiaToday();
    const total = await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      const role = await requireMember(context.userId);
      if (role === "employee" && (await dayIsClosed(sql, date))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      const member = await sql<{ name: string }>`select name from centre_member where user_id = ${context.userId}`;
      const staff = (member[0]?.name || "Staff").trim().slice(0, 80);
      const id = crypto.randomUUID();
      await sql`insert into service_entry (id, taken_on, user_id, staff_name, service, customer, mobile, amount, personal_gpay)
        values (${id}, ${date}, ${context.userId}, ${staff}, ${data.service}, ${data.customer}, ${data.mobile}, ${data.amount}, ${data.personalGpay})`;
      await rollCounterDay(sql, date);
      const mine = await sql<{ total: number }>`
        select coalesce(sum(amount), 0)::int as total from service_entry
        where taken_on = ${date} and user_id = ${context.userId}`;
      return Number(mine[0]?.total ?? 0);
    });
    return { total };
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
        select id, staff_name as staff, service, customer, mobile, amount, personal_gpay as "personalGpay"
        from service_entry where taken_on = ${date} and user_id = ${context.userId}
        order by created_at desc`;
      const lines = rows.map((line) => ({ ...line, amount: Number(line.amount), personalGpay: Boolean(line.personalGpay) }));
      return { role, total: lines.reduce((sum, line) => sum + line.amount, 0), lines, closed };
    }
    await withTransaction(async (tx) => {
      await rollCounterDay(tx, date);
    });
    const lines = await sql<ServiceLine>`
      select id, staff_name as staff, service, customer, mobile, amount, personal_gpay as "personalGpay"
      from service_entry where taken_on = ${date} order by created_at desc`;
    return {
      role,
      total: lines.reduce((sum, line) => sum + Number(line.amount), 0),
      lines: lines.map((line) => ({ ...line, amount: Number(line.amount), personalGpay: Boolean(line.personalGpay) })),
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
      const date = rows[0]?.taken_on?.slice(0, 10);
      if (date) await rollCounterDay(sql, date);
    });
    return { ok: true };
  });

export const updateServiceEntry = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; service: string; customer: string; mobile: string; amount: number; personalGpay?: boolean }) => {
    const id = input.id.trim();
    const service = input.service.trim().slice(0, 60);
    const customer = input.customer.trim().slice(0, 80);
    const mobile = input.mobile.replace(/\D/g, "").slice(0, 10);
    const amount = Math.round(Number(input.amount));
    if (!id) throw new Error("That charge was not found.");
    if (!service) throw new Error("Enter the service.");
    if (!customer) throw new Error("Enter the customer name.");
    if (mobile.length !== 10) throw new Error("Enter a 10 digit mobile number.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error("Enter the service charge.");
    return { id, service, customer, mobile, amount, personalGpay: Boolean(input.personalGpay) };
  })
  .handler(async ({ context, data }) => {
    const role = await requireMember(context.userId);
    await withTransaction(async (sql) => {
      await ensureServiceTable(sql);
      const rows = await sql<{ user_id: string; taken_on: string }>`
        select user_id, taken_on::text as taken_on from service_entry where id = ${data.id}`;
      const row = rows[0];
      if (!row) throw new Error("That charge was not found.");
      if (role === "employee" && row.user_id !== context.userId) throw new Error("You can edit only your own charge.");
      if (role === "employee" && (await dayIsClosed(sql, row.taken_on.slice(0, 10)))) {
        throw new Error("This day is closed. A new day starts tomorrow.");
      }
      if (role === "employee" && row.taken_on.slice(0, 10) !== indiaToday()) throw new Error("A past day cannot be changed.");
      await sql`update service_entry set service = ${data.service}, customer = ${data.customer}, mobile = ${data.mobile}, amount = ${data.amount}, personal_gpay = ${data.personalGpay} where id = ${data.id}`;
      await rollCounterDay(sql, row.taken_on.slice(0, 10));
    });
    return { ok: true };
  });

async function dayIsClosed(sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>, date: string) {
  const current = await sql<{ data: LedgerData | string }>`select data from centre_book where id = 'centre'`;
  const book = current[0] ? asJson(current[0].data) : null;
  return (book?.cashCloses ?? []).some((close) => close.date === date);
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

function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const real = headers.get("x-real-ip")?.trim() ?? "";
  const ip = forwarded || real;
  if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("172.")) return "";
  return ip.slice(0, 64);
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
      role: row.role === "admin" ? "Admin" : "Staff",
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
  if (rows.length === 0) return { book, dates: [] };
  const gpayRows = await sql<{ taken_on: string; amount: number }>`
    select taken_on::text as taken_on, coalesce(sum(amount), 0)::int as amount
    from service_entry where personal_gpay group by taken_on
  `;
  const gpayByDate = new Map(gpayRows.map((entry) => [String(entry.taken_on).slice(0, 10), Number(entry.amount) || 0]));
  const byDate = new Map<string, { amount: number; splits: Record<string, number>; personalGpay: number }>();
  for (const entry of rows) {
    const date = String(entry.taken_on).slice(0, 10);
    const bucket = byDate.get(date) ?? { amount: 0, splits: {}, personalGpay: gpayByDate.get(date) ?? 0 };
    const value = Number(entry.amount) || 0;
    bucket.amount += value;
    const employee = (book.employees ?? []).find((person) => normStaffName(person.name) === normStaffName(entry.staff_name));
    if (employee && value > 0) bucket.splits[employee.id] = (bucket.splits[employee.id] ?? 0) + value;
    byDate.set(date, bucket);
  }
  const seen = new Set<string>();
  let days = (book.days ?? []).flatMap((day) => {
    const fresh = byDate.get(day.date);
    if (!fresh) return [day];
    seen.add(day.date);
    if (!day.note.startsWith("Entered on the counter")) return [day];
    if (fresh.amount <= 0) return [];
    return [{ ...day, amount: fresh.amount, splits: fresh.splits, personalGpay: fresh.personalGpay }];
  });
  for (const [date, fresh] of byDate) {
    if (seen.has(date) || fresh.amount <= 0) continue;
    days.push({ date, amount: fresh.amount, note: "Entered on the counter", splits: fresh.splits, personalGpay: fresh.personalGpay });
  }
  days.sort((a, b) => (a.date < b.date ? -1 : 1));
  let next: LedgerData = { ...book, days };
  const today = indiaToday();
  for (const date of byDate.keys()) {
    if (date < today) next = applyImportedLeave(next, date);
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
    const saved = { book: synced.book, touches };
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
    await requireAdmin(context.userId);
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const current = await sql<{ data: LedgerData | string; touches: Record<string, string> | string }>`
      select data, touches from centre_book where id = 'centre'
    `;
    const row = readRow(current[0]);
    if (!row) throw new Error("The admin has to sign in once before a closing can be saved.");
    const touches = { ...(row.touches ?? {}) };
    const closes = (row.data.cashCloses ?? []).filter((item) => item.date !== data.date);
    if (data.close) {
      closes.push({
        ...data.close,
        date: data.date,
        countedBy: (data.close.countedBy ?? "").trim().slice(0, 80),
        accepted: Boolean(data.close.accepted),
      });
    }
    closes.sort((a, b) => (a.date < b.date ? -1 : 1));
    touches[data.date] = new Date().toISOString();
    const book = { ...row.data, cashCloses: closes };
    await writeBook(sql, book, touches);
    try {
      await keepDailyBackup(sql, book);
    } catch {
      // A backup problem must not lock the book.
    }
    return { book, touches } satisfies SharedBook;
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
    if (!stored) throw new Error("That copy is not there.");
    const now = new Date().toISOString();
    const touches: Record<string, string> = {};
    for (const close of stored.cashCloses ?? []) touches[close.date] = now;
    await writeBook(sql, stored, touches);
    return { book: stored, touches } satisfies SharedBook;
  });

async function keepDailyBackup(
  sql: Awaited<ReturnType<typeof import("@/lib/db").getSql>>,
  book: LedgerData,
) {
  await ensureBackupTable(sql);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  await sql.query(
    `insert into centre_backup (id, taken_on, data)
     values ($1, $1::date, $2::jsonb)
     on conflict (id) do update set data = excluded.data, created_at = now()`,
    [day, JSON.stringify(book)],
  );
  await sql.query(`delete from centre_backup where taken_on < ($1::date - interval '90 days')`, [day]);
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

function staffView(book: LedgerData): LedgerData {
  const employees = Array.isArray(book.employees) ? book.employees : [];
  return {
    ...book,
    cashCloses: [],
    expenses: {},
    employees: employees.map((employee) => ({ ...employee, basic: 0, incentive: 0 })),
    days: Array.isArray(book.days) ? book.days : [],
    leaves: Array.isArray(book.leaves) ? book.leaves : [],
    holidays: Array.isArray(book.holidays) ? book.holidays : [],
  };
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

function applyImportedLeave(book: LedgerData, date: string): LedgerData {
  const day = book.days.find((item) => item.date === date);
  const closed = book.holidays.includes(date) || isSunday(date);
  const leaves = book.leaves.filter((mark) => mark.date !== date || mark.code !== "LWP");
  if (day && day.amount > 0 && /^(Imported from aewskerala|Entered on the counter)/i.test(day.note) && !closed) {
    for (const employee of book.employees) {
      if (!employee.active) continue;
      if ((day.splits[employee.id] ?? 0) > 0) continue;
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
