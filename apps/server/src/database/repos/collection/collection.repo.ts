import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import { Page } from '@docmost/db/types/entity.types';

// ponytail: only the two primitives Task 2.1 needs (flip flags, load a
// collection page). More collection-page helpers (e.g. findByCollectionPageId
// joins, convert/delete orchestration) get added in Task 2.2 when the
// services that need them exist — no speculative methods here.
@Injectable()
export class CollectionRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async setCollectionFlags(
    pageId: string,
    flags: {
      isCollection?: boolean;
      isCollectionRow?: boolean;
      isInlineCollection?: boolean;
    },
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('pages')
      .set({ ...flags, updatedAt: new Date() })
      .where('id', '=', pageId)
      .execute();
  }

  async findCollectionPage(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<Page | undefined> {
    const db = dbOrTx(this.db, trx);
    return db
      .selectFrom('pages')
      .selectAll()
      .where('id', '=', pageId)
      .where('isCollection', '=', true)
      .executeTakeFirst();
  }
}
