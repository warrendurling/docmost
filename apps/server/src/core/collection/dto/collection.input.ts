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

export class CreateCollectionRowDto {
  @IsString()
  collectionPageId: string;
}

export class UpdateCollectionRowDto {
  @IsString()
  rowId: string;

  @IsObject()
  cells: Record<string, unknown>;
}

export class DeleteCollectionRowDto {
  @IsString()
  rowId: string;
}

export const ALLOWED_VIEW_TYPES = ['table'] as const;

export class CreateCollectionViewDto {
  @IsString()
  collectionPageId: string;

  @IsIn(ALLOWED_VIEW_TYPES)
  type: string;

  @IsString()
  name: string;
}

export class UpdateCollectionViewDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsObject()
  config?: object;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  position?: string;
}

export class DeleteCollectionViewDto {
  @IsString()
  id: string;
}

export class RowsListDto {
  @IsString()
  collectionPageId: string;

  @IsString()
  viewId: string;
}

export class RowGetDto {
  @IsString()
  pageId: string;
}
