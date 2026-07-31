import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
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

  async softDelete(id: string, trx?: KyselyTransaction): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('collectionRows')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
