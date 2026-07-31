import {
  ICollectionProperty,
  ICollectionView,
} from "@/features/collection/services/collection-service";

export interface IBuiltColumn {
  id: string;
  propertyId: string;
  name: string;
  type: ICollectionProperty["type"];
  typeOptions?: any;
}

// Pure: orders visible properties by view.config.columnOrder (falling back to
// property.position), then drops any ids listed in view.config.hiddenColumns.
// Ignores stale ids that no longer match a property instead of throwing.
export function buildColumns(
  properties: ICollectionProperty[],
  viewConfig: ICollectionView["config"] | undefined,
): IBuiltColumn[] {
  const columnOrder = viewConfig?.columnOrder;
  const hiddenColumns = new Set(viewConfig?.hiddenColumns ?? []);

  const byId = new Map(properties.map((p) => [p.id, p]));

  let ordered: ICollectionProperty[];
  if (columnOrder && columnOrder.length > 0) {
    const seen = new Set<string>();
    ordered = [];
    for (const id of columnOrder) {
      const prop = byId.get(id);
      if (prop && !seen.has(id)) {
        ordered.push(prop);
        seen.add(id);
      }
    }
    // append any properties not mentioned in columnOrder, in position order
    const remaining = properties
      .filter((p) => !seen.has(p.id))
      .sort((a, b) => a.position.localeCompare(b.position));
    ordered = ordered.concat(remaining);
  } else {
    ordered = [...properties].sort((a, b) =>
      a.position.localeCompare(b.position),
    );
  }

  return ordered
    .filter((p) => !hiddenColumns.has(p.id))
    .map((p) => ({
      id: p.id,
      propertyId: p.id,
      name: p.name,
      type: p.type,
      typeOptions: p.typeOptions,
    }));
}
