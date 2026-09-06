-- Anomaly flag set during ingest so odd amounts stand out on the draft:
--   'zero'    -> no deduction (0 / NIL) for an active member
--   'differs' -> amount != the expected rate for the member's scale/category
--   null      -> amount matches the expected rate
alter table contributions add column if not exists flag text;

create index if not exists idx_contrib_flag on contributions(period_id) where flag is not null;
