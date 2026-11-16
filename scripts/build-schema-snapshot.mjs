import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const outputPath = path.join(root, 'supabase', 'schema.sql');

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => /^\d{3}_.+\.sql$/.test(file))
  .sort();

if (files.length === 0) {
  console.error('No migration files found in supabase/migrations.');
  process.exit(1);
}

const header = [
  '-- AUTO-GENERATED FILE. DO NOT EDIT BY HAND.',
  '-- Source: supabase/migrations/*.sql',
  '-- Regenerate with: npm run db:schema',
  '-- Includes canonical schema, RLS policies, and reference seed data.',
  '-- Safe to re-run against a Supabase project.',
  '',
].join('\n');

const body = files
  .map((file) => {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim();
    return `-- ===== ${file} =====\n\n${sql}`;
  })
  .join('\n\n');

fs.writeFileSync(outputPath, `${header}\n${body}\n`, 'utf8');
console.log(`Wrote supabase/schema.sql from ${files.length} migrations.`);
