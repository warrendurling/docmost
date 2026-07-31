import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  CollectionRow,
  InsertableCollectionRow,
  UpdatableCollectionRow,
} from '@docmost/db/types/entity.types';

@Injectable()
export class CollectionRowRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableCollectionRow,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('collectionRows')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionRows')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByPageId(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionRows')
      .selectAll()
      .where('pageId', '=', pageId)
      .executeTakeFirst();
  }

  async findByCollectionPageId(
    collectionPageId: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow[]> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionRows')
      .selectAll()
      .where('collectionPageId', '=', collectionPageId)
      .where('deletedAt', 'is', null)
      .orderBy('position')
      .execute();
  }

  async update(
    id: string,
    data: UpdatableCollectionRow,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('collectionRows')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  // Patches `cells` via the shared jsonb_set_many() SQL function (defined in
  // the collections migration): a `null` value in `patches` deletes that
  // key, anything else is jsonb_set. See collections.migration.spec.ts.
  async patchCells(
    id: string,
    patches: Record<string, unknown>,
    lastUpdatedById: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionRow> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('collectionRows')
      .set({
        // postgres-js auto-serializes a plain JS object param to JSON; passing
        // a pre-stringified string here double-encodes it (jsonb_typeof would
        // come back 'string', not 'object' — caught by patchCells test).
        cells: sql`jsonb_set_many(cells, ${patches}::jsonb)`,
        lastUpdatedById,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('collectionRows')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
