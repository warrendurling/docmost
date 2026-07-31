import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CollectionService } from './collection.service';
import { CreateCollectionDto, CollectionPageIdDto } from './dto/collection.input';
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
}
