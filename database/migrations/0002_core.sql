-- Core app data: settings, name lists, call sessions, plans and usage.
-- Run after 0001_profiles.sql. Safe to run once on a project that already has users:
-- it backfills settings, a default name list and a free subscription for them.
--
-- Privacy: no audio, transcripts or sentences are stored here.
-- Sessions keep counters and the names snapshot only.

-- ---------------------------------------------------------------------------
-- Profiles: the agent's display name and onboarding time.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists agent_display_name text,
  add column if not exists onboarded_at timestamptz;

-- The agent must always be labeled as AI. Null means the default,
-- "<display_name>'s Relaya (AI)", built by the app.
alter table public.profiles drop constraint if exists profiles_agent_display_name_check;
alter table public.profiles add constraint profiles_agent_display_name_check
  check (agent_display_name is null or (char_length(agent_display_name) between 6 and 80 and agent_display_name like '%(AI)'));

-- ---------------------------------------------------------------------------
-- Settings: one row per user, created at signup.
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  default_mode text not null default 'say' check (default_mode in ('say', 'speak')),
  default_tone text not null default 'professional' check (default_tone in ('casual', 'professional')),
  language_mode text not null default 'auto' check (language_mode in ('auto', 'tagalog_english', 'bisaya_english')),
  ptt_key text not null default 'Space' check (char_length(ptt_key) between 1 and 20),
  mic_device_label text check (char_length(mic_device_label) <= 200),
  voice_id text not null default 'af_bella' check (voice_id ~ '^[a-z]{2}_[a-z]+$'),
  voice_speed numeric(3, 2) not null default 1.00 check (voice_speed between 0.70 and 1.30),
  email_product_updates boolean not null default true,
  email_quota_warnings boolean not null default true,
  save_sentence_history boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Name lists: names Relaya should spell right. Users edit these directly.
-- ---------------------------------------------------------------------------
create table if not exists public.name_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 60),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists name_lists_user_idx on public.name_lists (user_id);
-- At most one default list per user.
create unique index if not exists name_lists_one_default on public.name_lists (user_id) where is_default;

create table if not exists public.name_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.name_lists (id) on delete cascade,
  value text not null check (char_length(trim(value)) between 1 and 60),
  position int not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);
create unique index if not exists name_list_items_unique_value on public.name_list_items (list_id, lower(value));
create index if not exists name_list_items_list_idx on public.name_list_items (list_id, position);

-- Same limits as the app: 30 names per list. Also caps lists per user.
create or replace function public.enforce_name_limits()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if tg_table_name = 'name_lists' then
    if (select count(*) from public.name_lists where user_id = new.user_id) >= 20 then
      raise exception 'You can have up to 20 name lists.' using errcode = 'check_violation';
    end if;
  else
    if (select count(*) from public.name_list_items where list_id = new.list_id) >= 30 then
      raise exception 'You can add up to 30 names to a list.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists name_lists_limit on public.name_lists;
create trigger name_lists_limit before insert on public.name_lists
  for each row execute procedure public.enforce_name_limits();
drop trigger if exists name_list_items_limit on public.name_list_items;
create trigger name_list_items_limit before insert on public.name_list_items
  for each row execute procedure public.enforce_name_limits();

-- ---------------------------------------------------------------------------
-- Call sessions. Written by the API (service role); users read and delete.
-- ---------------------------------------------------------------------------
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  mode text not null check (mode in ('say', 'speak')),
  platform text check (platform in ('google_meet', 'zoom', 'teams')),
  tone text not null check (tone in ('casual', 'professional')),
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  sentences_approved int not null default 0 check (sentences_approved >= 0),
  sentences_edited int not null default 0 check (sentences_edited >= 0),
  sentences_used_as_is int not null default 0 check (sentences_used_as_is >= 0),
  rerecords int not null default 0 check (rerecords >= 0),
  agent_seconds int not null default 0 check (agent_seconds >= 0),
  created_at timestamptz not null default now(),
  constraint call_sessions_say_has_no_platform check (mode = 'speak' or platform is null),
  constraint call_sessions_ended_after_start check (ended_at is null or ended_at >= started_at)
);
create index if not exists call_sessions_recent_idx on public.call_sessions (user_id, started_at desc);

-- Snapshot of the names used in a session.
create table if not exists public.session_names (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions (id) on delete cascade,
  value text not null check (char_length(value) between 1 and 60),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists session_names_session_idx on public.session_names (session_id, position);

-- ---------------------------------------------------------------------------
-- Plans, subscriptions and the usage ledger.
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id text primary key check (id in ('free', 'paid', 'teams')),
  name text not null,
  monthly_reconstructions int not null,
  window_reconstructions int,
  window_hours int,
  monthly_agent_sessions int, -- null = unlimited
  max_agent_session_minutes int not null,
  monthly_agent_minutes int not null,
  price_php int, -- null until pricing is set (P7)
  created_at timestamptz not null default now(),
  constraint plans_window_pair check ((window_reconstructions is null) = (window_hours is null))
);

insert into public.plans (id, name, monthly_reconstructions, window_reconstructions, window_hours, monthly_agent_sessions, max_agent_session_minutes, monthly_agent_minutes, price_php)
values
  ('free', 'Free', 60, 15, 6, 8, 30, 240, 0),
  ('paid', 'Pro', 1000, null, null, null, 120, 1800, null),
  ('teams', 'Teams', 1000, null, null, null, 120, 1800, null)
on conflict (id) do update set
  name = excluded.name,
  monthly_reconstructions = excluded.monthly_reconstructions,
  window_reconstructions = excluded.window_reconstructions,
  window_hours = excluded.window_hours,
  monthly_agent_sessions = excluded.monthly_agent_sessions,
  max_agent_session_minutes = excluded.max_agent_session_minutes,
  monthly_agent_minutes = excluded.monthly_agent_minutes;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled')),
  -- Monthly cycles repeat from this date (the signup date for free accounts).
  period_anchor timestamptz not null default now(),
  gateway text,
  gateway_customer_id text,
  gateway_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only. Users can read their own rows; only the API (service role) inserts.
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.call_sessions (id) on delete set null,
  kind text not null check (kind in ('reconstruction', 'agent_session', 'agent_second')),
  quantity int not null check (quantity > 0),
  occurred_at timestamptz not null default now()
);
create index if not exists usage_ledger_user_time_idx on public.usage_ledger (user_id, kind, occurred_at);

-- Start of the monthly cycle that contains `at`, counting from `anchor`.
create or replace function public.cycle_start(anchor timestamptz, at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select anchor + make_interval(months => greatest(0,
    (extract(year from age(at, anchor)) * 12 + extract(month from age(at, anchor)))::int));
$$;

-- What a user has left right now. security_invoker: callers only see their own row.
create or replace view public.v_usage_current
with (security_invoker = true)
as
with current_sub as (
  select s.user_id, s.plan_id, s.status, public.cycle_start(s.period_anchor) as period_start
  from public.subscriptions s
),
used as (
  select
    cs.user_id,
    coalesce(sum(u.quantity) filter (where u.kind = 'reconstruction' and u.occurred_at >= cs.period_start), 0)::int as reconstructions,
    coalesce(sum(u.quantity) filter (where u.kind = 'reconstruction' and p.window_hours is not null
      and u.occurred_at >= now() - make_interval(hours => p.window_hours)), 0)::int as window_reconstructions,
    coalesce(sum(u.quantity) filter (where u.kind = 'agent_session' and u.occurred_at >= cs.period_start), 0)::int as agent_sessions,
    coalesce(sum(u.quantity) filter (where u.kind = 'agent_second' and u.occurred_at >= cs.period_start), 0)::int as agent_seconds
  from current_sub cs
  join public.plans p on p.id = cs.plan_id
  left join public.usage_ledger u on u.user_id = cs.user_id
  group by cs.user_id
)
select
  cs.user_id,
  cs.plan_id,
  cs.status,
  cs.period_start,
  cs.period_start + interval '1 month' as period_end,
  u.reconstructions as reconstructions_used,
  greatest(p.monthly_reconstructions - u.reconstructions, 0) as reconstructions_left,
  case when p.window_hours is null then null else greatest(p.window_reconstructions - u.window_reconstructions, 0) end as window_reconstructions_left,
  p.window_hours,
  u.agent_sessions as agent_sessions_used,
  case when p.monthly_agent_sessions is null then null else greatest(p.monthly_agent_sessions - u.agent_sessions, 0) end as agent_sessions_left,
  p.monthly_agent_sessions as agent_sessions_total,
  u.agent_seconds as agent_seconds_used,
  greatest(p.monthly_agent_minutes * 60 - u.agent_seconds, 0) as agent_seconds_left,
  p.max_agent_session_minutes
from current_sub cs
join public.plans p on p.id = cs.plan_id
join used u on u.user_id = cs.user_id;

-- Checks the limit and records usage in one step, so two requests can't both
-- take the last unit. Returns false when the user is out. API only.
create or replace function public.consume_usage(p_user_id uuid, p_kind text, p_quantity int default 1, p_session_id uuid default null)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  sub public.subscriptions;
  plan public.plans;
  period_start timestamptz;
  used int;
begin
  if p_kind not in ('reconstruction', 'agent_session') then
    raise exception 'consume_usage only meters reconstruction and agent_session; insert agent_second directly.';
  end if;

  -- Lock the subscription so concurrent requests for this user queue up here.
  select * into sub from public.subscriptions where user_id = p_user_id for update;
  if not found or sub.status = 'canceled' then return false; end if;
  select * into plan from public.plans where id = sub.plan_id;
  period_start := public.cycle_start(sub.period_anchor);

  select coalesce(sum(quantity), 0) into used from public.usage_ledger
    where user_id = p_user_id and kind = p_kind and occurred_at >= period_start;

  if p_kind = 'reconstruction' then
    if used + p_quantity > plan.monthly_reconstructions then return false; end if;
    if plan.window_hours is not null then
      select coalesce(sum(quantity), 0) into used from public.usage_ledger
        where user_id = p_user_id and kind = 'reconstruction' and occurred_at >= now() - make_interval(hours => plan.window_hours);
      if used + p_quantity > plan.window_reconstructions then return false; end if;
    end if;
  elsif plan.monthly_agent_sessions is not null and used + p_quantity > plan.monthly_agent_sessions then
    return false;
  end if;

  insert into public.usage_ledger (user_id, session_id, kind, quantity) values (p_user_id, p_session_id, p_kind, p_quantity);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at bookkeeping.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings for each row execute procedure public.touch_updated_at();
drop trigger if exists name_lists_touch on public.name_lists;
create trigger name_lists_touch before update on public.name_lists for each row execute procedure public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New accounts: settings, a default name list and the free plan.
-- ---------------------------------------------------------------------------
create or replace function public.create_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.user_settings (user_id) values (p_user_id) on conflict (user_id) do nothing;
  insert into public.subscriptions (user_id, plan_id) values (p_user_id, 'free') on conflict (user_id) do nothing;
  if not exists (select 1 from public.name_lists where user_id = p_user_id) then
    insert into public.name_lists (user_id, title, is_default) values (p_user_id, 'My names', true);
  end if;
end;
$$;

create or replace function public.handle_new_auth_user_defaults()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.create_user_defaults(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_defaults on auth.users;
create trigger on_auth_user_created_defaults
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user_defaults();

-- Backfill accounts created before this migration.
do $$ begin perform public.create_user_defaults(id) from auth.users; end $$;

-- ---------------------------------------------------------------------------
-- Row level security and grants. Supabase grants everything on new tables to
-- anon and authenticated by default, so start from nothing and add back.
-- ---------------------------------------------------------------------------
alter table public.user_settings enable row level security;
alter table public.name_lists enable row level security;
alter table public.name_list_items enable row level security;
alter table public.call_sessions enable row level security;
alter table public.session_names enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_ledger enable row level security;

revoke all on public.user_settings, public.name_lists, public.name_list_items, public.call_sessions,
  public.session_names, public.plans, public.subscriptions, public.usage_ledger, public.v_usage_current
  from anon, authenticated;
revoke all on function public.consume_usage(uuid, text, int, uuid) from public, anon, authenticated;
revoke all on function public.create_user_defaults(uuid) from public, anon, authenticated;
revoke all on function public.enforce_name_limits() from public, anon, authenticated;
revoke all on function public.handle_new_auth_user_defaults() from public, anon, authenticated;
grant execute on function public.consume_usage(uuid, text, int, uuid) to service_role;

-- Settings: read and change your own. Rows are created by the signup trigger.
grant select, update (default_mode, default_tone, language_mode, ptt_key, mic_device_label, voice_id, voice_speed,
  email_product_updates, email_quota_warnings) on public.user_settings to authenticated;
drop policy if exists "Own settings: read" on public.user_settings;
create policy "Own settings: read" on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Own settings: update" on public.user_settings;
create policy "Own settings: update" on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Name lists and items: full control over your own.
grant select, insert, update, delete on public.name_lists, public.name_list_items to authenticated;
drop policy if exists "Own name lists" on public.name_lists;
create policy "Own name lists" on public.name_lists for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Items of own name lists" on public.name_list_items;
create policy "Items of own name lists" on public.name_list_items for all to authenticated
  using (exists (select 1 from public.name_lists l where l.id = list_id and l.user_id = (select auth.uid())))
  with check (exists (select 1 from public.name_lists l where l.id = list_id and l.user_id = (select auth.uid())));

-- Sessions: read and delete your own. The API creates and updates them.
grant select, delete on public.call_sessions to authenticated;
drop policy if exists "Own sessions: read" on public.call_sessions;
create policy "Own sessions: read" on public.call_sessions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Own sessions: delete" on public.call_sessions;
create policy "Own sessions: delete" on public.call_sessions for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.session_names to authenticated;
drop policy if exists "Names of own sessions" on public.session_names;
create policy "Names of own sessions" on public.session_names for select to authenticated
  using (exists (select 1 from public.call_sessions s where s.id = session_id and s.user_id = (select auth.uid())));

-- Plans are public reference data.
grant select on public.plans to anon, authenticated;
drop policy if exists "Plans are public" on public.plans;
create policy "Plans are public" on public.plans for select to anon, authenticated using (true);

-- Subscription and usage: read your own. Writes come from the API or webhooks.
grant select on public.subscriptions, public.usage_ledger, public.v_usage_current to authenticated;
drop policy if exists "Own subscription" on public.subscriptions;
create policy "Own subscription" on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Own usage" on public.usage_ledger;
create policy "Own usage" on public.usage_ledger for select to authenticated
  using ((select auth.uid()) = user_id);
