# AFM Database

## Source of Truth

Canonical schema changes are versioned in `migrations/`:

1. `001_core_schema.sql` - seasons, agency profile fields, tech nodes, scheduled events, stations, parts, and mission/flight-plan extensions.
2. `002_rls.sql` - read-only client policies; all writes stay behind the backend service role.
3. `003_seed_tech.sql` - Era I-IV starter tech catalog.
4. `004_seed_stations.sql` - ground and ship tracking network.

`schema.sql` is generated from those files by `npm run db:schema`. Do not edit it by hand.

## Fresh Project

Open the Supabase SQL Editor and run `schema.sql`. It includes the schema, policies, tech catalog, and station seed, and it is safe to re-run.

Alternatively, apply `migrations/001` through `004` in order.

## Existing Shared Project

Migrations are additive and preserve the legacy AP/RP/SI/IPI columns while the Phase 1 backend cutover is pending.

Do not apply them to a shared production project without owner approval. Apply `001` through `004` in order, then run the legacy backfill:

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
