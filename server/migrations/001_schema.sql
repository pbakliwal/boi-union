-- BOI Union — core schema
-- Geography: zone -> district -> branch. Members belong to a branch.
-- Contributions snapshot branch/category/amount so historical reports never
-- change when a member later transfers or a rate is updated.

create table if not exists users (
  id            serial primary key,
  username      text not null unique,
  password_hash text not null,
  role          text not null default 'admin' check (role in ('admin', 'viewer')),
  created_at    timestamptz not null default now()
);

create table if not exists categories (
  id   serial primary key,
  code text not null unique,
  name text not null
);

create table if not exists zones (
  id   serial primary key,
  code text not null unique,
  name text not null
);

create table if not exists districts (
  id      serial primary key,
  code    text not null unique,
  name    text not null,
  zone_id integer not null references zones(id) on delete restrict
);

create table if not exists branches (
  id          serial primary key,
  code        text not null unique,
  name        text not null,
  district_id integer not null references districts(id) on delete restrict
);

create table if not exists members (
  id              serial primary key,
  name            text not null,
  surname         text,
  sex             char(1) check (sex in ('M', 'F')),
  category_id     integer not null references categories(id) on delete restrict,
  branch_id       integer not null references branches(id) on delete restrict,
  is_out_of_state boolean not null default false,
  home_state      text,
  custom_amount   numeric(12,2),          -- override used when out-of-state
  active          boolean not null default true,
  joined_on       date,
  left_on         date,
  created_at      timestamptz not null default now()
);

-- Effective-dated rate per category. The amount applied to a period is the
-- latest rate whose effective_from <= first day of that period's month.
create table if not exists rates (
  id             serial primary key,
  category_id    integer not null references categories(id) on delete cascade,
  amount         numeric(12,2) not null,
  effective_from date not null,
  unique (category_id, effective_from)
);

-- One row per (month, year). Draft while auditing, final once locked.
create table if not exists periods (
  id           serial primary key,
  month        integer not null check (month between 1 and 12),
  year         integer not null,
  status       text not null default 'draft' check (status in ('draft', 'final')),
  generated_at timestamptz not null default now(),
  finalized_at timestamptz,
  finalized_by integer references users(id),
  unique (month, year)
);

create table if not exists contributions (
  id          serial primary key,
  period_id   integer not null references periods(id) on delete cascade,
  member_id   integer not null references members(id) on delete restrict,
  branch_id   integer not null references branches(id) on delete restrict,   -- snapshot
  category_id integer not null references categories(id) on delete restrict, -- snapshot
  amount      numeric(12,2) not null default 0,                              -- snapshot
  received    boolean not null default true,
  remarks     text,
  entry_date  date not null default current_date,
  unique (period_id, member_id)
);

create index if not exists idx_districts_zone      on districts(zone_id);
create index if not exists idx_branches_district   on branches(district_id);
create index if not exists idx_members_branch      on members(branch_id);
create index if not exists idx_members_category    on members(category_id);
create index if not exists idx_rates_category      on rates(category_id);
create index if not exists idx_contrib_period      on contributions(period_id);
create index if not exists idx_contrib_member      on contributions(member_id);
create index if not exists idx_contrib_branch      on contributions(branch_id);
