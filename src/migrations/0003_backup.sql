create table if not exists centre_backup (
  id text primary key,
  taken_on date not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
