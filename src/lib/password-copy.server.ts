import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { getSql } from "@/lib/db";

type Sql = Awaited<ReturnType<typeof getSql>>;

function key() {
  const g = globalThis as typeof globalThis & { __centrePasswordKey?: string };
  const secret = process.env.BETTER_AUTH_SECRET?.trim() || g.__centrePasswordKey;
  if (!secret) {
    g.__centrePasswordKey = randomBytes(32).toString("hex");
    return createHash("sha256").update(g.__centrePasswordKey).digest();
  }
  return createHash("sha256").update(secret).digest();
}

function seal(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function unseal(value: string) {
  const buf = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

async function ensure(sql: Sql) {
  await sql.query(
    `create table if not exists staff_password_copy (
      user_id text primary key,
      sealed text not null
    )`,
  );
}

export async function savePasswordCopy(sql: Sql, userId: string, password: string) {
  await ensure(sql);
  const sealed = seal(password);
  await sql`insert into staff_password_copy (user_id, sealed) values (${userId}, ${sealed})
    on conflict (user_id) do update set sealed = ${sealed}`;
}

export async function readPasswordCopy(sql: Sql, userId: string) {
  await ensure(sql);
  const rows = await sql<{ sealed: string }>`select sealed from staff_password_copy where user_id = ${userId}`;
  const sealed = rows[0]?.sealed;
  if (!sealed) return null;
  try {
    return unseal(sealed);
  } catch {
    return null;
  }
}

export async function forgetPasswordCopy(sql: Sql, userId: string) {
  await ensure(sql);
  await sql`delete from staff_password_copy where user_id = ${userId}`;
}
