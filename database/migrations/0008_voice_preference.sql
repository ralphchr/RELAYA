-- Default speaking voice selected during account setup. NULL is allowed while
-- OAuth and email-link accounts are being guided through the required setup.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_settings' and column_name = 'voice_preference'
  ) then
    alter table public.user_settings add column voice_preference text;

    -- Existing members keep their current gendered voice as their preference.
    update public.user_settings
    set voice_preference = case
      when voice_id in ('am_michael', 'am_fenrir', 'bm_george') then 'male'
      else 'female'
    end;
  end if;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_voice_preference_check') then
    alter table public.user_settings add constraint user_settings_voice_preference_check
      check (voice_preference is null or voice_preference in ('male', 'female'));
  end if;
end $$;

-- Read the choice submitted with email/password signup metadata. Social and
-- email-link accounts have NULL until the app's required profile setup is done.
create or replace function public.create_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_preference text;
begin
  select case
    when raw_user_meta_data ->> 'voice_preference' in ('male', 'female') then raw_user_meta_data ->> 'voice_preference'
    else null
  end
  into v_preference
  from auth.users
  where id = p_user_id;

  insert into public.user_settings (user_id, voice_preference, voice_id)
  values (
    p_user_id,
    v_preference,
    case v_preference when 'male' then 'am_michael' else 'af_heart' end
  ) on conflict (user_id) do nothing;

  insert into public.subscriptions (user_id, plan_id) values (p_user_id, 'free') on conflict (user_id) do nothing;
  if not exists (select 1 from public.name_lists where user_id = p_user_id) then
    insert into public.name_lists (user_id, title, is_default) values (p_user_id, 'My names', true);
  end if;
end;
$$;

grant update (voice_preference) on public.user_settings to authenticated;
