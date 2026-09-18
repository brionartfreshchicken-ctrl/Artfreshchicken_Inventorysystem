-- ============================================================
-- 0002: suppliers
-- ============================================================

create table public.suppliers (
  id bigint generated always as identity primary key,
  name text not null,
  contact text,
  phone text,
  email text,
  address text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
