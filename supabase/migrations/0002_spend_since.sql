-- Spend summation moves into Postgres.
--
-- Why: lib/llm/budget.ts previously did `select cost_usd ... ` and summed the
-- rows in JS. PostgREST caps rows per request at the project's `max-rows`
-- setting (1000 by default on Supabase hosted) and truncates SILENTLY with a
-- 200 — no error, and with no ORDER BY, an arbitrary 1000 of them. Past that
-- many non-refunded rows in a month the global sum stops growing, so the
-- $20/month cap in app/api/ai/draft-brief/route.ts can never fire again. At a
-- measured ~$0.000195 per settled call, the sum would pin near $0.20 against
-- a $20 ceiling. It fails in the direction that costs money, and no amount of
-- manual testing on a small ledger reveals it.
--
-- An aggregate in the PostgREST query (`select=cost_usd.sum()`) would also fix
-- it without a migration, but aggregates are disabled on this project
-- (PGRST123, verified 2026-10-20), so the function is the way.
--
-- Second job: expiring orphaned reservations. A row is written as 'reserved'
-- before the OpenAI call and moved to 'settled' or 'refunded' after. If the
-- serverless invocation is killed in between — a slow upstream is enough, no
-- bug required — the row stays 'reserved' forever and counts as spend at
-- worst-case price for the rest of the window. A dozen of those exceed a
-- user's daily cap and lock them out having consumed nothing. The TTL below
-- makes a stuck reservation stop counting.
--
-- ponytail: a fixed TTL, not a reaper job or a status-sweeping cron. The
-- ceiling is that a request still genuinely in flight past the TTL stops
-- being counted against its own quota. lib/llm/openai.ts aborts its fetch at
-- 30s, well inside the window, so that can't happen in practice — if that
-- timeout is ever raised above the TTL, raise this with it.

create or replace function spend_since(
  p_start timestamptz,
  p_user uuid default null,
  p_reservation_ttl interval default interval '10 minutes'
) returns numeric
language sql
stable
as $$
  select coalesce(sum(cost_usd), 0)::numeric
  from usage_ledger
  where created_at >= p_start
    and status <> 'refunded'
    and (status <> 'reserved' or created_at > now() - p_reservation_ttl)
    and (p_user is null or user_id = p_user);
$$;

-- Only the server may ask. The global figure (p_user null) is business data,
-- and even the per-user figure has no UI behind it — all callers go through
-- lib/supabase/admin.ts's service-role client, which is not subject to these
-- grants. Without this revoke, PostgREST would expose the function to any
-- holder of the public anon key.
revoke execute on function spend_since(timestamptz, uuid, interval) from public;
revoke execute on function spend_since(timestamptz, uuid, interval) from anon;
revoke execute on function spend_since(timestamptz, uuid, interval) from authenticated;
grant execute on function spend_since(timestamptz, uuid, interval) to service_role;

-- Supports the window scans above (the existing user_id+created_at index
-- covers the per-user case; this covers the global one).
create index if not exists usage_ledger_status_created_at_idx
  on usage_ledger (status, created_at);
