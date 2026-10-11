alter table "user" add column if not exists username text;
alter table "user" add column if not exists "displayUsername" text;
create unique index if not exists user_username_unique on "user" (username);
update "user" u
set username = lower(split_part(u.email, '@', 1)),
    "displayUsername" = split_part(u.email, '@', 1)
where u.username is null
  and not exists (
    select 1 from "user" o where o.username = lower(split_part(u.email, '@', 1))
  );
