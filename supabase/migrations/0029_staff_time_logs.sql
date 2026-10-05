-- ============================================================
-- 0029: Staff time in / time out.
--
-- A staff account's own clock-in record — separate from the existing
-- `staff` table (that's a payroll directory an Admin fills in by hand,
-- name/position/wage, never tied to a login account). This is tied
-- directly to the signed-in account (profiles.id / auth.uid()) and
-- is written ONLY by the two functions below — there is no insert or
-- update RLS policy on the table at all, so there is no path for a
-- staff account to set its own time_in/time_out to anything other
-- than the server's own clock at the moment they pressed the button.
-- ============================================================

create table public.staff_time_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  time_in timestamptz not null default now(),
  time_out timestamptz
);

alter table public.staff_time_logs enable row level security;

-- Read your own record, or everything if you're an Admin reviewing
-- attendance. No insert/update/delete policy — see the functions below.
create policy "staff_time_logs_select" on public.staff_time_logs
  for select using (user_id = (select auth.uid()) or public.is_admin());

create index idx_staff_time_logs_user_id on public.staff_time_logs(user_id);
create index idx_staff_time_logs_time_in on public.staff_time_logs(time_in);

create or replace function public.staff_time_in()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select name into v_name from public.profiles where id = v_uid;

  insert into public.staff_time_logs (user_id, name, time_in)
  values (v_uid, v_name, now())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.staff_time_out(p_log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  update public.staff_time_logs
    set time_out = now()
    where id = p_log_id and user_id = v_uid and time_out is null;

  if not found then
    raise exception 'That time log is not open, or is not yours';
  end if;
end;
$$;

-- Explicit from-public AND from-anon revokes, not just a plain grant —
-- see 0027's header comment for exactly why a bare "grant ... to
-- authenticated" was not sufficient by itself on this project before.
revoke execute on function public.staff_time_in() from public;
revoke execute on function public.staff_time_in() from anon;
grant execute on function public.staff_time_in() to authenticated;

revoke execute on function public.staff_time_out(bigint) from public;
revoke execute on function public.staff_time_out(bigint) from anon;
grant execute on function public.staff_time_out(bigint) to authenticated;
