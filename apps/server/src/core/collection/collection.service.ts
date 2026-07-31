import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql, SelectQueryBuilder } from 'kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { CollectionRepo } from '@docmost/db/repos/collection/collection.repo';
import { CollectionPropertyRepo } from '@docmost/db/repos/collection/collection-property.repo';
import { CollectionViewRepo } from '@docmost/db/repos/collection/collection-view.repo';
import { CollectionRowRepo } from '@docmost/db/repos/collection/collection-row.repo';
import {
  CollectionProperty,
  CollectionRow,
  CollectionView,
  Page,
  User,
} from '@docmost/db/types/entity.types';
import { generateBasePropertyId } from '../../common/helpers';
import {
  ALLOWED_PROPERTY_TYPES,
  ALLOWED_VIEW_TYPES,
} from './dto/collection.input';
import { PageService } from '../page/services/page.service';
import { CreatePageDto } from '../page/dto/create-page.dto';
import { PageAccessService } from '../page/page-access/page-access.service';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';

export interface CollectionInfo {
  database: Page;
  properties: CollectionProperty[];
  views: CollectionView[];
}

@Injectable()
export class CollectionService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly shareRepo: ShareRepo,
    private readonly collectionRepo: CollectionRepo,
    private readonly collectionPropertyRepo: CollectionPropertyRepo,
    private readonly collectionViewRepo: CollectionViewRepo,
    private readonly collectionRowRepo: CollectionRowRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pagePermissionRepo: PagePermissionRepo,
  ) {}

  async create(opts: {
    user: User;
    workspaceId: string;
    spaceId: string;
    title: string;
  }): Promise<CollectionInfo> {
    const ability = await this.spaceAbility.createForUser(
      opts.user,
      opts.spaceId,
    );
    if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    return executeTx(this.db, async (trx) => {
      const page = await this.pageService.create(
        opts.user.id,
        opts.workspaceId,
        { spaceId: opts.spaceId, title: opts.title } as CreatePageDto,
        trx,
      );

      await this.collectionRepo.setCollectionFlags(
        page.id,
        { isCollection: true },
        trx,
      );

      const { properties, views } = await this.ensureTitlePropertyAndTableView(
        page.id,
        opts.workspaceId,
        opts.user.id,
        trx,
      );

      return {
        database: {
          ...page,
          isCollection: true,
          isCollectionRow: false,
          isInlineCollection: false,
        },
        properties,
        views,
      };
    });
  }

  async convert(opts: { user: User; pageId: string }): Promise<CollectionInfo> {
    const page = await this.pageRepo.findById(opts.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    const existing = await this.collectionRepo.findCollectionPage(
      opts.pageId,
    );
    if (existing) {
      throw new BadRequestException('Page is already a collection');
    }

    return executeTx(this.db, async (trx) => {
      await this.collectionRepo.setCollectionFlags(
        opts.pageId,
        { isCollection: true },
        trx,
      );

      const { properties, views } = await this.ensureTitlePropertyAndTableView(
        opts.pageId,
        page.workspaceId,
        opts.user.id,
        trx,
      );

      // [R13] revoke any existing public share — a pre-convert share would
      // otherwise expose the database anonymously.
      const share = await this.shareRepo.findByPageId(opts.pageId, { trx });
      if (share) {
        await trx.deleteFrom('shares').where('id', '=', share.id).execute();
      }

      return {
        database: {
          ...page,
          isCollection: true,
          isCollectionRow: false,
          isInlineCollection: false,
        },
        properties,
        views,
      };
    });
  }

  async info(opts: { user: User; pageId: string }): Promise<CollectionInfo> {
    const page = await this.pageRepo.findById(opts.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanView(page, opts.user);

    const collectionPage = await this.collectionRepo.findCollectionPage(
      opts.pageId,
    );
    if (!collectionPage) {
      throw new NotFoundException('Collection not found');
    }

    const [properties, views] = await Promise.all([
      this.collectionPropertyRepo.findByCollectionPageId(opts.pageId),
      this.collectionViewRepo.findByCollectionPageId(opts.pageId),
    ]);

    return { database: collectionPage, properties, views };
  }

  async delete(opts: {
    user: User;
    pageId: string;
  }): Promise<{ success: true }> {
    const page = await this.pageRepo.findById(opts.pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    await this.pageRepo.removePage(opts.pageId, opts.user.id, page.workspaceId);

    return { success: true };
  }

  // Guards that a pageId is actually a collection (is_collection = true).
  // PageRepo.findById can't be trusted for this — its baseFields omit the
  // is_collection flags — so query via findCollectionPage.
  private async assertCollection(pageId: string): Promise<void> {
    const collectionPage = await this.collectionRepo.findCollectionPage(pageId);
    if (!collectionPage) {
      throw new NotFoundException('Not a collection database');
    }
  }

  async createProperty(opts: {
    user: User;
    collectionPageId: string;
    name: string;
    type: string;
    typeOptions?: object;
  }): Promise<CollectionProperty> {
    if (opts.type === 'title') {
      // [R9] Title is auto-created only; users can't add another.
      throw new BadRequestException('Cannot create a property of type title');
    }
    if (!(ALLOWED_PROPERTY_TYPES as readonly string[]).includes(opts.type)) {
      throw new BadRequestException(`Invalid property type: ${opts.type}`);
    }

    const page = await this.pageRepo.findById(opts.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);
    await this.assertCollection(opts.collectionPageId);

    const existing = await this.collectionPropertyRepo.findByCollectionPageId(
      opts.collectionPageId,
    );
    const lastPosition = existing.length
      ? existing[existing.length - 1].position
      : null;

    try {
      return await this.collectionPropertyRepo.insert({
        id: generateBasePropertyId(),
        collectionPageId: opts.collectionPageId,
        name: opts.name,
        type: opts.type,
        typeOptions: (opts.typeOptions as any) ?? null,
        position: generateJitteredKeyBetween(lastPosition, null),
        isPrimary: false,
        workspaceId: page.workspaceId,
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(
          'A column with that name already exists',
        );
      }
      throw err;
    }
  }

  async updateProperty(opts: {
    user: User;
    collectionPageId: string;
    id: string;
    name?: string;
    typeOptions?: object;
    position?: string;
  }): Promise<CollectionProperty> {
    const page = await this.pageRepo.findById(opts.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    const property = await this.collectionPropertyRepo.findById(
      opts.collectionPageId,
      opts.id,
    );
    if (!property) {
      throw new NotFoundException('Property not found');
    }

    const patch: Partial<
      Pick<CollectionProperty, 'name' | 'typeOptions' | 'position'>
    > = {};
    if (opts.name !== undefined) patch.name = opts.name;
    if (opts.typeOptions !== undefined)
      patch.typeOptions = opts.typeOptions as any;
    if (opts.position !== undefined) patch.position = opts.position;

    try {
      return await this.collectionPropertyRepo.update(
        opts.collectionPageId,
        opts.id,
        patch,
      );
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(
          'A column with that name already exists',
        );
      }
      throw err;
    }
  }

  async deleteProperty(opts: {
    user: User;
    collectionPageId: string;
    id: string;
  }): Promise<{ success: true }> {
    const page = await this.pageRepo.findById(opts.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    const property = await this.collectionPropertyRepo.findById(
      opts.collectionPageId,
      opts.id,
    );
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    if (property.isPrimary) {
      // [R9] Title column can't be deleted.
      throw new BadRequestException('Cannot delete the primary property');
    }

    await this.collectionPropertyRepo.softDelete(opts.collectionPageId, opts.id);

    return { success: true };
  }

  async createRow(opts: {
    user: User;
    collectionPageId: string;
  }): Promise<CollectionRow> {
    const databasePage = await this.pageRepo.findById(opts.collectionPageId);
    if (!databasePage || databasePage.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(databasePage, opts.user);
    await this.assertCollection(opts.collectionPageId);

    return executeTx(this.db, async (trx) => {
      const rowPage = await this.pageService.create(
        opts.user.id,
        databasePage.workspaceId,
        {
          spaceId: databasePage.spaceId,
          parentPageId: opts.collectionPageId,
        } as CreatePageDto,
        trx,
      );

      await this.collectionRepo.setCollectionFlags(
        rowPage.id,
        { isCollectionRow: true },
        trx,
      );

      const existingRows = await this.collectionRowRepo.findByCollectionPageId(
        opts.collectionPageId,
        trx,
      );
      const lastPosition = existingRows.length
        ? existingRows[existingRows.length - 1].position
        : null;

      return this.collectionRowRepo.insert(
        {
          collectionPageId: opts.collectionPageId,
          pageId: rowPage.id,
          cells: {},
          position: generateJitteredKeyBetween(lastPosition, null),
          workspaceId: databasePage.workspaceId,
          creatorId: opts.user.id,
        },
        trx,
      );
    });
  }

  async updateRow(opts: {
    user: User;
    rowId: string;
    cells: Record<string, unknown>;
  }): Promise<CollectionRow> {
    const row = await this.collectionRowRepo.findById(opts.rowId);
    if (!row || row.deletedAt) {
      throw new NotFoundException('Row not found');
    }

    // Authorize on the ROW page, not the database page: a row is a child page
    // that can carry its own page_access restriction. validateCanEdit walks UP
    // the ancestor chain from the page it's given, so passing the database page
    // would never see a restriction on the row itself — letting a
    // database-editor read (empty patch → returningAll) or overwrite a row
    // they're locked out of.
    const rowPage = await this.pageRepo.findById(row.pageId);
    if (!rowPage || rowPage.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(rowPage, opts.user);

    return this.collectionRowRepo.patchCells(
      opts.rowId,
      opts.cells,
      opts.user.id,
    );
  }

  async deleteRow(opts: {
    user: User;
    rowId: string;
  }): Promise<{ success: true }> {
    const row = await this.collectionRowRepo.findById(opts.rowId);
    if (!row || row.deletedAt) {
      throw new NotFoundException('Row not found');
    }

    // Authorize on the ROW page (its own restriction), not the database page —
    // see updateRow above. A user locked out of this row must not delete it.
    const rowPage = await this.pageRepo.findById(row.pageId);
    if (!rowPage || rowPage.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(rowPage, opts.user);

    // ponytail: PageRepo.removePage manages its own internal transaction
    // (no trx param on its signature) — matches the existing idiom in
    // delete() above, which also calls it un-wrapped. True single-tx
    // atomicity with the row soft-delete below would need a signature
    // change to removePage, out of scope here.
    await this.pageRepo.removePage(
      row.pageId,
      opts.user.id,
      rowPage.workspaceId,
    );
    await this.collectionRowRepo.softDelete(opts.rowId);

    return { success: true };
  }

  async createView(opts: {
    user: User;
    collectionPageId: string;
    type: string;
    name: string;
  }): Promise<CollectionView> {
    if (!(ALLOWED_VIEW_TYPES as readonly string[]).includes(opts.type)) {
      // [V1] Only 'table' is supported; 'kanban' etc. are V2.
      throw new BadRequestException(`Invalid view type: ${opts.type}`);
    }

    const page = await this.pageRepo.findById(opts.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);
    await this.assertCollection(opts.collectionPageId);

    const existing = await this.collectionViewRepo.findByCollectionPageId(
      opts.collectionPageId,
    );
    const lastPosition = existing.length
      ? existing[existing.length - 1].position
      : null;

    return this.collectionViewRepo.insert({
      collectionPageId: opts.collectionPageId,
      name: opts.name,
      type: opts.type,
      position: generateJitteredKeyBetween(lastPosition, null),
      config: {},
      workspaceId: page.workspaceId,
      creatorId: opts.user.id,
    });
  }

  async updateView(opts: {
    user: User;
    id: string;
    config?: object;
    name?: string;
    position?: string;
  }): Promise<CollectionView> {
    const view = await this.collectionViewRepo.findById(opts.id);
    if (!view) {
      throw new NotFoundException('View not found');
    }

    const page = await this.pageRepo.findById(view.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    const patch: Partial<Pick<CollectionView, 'config' | 'name' | 'position'>> =
      {};
    if (opts.config !== undefined) patch.config = opts.config as any;
    if (opts.name !== undefined) patch.name = opts.name;
    if (opts.position !== undefined) patch.position = opts.position;

    return this.collectionViewRepo.update(opts.id, patch);
  }

  async deleteView(opts: {
    user: User;
    id: string;
  }): Promise<{ success: true }> {
    const view = await this.collectionViewRepo.findById(opts.id);
    if (!view) {
      throw new NotFoundException('View not found');
    }

    const page = await this.pageRepo.findById(view.collectionPageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, opts.user);

    const count = await this.collectionViewRepo.countByCollectionPageId(
      view.collectionPageId,
    );
    if (count <= 1) {
      // [R18] rendering + rows/list require a viewId; can't drop to zero.
      throw new BadRequestException('cannot delete the only view');
    }

    await this.collectionViewRepo.delete(opts.id);

    return { success: true };
  }

  // rows/list [R6b/R11]: two-grain access filtering — validateCanView gates
  // the database itself, filterAccessiblePageIds gates each row (a row is a
  // page and can carry its own restriction independent of the database's).
  async rowsList(opts: {
    user: User;
    collectionPageId: string;
    viewId: string;
  }): Promise<{
    rows: Array<{
      id: string;
      pageId: string;
      title: string | null;
      cells: Record<string, unknown>;
      position: string;
    }>;
  }> {
    const databasePage = await this.pageRepo.findById(opts.collectionPageId);
    if (!databasePage || databasePage.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    // [R6b] a restricted database must not expose its listing to a member
    // who can't view the database page itself.
    await this.pageAccessService.validateCanView(databasePage, opts.user);
    await this.assertCollection(opts.collectionPageId);

    const view = await this.collectionViewRepo.findById(opts.viewId);
    if (!view || view.collectionPageId !== opts.collectionPageId) {
      throw new NotFoundException('View not found');
    }

    const properties = await this.collectionPropertyRepo.findByCollectionPageId(
      opts.collectionPageId,
    );
    const propertyMap = new Map(properties.map((p) => [p.id, p]));

    let query = this.db
      .selectFrom('collectionRows as r')
      .innerJoin('pages as p', 'p.id', 'r.pageId')
      .select([
        'r.id as id',
        'r.pageId as pageId',
        'r.cells as cells',
        'r.position as position',
        'p.title as title',
      ])
      .where('r.collectionPageId', '=', opts.collectionPageId)
      .where('r.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      // defense-in-depth: a row page moved to another space (movePageToSpace
      // leaves the collection_rows join intact) must not leak its title/cells
      // to viewers of the database's space. V1 rows are never cross-space.
      .where('p.spaceId', '=', databasePage.spaceId);

    const config = (view.config ?? {}) as {
      filters?: unknown[];
      sorts?: unknown[];
    };

    for (const filter of config.filters ?? []) {
      query = this.applyRowFilter(query, filter, propertyMap);
    }

    // spec §10: sort cap 5
    const sorts = (config.sorts ?? []).slice(0, 5);
    if (sorts.length === 0) {
      // fractional-index keys need bytewise ("C") ordering — default collation
      // misorders appended keys (e.g. 'aa' before 'aA').
      query = query.orderBy(sql`r.position collate "C"`, 'asc');
    } else {
      for (const sort of sorts) {
        query = this.applyRowSort(query, sort, propertyMap);
      }
    }

    const candidates = await query.execute();
    if (candidates.length === 0) {
      return { rows: [] };
    }

    // [R11] a row is a page with its own possible restriction — intersect
    // with the caller's accessible page ids or a restricted row's Title +
    // cells leak, even though the caller can see the database itself.
    const accessiblePageIds = await this.pagePermissionRepo.filterAccessiblePageIds(
      {
        pageIds: candidates.map((c) => c.pageId),
        userId: opts.user.id,
        spaceId: databasePage.spaceId,
      },
    );
    const accessibleSet = new Set(accessiblePageIds);

    // ponytail: no pagination in V1; add cursor paging when tables grow
    return {
      rows: candidates
        .filter((c) => accessibleSet.has(c.pageId))
        .map((c) => ({
          id: c.id,
          pageId: c.pageId,
          title: c.title,
          cells: (c.cells ?? {}) as Record<string, unknown>,
          position: c.position,
        })),
    };
  }

  // Raw SQL fragment to read a property's value in the rows/list query.
  // Title (isPrimary) reads from the joined page's title column; every
  // other property type reads from collection_rows.cells via the typed
  // extraction helper matching its type [R3].
  private rowCellExpr(property: CollectionProperty) {
    if (property.isPrimary) {
      return sql.ref('p.title');
    }
    switch (property.type) {
      case 'number':
        return sql`collection_cell_numeric(r.cells, ${property.id})`;
      case 'date':
        return sql`collection_cell_timestamptz(r.cells, ${property.id})`;
      case 'checkbox':
        return sql`collection_cell_bool(r.cells, ${property.id})`;
      case 'text':
      case 'select':
      default:
        return sql`collection_cell_text(r.cells, ${property.id})`;
    }
  }

  // Compiles one `{propertyId, operator, value}` filter condition onto the
  // query. Unknown propertyId or an operator that doesn't apply to the
  // property's type is skipped, never fatal [R19].
  private applyRowFilter<QB extends SelectQueryBuilder<any, any, any>>(
    query: QB,
    filter: unknown,
    propertyMap: Map<string, CollectionProperty>,
  ): QB {
    if (!filter || typeof filter !== 'object') return query;
    const { propertyId, operator, value } = filter as {
      propertyId?: string;
      operator?: string;
      value?: unknown;
    };
    const property = propertyId ? propertyMap.get(propertyId) : undefined;
    if (!property) return query; // [R19] stale propertyId ignored

    const expr = this.rowCellExpr(property);
    const kind = property.isPrimary ? 'text' : property.type;

    if (operator === 'is_empty') return query.where(expr, 'is', null) as QB;
    if (operator === 'is_not_empty')
      return query.where(expr, 'is not', null) as QB;

    switch (kind) {
      case 'text':
        if (operator === 'contains') {
          return query.where(
            expr,
            'ilike',
            sql`${'%' + String(value) + '%'}`,
          ) as QB;
        }
        if (operator === 'equals') {
          return query.where(expr, '=', String(value)) as QB;
        }
        return query;
      case 'select':
        if (operator === 'equals') {
          return query.where(expr, '=', String(value)) as QB;
        }
        if (operator === 'not_equals') {
          return query.where(expr, '!=', String(value)) as QB;
        }
        return query;
      case 'number': {
        const numOps: Record<string, '=' | '!=' | '>' | '>=' | '<' | '<='> = {
          equals: '=',
          not_equals: '!=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<=',
        };
        const op = operator ? numOps[operator] : undefined;
        if (!op) return query;
        const num = Number(value);
        if (Number.isNaN(num)) return query;
        return query.where(expr, op, num) as QB;
      }
      case 'date': {
        // [R19] never fatal: an unparseable date value would throw on the
        // ::timestamptz cast and 500 rows/list for every viewer — skip it.
        if (Number.isNaN(Date.parse(String(value)))) return query;
        if (operator === 'on') {
          return query.where(
            sql`date_trunc('day', ${expr})`,
            '=',
            sql`date_trunc('day', ${String(value)}::timestamptz)`,
          ) as QB;
        }
        const dateOps: Record<string, '<' | '>'> = {
          before: '<',
          after: '>',
        };
        const op = operator ? dateOps[operator] : undefined;
        if (!op) return query;
        return query.where(expr, op, String(value)) as QB;
      }
      case 'checkbox':
        if (operator === 'equals') {
          // explicit coercion: the JSON string "false" must not read as true
          const boolVal = value === true || value === 'true';
          return query.where(expr, '=', boolVal) as QB;
        }
        return query;
      default:
        return query;
    }
  }

  // Compiles one `{propertyId, direction}` sort onto the query. Unknown
  // propertyId is skipped, never fatal [R19].
  private applyRowSort<QB extends SelectQueryBuilder<any, any, any>>(
    query: QB,
    sortSpec: unknown,
    propertyMap: Map<string, CollectionProperty>,
  ): QB {
    if (!sortSpec || typeof sortSpec !== 'object') return query;
    const { propertyId, direction } = sortSpec as {
      propertyId?: string;
      direction?: string;
    };
    const property = propertyId ? propertyMap.get(propertyId) : undefined;
    if (!property) return query; // [R19] stale propertyId ignored

    const expr = this.rowCellExpr(property);
    return query.orderBy(expr, direction === 'desc' ? 'desc' : 'asc') as QB;
  }

  // Auto-creates the Title property + Table view a collection page must
  // always have. Idempotent (used by both create and convert): if either
  // already exists (convert on a page that somehow already has some), it's
  // left alone rather than duplicated.
  private async ensureTitlePropertyAndTableView(
    collectionPageId: string,
    workspaceId: string,
    creatorId: string,
    trx: KyselyTransaction,
  ): Promise<{ properties: CollectionProperty[]; views: CollectionView[] }> {
    let properties = await this.collectionPropertyRepo.findByCollectionPageId(
      collectionPageId,
      trx,
    );
    if (properties.length === 0) {
      const property = await this.collectionPropertyRepo.insert(
        {
          id: generateBasePropertyId(),
          collectionPageId,
          name: 'Name',
          type: 'title',
          position: generateJitteredKeyBetween(null, null),
          isPrimary: true,
          workspaceId,
        },
        trx,
      );
      properties = [property];
    }

    let views = await this.collectionViewRepo.findByCollectionPageId(
      collectionPageId,
      trx,
    );
    if (views.length === 0) {
      const view = await this.collectionViewRepo.insert(
        {
          collectionPageId,
          name: 'Table',
          type: 'table',
          position: generateJitteredKeyBetween(null, null),
          config: {},
          workspaceId,
          creatorId,
        },
        trx,
      );
      views = [view];
    }

    return { properties, views };
  }
}
