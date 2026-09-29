-- ============================================================
-- 0027: URGENT — direct-access testing against the live database
-- (calling each RPC over the REST API with only the public anon
-- key, no login) showed that the `revoke execute ... from public`
-- statements from 0019 are NOT currently in effect for most of
-- these functions: an anonymous caller reaches the function BODY
-- (proven by getting the function's own custom error message, e.g.
-- "Only an admin can record a purchase", instead of a generic
-- "permission denied for function" grant-level rejection) for
-- complete_purchase, complete_production, void_sale,
-- delete_sale_permanently, delete_activity_permanently, and
-- purge_old_activity. Most of these happen to be saved anyway by
-- their own internal is_admin()/auth.uid() check — except
-- complete_production, which was intentionally left without an
-- admin gate (Production is a Staff-accessible page) and, until
-- 0025, had no auth check at all. That means, right now, on the
-- live database, an anonymous caller who knows or guesses a valid
-- recipe_id and linked_item_id can call complete_production()
-- directly and fabricate stock — no account needed.
--
-- 0025 already adds an internal auth check to complete_production()
-- (defense in depth), but this migration fixes the actual root
-- cause for every affected function: the grant itself. Re-running a
-- revoke is always safe/idempotent even if it turns out to already
-- be correctly applied for a given function.
-- ============================================================

revoke execute on function public.complete_purchase(bigint, text, text, jsonb) from public;
revoke execute on function public.complete_purchase(bigint, text, text, jsonb) from anon;
grant execute on function public.complete_purchase(bigint, text, text, jsonb) to authenticated;

revoke execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) from public;
revoke execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) from anon;
grant execute on function public.complete_production(bigint, numeric, text, jsonb, bigint, numeric) to authenticated;

revoke execute on function public.void_sale(bigint, text, text) from public;
revoke execute on function public.void_sale(bigint, text, text) from anon;
grant execute on function public.void_sale(bigint, text, text) to authenticated;

revoke execute on function public.delete_sale_permanently(bigint) from public;
revoke execute on function public.delete_sale_permanently(bigint) from anon;
grant execute on function public.delete_sale_permanently(bigint) to authenticated;

revoke execute on function public.void_activity(bigint, text, text) from public;
revoke execute on function public.void_activity(bigint, text, text) from anon;
grant execute on function public.void_activity(bigint, text, text) to authenticated;

revoke execute on function public.delete_activity_permanently(bigint) from public;
revoke execute on function public.delete_activity_permanently(bigint) from anon;
grant execute on function public.delete_activity_permanently(bigint) to authenticated;

revoke execute on function public.void_activity_range(bigint[], text, text) from public;
revoke execute on function public.void_activity_range(bigint[], text, text) from anon;
grant execute on function public.void_activity_range(bigint[], text, text) to authenticated;

revoke execute on function public.delete_activity_range(bigint[]) from public;
revoke execute on function public.delete_activity_range(bigint[]) from anon;
grant execute on function public.delete_activity_range(bigint[]) to authenticated;

revoke execute on function public.purge_old_activity() from public;
revoke execute on function public.purge_old_activity() from anon;
grant execute on function public.purge_old_activity() to authenticated;

revoke execute on function public.next_doc_number(text) from public;
revoke execute on function public.next_doc_number(text) from anon;
grant execute on function public.next_doc_number(text) to authenticated;

revoke execute on function public.reverse_movement_stock(bigint) from public;
revoke execute on function public.reverse_movement_stock(bigint) from anon;
grant execute on function public.reverse_movement_stock(bigint) to authenticated;

revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text) from public;
revoke execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text) from anon;
grant execute on function public.complete_sale(jsonb, numeric, text, numeric, numeric, numeric, text) to authenticated;
