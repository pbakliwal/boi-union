create table period_imports (
  period_id integer not null references periods(id) on delete cascade,
  district_id integer not null references districts(id) on delete cascade,
  import_hash text not null,
  import_summary jsonb not null,
  primary key (period_id, district_id)
);

insert into period_imports (period_id, district_id, import_hash, import_summary)
select p.id, d.id, p.import_hash, p.import_summary
from periods p
join districts d on lower(d.name) = 'indore'
join zones z on z.id = d.zone_id and lower(z.name) = 'indore'
where p.import_hash is not null and p.import_summary is not null;