import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CollectionService } from './collection.service';
import {
  CreateCollectionDto,
  CollectionPageIdDto,
  CreateCollectionPropertyDto,
  UpdateCollectionPropertyDto,
  DeleteCollectionPropertyDto,
  CreateCollectionRowDto,
  UpdateCollectionRowDto,
  DeleteCollectionRowDto,
  CreateCollectionViewDto,
  UpdateCollectionViewDto,
  DeleteCollectionViewDto,
  RowsListDto,
} from './dto/collection.input';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';

@UseGuards(JwtAuthGuard)
@Controller('collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  create(
    @Body() dto: CreateCollectionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.collectionService.create({
      user,
      workspaceId: workspace.id,
      spaceId: dto.spaceId,
      title: dto.title,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('convert')
  convert(@Body() dto: CollectionPageIdDto, @AuthUser() user: User) {
    return this.collectionService.convert({ user, pageId: dto.pageId });
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  info(@Body() dto: CollectionPageIdDto, @AuthUser() user: User) {
    return this.collectionService.info({ user, pageId: dto.pageId });
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  delete(@Body() dto: CollectionPageIdDto, @AuthUser() user: User) {
    return this.collectionService.delete({ user, pageId: dto.pageId });
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/create')
  createProperty(
    @Body() dto: CreateCollectionPropertyDto,
    @AuthUser() user: User,
  ) {
    return this.collectionService.createProperty({
      user,
      collectionPageId: dto.collectionPageId,
      name: dto.name,
      type: dto.type,
      typeOptions: dto.typeOptions,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/update')
  updateProperty(
    @Body() dto: UpdateCollectionPropertyDto,
    @AuthUser() user: User,
  ) {
    return this.collectionService.updateProperty({
      user,
      collectionPageId: dto.collectionPageId,
      id: dto.id,
      name: dto.name,
      typeOptions: dto.typeOptions,
      position: dto.position,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/delete')
  deleteProperty(
    @Body() dto: DeleteCollectionPropertyDto,
    @AuthUser() user: User,
  ) {
    return this.collectionService.deleteProperty({
      user,
      collectionPageId: dto.collectionPageId,
      id: dto.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/create')
  createRow(@Body() dto: CreateCollectionRowDto, @AuthUser() user: User) {
    return this.collectionService.createRow({
      user,
      collectionPageId: dto.collectionPageId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/update')
  updateRow(@Body() dto: UpdateCollectionRowDto, @AuthUser() user: User) {
    return this.collectionService.updateRow({
      user,
      rowId: dto.rowId,
      cells: dto.cells,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/delete')
  deleteRow(@Body() dto: DeleteCollectionRowDto, @AuthUser() user: User) {
    return this.collectionService.deleteRow({ user, rowId: dto.rowId });
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/list')
  rowsList(@Body() dto: RowsListDto, @AuthUser() user: User) {
    return this.collectionService.rowsList({
      user,
      collectionPageId: dto.collectionPageId,
      viewId: dto.viewId,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  createView(@Body() dto: CreateCollectionViewDto, @AuthUser() user: User) {
    return this.collectionService.createView({
      user,
      collectionPageId: dto.collectionPageId,
      type: dto.type,
      name: dto.name,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/update')
  updateView(@Body() dto: UpdateCollectionViewDto, @AuthUser() user: User) {
    return this.collectionService.updateView({
      user,
      id: dto.id,
      config: dto.config,
      name: dto.name,
      position: dto.position,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/delete')
  deleteView(@Body() dto: DeleteCollectionViewDto, @AuthUser() user: User) {
    return this.collectionService.deleteView({ user, id: dto.id });
  }
}
