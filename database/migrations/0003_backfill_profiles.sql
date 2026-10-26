-- Profiles for accounts created before 0001 ran. 0001 only creates one at signup.
-- Uses the same name rules as the signup trigger. Running it twice is harmless.
insert into public.profiles (id, display_name, date_of_birth)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1), 'Relaya user'),
  case when u.raw_user_meta_data ->> 'date_of_birth' ~ '^\d{4}-\d{2}-\d{2}$' then (u.raw_user_meta_data ->> 'date_of_birth')::date end
from auth.users u
on conflict (id) do nothing;
