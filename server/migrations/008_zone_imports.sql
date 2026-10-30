-- District-file receipts cannot represent a complete zone-file retry.
-- Invalidate receipts only; keep all masters, contributions and manual edits.
delete from period_imports;
update periods set import_hash = null, import_summary = null;

alter table period_imports drop constraint period_imports_pkey;
alter table period_imports drop column district_id;
alter table period_imports add column zone_id integer not null references zones(id) on delete cascade;
alter table period_imports add primary key (period_id, zone_id);
