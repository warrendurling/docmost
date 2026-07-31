import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { CollectionRepo } from '@docmost/db/repos/collection/collection.repo';
import { CollectionPropertyRepo } from '@docmost/db/repos/collection/collection-property.repo';
import { CollectionViewRepo } from '@docmost/db/repos/collection/collection-view.repo';
import {
  CollectionProperty,
  CollectionView,
  Page,
  User,
} from '@docmost/db/types/entity.types';
import { generateBasePropertyId } from '../../common/helpers';
import { PageService } from '../page/services/page.service';
import { CreatePageDto } from '../page/dto/create-page.dto';
import { PageAccessService } from '../page/page-access/page-access.service';
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
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
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
