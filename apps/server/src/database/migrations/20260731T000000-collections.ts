import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('is_collection', 'boolean', (col) =>
      col.ifNotExists().notNull().defaultTo(false),
    )
    .addColumn('is_collection_row', 'boolean', (col) =>
      col.ifNotExists().notNull().defaultTo(false),
    )
    .addColumn('is_inline_collection', 'boolean', (col) =>
      col.ifNotExists().notNull().defaultTo(false),
    )
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_pages_is_collection
      ON pages (space_id, position COLLATE "C")
      WHERE is_collection = true AND deleted_at IS NULL
  `.execute(db);

  await db.schema
    .createTable('collection_properties')
    .ifNotExists()
    .addColumn('collection_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('id', 'varchar', (col) => col.notNull())
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('type_options', 'jsonb')
    .addColumn('is_primary', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addPrimaryKeyConstraint('collection_properties_pkey', [
      'collection_page_id',
      'id',
    ])
    .execute();

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS collection_properties_page_name_alive_unique
      ON collection_properties (collection_page_id, lower(trim(name)))
      WHERE deleted_at IS NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_collection_properties_page
      ON collection_properties (collection_page_id)
  `.execute(db);

  await db.schema
    .createTable('collection_rows')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('collection_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull().unique(),
    )
    .addColumn('cells', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('last_updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_collection_rows_page_alive
      ON collection_rows (collection_page_id, position COLLATE "C", id)
      WHERE deleted_at IS NULL
  `.execute(db);

  await db.schema
    .createTable('collection_views')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('collection_page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull().defaultTo('table'))
    .addColumn('position', 'varchar', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`
    CREATE INDEX IF NOT EXISTS idx_collection_views_page
      ON collection_views (collection_page_id)
  `.execute(db);

  // Cell extraction helpers for filters and sorts. Return NULL for absent or
  // non-castable values.
  await sql`
    CREATE OR REPLACE FUNCTION collection_cell_text(cells jsonb, prop text)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$ SELECT cells->>prop::text $$
  `.execute(db);

  // A numeric-looking string can still overflow PostgreSQL's numeric range
  // (e.g. '1e300000'), which the regex can't pre-validate. plpgsql with an
  // EXCEPTION handler returns NULL on that overflow instead of erroring the
  // whole query; the regex is kept to avoid paying exception-handling cost
  // on ordinary non-numeric strings.
  await sql`
    CREATE OR REPLACE FUNCTION collection_cell_numeric(cells jsonb, prop text)
    RETURNS numeric LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
      BEGIN
        RETURN CASE jsonb_typeof(cells->prop::text)
          WHEN 'number' THEN (cells->>prop::text)::numeric
          WHEN 'string' THEN
            CASE
              WHEN (cells->>prop::text) ~
                '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$'
              THEN (cells->>prop::text)::numeric
            END
        END;
      EXCEPTION WHEN others THEN RETURN NULL; END;
    $$
  `.execute(db);

  // A DATE cell stores an arbitrary string, so the cast can fail on values no
  // regex can pre-validate (e.g. '2024-13-45'). plpgsql with an EXCEPTION
  // handler returns NULL on failure instead of erroring the whole query.
  // STABLE (not IMMUTABLE): the cast also accepts relative values like 'now'
  // / 'tomorrow' and its result depends on the session TimeZone setting.
  await sql`
    CREATE OR REPLACE FUNCTION collection_cell_timestamptz(cells jsonb, prop text)
    RETURNS timestamptz LANGUAGE plpgsql STABLE STRICT PARALLEL SAFE
    AS $$
      BEGIN RETURN (cells->>prop::text)::timestamptz;
      EXCEPTION WHEN others THEN RETURN NULL; END;
    $$
  `.execute(db);

  await sql`
    CREATE OR REPLACE FUNCTION collection_cell_bool(cells jsonb, prop text)
    RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $$
      SELECT CASE jsonb_typeof(cells->prop::text)
        WHEN 'boolean' THEN (cells->>prop::text)::boolean
        WHEN 'string' THEN
          CASE
            WHEN lower(btrim(cells->>prop::text)) IN
              ('true','t','yes','y','on','1','false','f','no','n','off','0')
            THEN (cells->>prop::text)::boolean
          END
      END
    $$
  `.execute(db);

  // jsonb_set_many is already defined by the upstream `bases` migration with
  // identical semantics (null patch value deletes the key). CREATE OR REPLACE
  // here is idempotent and keeps the function available if this migration
  // ever runs standalone; down() must NOT drop it (see comment there).
  await sql`
    CREATE OR REPLACE FUNCTION jsonb_set_many(target jsonb, patches jsonb)
    RETURNS jsonb LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $$
      DECLARE k text; v jsonb; result jsonb := coalesce(target, '{}'::jsonb);
      BEGIN
        IF patches IS NULL OR jsonb_typeof(patches) <> 'object' THEN
          RETURN result;
        END IF;
        FOR k, v IN SELECT * FROM jsonb_each(patches) LOOP
          IF v = 'null'::jsonb THEN
            result := result - k;
          ELSE
            result := jsonb_set(result, ARRAY[k], v, true);
          END IF;
        END LOOP;
        RETURN result;
      END;
    $$
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('collection_views').execute();
  await db.schema.dropTable('collection_rows').execute();
  await db.schema.dropTable('collection_properties').execute();

  await sql`DROP FUNCTION collection_cell_bool(jsonb, text)`.execute(db);
  await sql`DROP FUNCTION collection_cell_timestamptz(jsonb, text)`.execute(db);
  await sql`DROP FUNCTION collection_cell_numeric(jsonb, text)`.execute(db);
  await sql`DROP FUNCTION collection_cell_text(jsonb, text)`.execute(db);

  // NOT dropping jsonb_set_many: it is a shared global function also used by
  // upstream's `bases` migration. Dropping it here would break Base.

  await sql`DROP INDEX idx_pages_is_collection`.execute(db);
  await db.schema
    .alterTable('pages')
    .dropColumn('is_inline_collection')
    .dropColumn('is_collection_row')
    .dropColumn('is_collection')
    .execute();
}
