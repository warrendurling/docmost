import { IsString, IsUUID } from 'class-validator';

export class CreateCollectionDto {
  @IsUUID()
  spaceId: string;

  @IsString()
  title: string;
}

export class CollectionPageIdDto {
  @IsString()
  pageId: string;
}
