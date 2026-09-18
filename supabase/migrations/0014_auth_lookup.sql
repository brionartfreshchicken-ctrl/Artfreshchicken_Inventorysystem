-- ============================================================
-- 0014: username -> email lookup for sign-in (the app signs in by
-- username, but Supabase Auth identifies accounts by email), plus a
-- pre-signup username-availability check. Both are SECURITY DEFINER
-- functions callable by anonymous (not-yet-signed-in) clients, so they
-- don't require opening up the profiles table itself to anon access.
-- ============================================================

alter table public.profiles add column email text;

-- Re-created to also populate the new email column.
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
  insert into public.profiles (id, username, name, role, email)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    -- Role is NEVER taken from client-supplied signup metadata (that would
    -- let anyone self-promote to admin) — only ever first-account-is-admin.
    case when first_account then 'admin' else 'staff' end,
    new.email
  );
  return new;
end;
$$;

-- Keeps profiles.email in sync if someone changes their auth email later.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

create or replace function public.email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where username = lower(trim(p_username));
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where username = lower(trim(p_username))
  );
$$;

-- Lets the (anonymous, not-yet-signed-in) login screen tell whether to show
-- first-run Setup or the normal Sign in/Sign up tabs.
create or replace function public.accounts_exist()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles);
$$;

grant execute on function public.email_for_username(text) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.accounts_exist() to anon, authenticated;
