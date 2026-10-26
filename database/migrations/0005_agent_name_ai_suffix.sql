-- Google account names can't contain parentheses, so the agent's name may end
-- in "AI" as a word ("Angel's Relaya AI") as well as "(AI)". It must still say
-- it's an AI at the end.
alter table public.profiles drop constraint if exists profiles_agent_display_name_check;
alter table public.profiles add constraint profiles_agent_display_name_check
  check (agent_display_name is null or (char_length(agent_display_name) between 4 and 80 and agent_display_name ~ '(^|[\s(])AI\)?$'));
