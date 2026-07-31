import { Module } from '@nestjs/common';
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
import { CollectionPropertyRepo } from '@docmost/db/repos/collection/collection-property.repo';
import { CollectionViewRepo } from '@docmost/db/repos/collection/collection-view.repo';
import { CollectionRowRepo } from '@docmost/db/repos/collection/collection-row.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
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
  let pageRepo: PageRepo;
  let shareRepo: ShareRepo;
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
    pageRepo = moduleFixture.get(PageRepo);
    shareRepo = moduleFixture.get(ShareRepo);
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
  });
});
