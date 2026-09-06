-- Add an optional mobile number to members. Nullable — not every source row
-- has a usable value (e.g. "#N/A" or malformed data from the salary register).
alter table members add column if not exists mobile text;
