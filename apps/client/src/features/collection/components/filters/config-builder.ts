import { ICollectionView } from "@/features/collection/services/collection-service";
import { isEmptyOperator } from "@/features/collection/components/filters/operators";

export interface FilterCondition {
  propertyId: string;
  operator: string;
  value?: unknown;
}

export interface SortSpec {
  propertyId: string;
  direction: "asc" | "desc";
}

const SORT_CAP = 5; // spec §10

function isCompleteFilter(f: FilterCondition): boolean {
  if (!f.propertyId || !f.operator) return false;
  if (isEmptyOperator(f.operator)) return true;
  return f.value !== undefined && f.value !== null && f.value !== "";
}

// Pure: assembles the view config's filters/sorts from editable local state.
// Drops filter conditions missing a property/operator, or missing a value
// where the operator needs one. Caps sorts at 5 to match the server's cap.
// Spreads `base` first so columnOrder/hiddenColumns survive untouched.
export function buildViewConfig(
  filters: FilterCondition[],
  sorts: SortSpec[],
  base: ICollectionView["config"] | undefined,
): ICollectionView["config"] {
  return {
    ...base,
    filters: filters.filter(isCompleteFilter),
    sorts: sorts.filter((s) => !!s.propertyId).slice(0, SORT_CAP),
  };
}
