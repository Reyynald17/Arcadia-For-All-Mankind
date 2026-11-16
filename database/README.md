# Deprecated

This directory is an archive. The old Bootstrap/Express database model under `legacy/` does not match the application code and must not be applied to Supabase.

Canonical schema and migrations live in `../supabase/migrations/`. The generated setup file is `../supabase/schema.sql`.

Useful commands from the repository root:

```bash
npm run db:schema
npm run db:validate
npm run db:backfill
```
