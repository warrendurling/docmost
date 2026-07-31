import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

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

export const ALLOWED_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'date',
  'checkbox',
] as const;

export class CreateCollectionPropertyDto {
  @IsString()
  collectionPageId: string;

  @IsString()
  name: string;

  @IsIn(ALLOWED_PROPERTY_TYPES)
  type: string;

  @IsOptional()
  @IsObject()
  typeOptions?: object;
}

export class UpdateCollectionPropertyDto {
  @IsString()
  collectionPageId: string;

  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsObject()
  typeOptions?: object;

  @IsOptional()
  @IsString()
  position?: string;
}

export class DeleteCollectionPropertyDto {
  @IsString()
  collectionPageId: string;

  @IsString()
  id: string;
}
