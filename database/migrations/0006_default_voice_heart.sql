-- New accounts start with the Heart voice. Existing accounts keep the voice they have.
alter table public.user_settings alter column voice_id set default 'af_heart';
