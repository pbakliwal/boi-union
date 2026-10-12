-- Keep the last successful import receipt in the same transaction as its data.
-- Deleting/resetting a period also removes its receipt.
alter table periods add column import_hash text;
alter table periods add column import_summary jsonb;
