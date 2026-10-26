-- Security and behavior tests for 0001 + 0002. Run with database/tests/run.sh.
-- Every check raises an exception on failure, so psql stops at the first one.
\set ON_ERROR_STOP on
\set QUIET on
-- Results are noise; each check reports through a notice.
\o /dev/null
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', what; end if;
  raise notice 'ok - %', what;
end $$;

-- Runs `stmt` and passes only if it fails with an error containing `expected`.
create or replace function tests.fails(stmt text, expected text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (statement succeeded)', what;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expected) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', what, sqlerrm;
  end if;
  raise notice 'ok - %', what;
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Two users sign up.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '{"full_name":"Angel","gender":"male"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '{"full_name":"Ben","gender":"female"}');

-- run.sh created one more account before 0002 ran.
select tests.ok((select count(*) = 3 from public.profiles), 'signup creates profiles');
select tests.ok((select count(*) = 3 from public.user_settings), 'signup creates settings');
select tests.ok((select count(*) = 3 from public.subscriptions where plan_id = 'free'), 'signup starts the free plan');
select tests.ok((select count(*) = 3 from public.name_lists where is_default and title = 'Default Glossary'), 'signup creates a default glossary');
select tests.ok((select count(*) = 3 from public.name_list_items where value = 'Relaya'), 'every default glossary includes Relaya');
select tests.ok((select count(*) = 1 from public.user_settings where user_id = '00000000-0000-0000-0000-0000000000e0'), 'accounts made before 0002 get their defaults too');
select tests.ok((select display_name = 'early' from public.profiles where id = '00000000-0000-0000-0000-0000000000e0'), 'accounts made before 0001 get a profile from 0003');
select tests.ok((select voice_id = 'af_heart' from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000b'), 'new accounts start with the Heart voice');
select tests.ok((select gender = 'male' and voice_id = 'am_michael' from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000a'), 'male signup selects Michael by default');
select tests.ok((select gender = 'female' and voice_id = 'af_heart' from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000b'), 'female signup selects Heart by default');

-- ---------------------------------------------------------------- user A
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';

select tests.ok((select count(*) = 1 from public.user_settings), 'A sees only their own settings');
select tests.ok((select count(*) = 1 from public.profiles), 'A sees only their own profile');
select tests.ok((select count(*) = 1 from public.subscriptions), 'A sees only their own subscription');

update public.user_settings set voice_id = 'af_heart', default_tone = 'casual';
select tests.ok((select voice_id = 'af_heart' from public.user_settings), 'A can change their voice');
update public.user_settings set language_mode = 'japanese_english';
select tests.ok((select language_mode = 'japanese_english' from public.user_settings), 'A can save Japanese speech');
update public.user_settings set language_mode = 'mandarin_english';
select tests.ok((select language_mode = 'mandarin_english' from public.user_settings), 'A can save Mandarin speech');
update public.user_settings set language_mode = 'spanish_english';
select tests.ok((select language_mode = 'spanish_english' from public.user_settings), 'A can save Spanish speech');
select tests.fails($$update public.user_settings set language_mode = 'unsupported'$$, 'check constraint', 'unknown speech preferences are rejected');
update public.user_settings set gender = 'female', voice_id = 'af_heart';
select tests.ok((select gender = 'female' and voice_id = 'af_heart' from public.user_settings), 'A can change their gender and default voice');
select tests.fails($$update public.user_settings set save_sentence_history = true$$, 'permission denied', 'A cannot turn on sentence history directly');
select tests.fails($$update public.user_settings set agent_consented_at = now()$$, 'permission denied', 'A cannot fake agent consent directly');
select tests.ok((select agent_consented_at is null from public.user_settings), 'A can read their consent (none yet)');
select tests.fails($$update public.user_settings set voice_speed = 2$$, 'check constraint', 'voice speed is bounded');
update public.user_settings set default_mode = 'speak' where user_id = '00000000-0000-0000-0000-00000000000b';

update public.profiles set agent_display_name = 'Angel''s Relaya (AI)';
select tests.fails($$update public.profiles set agent_display_name = 'Angel'$$, 'check constraint', 'agent name must say AI at the end');
update public.profiles set agent_display_name = 'Angel''s Relaya AI';
select tests.ok((select agent_display_name = 'Angel''s Relaya AI' from public.profiles), 'agent name may end in AI without parentheses');
select tests.fails($$update public.profiles set agent_display_name = 'Angel MAI'$$, 'check constraint', 'AI must be its own word');
select tests.fails($$update public.profiles set agent_display_name = 'AI Angel'$$, 'check constraint', 'AI must come last');

-- Name lists
insert into public.name_list_items (list_id, value, position)
  select id, 'Ma. Cristina', 0 from public.name_lists where is_default;
select tests.fails($$insert into public.name_list_items (list_id, value) select id, 'ma. cristina' from public.name_lists where is_default$$,
  'duplicate key', 'duplicate names are rejected regardless of case');
insert into public.name_list_items (list_id, value, position)
  select l.id, 'Name ' || n, n from public.name_lists l, generate_series(1, 28) n where l.is_default;
select tests.fails($$insert into public.name_list_items (list_id, value) select id, 'One too many' from public.name_lists where is_default$$,
  'up to 30 names', 'a list holds at most 30 names');
select tests.fails($$insert into public.name_lists (user_id, title, is_default) values ('00000000-0000-0000-0000-00000000000a', 'Second default', true)$$,
  'duplicate key', 'only one default list');
select tests.fails($$insert into public.name_lists (user_id, title) values ('00000000-0000-0000-0000-00000000000b', 'Sneaky')$$,
  'row-level security', 'A cannot create a list for B');

-- Sessions and usage are written by the API only.
select tests.fails($$insert into public.call_sessions (user_id, title, mode, tone) values ('00000000-0000-0000-0000-00000000000a', 'x', 'say', 'casual')$$,
  'permission denied', 'A cannot create sessions directly');
select tests.fails($$insert into public.usage_ledger (user_id, kind, quantity) values ('00000000-0000-0000-0000-00000000000a', 'reconstruction', 1)$$,
  'permission denied', 'A cannot write usage');
select tests.fails($$select public.consume_usage('00000000-0000-0000-0000-00000000000a', 'reconstruction')$$,
  'permission denied', 'A cannot call consume_usage');
select tests.fails($$update public.subscriptions set plan_id = 'paid'$$, 'permission denied', 'A cannot upgrade themselves');
select tests.fails($$update public.plans set monthly_reconstructions = 9999$$, 'permission denied', 'A cannot change plans');
commit;

-- Provider metadata can refresh during sign-in; it must not replace an edited name.
update public.profiles set display_name = 'Angel Relaya' where id = '00000000-0000-0000-0000-00000000000a';
update auth.users set raw_user_meta_data = '{"full_name":"Angel Ranario","gender":"male"}'
  where id = '00000000-0000-0000-0000-00000000000a';
select tests.ok((select display_name = 'Angel Relaya' from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'auth metadata refresh preserves the user-edited profile name');

-- B's data was untouched by A's update attempts.
select tests.ok((select default_mode = 'say' from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000b'), 'A cannot change B''s settings');

-- ---------------------------------------------------------------- B adds a name; A can't see it
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
insert into public.name_list_items (list_id, value) select id, 'Davao' from public.name_lists where is_default;
commit;

select id as b_list from public.name_lists where user_id = '00000000-0000-0000-0000-00000000000b' \gset

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select tests.ok((select count(*) = 1 from public.name_lists), 'A sees only their own lists');
select tests.ok((select count(*) = 0 from public.name_list_items where value = 'Davao'), 'A cannot see B''s names');
select tests.fails(format($$insert into public.name_list_items (list_id, value) values (%L, 'Injected')$$, :'b_list'),
  'row-level security', 'A cannot add names to B''s list');
update public.name_lists set title = 'Hijacked' where id = :'b_list';
delete from public.name_list_items where list_id = :'b_list';
commit;
select tests.ok((select title = 'Default Glossary' from public.name_lists where id = :'b_list')
  and (select count(*) = 2 from public.name_list_items where list_id = :'b_list'), 'A cannot change or empty B''s default glossary');

-- ---------------------------------------------------------------- the API (service role)
begin;
set local role service_role;
insert into public.call_sessions (id, user_id, title, mode, platform, tone) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Speak for me · Oct 17, 9:00 AM', 'speak', 'google_meet', 'professional'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Say it yourself · Oct 17, 9:00 AM', 'say', null, 'casual');
insert into public.session_names (session_id, value) values ('10000000-0000-0000-0000-00000000000b', 'Davao');
select tests.fails($$insert into public.call_sessions (user_id, title, mode, platform, tone) values ('00000000-0000-0000-0000-00000000000a', 'x', 'say', 'google_meet', 'casual')$$,
  'call_sessions_say_has_no_platform', 'Say it yourself sessions have no platform');

-- Free plan: 15 reconstructions per 6 hours.
select tests.ok((select bool_and(public.consume_usage('00000000-0000-0000-0000-00000000000a', 'reconstruction')) from generate_series(1, 15)), '15 reconstructions are allowed');
select tests.ok(not public.consume_usage('00000000-0000-0000-0000-00000000000a', 'reconstruction'), 'the 16th within 6 hours is refused');
-- Free plan: 8 agent sessions per month.
select tests.ok((select bool_and(public.consume_usage('00000000-0000-0000-0000-00000000000a', 'agent_session', 1, '10000000-0000-0000-0000-00000000000a')) from generate_series(1, 8)), '8 agent sessions are allowed');
select tests.ok(not public.consume_usage('00000000-0000-0000-0000-00000000000a', 'agent_session'), 'the 9th agent session is refused');
select tests.fails($$select public.consume_usage('00000000-0000-0000-0000-00000000000a', 'agent_second', 30)$$, 'only meters', 'agent seconds are recorded, not metered');
insert into public.usage_ledger (user_id, session_id, kind, quantity) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'agent_second', 90);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select tests.ok((select count(*) = 1 from public.call_sessions), 'A sees only their own sessions');
select tests.ok((select count(*) = 0 from public.session_names), 'A cannot see B''s session names');
select tests.ok((select count(*) = 1 from public.v_usage_current), 'usage view shows only A');
select tests.ok((select reconstructions_used = 15 and reconstructions_left = 45 and window_reconstructions_left = 0
  and agent_sessions_left = 0 and agent_sessions_total = 8 and agent_seconds_used = 90 and agent_seconds_left = 240 * 60 - 90
  from public.v_usage_current), 'usage view counts what A has left');
delete from public.call_sessions;
select tests.ok((select count(*) = 0 from public.call_sessions), 'A can delete their own sessions');
select tests.ok((select count(*) = 1 from public.usage_ledger where kind = 'agent_second' and session_id is null), 'usage survives deleting the session');
commit;

begin;
set local role anon;
select tests.ok((select count(*) = 3 from public.plans), 'anyone can read plans');
select tests.fails($$select * from public.user_settings$$, 'permission denied', 'signed-out users cannot read settings');
select tests.fails($$select * from public.v_usage_current$$, 'permission denied', 'signed-out users cannot read usage');
commit;

-- Monthly cycles repeat from the anchor date.
select tests.ok(public.cycle_start('2026-01-31 00:00+00', '2026-03-05 00:00+00') = '2026-02-28 00:00+00', 'cycle anchored on the 31st clamps to month end');
select tests.ok(public.cycle_start('2026-01-15 00:00+00', '2026-01-20 00:00+00') = '2026-01-15 00:00+00', 'first cycle starts at the anchor');

-- Deleting an account removes everything.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select tests.ok((select count(*) = 0 from public.name_lists where user_id = '00000000-0000-0000-0000-00000000000b')
  and (select count(*) = 0 from public.usage_ledger where user_id = '00000000-0000-0000-0000-00000000000b'), 'deleting an account deletes its data');

\o
\echo 'All database tests passed.'
