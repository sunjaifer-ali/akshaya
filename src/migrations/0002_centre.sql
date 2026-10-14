create table if not exists centre_member (
  user_id text primary key,
  role text not null check (role in ('admin', 'employee')),
  name text not null default ''
);

create table if not exists centre_book (
  id text primary key,
  data jsonb not null,
  touches jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
