import { Kysely, CamelCasePlugin } from 'kysely';
import * as dotenv from 'dotenv';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { envPath, normalizePostgresUrl } from '../../../../common/helpers';
import { CollectionPropertyRepo } from '../collection-property.repo';
import { CollectionRowRepo } from '../collection-row.repo';
import { CollectionViewRepo } from '../collection-view.repo';
import { CollectionRepo } from '../collection.repo';

dotenv.config({ path: envPath });

const db = new Kysely<any>({
  dialect: new PostgresJSDialect({
    postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL)),
  }),
  plugins: [new CamelCasePlugin()],
});

const propertyRepo = new CollectionPropertyRepo(db as any);
const rowRepo = new CollectionRowRepo(db as any);
const viewRepo = new CollectionViewRepo(db as any);
const collectionRepo = new CollectionRepo(db as any);

describe('collection repos', () => {
  let workspaceId: string;
  let spaceId: string;
  let userId: string;
  let collectionPageId: string;
  let normalPageId: string;

  beforeAll(async () => {
    const workspace = await db
      .insertInto('workspaces')
      .values({ name: 'Test WS', hostname: `test-ws-${randomUUID()}` })
      .returningAll()
      .executeTakeFirstOrThrow();
    workspaceId = workspace.id;

    const space = await db
      .insertInto('spaces')
      .values({ name: 'Test Space', slug: `test-space-${randomUUID()}`, workspaceId })
      .returningAll()
      .executeTakeFirstOrThrow();
    spaceId = space.id;

    const user = await db
      .insertInto('users')
      .values({ email: `test-${randomUUID()}@example.com`, workspaceId })
      .returningAll()
      .executeTakeFirstOrThrow();
    userId = user.id;

    const collectionPage = await db
      .insertInto('pages')
      .values({
        slugId: randomUUID(),
        title: 'Test Collection',
        spaceId,
        workspaceId,
        creatorId: userId,
        isCollection: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    collectionPageId = collectionPage.id;

    const normalPage = await db
      .insertInto('pages')
      .values({
        slugId: randomUUID(),
        title: 'Normal Page',
        spaceId,
        workspaceId,
        creatorId: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    normalPageId = normalPage.id;
  });

  afterAll(async () => {
    await db.deleteFrom('workspaces').where('id', '=', workspaceId).execute();
    await db.destroy();
  });

  it('CollectionPropertyRepo: insert -> findById -> findByCollectionPageId -> update -> softDelete', async () => {
    const inserted = await propertyRepo.insert({
      id: randomUUID(),
      collectionPageId,
      name: 'Status',
      type: 'text',
      position: 'a0',
      workspaceId,
    });
    expect(inserted.id).toBeDefined();
    expect(inserted.name).toBe('Status');

    const found = await propertyRepo.findById(collectionPageId, inserted.id);
    expect(found?.id).toBe(inserted.id);

    const list = await propertyRepo.findByCollectionPageId(collectionPageId);
    expect(list.map((p) => p.id)).toContain(inserted.id);

    const updated = await propertyRepo.update(collectionPageId, inserted.id, {
      name: 'Status Updated',
    });
    expect(updated.name).toBe('Status Updated');

    await propertyRepo.softDelete(collectionPageId, inserted.id);
    const listAfterDelete = await propertyRepo.findByCollectionPageId(collectionPageId);
    expect(listAfterDelete.map((p) => p.id)).not.toContain(inserted.id);
  });

  it('CollectionRowRepo: insert -> findById/findByPageId -> update -> softDelete', async () => {
    const rowPage = await db
      .insertInto('pages')
      .values({
        slugId: randomUUID(),
        title: 'Row 1',
        spaceId,
        workspaceId,
        creatorId: userId,
        parentPageId: collectionPageId,
        isCollectionRow: true,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const inserted = await rowRepo.insert({
      collectionPageId,
      pageId: rowPage.id,
      position: 'a0',
      workspaceId,
      creatorId: userId,
    });
    expect(inserted.id).toBeDefined();

    const foundById = await rowRepo.findById(inserted.id);
    expect(foundById?.id).toBe(inserted.id);

    const foundByPageId = await rowRepo.findByPageId(rowPage.id);
    expect(foundByPageId?.id).toBe(inserted.id);

    const list = await rowRepo.findByCollectionPageId(collectionPageId);
    expect(list.map((r) => r.id)).toContain(inserted.id);

    const updated = await rowRepo.update(inserted.id, {
      cells: { status: 'done' } as any,
    });
    expect(updated.cells).toEqual({ status: 'done' });

    await rowRepo.softDelete(inserted.id);
    const listAfterDelete = await rowRepo.findByCollectionPageId(collectionPageId);
    expect(listAfterDelete.map((r) => r.id)).not.toContain(inserted.id);
  });

  it('CollectionViewRepo: insert 2 -> count -> list ordered -> update -> delete -> count', async () => {
    const view1 = await viewRepo.insert({
      collectionPageId,
      name: 'Table',
      type: 'table',
      position: 'a0',
      workspaceId,
      creatorId: userId,
    });
    const view2 = await viewRepo.insert({
      collectionPageId,
      name: 'Board',
      type: 'board',
      position: 'a1',
      workspaceId,
      creatorId: userId,
    });

    const count = await viewRepo.countByCollectionPageId(collectionPageId);
    expect(count).toBe(2);

    const list = await viewRepo.findByCollectionPageId(collectionPageId);
    expect(list.map((v) => v.id)).toEqual([view1.id, view2.id]);

    const updated = await viewRepo.update(view1.id, { name: 'Table Updated' });
    expect(updated.name).toBe('Table Updated');

    await viewRepo.delete(view2.id);
    const countAfterDelete = await viewRepo.countByCollectionPageId(collectionPageId);
    expect(countAfterDelete).toBe(1);
  });

  it('CollectionRepo: setCollectionFlags + findCollectionPage', async () => {
    const flaggedPage = await collectionRepo.findCollectionPage(collectionPageId);
    expect(flaggedPage?.id).toBe(collectionPageId);

    const nonCollection = await collectionRepo.findCollectionPage(normalPageId);
    expect(nonCollection).toBeUndefined();

    await collectionRepo.setCollectionFlags(normalPageId, { isCollection: true });
    const nowCollection = await collectionRepo.findCollectionPage(normalPageId);
    expect(nowCollection?.id).toBe(normalPageId);
  });
});
