-- 005_diplomacy.sql
-- Diplomacy MVP schema. Additive and safe to re-run.
-- Balance values are supplied by the backend config module; this migration only
-- stores state and provides the atomic acceptance transaction.

-- ---------------------------------------------------------------------------
-- Agencies: canonical bloc metadata on top of the legacy alignment column
-- ---------------------------------------------------------------------------

alter table agencies
  add column if not exists bloc text,
  add column if not exists controller_type text,
  add column if not exists npc_profile jsonb,
  add column if not exists is_active boolean;

update agencies
set bloc = case upper(coalesce(alignment, 'INDEPENDENT'))
  when 'WESTERN' then 'western'
  when 'EASTERN' then 'eastern'
  else 'neutral'
end
where bloc is null
   or bloc not in ('western', 'eastern', 'neutral');

alter table agencies alter column bloc set default 'neutral';
alter table agencies alter column bloc set not null;

update agencies
set controller_type = case
  when code like 'NPC\_%' escape '\' then 'npc'
  else 'player'
end
where controller_type is null
   or controller_type not in ('player', 'npc');

alter table agencies alter column controller_type set default 'player';
alter table agencies alter column controller_type set not null;

update agencies
set is_active = true
where is_active is null;

alter table agencies alter column is_active set default true;
alter table agencies alter column is_active set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agencies_bloc_check'
  ) then
    alter table agencies
      add constraint agencies_bloc_check
      check (bloc in ('western', 'eastern', 'neutral'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'agencies_controller_type_check'
  ) then
    alter table agencies
      add constraint agencies_controller_type_check
      check (controller_type in ('player', 'npc'));
  end if;
end
$$;

create index if not exists agencies_bloc_active_idx
  on agencies (season_id, bloc, is_active);
create index if not exists agencies_controller_active_idx
  on agencies (season_id, controller_type, is_active);

comment on column agencies.bloc is
  'Diplomacy bloc: western, eastern, or neutral. Legacy alignment remains for tech modifiers.';
comment on column agencies.controller_type is
  'player when controlled through the API, npc when driven by the deterministic diplomacy tick.';
comment on column agencies.npc_profile is
  'Server-only NPC behaviour profile. Never expose through public agency APIs.';
comment on column agencies.is_active is
  'Inactive agencies remain in history but are excluded from diplomacy and bloc counts.';

-- ---------------------------------------------------------------------------
-- Relations, proposals, agreements, audit log
-- ---------------------------------------------------------------------------

create table if not exists agency_relations (
  id uuid primary key default gen_random_uuid(),
  agency_low_id uuid not null references agencies(id) on delete cascade,
  agency_high_id uuid not null references agencies(id) on delete cascade,
  relation_score int not null default 50
    check (relation_score between 0 and 100),
  status text not null default 'neutral'
    check (status in ('neutral', 'cooperative', 'allied', 'sanctioned')),
  cooldown_until timestamptz,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_relations_distinct check (agency_low_id <> agency_high_id),
  constraint agency_relations_normalized check (agency_low_id < agency_high_id),
  constraint agency_relations_pair_key unique (agency_low_id, agency_high_id)
);

create index if not exists agency_relations_low_idx
  on agency_relations (agency_low_id);
create index if not exists agency_relations_high_idx
  on agency_relations (agency_high_id);
create index if not exists agency_relations_cooldown_idx
  on agency_relations (cooldown_until);

create table if not exists diplomatic_proposals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  from_agency_id uuid not null references agencies(id) on delete cascade,
  to_agency_id uuid not null references agencies(id) on delete cascade,
  proposal_type text not null default 'cooperation'
    check (proposal_type in ('cooperation')),
  terms jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'withdrawn', 'countered')),
  parent_proposal_id uuid references diplomatic_proposals(id) on delete set null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint diplomatic_proposals_distinct check (from_agency_id <> to_agency_id)
);

create unique index if not exists diplomatic_proposals_pending_pair_idx
  on diplomatic_proposals (
    least(from_agency_id, to_agency_id),
    greatest(from_agency_id, to_agency_id),
    proposal_type
  )
  where status = 'pending';
create index if not exists diplomatic_proposals_inbox_idx
  on diplomatic_proposals (to_agency_id, status, expires_at);
create index if not exists diplomatic_proposals_outbox_idx
  on diplomatic_proposals (from_agency_id, status, expires_at);
create index if not exists diplomatic_proposals_expiry_idx
  on diplomatic_proposals (status, expires_at);
create index if not exists diplomatic_proposals_season_idx
  on diplomatic_proposals (season_id);

create table if not exists agency_agreements (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  party_low_id uuid not null references agencies(id) on delete cascade,
  party_high_id uuid not null references agencies(id) on delete cascade,
  agreement_type text not null default 'cooperation'
    check (agreement_type in ('cooperation')),
  terms jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'expired', 'terminated')),
  source_proposal_id uuid references diplomatic_proposals(id) on delete set null,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  next_payment_at timestamptz,
  terminated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agency_agreements_distinct check (party_low_id <> party_high_id),
  constraint agency_agreements_normalized check (party_low_id < party_high_id)
);

create index if not exists agency_agreements_low_idx
  on agency_agreements (party_low_id, status);
create index if not exists agency_agreements_high_idx
  on agency_agreements (party_high_id, status);
create index if not exists agency_agreements_live_idx
  on agency_agreements (status, ends_at);
create index if not exists agency_agreements_season_idx
  on agency_agreements (season_id);

create table if not exists diplomatic_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references seasons(id) on delete cascade,
  actor_agency_id uuid references agencies(id) on delete set null,
  counterpart_agency_id uuid references agencies(id) on delete set null,
  event_type text not null,
  proposal_id uuid references diplomatic_proposals(id) on delete set null,
  agreement_id uuid references agency_agreements(id) on delete set null,
  description text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists diplomatic_events_actor_idx
  on diplomatic_events (actor_agency_id, created_at desc);
create index if not exists diplomatic_events_counterpart_idx
  on diplomatic_events (counterpart_agency_id, created_at desc);
create index if not exists diplomatic_events_proposal_idx
  on diplomatic_events (proposal_id);
create index if not exists diplomatic_events_agreement_idx
  on diplomatic_events (agreement_id);

-- Persisted saturation evaluation. Only neutral agencies have rows because
-- saturation is a neutral-agency soft cap against western/eastern blocs.
create table if not exists agency_bloc_saturation (
  agency_id uuid not null references agencies(id) on delete cascade,
  bloc text not null check (bloc in ('western', 'eastern', 'neutral')),
  counterpart_count int not null default 0 check (counterpart_count >= 0),
  bloc_agency_count int not null default 0 check (bloc_agency_count >= 0),
  threshold int not null default 0 check (threshold >= 0),
  is_saturated boolean not null default false,
  evaluated_at timestamptz not null default now(),
  primary key (agency_id, bloc)
);

create index if not exists agency_bloc_saturation_evaluated_idx
  on agency_bloc_saturation (evaluated_at);

drop trigger if exists agency_relations_set_updated_at on agency_relations;
create trigger agency_relations_set_updated_at
  before update on agency_relations
  for each row execute function set_updated_at();

drop trigger if exists diplomatic_proposals_set_updated_at on diplomatic_proposals;
create trigger diplomatic_proposals_set_updated_at
  before update on diplomatic_proposals
  for each row execute function set_updated_at();

drop trigger if exists agency_agreements_set_updated_at on agency_agreements;
create trigger agency_agreements_set_updated_at
  before update on agency_agreements
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Saturation helpers
-- ---------------------------------------------------------------------------

create or replace function diplomacy_bloc_size(
  p_bloc text,
  p_season_id uuid
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(*)::int
  from agencies a
  where a.bloc = p_bloc
    and a.is_active
    and (p_season_id is null or a.season_id = p_season_id);
$$;

create or replace function diplomacy_counterpart_count(
  p_agency_id uuid,
  p_bloc text,
  p_season_id uuid,
  p_at timestamptz
)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select count(distinct
    case
      when ag.party_low_id = p_agency_id then ag.party_high_id
      else ag.party_low_id
    end
  )::int
  from agency_agreements ag
  join agencies other
    on other.id = case
      when ag.party_low_id = p_agency_id then ag.party_high_id
      else ag.party_low_id
    end
  where (ag.party_low_id = p_agency_id or ag.party_high_id = p_agency_id)
    and ag.status = 'active'
    and ag.ends_at > p_at
    and ag.agreement_type = 'cooperation'
    and other.is_active
    and other.bloc = p_bloc
    and (p_season_id is null or other.season_id = p_season_id);
$$;

create or replace function diplomacy_saturation_snapshot(
  p_agency_id uuid,
  p_bloc text,
  p_ratio numeric,
  p_at timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_season_id uuid;
  v_bloc_size int;
  v_counterparts int;
  v_threshold int;
  v_saturated boolean;
begin
  select a.season_id into v_season_id
  from agencies a
  where a.id = p_agency_id;

  if not found then
    raise exception using message = 'AGENCY_NOT_FOUND';
  end if;

  v_bloc_size := diplomacy_bloc_size(p_bloc, v_season_id);
  v_counterparts := diplomacy_counterpart_count(p_agency_id, p_bloc, v_season_id, p_at);
  v_threshold := ceil(greatest(coalesce(p_ratio, 0), 0) * v_bloc_size)::int;
  v_saturated := v_bloc_size > 0
    and v_counterparts > 0
    and v_counterparts >= v_threshold;

  return jsonb_build_object(
    'agency_id', p_agency_id,
    'bloc', p_bloc,
    'counterpart_count', v_counterparts,
    'bloc_agency_count', v_bloc_size,
    'threshold', v_threshold,
    'is_saturated', v_saturated
  );
end;
$$;

create or replace function diplomacy_refresh_saturation(
  p_agency_id uuid,
  p_ratio numeric,
  p_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bloc text;
  v_snapshot jsonb;
begin
  if not exists (
    select 1 from agencies a where a.id = p_agency_id and a.bloc = 'neutral'
  ) then
    return;
  end if;

  foreach v_bloc in array array['western', 'eastern']
  loop
    v_snapshot := diplomacy_saturation_snapshot(p_agency_id, v_bloc, p_ratio, p_at);

    insert into agency_bloc_saturation (
      agency_id,
      bloc,
      counterpart_count,
      bloc_agency_count,
      threshold,
      is_saturated,
      evaluated_at
    )
    values (
      p_agency_id,
      v_bloc,
      (v_snapshot ->> 'counterpart_count')::int,
      (v_snapshot ->> 'bloc_agency_count')::int,
      (v_snapshot ->> 'threshold')::int,
      (v_snapshot ->> 'is_saturated')::boolean,
      p_at
    )
    on conflict (agency_id, bloc) do update
      set counterpart_count = excluded.counterpart_count,
          bloc_agency_count = excluded.bloc_agency_count,
          threshold = excluded.threshold,
          is_saturated = excluded.is_saturated,
          evaluated_at = excluded.evaluated_at;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic acceptance: agreement creation + saturation re-check + cooldown +
-- audit log + agreement-expiry event all happen in one transaction.
-- ---------------------------------------------------------------------------

create or replace function accept_diplomatic_proposal(
  p_proposal_id uuid,
  p_actor_agency_id uuid,
  p_saturation_ratio numeric,
  p_allowed_durations int[],
  p_initial_score int,
  p_relation_gain int,
  p_cooldown_seconds int,
  p_cross_bloc_cooldown_seconds int,
  p_min_score int,
  p_max_score int,
  p_cooperative_threshold int,
  p_allied_threshold int
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proposal diplomatic_proposals%rowtype;
  v_from agencies%rowtype;
  v_to agencies%rowtype;
  v_duration int;
  v_cooldown_seconds int;
  v_ends_at timestamptz;
  v_multiplier numeric;
  v_season_id uuid;
  v_relation agency_relations%rowtype;
  v_agreement agency_agreements%rowtype;
  v_snapshot jsonb;
  v_score int;
  v_status text;
begin
  select * into v_proposal
  from diplomatic_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception using message = 'PROPOSAL_NOT_FOUND';
  end if;

  if v_proposal.to_agency_id <> p_actor_agency_id then
    raise exception using message = 'FORBIDDEN_PROPOSAL';
  end if;

  if v_proposal.status <> 'pending' then
    raise exception using message = 'PROPOSAL_NOT_PENDING';
  end if;

  if v_proposal.expires_at <= now() then
    update diplomatic_proposals
    set status = 'expired',
        responded_at = now(),
        updated_at = now()
    where id = v_proposal.id
      and status = 'pending';

    insert into diplomatic_events (
      season_id,
      actor_agency_id,
      counterpart_agency_id,
      event_type,
      proposal_id,
      description,
      data
    )
    values (
      v_proposal.season_id,
      v_proposal.to_agency_id,
      v_proposal.from_agency_id,
      'DIPLOMACY_PROPOSAL_EXPIRED',
      v_proposal.id,
      'Proposal expired before acceptance.',
      jsonb_build_object('reason', 'expired_before_accept')
    );

    return jsonb_build_object('error', 'PROPOSAL_EXPIRED');
  end if;

  select * into v_from from agencies where id = v_proposal.from_agency_id;
  select * into v_to from agencies where id = v_proposal.to_agency_id;

  if v_from.id is null or v_to.id is null then
    raise exception using message = 'AGENCY_NOT_FOUND';
  end if;

  if not v_from.is_active or not v_to.is_active then
    raise exception using message = 'AGENCY_INACTIVE';
  end if;

  if v_from.season_id is distinct from v_to.season_id then
    raise exception using message = 'SEASON_MISMATCH';
  end if;

  v_duration := nullif(v_proposal.terms ->> 'duration_days', '')::int;
  if v_duration is null
     or not (v_duration = any(coalesce(p_allowed_durations, array[]::int[]))) then
    raise exception using message = 'INVALID_DURATION';
  end if;

  -- Serialise saturation checks for the same neutral agency/bloc.
  if v_from.bloc = 'neutral' and v_to.bloc in ('western', 'eastern') then
    perform pg_advisory_xact_lock(
      hashtext('diplomacy_saturation'),
      hashtext(v_from.id::text || ':' || v_to.bloc)
    );

    v_snapshot := diplomacy_saturation_snapshot(
      v_from.id,
      v_to.bloc,
      p_saturation_ratio,
      now()
    );

    if (v_snapshot ->> 'is_saturated')::boolean then
      raise exception using message = upper(v_to.bloc) || '_SATURATED';
    end if;
  end if;

  if v_to.bloc = 'neutral' and v_from.bloc in ('western', 'eastern') then
    perform pg_advisory_xact_lock(
      hashtext('diplomacy_saturation'),
      hashtext(v_to.id::text || ':' || v_from.bloc)
    );

    v_snapshot := diplomacy_saturation_snapshot(
      v_to.id,
      v_from.bloc,
      p_saturation_ratio,
      now()
    );

    if (v_snapshot ->> 'is_saturated')::boolean then
      raise exception using message = upper(v_from.bloc) || '_SATURATED';
    end if;
  end if;

  v_season_id := coalesce(v_from.season_id, current_season_id());
  v_cooldown_seconds := case
    when v_from.bloc in ('western', 'eastern')
      and v_to.bloc in ('western', 'eastern')
      and v_from.bloc <> v_to.bloc
      then p_cross_bloc_cooldown_seconds
    else p_cooldown_seconds
  end;

  v_score := least(
    p_max_score,
    greatest(p_min_score, p_initial_score + p_relation_gain)
  );
  v_status := case
    when v_score >= p_allied_threshold then 'allied'
    when v_score >= p_cooperative_threshold then 'cooperative'
    else 'neutral'
  end;

  insert into agency_relations as rel (
    agency_low_id,
    agency_high_id,
    relation_score,
    status,
    cooldown_until,
    last_action_at
  )
  values (
    least(v_from.id, v_to.id),
    greatest(v_from.id, v_to.id),
    v_score,
    v_status,
    now() + make_interval(secs => greatest(v_cooldown_seconds, 0)),
    now()
  )
  on conflict (agency_low_id, agency_high_id) do update
    set relation_score = least(
          p_max_score,
          greatest(p_min_score, rel.relation_score + p_relation_gain)
        ),
        status = case
          when least(p_max_score, greatest(p_min_score, rel.relation_score + p_relation_gain))
            >= p_allied_threshold then 'allied'
          when least(p_max_score, greatest(p_min_score, rel.relation_score + p_relation_gain))
            >= p_cooperative_threshold then 'cooperative'
          else 'neutral'
        end,
        cooldown_until = excluded.cooldown_until,
        last_action_at = excluded.last_action_at,
        updated_at = now()
  returning * into v_relation;

  select coalesce(time_scale_multiplier, 52.142857)
  into v_multiplier
  from seasons
  where id = v_season_id;

  if v_multiplier is null or v_multiplier <= 0 then
    v_multiplier := 52.142857;
  end if;

  v_ends_at := now() + (v_duration::double precision / v_multiplier::double precision) * interval '1 day';

  insert into agency_agreements (
    season_id,
    party_low_id,
    party_high_id,
    agreement_type,
    terms,
    status,
    source_proposal_id,
    started_at,
    ends_at
  )
  values (
    v_season_id,
    least(v_from.id, v_to.id),
    greatest(v_from.id, v_to.id),
    v_proposal.proposal_type,
    v_proposal.terms,
    'active',
    v_proposal.id,
    now(),
    v_ends_at
  )
  returning * into v_agreement;

  update diplomatic_proposals
  set status = 'accepted',
      responded_at = now(),
      updated_at = now()
  where id = v_proposal.id
    and status = 'pending';

  insert into diplomatic_events (
    season_id,
    actor_agency_id,
    counterpart_agency_id,
    event_type,
    proposal_id,
    agreement_id,
    description,
    data
  )
  values (
    v_season_id,
    v_to.id,
    v_from.id,
    'DIPLOMACY_PROPOSAL_ACCEPTED',
    v_proposal.id,
    v_agreement.id,
    'Proposal accepted.',
    jsonb_build_object(
      'agreement_type', v_agreement.agreement_type,
      'duration_days', v_duration,
      'cross_bloc', (
        v_from.bloc in ('western', 'eastern')
        and v_to.bloc in ('western', 'eastern')
        and v_from.bloc <> v_to.bloc
      )
    )
  );

  insert into diplomatic_events (
    season_id,
    actor_agency_id,
    counterpart_agency_id,
    event_type,
    proposal_id,
    agreement_id,
    description,
    data
  )
  values (
    v_season_id,
    v_to.id,
    v_from.id,
    'DIPLOMACY_AGREEMENT_CREATED',
    v_proposal.id,
    v_agreement.id,
    'Cooperation agreement is now active.',
    jsonb_build_object(
      'agreement_type', v_agreement.agreement_type,
      'duration_days', v_duration,
      'ends_at', v_agreement.ends_at
    )
  );

  insert into scheduled_events (
    season_id,
    agency_id,
    event_type,
    reference_id,
    payload,
    execute_at,
    status
  )
  values (
    v_season_id,
    v_to.id,
    'DIPLOMACY_AGREEMENT_EXPIRED',
    v_agreement.id::text,
    jsonb_build_object(
      'agreement_id', v_agreement.id,
      'ends_at', v_agreement.ends_at
    ),
    v_agreement.ends_at,
    'PENDING'
  );

  perform diplomacy_refresh_saturation(v_from.id, p_saturation_ratio, now());
  perform diplomacy_refresh_saturation(v_to.id, p_saturation_ratio, now());

  return jsonb_build_object(
    'agreement', to_jsonb(v_agreement),
    'relation', to_jsonb(v_relation)
  );
end;
$$;

-- Backend-only execution. The API authenticates and authorises the actor before
-- calling these functions with the service role.
revoke all on function diplomacy_bloc_size(text, uuid) from public, anon, authenticated;
revoke all on function diplomacy_counterpart_count(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function diplomacy_saturation_snapshot(uuid, text, numeric, timestamptz)
  from public, anon, authenticated;
revoke all on function diplomacy_refresh_saturation(uuid, numeric, timestamptz)
  from public, anon, authenticated;
revoke all on function accept_diplomatic_proposal(
  uuid, uuid, numeric, int[], int, int, int, int, int, int, int, int
) from public, anon, authenticated;

grant execute on function diplomacy_bloc_size(text, uuid) to service_role;
grant execute on function diplomacy_counterpart_count(uuid, text, uuid, timestamptz)
  to service_role;
grant execute on function diplomacy_saturation_snapshot(uuid, text, numeric, timestamptz)
  to service_role;
grant execute on function diplomacy_refresh_saturation(uuid, numeric, timestamptz)
  to service_role;
grant execute on function accept_diplomatic_proposal(
  uuid, uuid, numeric, int[], int, int, int, int, int, int, int, int
) to service_role;
