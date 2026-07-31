import { Kysely, sql } from 'kysely';
import * as dotenv from 'dotenv';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { envPath, normalizePostgresUrl } from '../../../common/helpers';

dotenv.config({ path: envPath });

const db = new Kysely<any>({
  dialect: new PostgresJSDialect({
    postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL)),
  }),
});

describe('collections migration', () => {
  afterAll(async () => {
    await db.destroy();
  });

  // --- Task 1.1: schema ---

  it('adds is_collection, is_collection_row, is_inline_collection to pages', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'pages'
        AND column_name IN ('is_collection', 'is_collection_row', 'is_inline_collection')
    `.execute(db);
    const names = rows.rows.map((r) => r.column_name).sort();
    expect(names).toEqual([
      'is_collection',
      'is_collection_row',
      'is_inline_collection',
    ]);
  });

  it('creates collection_properties, collection_rows, collection_views tables', async () => {
    const rows = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('collection_properties', 'collection_rows', 'collection_views')
    `.execute(db);
    const names = rows.rows.map((r) => r.table_name).sort();
    expect(names).toEqual([
      'collection_properties',
      'collection_rows',
      'collection_views',
    ]);
  });

  it('collection_properties has a composite primary key on (collection_page_id, id)', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.table_name = 'collection_properties'
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `.execute(db);
    const names = rows.rows.map((r) => r.column_name);
    expect(names).toEqual(['collection_page_id', 'id']);
  });

  it('has the partial unique index on collection_properties(collection_page_id, lower(trim(name)))', async () => {
    const rows = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'collection_properties'
        AND indexname = 'collection_properties_page_name_alive_unique'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('has idx_pages_is_collection index', async () => {
    const rows = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'pages' AND indexname = 'idx_pages_is_collection'
    `.execute(db);
    expect(rows.rows.length).toBe(1);
  });

  it('collection_views does NOT have a deleted_at column', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'collection_views' AND column_name = 'deleted_at'
    `.execute(db);
    expect(rows.rows.length).toBe(0);
  });

  // --- Task 1.2: cell helper SQL functions ---

  it('collection_cell_text extracts a text value', async () => {
    const result = await sql<{ v: string }>`
      SELECT collection_cell_text('{"p":"hi"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(result.rows[0].v).toBe('hi');
  });

  it('collection_cell_numeric extracts numeric-typed and numeric-looking string values, else NULL', async () => {
    const ok = await sql<{ v: string }>`
      SELECT collection_cell_numeric('{"p":"42"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(Number(ok.rows[0].v)).toBe(42);

    const bad = await sql<{ v: string | null }>`
      SELECT collection_cell_numeric('{"p":"abc"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(bad.rows[0].v).toBeNull();
  });

  it('collection_cell_numeric returns NULL (not a thrown overflow error) for a numeric-looking but overflowing string', async () => {
    const result = await sql<{ v: string | null }>`
      SELECT collection_cell_numeric('{"p":"1e300000"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(result.rows[0].v).toBeNull();
  });

  it('collection_cell_timestamptz parses valid dates and returns NULL for invalid ones', async () => {
    const ok = await sql<{ v: Date | null }>`
      SELECT collection_cell_timestamptz('{"p":"2024-01-02"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(ok.rows[0].v).not.toBeNull();
    expect(new Date(ok.rows[0].v as any).getUTCFullYear()).toBe(2024);

    const bad = await sql<{ v: Date | null }>`
      SELECT collection_cell_timestamptz('{"p":"2024-13-45"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(bad.rows[0].v).toBeNull();
  });

  it('collection_cell_timestamptz is STABLE, not IMMUTABLE (result depends on session TimeZone)', async () => {
    const result = await sql<{ provolatile: string }>`
      SELECT provolatile FROM pg_proc WHERE proname = 'collection_cell_timestamptz'
    `.execute(db);
    expect(result.rows[0].provolatile).toBe('s');
  });

  it('collection_cell_bool extracts boolean-typed and bool-looking string values, else NULL', async () => {
    const ok = await sql<{ v: boolean }>`
      SELECT collection_cell_bool('{"p":"yes"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(ok.rows[0].v).toBe(true);

    const bad = await sql<{ v: boolean | null }>`
      SELECT collection_cell_bool('{"p":"maybe"}'::jsonb, 'p') AS v
    `.execute(db);
    expect(bad.rows[0].v).toBeNull();
  });

  it('jsonb_set_many applies patches, deleting keys set to null', async () => {
    const result = await sql<{ v: any }>`
      SELECT jsonb_set_many('{"a":1,"b":2}'::jsonb, '{"a":10,"b":null}'::jsonb) AS v
    `.execute(db);
    expect(result.rows[0].v).toEqual({ a: 10 });
  });
});
