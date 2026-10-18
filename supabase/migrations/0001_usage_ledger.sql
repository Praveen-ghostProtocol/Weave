-- Usage ledger: (user, task, model, tokens, cost) only — never content.
-- Supabase Postgres already has gen_random_uuid() (pgcrypto), this is just
-- defensive in case it isn't enabled on the project yet.
create extension if not exists pgcrypto;

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_usd numeric(10,6) not null,
  status text not null check (status in ('reserved', 'settled', 'refunded')),
  created_at timestamptz not null default now()
);

create index if not exists usage_ledger_user_id_created_at_idx
  on usage_ledger (user_id, created_at);

-- Supports a future global-spend-this-month query across all users.
create index if not exists usage_ledger_created_at_idx
  on usage_ledger (created_at);

alter table usage_ledger enable row level security;

-- A signed-in user can read their own usage rows (e.g. a "your usage this
-- month" display) but there is deliberately NO insert/update/delete policy
-- for the authenticated role. All writes go through the service-role
-- client (lib/supabase/admin.ts), which bypasses RLS entirely — this is so
-- a user can never forge or tamper with their own cost/token rows.
create policy "Users can view their own usage ledger rows"
  on usage_ledger
  for select
  to authenticated
  using (user_id = auth.uid());
