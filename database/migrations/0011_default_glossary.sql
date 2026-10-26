-- Give every account a glossary entry for Relaya and rename the starter list.
update public.name_lists
set title = 'Default Glossary'
where is_default and title = 'My names';

insert into public.name_list_items (list_id, value, position)
select l.id, 'Relaya', coalesce(max(i.position) + 1, 0)
from public.name_lists l
left join public.name_list_items i on i.list_id = l.id
where l.is_default
  and not exists (
    select 1 from public.name_list_items existing
    where existing.list_id = l.id and lower(existing.value) = 'relaya'
  )
group by l.id
having count(i.id) < 30;

-- New accounts and accounts backfilled later also start with Relaya in their
-- Default Glossary. Keep the current gender-aware signup behavior intact.
create or replace function public.create_user_defaults(p_user_id uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_gender text;
  v_list_id uuid;
  v_item_count integer;
  v_position integer;
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

  select id into v_list_id
  from public.name_lists
  where user_id = p_user_id and is_default;

  if v_list_id is null and not exists (select 1 from public.name_lists where user_id = p_user_id) then
    insert into public.name_lists (user_id, title, is_default)
    values (p_user_id, 'Default Glossary', true)
    returning id into v_list_id;
  end if;

  if v_list_id is not null and not exists (
    select 1 from public.name_list_items where list_id = v_list_id and lower(value) = 'relaya'
  ) then
    select count(*), coalesce(max(position) + 1, 0)
    into v_item_count, v_position
    from public.name_list_items
    where list_id = v_list_id;

    if v_item_count < 30 then
      insert into public.name_list_items (list_id, value, position)
      values (v_list_id, 'Relaya', v_position);
    end if;
  end if;
end;
$$;

-- Idempotently backfill existing accounts, including any created before the
-- current signup defaults were installed.
do $$ begin perform public.create_user_defaults(id) from auth.users; end $$;
