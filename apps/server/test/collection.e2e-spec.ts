import { BadRequestException, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';
import { RedisModule } from '@nestjs-labs/nestjs-ioredis';
import { CoreModule } from '../src/core/core.module';
import { DatabaseModule } from '@docmost/db/database.module';
import { EnvironmentModule } from '../src/integrations/environment/environment.module';
import { EnvironmentService } from '../src/integrations/environment/environment.service';
import { RedisConfigService } from '../src/integrations/redis/redis-config.service';
import { CollaborationModule } from '../src/collaboration/collaboration.module';
import { WsModule } from '../src/ws/ws.module';
import { QueueModule } from '../src/integrations/queue/queue.module';
import { StorageModule } from '../src/integrations/storage/storage.module';
import { MailModule } from '../src/integrations/mail/mail.module';
import { LoggerModule } from '../src/common/logger/logger.module';
import { NoopAuditModule } from '../src/integrations/audit/audit.module';
import { ThrottleModule } from '../src/integrations/throttle/throttle.module';
import { CollectionService } from '../src/core/collection/collection.service';
import { PageService } from '../src/core/page/services/page.service';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { CollectionPropertyRepo } from '@docmost/db/repos/collection/collection-property.repo';
import { CollectionViewRepo } from '@docmost/db/repos/collection/collection-view.repo';
import { CollectionRowRepo } from '@docmost/db/repos/collection/collection-row.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';

// ponytail: mirrors AppModule minus Export/Import/Static/Health/Security/
// Telemetry/Throttle/EE. Those pull in ESM-only / modern-syntax deps
// (cheerio, undici, @sindresorhus/slugify) this repo's jest-e2e config has
// never been able to transform (pre-existing gap in test/jest-e2e.json,
// unrelated to collections). Everything collections actually depends on —
// PageService, PageAccessService, CollaborationModule, DatabaseModule,
// QueueModule, watchers — is wired for real; nothing here is mocked.
// Upgrade path: fix jest-e2e's transform for those packages, then swap
// this back to importing the real AppModule.
@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    LoggerModule,
    NoopAuditModule,
    CoreModule,
    DatabaseModule,
    EnvironmentModule,
    RedisModule.forRootAsync({ useClass: RedisConfigService }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async (environmentService: EnvironmentService) => ({
        ttl: 5 * 1000,
        stores: [new KeyvRedis(environmentService.getRedisUrl())],
      }),
      inject: [EnvironmentService],
    }),
    CollaborationModule,
    WsModule,
    QueueModule,
    StorageModule.forRootAsync({ imports: [EnvironmentModule] }),
    MailModule.forRootAsync({ imports: [EnvironmentModule] }),
    EventEmitterModule.forRoot(),
    ThrottleModule,
  ],
})
class TestAppModule {}

describe('CollectionService (e2e)', () => {
  let app: INestApplication;
  let collectionService: CollectionService;
  let collectionPropertyRepo: CollectionPropertyRepo;
  let collectionViewRepo: CollectionViewRepo;
  let collectionRowRepo: CollectionRowRepo;
  let pageService: PageService;
  let pageRepo: PageRepo;
  let shareRepo: ShareRepo;
  let pagePermissionRepo: PagePermissionRepo;
  let db: KyselyDB;

  let workspaceId: string;
  let spaceId: string;
  let user: { id: string; workspaceId: string };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleFixture.createNestApplication(new FastifyAdapter());
    await app.init();

    collectionService = moduleFixture.get(CollectionService);
    collectionPropertyRepo = moduleFixture.get(CollectionPropertyRepo);
    collectionViewRepo = moduleFixture.get(CollectionViewRepo);
    collectionRowRepo = moduleFixture.get(CollectionRowRepo);
    pageService = moduleFixture.get(PageService);
    pageRepo = moduleFixture.get(PageRepo);
    shareRepo = moduleFixture.get(ShareRepo);
    pagePermissionRepo = moduleFixture.get(PagePermissionRepo);
    db = moduleFixture.get(KYSELY_MODULE_CONNECTION_TOKEN());

    const workspace = await db
      .insertInto('workspaces')
      .values({ name: 'Collection Test WS', hostname: `coll-test-ws-${randomUUID()}` })
      .returningAll()
      .executeTakeFirstOrThrow();
    workspaceId = workspace.id;

    const space = await db
      .insertInto('spaces')
      .values({
        name: 'Collection Test Space',
        slug: `coll-test-space-${randomUUID()}`,
        workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    spaceId = space.id;

    const insertedUser = await db
      .insertInto('users')
      .values({ email: `coll-test-${randomUUID()}@example.com`, workspaceId })
      .returningAll()
      .executeTakeFirstOrThrow();
    user = { id: insertedUser.id, workspaceId };

    await db
      .insertInto('spaceMembers')
      .values({ spaceId, userId: user.id, role: 'admin' })
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('workspaces').where('id', '=', workspaceId).execute();
    await app.close();
  });

  async function restrictPage(
    pageId: string,
    permittedUserId?: string,
  ): Promise<void> {
    const pageAccess = await pagePermissionRepo.insertPageAccess({
      pageId,
      workspaceId,
      spaceId,
      accessLevel: 'restricted',
      creatorId: user.id,
    });
    if (permittedUserId) {
      await pagePermissionRepo.insertPagePermissions([
        {
          pageAccessId: pageAccess.id,
          userId: permittedUserId,
          role: 'writer',
          addedById: user.id,
        } as any,
      ]);
    }
  }

  it('create() creates a collection page + primary title property + table view', async () => {
    const result = await collectionService.create({
      user: user as any,
      workspaceId,
      spaceId,
      title: 'My Database',
    });

    expect(result.database.isCollection).toBe(true);
    expect(result.database.title).toBe('My Database');

    expect(result.properties).toHaveLength(1);
    expect(result.properties[0].isPrimary).toBe(true);
    expect(result.properties[0].type).toBe('title');

    expect(result.views).toHaveLength(1);
    expect(result.views[0].type).toBe('table');

    const dbProperties = await collectionPropertyRepo.findByCollectionPageId(
      result.database.id,
    );
    expect(dbProperties).toHaveLength(1);

    const dbViews = await collectionViewRepo.findByCollectionPageId(
      result.database.id,
    );
    expect(dbViews).toHaveLength(1);
  });

  it('info() returns database + properties + views, not rows', async () => {
    const created = await collectionService.create({
      user: user as any,
      workspaceId,
      spaceId,
      title: 'Info Database',
    });

    const info = await collectionService.info({
      user: user as any,
      pageId: created.database.id,
    });

    expect(info.database.id).toBe(created.database.id);
    expect(info.properties).toHaveLength(1);
    expect(info.views).toHaveLength(1);
    expect((info as any).rows).toBeUndefined();
  });

  it('convert() flips a normal page to a collection, auto-creates property+view, and revokes an existing share [R13]', async () => {
    const normalPage = await pageRepo.insertPage({
      slugId: randomUUID(),
      title: 'Normal Page To Convert',
      position: 'a0',
      spaceId,
      creatorId: user.id,
      workspaceId,
      lastUpdatedById: user.id,
    } as any);

    const share = await shareRepo.insertShare({
      key: randomUUID().slice(0, 10),
      pageId: normalPage.id,
      spaceId,
      workspaceId,
      creatorId: user.id,
    } as any);
    expect(await shareRepo.findByPageId(normalPage.id)).toBeDefined();

    const result = await collectionService.convert({
      user: user as any,
      pageId: normalPage.id,
    });

    expect(result.database.isCollection).toBe(true);
    expect(result.properties).toHaveLength(1);
    expect(result.properties[0].isPrimary).toBe(true);
    expect(result.views).toHaveLength(1);

    const shareAfter = await shareRepo.findByPageId(normalPage.id);
    expect(shareAfter).toBeUndefined();
    void share;
  });

  it('delete() trashes the collection page (soft delete)', async () => {
    const created = await collectionService.create({
      user: user as any,
      workspaceId,
      spaceId,
      title: 'To Delete',
    });

    await collectionService.delete({
      user: user as any,
      pageId: created.database.id,
    });

    const page = await pageRepo.findById(created.database.id);
    expect(page.deletedAt).not.toBeNull();
  });

  describe('property endpoints', () => {
    it('createProperty() adds a text property after the Title column', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Props Database',
      });
      const titleProp = created.properties[0];

      const property = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Notes',
        type: 'text',
      });

      expect(property.isPrimary).toBe(false);
      expect(property.type).toBe('text');
      expect(property.position > titleProp.position).toBe(true);

      const all = await collectionPropertyRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.id)).toContain(property.id);
    });

    it('createProperty() rejects type "title"', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Reject Title Type DB',
      });

      await expect(
        collectionService.createProperty({
          user: user as any,
          collectionPageId: created.database.id,
          name: 'Another Title',
          type: 'title' as any,
        }),
      ).rejects.toThrow();
    });

    it('createProperty() rejects a bogus type', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Reject Bogus Type DB',
      });

      await expect(
        collectionService.createProperty({
          user: user as any,
          collectionPageId: created.database.id,
          name: 'Weird',
          type: 'foo' as any,
        }),
      ).rejects.toThrow();
    });

    it('updateProperty() persists a name change', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Update Database',
      });
      const property = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Old Name',
        type: 'text',
      });

      const updated = await collectionService.updateProperty({
        user: user as any,
        collectionPageId: created.database.id,
        id: property.id,
        name: 'New Name',
      });
      expect(updated.name).toBe('New Name');

      const fetched = await collectionPropertyRepo.findById(
        created.database.id,
        property.id,
      );
      expect(fetched.name).toBe('New Name');
    });

    it('updateProperty() maps a name collision to a conflict error', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Collision Database',
      });
      await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Existing',
        type: 'text',
      });
      const second = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Other',
        type: 'text',
      });

      await expect(
        collectionService.updateProperty({
          user: user as any,
          collectionPageId: created.database.id,
          id: second.id,
          name: '  existing  ',
        }),
      ).rejects.toThrow();
    });

    it('[fix C] updateProperty() rejects an invalid position string', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Bad Position Property Database',
      });
      const property = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Movable',
        type: 'text',
      });

      await expect(
        collectionService.updateProperty({
          user: user as any,
          collectionPageId: created.database.id,
          id: property.id,
          position: 'A',
        }),
      ).rejects.toThrow(BadRequestException);

      const fetched = await collectionPropertyRepo.findById(
        created.database.id,
        property.id,
      );
      expect(fetched.position).toBe(property.position);

      // subsequent creates must not be bricked by the (rejected) bad key
      const next = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'After',
        type: 'text',
      });
      expect(next.id).toBeTruthy();
    });

    it('deleteProperty() soft-deletes a non-primary property', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Delete Prop Database',
      });
      const property = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Removable',
        type: 'text',
      });

      await collectionService.deleteProperty({
        user: user as any,
        collectionPageId: created.database.id,
        id: property.id,
      });

      const all = await collectionPropertyRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all.map((p) => p.id)).not.toContain(property.id);
    });

    it('[fix 3] createProperty() rejects a normal (non-collection) page', async () => {
      const normalPage = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Normal Page Not A Collection',
        position: 'a0',
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      await expect(
        collectionService.createProperty({
          user: user as any,
          collectionPageId: normalPage.id,
          name: 'Notes',
          type: 'text',
        }),
      ).rejects.toThrow();
    });

    it('deleteProperty() rejects deleting the primary Title property', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Protect Title Database',
      });
      const titleProp = created.properties[0];

      await expect(
        collectionService.deleteProperty({
          user: user as any,
          collectionPageId: created.database.id,
          id: titleProp.id,
        }),
      ).rejects.toThrow();

      const all = await collectionPropertyRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all.map((p) => p.id)).toContain(titleProp.id);
    });
  });

  describe('row endpoints', () => {
    it('rows/create creates a collection_rows record + a row page with is_collection_row flag', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Database',
      });

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      expect(row.collectionPageId).toBe(created.database.id);

      const dbRow = await collectionRowRepo.findById(row.id);
      expect(dbRow).toBeDefined();
      expect(dbRow.collectionPageId).toBe(created.database.id);

      // baseFields on PageRepo omits is_collection_row / parent_page_id
      // relevance, so query pages directly.
      const rowPage = await db
        .selectFrom('pages')
        .select(['isCollectionRow', 'parentPageId', 'deletedAt'])
        .where('id', '=', row.pageId)
        .executeTakeFirst();
      expect(rowPage.isCollectionRow).toBe(true);
      expect(rowPage.parentPageId).toBe(created.database.id);
      expect(rowPage.deletedAt).toBeNull();
    });

    it('rows/create positions two rows so the second sorts after the first', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Position Database',
      });

      const first = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const second = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      expect(first.position).not.toBe(second.position);
      expect(second.position > first.position).toBe(true);
    });

    it('rows/update sets a cell, then a null value removes that key [jsonb_set_many delete semantics]', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Update Database',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const titlePropId = created.properties[0].id;

      const updated = await collectionService.updateRow({
        user: user as any,
        rowId: row.id,
        cells: { [titlePropId]: 'Hello' },
      });
      expect(updated.cells[titlePropId]).toBe('Hello');
      expect(updated.lastUpdatedById).toBe(user.id);

      const cleared = await collectionService.updateRow({
        user: user as any,
        rowId: row.id,
        cells: { [titlePropId]: null },
      });
      expect(cleared.cells[titlePropId]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(cleared.cells, titlePropId)).toBe(
        false,
      );
    });

    it('rows/delete trashes both the row page and the collection_rows record [R5]', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Delete Database',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const result = await collectionService.deleteRow({
        user: user as any,
        rowId: row.id,
      });
      expect(result.success).toBe(true);

      const rowPage = await pageRepo.findById(row.pageId);
      expect(rowPage.deletedAt).not.toBeNull();

      const dbRow = await db
        .selectFrom('collectionRows')
        .select(['deletedAt'])
        .where('id', '=', row.id)
        .executeTakeFirst();
      expect(dbRow.deletedAt).not.toBeNull();
    });

    it('rows/get returns the row context by its page id', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Get Database',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const titlePropId = created.properties[0].id;
      await collectionService.updateRow({
        user: user as any,
        rowId: row.id,
        cells: { [titlePropId]: 'Hello' },
      });
      await db
        .updateTable('pages')
        .set({ title: 'Row Get Title' })
        .where('id', '=', row.pageId)
        .execute();

      const result = await collectionService.getRowByPageId({
        user: user as any,
        pageId: row.pageId,
      });

      expect(result.collectionPageId).toBe(created.database.id);
      expect(result.rowId).toBe(row.id);
      expect(result.title).toBe('Row Get Title');
      expect(result.cells[titlePropId]).toBe('Hello');
      expect(result.properties).toHaveLength(1);
      expect(result.properties[0].id).toBe(titlePropId);
    });

    // Security regression guard [mirrors R11]: rows/get MUST authorize on the
    // row's own page, not the database page. A user restricted from the row
    // page must be denied even though the database itself is open to them.
    it('rows/get throws for a user restricted from the row page, even though they can view the database', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Rows Get Restricted Database',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const outsider = await db
        .insertInto('users')
        .values({
          email: `coll-rows-get-outsider-${randomUUID()}@example.com`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('spaceMembers')
        .values({ spaceId, userId: outsider.id, role: 'writer' })
        .execute();

      // restrict only the row's page, with no permission grant for outsider —
      // the database page itself is left unrestricted.
      await restrictPage(row.pageId, user.id);

      await expect(
        collectionService.getRowByPageId({
          user: outsider as any,
          pageId: row.pageId,
        }),
      ).rejects.toThrow();
    });
  });

  describe('view endpoints', () => {
    it('views/create adds a 2nd table view after the auto-created one', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Views Database',
      });
      const firstView = created.views[0];

      const view = await collectionService.createView({
        user: user as any,
        collectionPageId: created.database.id,
        type: 'table',
        name: 'Second Table',
      });

      expect(view.type).toBe('table');
      expect(view.name).toBe('Second Table');
      expect(view.position > firstView.position).toBe(true);

      const all = await collectionViewRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe(firstView.id);
      expect(all[1].id).toBe(view.id);
    });

    it('views/create rejects type "kanban" (V2)', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Reject Kanban DB',
      });

      await expect(
        collectionService.createView({
          user: user as any,
          collectionPageId: created.database.id,
          type: 'kanban' as any,
          name: 'Board',
        }),
      ).rejects.toThrow();
    });

    it('views/create rejects a bogus type', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Reject Bogus View Type DB',
      });

      await expect(
        collectionService.createView({
          user: user as any,
          collectionPageId: created.database.id,
          type: 'foo' as any,
          name: 'Weird',
        }),
      ).rejects.toThrow();
    });

    it('views/update persists config and name changes', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Update View Database',
      });
      const view = created.views[0];

      const updated = await collectionService.updateView({
        user: user as any,
        id: view.id,
        name: 'Renamed View',
        config: { sorts: [{ propertyId: 'x', direction: 'asc' }] },
      });

      expect(updated.name).toBe('Renamed View');
      expect(updated.config).toEqual({
        sorts: [{ propertyId: 'x', direction: 'asc' }],
      });

      const fetched = await collectionViewRepo.findById(view.id);
      expect(fetched.name).toBe('Renamed View');
      expect(fetched.config).toEqual({
        sorts: [{ propertyId: 'x', direction: 'asc' }],
      });
    });

    it('[fix C] updateView() rejects an invalid position string', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Bad Position View Database',
      });
      const view = created.views[0];

      await expect(
        collectionService.updateView({
          user: user as any,
          id: view.id,
          position: 'A',
        }),
      ).rejects.toThrow(BadRequestException);

      const fetched = await collectionViewRepo.findById(view.id);
      expect(fetched.position).toBe(view.position);

      // subsequent creates must not be bricked by the (rejected) bad key
      const next = await collectionService.createView({
        user: user as any,
        collectionPageId: created.database.id,
        type: 'table',
        name: 'After',
      });
      expect(next.id).toBeTruthy();
    });

    it('views/delete removes a non-last view, then rejects deleting the remaining last view [R18]', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Delete View Database',
      });
      const firstView = created.views[0];

      const secondView = await collectionService.createView({
        user: user as any,
        collectionPageId: created.database.id,
        type: 'table',
        name: 'Second',
      });

      const result = await collectionService.deleteView({
        user: user as any,
        id: secondView.id,
      });
      expect(result.success).toBe(true);

      let all = await collectionViewRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(firstView.id);

      await expect(
        collectionService.deleteView({
          user: user as any,
          id: firstView.id,
        }),
      ).rejects.toThrow();

      all = await collectionViewRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(firstView.id);
    });

    it('[fix D] the atomic delete-if-not-last query deletes 0 rows for the last remaining view', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Atomic Delete Guard Database',
      });
      const firstView = created.views[0];

      const deletedCount = await collectionViewRepo.deleteIfNotLast(
        firstView.id,
        created.database.id,
      );
      expect(deletedCount).toBe(0);

      const all = await collectionViewRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(firstView.id);
    });
  });

  describe('rows/list', () => {
    it('returns rows with title from page + cells; excludes a soft-deleted row and a row with a trashed page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'RowsList Database',
      });
      const viewId = created.views[0].id;

      const rowA = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await db
        .updateTable('pages')
        .set({ title: 'Row A' })
        .where('id', '=', rowA.pageId)
        .execute();

      const rowB = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionRowRepo.softDelete(rowB.id);

      const rowC = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await db
        .updateTable('pages')
        .set({ deletedAt: new Date() })
        .where('id', '=', rowC.pageId)
        .execute();

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(rowA.id);
      expect(ids).not.toContain(rowB.id);
      expect(ids).not.toContain(rowC.id);

      const found = result.rows.find((r) => r.id === rowA.id);
      expect(found.title).toBe('Row A');
      expect(found.pageId).toBe(rowA.pageId);
      expect(found.cells).toBeDefined();
    });

    it('a text contains filter narrows results', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Text Database',
      });
      const viewId = created.views[0].id;
      const notesProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Notes',
        type: 'text',
      });

      const rowMatch = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: rowMatch.id,
        cells: { [notesProp.id]: 'contains banana here' },
      });

      const rowNoMatch = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: rowNoMatch.id,
        cells: { [notesProp.id]: 'nothing fruity' },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: notesProp.id, operator: 'contains', value: 'banana' },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(rowMatch.id);
      expect(ids).not.toContain(rowNoMatch.id);
    });

    it('a number gt filter narrows results', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Number Database',
      });
      const viewId = created.views[0].id;
      const scoreProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Score',
        type: 'number',
      });

      const high = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: high.id,
        cells: { [scoreProp.id]: 50 },
      });

      const low = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: low.id,
        cells: { [scoreProp.id]: 5 },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [{ propertyId: scoreProp.id, operator: 'gt', value: 10 }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(high.id);
      expect(ids).not.toContain(low.id);
    });

    it('a checkbox equals:true filter narrows results', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Checkbox Database',
      });
      const viewId = created.views[0].id;
      const doneProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Done',
        type: 'checkbox',
      });

      const checked = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: checked.id,
        cells: { [doneProp.id]: true },
      });

      const unchecked = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: unchecked.id,
        cells: { [doneProp.id]: false },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [{ propertyId: doneProp.id, operator: 'equals', value: true }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(checked.id);
      expect(ids).not.toContain(unchecked.id);
    });

    it('[fix 1] an unparseable date filter value does not throw and skips the clause', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Bad Date Database',
      });
      const viewId = created.views[0].id;
      const dueProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Due',
        type: 'date',
      });

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: dueProp.id, operator: 'before', value: 'garbage' },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[fix A] a calendar-invalid date filter value ("2024-02-30") does not throw and skips the clause', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Bad Calendar Date Database',
      });
      const viewId = created.views[0].id;
      const dueProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Due',
        type: 'date',
      });

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: dueProp.id, operator: 'before', value: '2024-02-30' },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[fix A] a JS Date#toString() value with a named-zone offset does not throw and skips the clause', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Date ToString Database',
      });
      const viewId = created.views[0].id;
      const dueProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Due',
        type: 'date',
      });

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            {
              propertyId: dueProp.id,
              operator: 'before',
              value:
                'Thu Jul 31 2026 10:00:00 GMT+1200 (New Zealand Standard Time)',
            },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[fix B] views/update with config.filters as a non-array object does not throw on rows/list', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Malformed Filters Config Database',
      });
      const viewId = created.views[0].id;

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: { filters: {} as any },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[fix B] views/update with config.sorts as a non-array object does not throw on rows/list', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Malformed Sorts Config Database',
      });
      const viewId = created.views[0].id;

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: { sorts: {} as any },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[fix 2] a checkbox equals:"false" (string) filter returns unchecked rows, not everything', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Filter Checkbox String False Database',
      });
      const viewId = created.views[0].id;
      const doneProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Done',
        type: 'checkbox',
      });

      const checked = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: checked.id,
        cells: { [doneProp.id]: true },
      });

      const unchecked = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: unchecked.id,
        cells: { [doneProp.id]: false },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: doneProp.id, operator: 'equals', value: 'false' },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(unchecked.id);
      expect(ids).not.toContain(checked.id);
    });

    it('sorts by a number cell desc', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Sort Number Database',
      });
      const viewId = created.views[0].id;
      const scoreProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Score',
        type: 'number',
      });

      const low = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: low.id,
        cells: { [scoreProp.id]: 1 },
      });
      const high = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: high.id,
        cells: { [scoreProp.id]: 99 },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          sorts: [{ propertyId: scoreProp.id, direction: 'desc' }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids.indexOf(high.id)).toBeLessThan(ids.indexOf(low.id));
    });

    it('sorts by Title (page title)', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Sort Title Database',
      });
      const viewId = created.views[0].id;
      const titleProp = created.properties[0];

      const rowA = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await db
        .updateTable('pages')
        .set({ title: 'Alpha' })
        .where('id', '=', rowA.pageId)
        .execute();

      const rowZ = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await db
        .updateTable('pages')
        .set({ title: 'Zeta' })
        .where('id', '=', rowZ.pageId)
        .execute();

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          sorts: [{ propertyId: titleProp.id, direction: 'asc' }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids.indexOf(rowA.id)).toBeLessThan(ids.indexOf(rowZ.id));
    });

    it('[R19] ignores a filter/sort referencing an unknown propertyId instead of crashing', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Stale Ref Database',
      });
      const viewId = created.views[0].id;

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: 'does-not-exist', operator: 'equals', value: 'x' },
          ],
          sorts: [{ propertyId: 'also-missing', direction: 'asc' }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('caps sorts at 5, ignoring extras without erroring', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Too Many Sorts Database',
      });
      const viewId = created.views[0].id;

      const props = [];
      for (let i = 0; i < 6; i++) {
        const p = await collectionService.createProperty({
          user: user as any,
          collectionPageId: created.database.id,
          name: `Num${i}`,
          type: 'number',
        });
        props.push(p);
      }

      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          sorts: props.map((p) => ({ propertyId: p.id, direction: 'asc' })),
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      expect(result.rows.map((r) => r.id)).toContain(row.id);
    });

    it('[R6b] a user with no view access to the database THROWS on rows/list', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Restricted Database',
      });
      const viewId = created.views[0].id;

      const outsider = await db
        .insertInto('users')
        .values({
          email: `coll-outsider-${randomUUID()}@example.com`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('spaceMembers')
        .values({ spaceId, userId: outsider.id, role: 'reader' })
        .execute();

      // restrict the database page to only the owning `user`
      await restrictPage(created.database.id, user.id);

      await expect(
        collectionService.rowsList({
          user: outsider as any,
          collectionPageId: created.database.id,
          viewId,
        }),
      ).rejects.toThrow();
    });

    it('[R11] a row whose page is restricted from the caller is absent from rows/list, while an unrestricted row is present', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Row Leak Database',
      });
      const viewId = created.views[0].id;

      const openRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const restrictedRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      // restrict the row's page with no permission grant for anyone —
      // including `user`, who otherwise has full access to the database.
      await restrictPage(restrictedRow.pageId);

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(openRow.id);
      expect(ids).not.toContain(restrictedRow.id);
    });
  });

  describe('row-level auth bypass [fix 1]', () => {
    async function createBobWithSpaceEdit(): Promise<{ id: string }> {
      const bob = await db
        .insertInto('users')
        .values({
          email: `coll-bob-${randomUUID()}@example.com`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .insertInto('spaceMembers')
        .values({ spaceId, userId: bob.id, role: 'writer' })
        .execute();
      return { id: bob.id };
    }

    it('[fix 1a] updateRow() throws for a user who can edit the database but is restricted from the row page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Row Auth Update DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const bob = await createBobWithSpaceEdit();
      await restrictPage(row.pageId, user.id);

      await expect(
        collectionService.updateRow({
          user: bob as any,
          rowId: row.id,
          cells: { foo: 'bar' },
        }),
      ).rejects.toThrow();
    });

    it('[fix 1a] deleteRow() throws for a user who can edit the database but is restricted from the row page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Row Auth Delete DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const bob = await createBobWithSpaceEdit();
      await restrictPage(row.pageId, user.id);

      await expect(
        collectionService.deleteRow({
          user: bob as any,
          rowId: row.id,
        }),
      ).rejects.toThrow();

      const dbRow = await collectionRowRepo.findById(row.id);
      expect(dbRow.deletedAt).toBeNull();
    });

    it('[fix 1b] updateRow() with an empty cells patch still throws for a restricted user, rather than returning the row', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Row Auth Read Leak DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: row.id,
        cells: { secret: 'sensitive-value' },
      });

      const bob = await createBobWithSpaceEdit();
      await restrictPage(row.pageId, user.id);

      await expect(
        collectionService.updateRow({
          user: bob as any,
          rowId: row.id,
          cells: {},
        }),
      ).rejects.toThrow();
    });

    it('[fix 1c] updateRow() and deleteRow() still work for a user with permission on the restricted row page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Row Auth Allowed DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      // restrict the row but explicitly permit the owning `user`
      await restrictPage(row.pageId, user.id);

      const titlePropId = created.properties[0].id;
      const updated = await collectionService.updateRow({
        user: user as any,
        rowId: row.id,
        cells: { [titlePropId]: 'Still Works' },
      });
      expect(updated.cells[titlePropId]).toBe('Still Works');

      const result = await collectionService.deleteRow({
        user: user as any,
        rowId: row.id,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('rows/list cross-space leak [fix 2]', () => {
    it('excludes a row whose page has been moved to a different space, and still returns a same-space row', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Cross Space Leak DB',
      });
      const viewId = created.views[0].id;

      const sameSpaceRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const movedRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const otherSpace = await db
        .insertInto('spaces')
        .values({
          name: 'Other Space',
          slug: `coll-other-space-${randomUUID()}`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // simulate the row's page having been moved to another space
      await db
        .updateTable('pages')
        .set({ spaceId: otherSpace.id })
        .where('id', '=', movedRow.pageId)
        .execute();

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(sameSpaceRow.id);
      expect(ids).not.toContain(movedRow.id);
    });
  });

  describe('rows/list position collation [fix 3]', () => {
    it('orders rows by C-collation position, not default collation', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'C Collation DB',
      });
      const viewId = created.views[0].id;

      const rowZ = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionRowRepo.update(rowZ.id, { position: 'Z0' } as any);

      const rowA = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionRowRepo.update(rowA.id, { position: 'a0' } as any);

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      // C collation: 'Z' (0x5A) < 'a' (0x61) → Z0 sorts before a0.
      // Under default (en_US) collation this order is reversed.
      expect(ids.indexOf(rowZ.id)).toBeLessThan(ids.indexOf(rowA.id));
    });
  });

  describe('row mutation cross-space guard', () => {
    it('updateRow() and deleteRow() throw when the row page has moved to a different space than the database; a same-space row is unaffected', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Cross Space Mutation DB',
      });

      const otherSpace = await db
        .insertInto('spaces')
        .values({
          name: 'Other Mutation Space',
          slug: `coll-other-mutation-space-${randomUUID()}`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const movedRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      // simulate the row's page having been moved to another space, same as
      // the rows/list cross-space leak fixture above
      await db
        .updateTable('pages')
        .set({ spaceId: otherSpace.id })
        .where('id', '=', movedRow.pageId)
        .execute();

      await expect(
        collectionService.updateRow({
          user: user as any,
          rowId: movedRow.id,
          cells: {},
        }),
      ).rejects.toThrow();

      await expect(
        collectionService.deleteRow({
          user: user as any,
          rowId: movedRow.id,
        }),
      ).rejects.toThrow();

      const dbRow = await collectionRowRepo.findById(movedRow.id);
      expect(dbRow.deletedAt).toBeNull();

      // control: a row still in the database's own space is unaffected
      const sameSpaceRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const titlePropId = created.properties[0].id;
      const updated = await collectionService.updateRow({
        user: user as any,
        rowId: sameSpaceRow.id,
        cells: { [titlePropId]: 'Still Works' },
      });
      expect(updated.cells[titlePropId]).toBe('Still Works');

      const result = await collectionService.deleteRow({
        user: user as any,
        rowId: sameSpaceRow.id,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('row mutation re-parent guard [security]', () => {
    it('getRowByPageId() and updateRow() throw when the row page has been moved to the space root (parentPageId=null); a still-nested row is unaffected', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Re-parent Guard DB',
      });

      const escapedRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      // simulate the row's page having been moved to the space root, same as
      // movePage would do (no guard blocks this yet — Phase 5)
      await db
        .updateTable('pages')
        .set({ parentPageId: null })
        .where('id', '=', escapedRow.pageId)
        .execute();

      await expect(
        collectionService.getRowByPageId({
          user: user as any,
          pageId: escapedRow.pageId,
        }),
      ).rejects.toThrow();

      await expect(
        collectionService.updateRow({
          user: user as any,
          rowId: escapedRow.id,
          cells: {},
        }),
      ).rejects.toThrow();

      // control: a row still nested under the database is unaffected
      const sameTreeRow = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const result = await collectionService.getRowByPageId({
        user: user as any,
        pageId: sameTreeRow.pageId,
      });
      expect(result.rowId).toBe(sameTreeRow.id);

      const titlePropId = created.properties[0].id;
      const updated = await collectionService.updateRow({
        user: user as any,
        rowId: sameTreeRow.id,
        cells: { [titlePropId]: 'Still Works' },
      });
      expect(updated.cells[titlePropId]).toBe('Still Works');
    });
  });

  describe('page move guards [R6/R15]', () => {
    it('movePage() rejects moving a collection row', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Move Guard DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const rowPage = await pageRepo.findById(row.pageId);

      await expect(
        pageService.movePage(
          { pageId: rowPage.id, position: rowPage.position, parentPageId: null } as any,
          rowPage,
        ),
      ).rejects.toThrow('Collection rows cannot be moved');
    });

    it('movePageToSpace() rejects moving a collection row to another space', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Move Guard DB Row Space',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const rowPage = await pageRepo.findById(row.pageId);

      const otherSpace = await db
        .insertInto('spaces')
        .values({
          name: 'Move Guard Other Space',
          slug: `move-guard-other-space-${randomUUID()}`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await expect(
        pageService.movePageToSpace(rowPage, otherSpace.id, user.id),
      ).rejects.toThrow(
        'Collections and their rows cannot be moved to another space',
      );
    });

    it('movePageToSpace() rejects moving a database to another space', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Move Guard DB Space',
      });
      const dbPage = await pageRepo.findById(created.database.id);

      const otherSpace = await db
        .insertInto('spaces')
        .values({
          name: 'Move Guard Other Space 2',
          slug: `move-guard-other-space-2-${randomUUID()}`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await expect(
        pageService.movePageToSpace(dbPage, otherSpace.id, user.id),
      ).rejects.toThrow(
        'Collections and their rows cannot be moved to another space',
      );
    });

    it('movePage() allows moving a database within its own space [control]', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Move Guard DB Reparent',
      });
      const dbPage = await pageRepo.findById(created.database.id);

      const newParent = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Move Guard New Parent',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      await pageService.movePage(
        {
          pageId: dbPage.id,
          position: dbPage.position,
          parentPageId: newParent.id,
        } as any,
        dbPage,
      );

      const moved = await pageRepo.findById(dbPage.id);
      expect(moved.parentPageId).toBe(newParent.id);
    });

    it('movePage() and movePageToSpace() still allow moving a normal page [control, no regression]', async () => {
      const normalPage = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Move Guard Normal Page',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      const newParent = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Move Guard Normal Page Parent',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      await pageService.movePage(
        {
          pageId: normalPage.id,
          position: normalPage.position,
          parentPageId: newParent.id,
        } as any,
        normalPage,
      );

      const reparented = await pageRepo.findById(normalPage.id);
      expect(reparented.parentPageId).toBe(newParent.id);

      const otherSpace = await db
        .insertInto('spaces')
        .values({
          name: 'Move Guard Other Space 3',
          slug: `move-guard-other-space-3-${randomUUID()}`,
          workspaceId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const { childPageIds } = await pageService.movePageToSpace(
        reparented,
        otherSpace.id,
        user.id,
      );
      expect(childPageIds).toEqual([]);

      const movedToSpace = await pageRepo.findById(normalPage.id);
      expect(movedToSpace.spaceId).toBe(otherSpace.id);
    });
  });

  describe('restore guards [R5/R16/R17]', () => {
    it('restorePage() rejects restoring a collection row directly while its database is still trashed', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Restore Guard DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      // trash the database page; removePage cascades to descendants,
      // including the row page
      await pageService.removePage(created.database.id, user.id, workspaceId);

      const rowPage = await pageRepo.findById(row.pageId);
      expect(rowPage.deletedAt).not.toBeNull();

      await expect(
        pageService.restorePage(rowPage, workspaceId),
      ).rejects.toThrow('Restore the database to restore its rows');
    });

    it('restorePage() allows restoring a normal trashed page [control, no regression]', async () => {
      const normalPage = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Restore Guard Normal Page',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      await pageService.removePage(normalPage.id, user.id, workspaceId);
      const trashedPage = await pageRepo.findById(normalPage.id);
      expect(trashedPage.deletedAt).not.toBeNull();

      await pageService.restorePage(trashedPage, workspaceId);

      const restored = await pageRepo.findById(normalPage.id);
      expect(restored.deletedAt).toBeNull();
    });

    it('restoring the database cascades to restore its row [control]', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Restore Guard DB Then Row',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await pageService.removePage(created.database.id, user.id, workspaceId);

      const dbPage = await pageRepo.findById(created.database.id);
      await pageService.restorePage(dbPage, workspaceId);

      // restorePage cascades to descendants, so the row page comes back
      // restored along with the database — no separate row restore needed
      const restoredRow = await pageRepo.findById(row.pageId);
      expect(restoredRow.deletedAt).toBeNull();
    });
  });

  describe('date filter timezone offset cap', () => {
    it('a +16:00 offset date filter value does not throw rows/list (offset capped, filter skipped); a valid +05:00 offset also does not throw', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Offset Cap Database',
      });
      const viewId = created.views[0].id;
      const dueProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Due',
        type: 'date',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            {
              propertyId: dueProp.id,
              operator: 'before',
              value: '2024-01-01T12:00+16:00',
            },
          ],
        },
      });
      await expect(
        collectionService.rowsList({
          user: user as any,
          collectionPageId: created.database.id,
          viewId,
        }),
      ).resolves.toBeDefined();

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            {
              propertyId: dueProp.id,
              operator: 'before',
              value: '2024-01-01T12:00+05:00',
            },
          ],
        },
      });
      await expect(
        collectionService.rowsList({
          user: user as any,
          collectionPageId: created.database.id,
          viewId,
        }),
      ).resolves.toBeDefined();

      void row;
    });
  });

  describe('date filter year 0001-0099', () => {
    it('accepts a year-0050 date filter value and actually applies it, not treating it as invalid/skipped', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Year 50 Database',
      });
      const viewId = created.views[0].id;
      const dueProp = await collectionService.createProperty({
        user: user as any,
        collectionPageId: created.database.id,
        name: 'Due',
        type: 'date',
      });

      // 2024 is after year 50 -> matches an "after 0050-01-01" filter
      const rowMatch = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: rowMatch.id,
        cells: { [dueProp.id]: '2024-06-01' },
      });

      // year 1 is NOT after year 50 -> excluded by the same filter
      const rowNoMatch = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionService.updateRow({
        user: user as any,
        rowId: rowNoMatch.id,
        cells: { [dueProp.id]: '0001-06-01' },
      });

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          filters: [
            { propertyId: dueProp.id, operator: 'after', value: '0050-01-01' },
          ],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(rowMatch.id);
      expect(ids).not.toContain(rowNoMatch.id);
    });
  });

  describe('stale sorts still order by position', () => {
    it('a view whose only sort references a nonexistent propertyId still returns rows in position order', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Stale Sort Position Order DB',
      });
      const viewId = created.views[0].id;

      const rowFirst = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      // 'Z0' is a valid fractional-index key both as a stored position AND
      // as the lower bound the next createRow()'s generateJitteredKeyBetween
      // call reads back (matches the working pair used by the C-collation
      // test above; an arbitrary string like 'b0' fails that library's key
      // validation on the next insert).
      await collectionRowRepo.update(rowFirst.id, { position: 'Z0' } as any);

      const rowSecond = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      await collectionRowRepo.update(rowSecond.id, { position: 'a0' } as any);

      await collectionService.updateView({
        user: user as any,
        id: viewId,
        config: {
          sorts: [{ propertyId: 'nonexistent', direction: 'asc' }],
        },
      });

      const result = await collectionService.rowsList({
        user: user as any,
        collectionPageId: created.database.id,
        viewId,
      });

      const ids = result.rows.map((r) => r.id);
      // C collation: 'Z' (0x5A) < 'a' (0x61) -> Z0 sorts before a0.
      expect(ids.indexOf(rowFirst.id)).toBeLessThan(ids.indexOf(rowSecond.id));
    });
  });

  describe('last-view delete guard survives the FOR UPDATE rewrite', () => {
    it('with 2 views, deletes the non-last one, then rejects deleting the remaining last one', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Locked Last View Delete DB',
      });
      const firstView = created.views[0];

      const secondView = await collectionService.createView({
        user: user as any,
        collectionPageId: created.database.id,
        type: 'table',
        name: 'Second',
      });

      const result = await collectionService.deleteView({
        user: user as any,
        id: secondView.id,
      });
      expect(result.success).toBe(true);

      await expect(
        collectionService.deleteView({
          user: user as any,
          id: firstView.id,
        }),
      ).rejects.toThrow(BadRequestException);

      const all = await collectionViewRepo.findByCollectionPageId(
        created.database.id,
      );
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(firstView.id);
    });
  });

  describe('duplicate guards', () => {
    it('duplicatePage() rejects duplicating a collection database page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Duplicate Guard DB',
      });
      const dbPage = await pageRepo.findById(created.database.id);

      await expect(
        pageService.duplicatePage(dbPage, undefined, user as any),
      ).rejects.toThrow('Duplicating collections is not yet supported');
    });

    it('duplicatePage() rejects duplicating a collection row page', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Duplicate Guard DB Row',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });
      const rowPage = await pageRepo.findById(row.pageId);

      await expect(
        pageService.duplicatePage(rowPage, undefined, user as any),
      ).rejects.toThrow('Duplicating collections is not yet supported');
    });

    it('duplicatePage() rejects duplicating a normal page that has a collection database nested under it', async () => {
      const parent = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Duplicate Guard Nested Parent',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      const child = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Duplicate Guard Nested DB',
        position: generateJitteredKeyBetween(null, null),
        parentPageId: parent.id,
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);
      await collectionService.convert({ user: user as any, pageId: child.id });

      const parentPage = await pageRepo.findById(parent.id);

      await expect(
        pageService.duplicatePage(parentPage, undefined, user as any),
      ).rejects.toThrow('Duplicating collections is not yet supported');
    });

    it('duplicatePage() still allows duplicating a plain page with no collection in its subtree [control]', async () => {
      const normalPage = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Duplicate Guard Normal Page',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      const duplicated = await pageService.duplicatePage(
        normalPage,
        undefined,
        user as any,
      );

      expect(duplicated.id).not.toBe(normalPage.id);
      expect(duplicated.title).toBe('Copy of Duplicate Guard Normal Page');
    });
  });

  describe('page tree surface exclusion [collection lifecycle guards]', () => {
    it('getSidebarPages() lists the database page but not its row page; a normal page with a normal child still shows hasChildren + the child', async () => {
      const created = await collectionService.create({
        user: user as any,
        workspaceId,
        spaceId,
        title: 'Sidebar Exclusion DB',
      });
      const row = await collectionService.createRow({
        user: user as any,
        collectionPageId: created.database.id,
      });

      const normalParent = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Sidebar Normal Parent',
        position: generateJitteredKeyBetween(null, null),
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);
      const normalChild = await pageRepo.insertPage({
        slugId: randomUUID(),
        title: 'Sidebar Normal Child',
        position: generateJitteredKeyBetween(null, null),
        parentPageId: normalParent.id,
        spaceId,
        creatorId: user.id,
        workspaceId,
        lastUpdatedById: user.id,
      } as any);

      // root-level listing: database page present, row page never at root
      // anyway (it's parented under the database) but the exclusion must
      // still keep the database itself visible.
      const rootResult = await pageService.getSidebarPages(spaceId, {
        limit: 100,
      } as any);
      const rootIds = rootResult.items.map((p: any) => p.id);
      expect(rootIds).toContain(created.database.id);
      expect(rootIds).toContain(normalParent.id);

      const dbItem: any = rootResult.items.find(
        (p: any) => p.id === created.database.id,
      );
      // database has only a row child -> hasChildren must be false (no
      // empty expand chevron in the sidebar).
      expect(dbItem.hasChildren).toBe(false);

      const normalParentItem: any = rootResult.items.find(
        (p: any) => p.id === normalParent.id,
      );
      expect(normalParentItem.hasChildren).toBe(true);

      // child-level listing under the database: the row page must NOT appear
      const dbChildrenResult = await pageService.getSidebarPages(
        spaceId,
        { limit: 100 } as any,
        created.database.id,
      );
      expect(dbChildrenResult.items.map((p: any) => p.id)).not.toContain(
        row.pageId,
      );

      // control: child-level listing under the normal parent still lists
      // its normal child
      const normalChildrenResult = await pageService.getSidebarPages(
        spaceId,
        { limit: 100 } as any,
        normalParent.id,
      );
      expect(normalChildrenResult.items.map((p: any) => p.id)).toContain(
        normalChild.id,
      );
    });
  });
});
