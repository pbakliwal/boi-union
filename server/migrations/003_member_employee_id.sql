-- Add a unique, human-facing Employee ID to members (bank staff/PF number).
-- The surrogate `id` remains the internal key; employee_id is the business key.

alter table members add column if not exists employee_id text;

-- Backfill any existing rows so NOT NULL + UNIQUE can be applied.
update members set employee_id = 'EMP-' || id where employee_id is null;

alter table members alter column employee_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_employee_id_key') then
    alter table members add constraint members_employee_id_key unique (employee_id);
  end if;
end $$;
