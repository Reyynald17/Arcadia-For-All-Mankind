# AFM Database

## Source of Truth

Canonical schema changes are versioned in `migrations/`:

1. `001_core_schema.sql` - seasons, agency profile fields, tech nodes, scheduled events, stations, parts, and mission/flight-plan extensions.
2. `002_rls.sql` - read-only client policies; all writes stay behind the backend service role.
3. `003_seed_tech.sql` - Era I-IV starter tech catalog.
4. `004_seed_stations.sql` - ground and ship tracking network.
5. `005_diplomacy.sql` - relations, proposals, agreements, saturation, and NPC agencies.
6. `006_diplomacy_rls.sql` - diplomacy RLS and read-own policies.
7. `007_seed_npc_diplomacy.sql` - 18 NPC agencies across the three blocs.
8. `008_economy.sql` - contracts, one-time grants, mission rewards, and the mission queue.
9. `009_economy_rls.sql` - economy RLS and read-own policies.
10. `010_contract_mission_link.sql` - links completed contracts to their mission and backfills existing rows.
11. `011_audit_events.sql` - audit trail for GM actions and financial mutations (backend service role only).
12. `012_audit_append_only.sql` - blocks UPDATE, DELETE, and TRUNCATE on `audit_events`; keeps agency/season as soft references.

`schema.sql` is generated from those files by `npm run db:schema`. Do not edit it by hand.

## Fresh Project

Open the Supabase SQL Editor and run `schema.sql`. It includes the schema, policies, tech catalog, and station seed, and it is safe to re-run.

Alternatively, apply `migrations/001` through `012` in order.

## Existing Shared Project

Migrations are additive and preserve the legacy AP/RP/SI/IPI columns while the Phase 1 backend cutover is pending.

Do not apply them to a shared production project without owner approval. Apply `001` through `012` in order, then run the legacy backfill:

```bash
npm run db:backfill
```

Review the dry-run report before writing:

```bash
npm run db:backfill:apply
```

The backfill only inserts missing `agency_tech_nodes` rows. Add `--refresh` only when you intentionally want to overwrite existing progress from research logs:

```bash
node backend/scripts/migrate-legacy.mjs --apply --refresh
```

## Validation

```bash
npm run db:validate
npm run db:schema
```

`db:validate` checks required tables and columns, RLS coverage, duplicate tech nodes, missing prerequisites, tech-tree cycles, and station coordinates.

## Archived Files

The old `database/` schema and `supabase/legacy/seed-technologies.sql` are historical only. Do not apply them.
