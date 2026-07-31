import { CollectionPropertyType } from "@/features/collection/services/collection-service";

// Must match apps/server/src/core/collection/collection.service.ts
// applyRowFilter exactly — an operator listed here that the server doesn't
// handle silently no-ops the filter server-side.
const OPERATORS_BY_TYPE: Record<CollectionPropertyType, string[]> = {
  title: ["contains", "equals", "is_empty", "is_not_empty"],
  text: ["contains", "equals", "is_empty", "is_not_empty"],
  number: [
    "equals",
    "not_equals",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_empty",
    "is_not_empty",
  ],
  date: ["before", "after", "on", "is_empty", "is_not_empty"],
  select: ["equals", "not_equals", "is_empty", "is_not_empty"],
  checkbox: ["equals"],
};

export function operatorsForType(type: CollectionPropertyType): string[] {
  return OPERATORS_BY_TYPE[type] ?? [];
}

export function isEmptyOperator(operator: string): boolean {
  return operator === "is_empty" || operator === "is_not_empty";
}
