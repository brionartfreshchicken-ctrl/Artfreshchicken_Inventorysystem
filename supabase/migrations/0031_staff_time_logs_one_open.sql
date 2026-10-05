-- ============================================================
-- 0031: prevent a staff account from ever having two open (not yet
-- timed out) shifts at once.
--
-- staff_time_in() had no guard against being called twice before
-- either call finished — two browser tabs on the same account, both
-- hitting "Time In" within the same moment, could each insert their
-- own row. doTimeOut() only ever closes the first open one it finds,
-- so the second would sit "ongoing" forever. The unique index below
-- makes a second simultaneous insert for the same user physically
-- impossible at the database level (the real fix); staff_time_in()
-- itself is rewritten to check for an already-open shift FIRST and
-- just hand back that row's id instead of inserting again — so the
-- normal case (clicking it once) never even reaches the index, and
-- the rare true-simultaneous race is caught and handled gracefully
-- rather than surfacing a confusing database error.
-- ============================================================

create unique index staff_time_logs_one_open_per_user
  on public.staff_time_logs (user_id)
  where time_out is null;

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

  -- Already has an open shift — hand back that one instead of
  -- creating a second (the unique index would reject it anyway).
  select id into v_id from public.staff_time_logs
    where user_id = v_uid and time_out is null
    order by time_in desc limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select name into v_name from public.profiles where id = v_uid;

  begin
    insert into public.staff_time_logs (user_id, name, time_in)
    values (v_uid, v_name, now())
    returning id into v_id;
  exception when unique_violation then
    -- Lost a true simultaneous race to another request from the same
    -- account between the check above and this insert — that other
    -- request's row is the real one; use it instead of erroring.
    select id into v_id from public.staff_time_logs
      where user_id = v_uid and time_out is null
      order by time_in desc limit 1;
  end;

  return v_id;
end;
$$;

-- Same signature as before (no new parameters) — plain create-or-
-- replace, existing grants (0029) carry over unchanged.
