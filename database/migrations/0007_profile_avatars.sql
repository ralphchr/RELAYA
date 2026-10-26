-- Profile photos use one small WebP object per account in Supabase Storage.
alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relaya-avatars', 'relaya-avatars', true, 524288, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Relaya avatar photos are public" on storage.objects;
create policy "Relaya avatar photos are public"
  on storage.objects for select
  using (bucket_id = 'relaya-avatars');

drop policy if exists "Users can upload their Relaya avatar" on storage.objects;
create policy "Users can upload their Relaya avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'relaya-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can update their Relaya avatar" on storage.objects;
create policy "Users can update their Relaya avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'relaya-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'relaya-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users can delete their Relaya avatar" on storage.objects;
create policy "Users can delete their Relaya avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'relaya-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
