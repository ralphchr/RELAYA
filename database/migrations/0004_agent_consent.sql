-- When the user agreed to the Speak for me terms (shown once before the first join).
-- Set by the API when it issues an agent ticket; users can read it but not edit it.
alter table public.user_settings add column if not exists agent_consented_at timestamptz;
