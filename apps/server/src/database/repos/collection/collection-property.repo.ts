import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  CollectionProperty,
  InsertableCollectionProperty,
  UpdatableCollectionProperty,
} from '@docmost/db/types/entity.types';

@Injectable()
export class CollectionPropertyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableCollectionProperty,
    trx?: KyselyTransaction,
  ): Promise<CollectionProperty> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('collectionProperties')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async findById(
    collectionPageId: string,
    id: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionProperty | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionProperties')
      .selectAll()
      .where('collectionPageId', '=', collectionPageId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async findByCollectionPageId(
    collectionPageId: string,
    trx?: KyselyTransaction,
  ): Promise<CollectionProperty[]> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('collectionProperties')
      .selectAll()
      .where('collectionPageId', '=', collectionPageId)
      .where('deletedAt', 'is', null)
      .orderBy('position')
      .execute();
  }

  async update(
    collectionPageId: string,
    id: string,
    data: UpdatableCollectionProperty,
    trx?: KyselyTransaction,
  ): Promise<CollectionProperty> {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('collectionProperties')
      .set({ ...data, updatedAt: new Date() })
      .where('collectionPageId', '=', collectionPageId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async softDelete(
    collectionPageId: string,
    id: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('collectionProperties')
      .set({ deletedAt: new Date() })
      .where('collectionPageId', '=', collectionPageId)
      .where('id', '=', id)
      .execute();
  }
}
