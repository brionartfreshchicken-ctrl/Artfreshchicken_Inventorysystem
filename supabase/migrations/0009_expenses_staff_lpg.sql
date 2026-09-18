-- ============================================================
-- 0009: Operating Expenses, Staff Directory, LPG Usage
-- ============================================================

create table public.expenses (
  id bigint generated always as identity primary key,
  expense_number text not null unique,
  date date not null,
  category text not null,
  description text,
  amount numeric not null,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'gcash', 'card', 'other')),
  recorded_by text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.staff (
  id bigint generated always as identity primary key,
  name text not null,
  position text,
  wage numeric,
  wage_period text check (wage_period in ('day', 'month')),
  created_at timestamptz not null default now()
);

-- Replaces the old workDates text-array with real rows.
create table public.staff_work_dates (
  staff_id bigint not null references public.staff(id) on delete cascade,
  work_date date not null,
  primary key (staff_id, work_date)
);

create table public.lpg_logs (
  id bigint generated always as identity primary key,
  date_start date,
  date_end date,     -- null = still in use
  price numeric
);
