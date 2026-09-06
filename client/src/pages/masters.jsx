// Config objects for the generic CrudPage — one per master screen.

const badge = (ok, yes, no) =>
  ok ? <span className="badge yes">{yes}</span> : <span className="badge no">{no}</span>;

export const categories = {
  title: 'Categories',
  endpoint: '/api/categories',
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Name', required: true },
  ],
};

export const zones = {
  title: 'Zones',
  endpoint: '/api/zones',
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Name', required: true },
  ],
};

export const districts = {
  title: 'Districts',
  endpoint: '/api/districts',
  searchable: true,
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'District' },
    { key: 'zone_name', label: 'Zone' },
  ],
  fields: [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'District name', required: true },
    { name: 'zone_id', label: 'Zone', type: 'select', required: true, optionsEndpoint: '/api/zones' },
  ],
};

export const branches = {
  title: 'Branches',
  endpoint: '/api/branches',
  searchable: true,
  columns: [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Branch' },
    { key: 'district_name', label: 'District' },
    { key: 'zone_name', label: 'Zone' },
  ],
  fields: [
    { name: 'code', label: 'Branch code', required: true },
    { name: 'name', label: 'Branch name', required: true },
    {
      name: 'district_id',
      label: 'District',
      type: 'select',
      required: true,
      optionsEndpoint: '/api/districts',
      optionLabel: (o) => `${o.name} (${o.zone_name})`,
    },
  ],
};

export const rates = {
  title: 'Rates',
  endpoint: '/api/rates',
  columns: [
    { key: 'category_name', label: 'Category' },
    { key: 'amount', label: 'Amount', num: true, render: (r) => Number(r.amount).toFixed(2) },
    { key: 'effective_from', label: 'Effective from' },
  ],
  fields: [
    { name: 'category_id', label: 'Category', type: 'select', required: true, optionsEndpoint: '/api/categories' },
    { name: 'amount', label: 'Monthly amount', type: 'number', required: true },
    { name: 'effective_from', label: 'Effective from', type: 'date', required: true },
  ],
};

export const members = {
  title: 'Members',
  endpoint: '/api/members',
  searchable: true,
  defaults: { active: true, is_out_of_state: false, sex: 'M' },
  columns: [
    { key: 'employee_id', label: 'Emp ID' },
    { key: 'name', label: 'Name' },
    { key: 'surname', label: 'Surname' },
    { key: 'sex', label: 'Sex' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'category_code', label: 'Cat' },
    { key: 'branch_name', label: 'Branch' },
    { key: 'district_name', label: 'District' },
    {
      key: 'is_out_of_state',
      label: 'Out-of-state',
      render: (r) => (r.is_out_of_state ? <span className="badge yes">{r.home_state || 'Yes'}</span> : ''),
    },
    { key: 'active', label: 'Status', render: (r) => badge(r.active, 'Active', 'Inactive') },
  ],
  fields: [
    { name: 'employee_id', label: 'Employee ID (unique)', required: true },
    { name: 'name', label: 'First / given name', required: true },
    { name: 'surname', label: 'Surname' },
    {
      name: 'sex',
      label: 'Sex',
      type: 'select',
      optionValue: 'value',
      optionLabel: (o) => o.label,
      staticOptions: [
        { value: 'M', label: 'Male' },
        { value: 'F', label: 'Female' },
      ],
    },
    { name: 'mobile', label: 'Mobile' },
    { name: 'category_id', label: 'Category', type: 'select', required: true, optionsEndpoint: '/api/categories' },
    {
      name: 'branch_id',
      label: 'Branch',
      type: 'select',
      required: true,
      optionsEndpoint: '/api/branches',
      optionLabel: (o) => `${o.code} — ${o.name}`,
    },
    { name: 'is_out_of_state', label: 'Transferred from another state', type: 'checkbox' },
    { name: 'home_state', label: 'Home state (if out-of-state)' },
    { name: 'joined_on', label: 'Joined on', type: 'date' },
    { name: 'left_on', label: 'Left on', type: 'date' },
    { name: 'active', label: 'Active member', type: 'checkbox' },
  ],
};

export const allMasters = { categories, zones, districts, branches, rates, members };
