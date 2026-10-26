-- Allow the new speech-recognition preferences for existing and new accounts.
begin;

alter table public.user_settings
  drop constraint user_settings_language_mode_check;

alter table public.user_settings
  add constraint user_settings_language_mode_check
  check (language_mode in (
    'auto', 'tagalog_english', 'bisaya_english',
    'japanese_english', 'mandarin_english', 'spanish_english'
  ));

commit;
