-- ============================================================
-- 0010: Settings (singleton row) and document-number sequences
-- ============================================================

-- Singleton-row trick: id is boolean and must be true, so at most one row
-- can ever exist.
create table public.settings (
  id boolean primary key default true,
  gcash_qr_path text,          -- Supabase Storage object path
  retention_days integer not null default 0 check (retention_days >= 0),
  last_purge timestamptz,
  constraint settings_singleton check (id)
);

insert into public.settings (id) values (true);

create table public.doc_sequences (
  key text primary key,   -- e.g. 'PO-20260918'
  seq integer not null default 0
);

-- Atomic replacement for the old client-side per-day counter (which would
-- race across two devices) — e.g. next_doc_number('PO') -> 'PO-20260918-0001'.
create or replace function public.next_doc_number(prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  day_key text := prefix || '-' || to_char(now(), 'YYYYMMDD');
  next_seq integer;
begin
  insert into public.doc_sequences (key, seq) values (day_key, 1)
  on conflict (key) do update set seq = doc_sequences.seq + 1
  returning seq into next_seq;
  return day_key || '-' || lpad(next_seq::text, 4, '0');
end;
$$;
