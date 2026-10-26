-- Keep the user's gender as the account setting. It determines the initial
-- default AI voice, while remaining distinct from a later manual voice choice.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_settings' and column_name = 'gender'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'user_settings' and column_name = 'voice_preference'
    ) then
      alter table public.user_settings rename column voice_preference to gender;
    else
      alter table public.user_settings add column gender text;
      update public.user_settings
      set gender = case
        when voice_id in ('am_michael', 'am_fenrir', 'bm_george') then 'male'
        else 'female'
      end;
    end if;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_settings' and column_name = 'voice_preference'
  ) then
    update public.user_settings set gender = coalesce(gender, voice_preference);
  end if;
end;
$$;

alter table public.user_settings drop constraint if exists user_settings_voice_preference_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_gender_check') then
    alter table public.user_settings add constraint user_settings_gender_check
      check (gender is null or gender in ('male', 'female'));
  end if;
end $$;

-- Email/password signup supplies gender in auth metadata. Google, Facebook and
-- email-link accounts choose it in the required profile setup after sign-in.
create or replace function public.create_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_gender text;
begin
  select case
    when raw_user_meta_data ->> 'gender' in ('male', 'female') then raw_user_meta_data ->> 'gender'
    else null
  end
  into v_gender
  from auth.users
  where id = p_user_id;

  insert into public.user_settings (user_id, gender, voice_id)
  values (
    p_user_id,
    v_gender,
    case v_gender when 'male' then 'am_michael' else 'af_heart' end
  ) on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan_id) values (p_user_id, 'free') on conflict (user_id) do nothing;
  if not exists (select 1 from public.name_lists where user_id = p_user_id) then
    insert into public.name_lists (user_id, title, is_default) values (p_user_id, 'My names', true);
  end if;
end;
$$;

grant update (gender) on public.user_settings to authenticated;
