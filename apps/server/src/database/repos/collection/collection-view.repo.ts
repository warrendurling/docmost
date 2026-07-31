import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  CollectionView,
  InsertableCollectionView,
  UpdatableCollectionView,
} from '@docmost/db/types/entity.types';

@Injectable()
export class CollectionViewRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableCollectionView,
    trx?: KyselyTransaction,
  ): Promise<CollectionView> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('collectionViews')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async findById(
    id: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionView | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionViews')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  // Views have no deleted_at column (no soft-delete) — see migration test.
  async findByCollectionPageId(
    collectionPageId: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionView[]> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionViews')
      .selectAll()
      .where('collectionPageId', '=', collectionPageId)
      .orderBy(sql`position collate "C"`)
      .execute();
  }

  async countByCollectionPageId(
    collectionPageId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const db = dbOrTx(this.db, trx);
    const result = await db
      .selectFrom('collectionViews')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('collectionPageId', '=', collectionPageId)
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async update(
    id: string,
    data: UpdatableCollectionView,
    trx?: KyselyTransaction,
  ): Promise<CollectionView> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('collectionViews')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  // Hard delete — views have no soft-delete column.
  async delete(id: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db.deleteFrom('collectionViews').where('id', '=', id).execute();
  }
}
