// Pure: moves fromId to toId's slot in the column order. Falls back to
// allPropertyIds when currentOrder is empty, drops stale ids, appends any
// property missing from currentOrder, tolerates ids that don't exist.
export function reorderColumns(
  currentOrder: string[],
  allPropertyIds: string[],
  fromId: string,
  toId: string,
): string[] {
  const known = new Set(allPropertyIds);
  const seen = new Set<string>();
  const base: string[] = [];
  const source = currentOrder.length > 0 ? currentOrder : allPropertyIds;
  for (const id of source) {
    if (known.has(id) && !seen.has(id)) {
      base.push(id);
      seen.add(id);
    }
  }
  for (const id of allPropertyIds) {
    if (!seen.has(id)) {
      base.push(id);
      seen.add(id);
    }
  }

  const fromIndex = base.indexOf(fromId);
  const toIndex = base.indexOf(toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return base;
  }

  const next = [...base];
  const [moved] = next.splice(fromIndex, 1);
  const insertAt = next.indexOf(toId);
  next.splice(insertAt === -1 ? next.length : insertAt, 0, moved);
  return next;
}
