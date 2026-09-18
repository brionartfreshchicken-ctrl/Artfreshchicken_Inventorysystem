-- ============================================================
-- 0001: profiles (accounts), tied to Supabase Auth
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

-- True if the currently authenticated user is an admin. Used throughout RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Creates a profile row automatically whenever someone signs up via
-- Supabase Auth. The very first account ever created becomes admin
-- (same as the app's original "first account is the owner" Setup flow);
-- every account after that defaults to staff.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_account boolean;
begin
  select not exists (select 1 from public.profiles) into first_account;
  insert into public.profiles (id, username, name, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when first_account then 'admin' else 'staff' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Blocks demoting or deleting the sole remaining admin (today this was
-- only a client-side check before the delete/role-change buttons).
create or replace function public.prevent_last_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if (select count(*) from public.profiles where role = 'admin') <= 1 then
      raise exception 'Cannot remove or demote the last remaining admin';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_admin
  before update or delete on public.profiles
  for each row execute function public.prevent_last_admin_change();

-- Only an admin may change someone's role (prevents a staff account from
-- promoting itself by editing its own profile row).
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> old.role and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();
