-- 006_diplomacy_rls.sql
-- Diplomacy MVP: read-only client access to rows involving the player's own
-- agency. All writes stay behind the backend service role, which bypasses RLS.

alter table agency_relations enable row level security;
alter table diplomatic_proposals enable row level security;
alter table agency_agreements enable row level security;
alter table diplomatic_events enable row level security;
alter table agency_bloc_saturation enable row level security;

drop policy if exists agency_relations_read_own on agency_relations;
create policy agency_relations_read_own on agency_relations
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = agency_relations.agency_low_id
          or a.id = agency_relations.agency_high_id
        )
    )
  );

drop policy if exists diplomatic_proposals_read_own on diplomatic_proposals;
create policy diplomatic_proposals_read_own on diplomatic_proposals
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = diplomatic_proposals.from_agency_id
          or a.id = diplomatic_proposals.to_agency_id
        )
    )
  );

drop policy if exists agency_agreements_read_own on agency_agreements;
create policy agency_agreements_read_own on agency_agreements
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = agency_agreements.party_low_id
          or a.id = agency_agreements.party_high_id
        )
    )
  );

drop policy if exists diplomatic_events_read_own on diplomatic_events;
create policy diplomatic_events_read_own on diplomatic_events
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and (
          a.id = diplomatic_events.actor_agency_id
          or a.id = diplomatic_events.counterpart_agency_id
        )
    )
  );

drop policy if exists agency_bloc_saturation_read_own on agency_bloc_saturation;
create policy agency_bloc_saturation_read_own on agency_bloc_saturation
  for select to authenticated
  using (
    exists (
      select 1
      from agencies a
      where a.user_id = auth.uid()
        and a.id = agency_bloc_saturation.agency_id
    )
  );

grant select on
  agency_relations,
  diplomatic_proposals,
  agency_agreements,
  diplomatic_events,
  agency_bloc_saturation
to authenticated;
