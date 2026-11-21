-- Audit trail for GM actions and financial mutations.
-- Service-role only: RLS is enabled without client policies.

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete set null,
  agency_id uuid references agencies(id) on delete set null,
  actor_type text not null
    check (actor_type in ('gm', 'player', 'agency', 'system')),
  actor_id text,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  delta_data jsonb,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_agency_created_idx
  on audit_events (agency_id, created_at desc);

create index if not exists audit_events_action_created_idx
  on audit_events (action, created_at desc);

create index if not exists audit_events_actor_created_idx
  on audit_events (actor_type, created_at desc);

create index if not exists audit_events_created_idx
  on audit_events (created_at desc);

alter table audit_events enable row level security;

comment on table audit_events is
  'Append-only audit trail for GM actions and financial mutations. Backend service role only.';
