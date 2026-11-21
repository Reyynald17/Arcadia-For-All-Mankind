-- Enforce append-only audit rows.
-- The 011 foreign keys used ON DELETE SET NULL, which would mutate audit rows
-- when an agency or season is deleted. Keep them as soft references instead.

alter table audit_events drop constraint if exists audit_events_agency_id_fkey;
alter table audit_events drop constraint if exists audit_events_season_id_fkey;

create or replace function audit_events_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only; % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_events_no_update on audit_events;
create trigger audit_events_no_update
  before update on audit_events
  for each row execute function audit_events_reject_mutation();

drop trigger if exists audit_events_no_delete on audit_events;
create trigger audit_events_no_delete
  before delete on audit_events
  for each row execute function audit_events_reject_mutation();

drop trigger if exists audit_events_no_truncate on audit_events;
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function audit_events_reject_mutation();

comment on function audit_events_reject_mutation() is
  'Blocks UPDATE, DELETE, and TRUNCATE on audit_events. Drop triggers only for an intentional maintenance window.';
