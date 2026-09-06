-- Out-of-state contribution differences are now applied by editing the draft
-- during the audit window, not stored as a per-member override. Drop the column.
alter table members drop column if exists custom_amount;
