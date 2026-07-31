import api from "@/lib/api-client";

export type CollectionPropertyType =
  | "title"
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox";

export type CreatablePropertyType = Exclude<CollectionPropertyType, "title">;

export interface ICollectionProperty {
  id: string;
  name: string;
  type: CollectionPropertyType;
  typeOptions?: any;
  position: string;
}

export interface ICollectionView {
  id: string;
  type: string;
  name: string;
  config?: {
    filters?: any[];
    sorts?: any[];
    columnOrder?: string[];
    hiddenColumns?: string[];
  };
  position: string;
}

export interface ICollectionInfo {
  database: any;
  properties: ICollectionProperty[];
  views: ICollectionView[];
}

export interface ICollectionRow {
  id: string;
  pageId: string;
  title: string;
  slugId: string;
  cells: Record<string, any>;
  position: string;
}

export async function createCollection(data: {
  spaceId: string;
  title: string;
}) {
  const req = await api.post("/collections/create", data);
  return req.data;
}

export async function convertToCollection(data: { pageId: string }) {
  const req = await api.post("/collections/convert", data);
  return req.data;
}

export async function getCollectionInfo(data: {
  pageId: string;
}): Promise<ICollectionInfo> {
  const req = await api.post<ICollectionInfo>("/collections/info", data);
  return req.data;
}

export async function deleteCollection(data: { pageId: string }) {
  const req = await api.post("/collections/delete", data);
  return req.data;
}

export async function createProperty(data: {
  collectionPageId: string;
  name: string;
  type: CreatablePropertyType;
  typeOptions?: any;
}): Promise<ICollectionProperty> {
  const req = await api.post<ICollectionProperty>(
    "/collections/properties/create",
    data,
  );
  return req.data;
}

export async function updateProperty(data: {
  collectionPageId: string;
  id: string;
  name?: string;
  typeOptions?: any;
  position?: string;
}): Promise<ICollectionProperty> {
  const req = await api.post<ICollectionProperty>(
    "/collections/properties/update",
    data,
  );
  return req.data;
}

export async function deleteProperty(data: {
  collectionPageId: string;
  id: string;
}) {
  const req = await api.post("/collections/properties/delete", data);
  return req.data;
}

export async function listRows(data: {
  collectionPageId: string;
  viewId: string;
}): Promise<{ rows: ICollectionRow[] }> {
  const req = await api.post<{ rows: ICollectionRow[] }>(
    "/collections/rows/list",
    data,
  );
  return req.data;
}

export async function createRow(data: {
  collectionPageId: string;
}): Promise<ICollectionRow> {
  const req = await api.post<ICollectionRow>("/collections/rows/create", data);
  return req.data;
}

// Note: editing a row's Title does NOT go through updateRow — it uses the
// existing updatePage() in features/page/services/page-service.ts
// (POST /pages/update, body { pageId, title }). Don't duplicate it here.
export async function updateRow(data: {
  rowId: string;
  cells: Record<string, any>;
}): Promise<ICollectionRow> {
  const req = await api.post<ICollectionRow>("/collections/rows/update", data);
  return req.data;
}

export async function deleteRow(data: { rowId: string }) {
  const req = await api.post("/collections/rows/delete", data);
  return req.data;
}

export async function createView(data: {
  collectionPageId: string;
  type: string;
  name: string;
}): Promise<ICollectionView> {
  const req = await api.post<ICollectionView>("/collections/views/create", data);
  return req.data;
}

export async function updateView(data: {
  id: string;
  config?: ICollectionView["config"];
  name?: string;
  position?: string;
}): Promise<ICollectionView> {
  const req = await api.post<ICollectionView>("/collections/views/update", data);
  return req.data;
}

export async function deleteView(data: { id: string }) {
  const req = await api.post("/collections/views/delete", data);
  return req.data;
}
