import { useEffect, useState } from "react";
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Popover,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconArrowsSort, IconFilter, IconPlus, IconX } from "@tabler/icons-react";
import { useUpdateViewMutation } from "@/features/collection/queries/collection-query";
import {
  ICollectionProperty,
  ICollectionView,
} from "@/features/collection/services/collection-service";
import { isEmptyOperator, operatorsForType } from "@/features/collection/components/filters/operators";
import {
  buildViewConfig,
  FilterCondition,
  SortSpec,
} from "@/features/collection/components/filters/config-builder";
import { toCellValue } from "@/features/collection/components/cell-editors/to-cell-value";

const OPERATOR_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "is",
  not_equals: "is not",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  before: "before",
  after: "after",
  on: "on",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const SORT_CAP = 5;

// Local filter draft with a stable client-side identity, independent of
// array position or propertyId/operator — see BUG 2 note above.
type FilterDraft = FilterCondition & { _key: string };
const withKey = (f: FilterCondition): FilterDraft => ({ ...f, _key: crypto.randomUUID() });
const stripKey = ({ _key, ...f }: FilterDraft): FilterCondition => f;

interface FilterSortBarProps {
  collectionPageId: string;
  viewId: string;
  properties: ICollectionProperty[];
  viewConfig: ICollectionView["config"];
  readOnly?: boolean;
}

// Writes filters/sorts into the view's config; the server (rows/list) does
// all actual filtering/sorting — this only has to produce a config shape it
// understands. See collection.service.ts applyRowFilter/applyRowSort.
//
// Local draft state applies to FILTERS ONLY: filter rows render from
// localFilters, NOT straight from viewConfig — an in-progress condition (no
// value yet, or operator/property just switched to something needing a new
// value) has to stay visible with its input so the user can finish it.
// buildViewConfig strips incomplete conditions before every server write.
// Re-synced from viewConfig only when viewId changes, so refetches after our
// own writes don't clobber an edit in progress. Each local filter draft
// carries a stable `_key` (assigned on add / on sync-from-viewConfig) used
// as the React key, so removing one row can't make React reuse another
// row's uncontrolled input DOM under a different filter's identity.
//
// Sorts have no draft state: a sort is complete the moment it's created, so
// it renders straight from viewConfig.sorts and persists immediately on
// every change. (A frozen local copy previously went stale whenever the
// column-header sort menu wrote config.sorts directly — the next filter
// edit would then persist the stale copy and silently revert the sort.)
export function FilterSortBar({
  collectionPageId,
  viewId,
  properties,
  viewConfig,
  readOnly = false,
}: FilterSortBarProps) {
  const updateView = useUpdateViewMutation(collectionPageId);
  const [localFilters, setLocalFilters] = useState<FilterDraft[]>(() =>
    ((viewConfig?.filters ?? []) as FilterCondition[]).map(withKey),
  );
  useEffect(() => {
    setLocalFilters(((viewConfig?.filters ?? []) as FilterCondition[]).map(withKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewId]);

  const filters = localFilters;
  const sorts = (viewConfig?.sorts ?? []) as SortSpec[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const persistFilters = (nextFilters: FilterDraft[]) => {
    updateView.mutate({
      id: viewId,
      config: buildViewConfig(nextFilters.map(stripKey), sorts, viewConfig),
    });
  };
  const persistSorts = (nextSorts: SortSpec[]) => {
    updateView.mutate({
      id: viewId,
      config: buildViewConfig(filters.map(stripKey), nextSorts, viewConfig),
    });
  };

  // Local-only add: a fresh condition has no value yet, so buildViewConfig
  // would strip it anyway — nothing to persist until it's completed.
  const addFilter = () => {
    if (readOnly) return;
    const first = properties[0];
    if (!first) return;
    setLocalFilters([
      ...filters,
      withKey({ propertyId: first.id, operator: operatorsForType(first.type)[0] }),
    ]);
  };
  // Discrete change (property/operator switch, select, checkbox, is_empty
  // toggle): update local state and persist immediately.
  const updateFilterAndPersist = (index: number, patch: Partial<FilterCondition>) => {
    const next = filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
    setLocalFilters(next);
    persistFilters(next);
  };
  // Draft change (value input typing): update local state only, no persist.
  const updateFilterLocal = (index: number, patch: Partial<FilterCondition>) =>
    setLocalFilters(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  const removeFilter = (index: number) => {
    const next = filters.filter((_, i) => i !== index);
    setLocalFilters(next);
    persistFilters(next);
  };

  const addSort = () => {
    if (readOnly) return;
    const first = properties[0];
    if (!first || sorts.length >= SORT_CAP) return;
    persistSorts([...sorts, { propertyId: first.id, direction: "asc" as const }]);
  };
  const updateSort = (index: number, patch: Partial<SortSpec>) => {
    persistSorts(sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const removeSort = (index: number) => {
    persistSorts(sorts.filter((_, i) => i !== index));
  };

  return (
    <Group gap="xs" px="md" py={4}>
      <Popover withinPortal position="bottom-start" shadow="md">
        <Popover.Target>
          <Button size="xs" variant="subtle" leftSection={<IconFilter size={14} />}>
            Filter{filters.length > 0 ? ` (${filters.length})` : ""}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs" miw={380}>
            {filters.map((f, i) => {
              const property = propertyById.get(f.propertyId);
              const ops = property ? operatorsForType(property.type) : [];
              return (
                <Group key={f._key} gap="xs" wrap="nowrap">
                  <Select
                    size="xs"
                    disabled={readOnly}
                    data={properties.map((p) => ({ value: p.id, label: p.name }))}
                    value={f.propertyId}
                    onChange={(v) => {
                      const prop = v ? propertyById.get(v) : undefined;
                      if (!v || !prop) return;
                      updateFilterAndPersist(i, {
                        propertyId: v,
                        operator: operatorsForType(prop.type)[0],
                        value: undefined,
                      });
                    }}
                  />
                  <Select
                    size="xs"
                    disabled={readOnly}
                    data={ops.map((op) => ({ value: op, label: OPERATOR_LABELS[op] ?? op }))}
                    value={f.operator}
                    onChange={(v) => v && updateFilterAndPersist(i, { operator: v, value: undefined })}
                  />
                  {property && !isEmptyOperator(f.operator) && (
                    <FilterValueInput
                      key={`${f.propertyId}-${f.operator}`}
                      property={property}
                      value={f.value}
                      disabled={readOnly}
                      onChange={(v) => updateFilterLocal(i, { value: v })}
                      onCommit={(v) => updateFilterAndPersist(i, { value: v })}
                    />
                  )}
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label="Remove filter"
                    disabled={readOnly}
                    onClick={() => removeFilter(i)}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
              );
            })}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconPlus size={14} />}
              disabled={readOnly || properties.length === 0}
              onClick={addFilter}
            >
              Add filter
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Popover withinPortal position="bottom-start" shadow="md">
        <Popover.Target>
          <Button size="xs" variant="subtle" leftSection={<IconArrowsSort size={14} />}>
            Sort{sorts.length > 0 ? ` (${sorts.length})` : ""}
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs" miw={300}>
            {sorts.map((s, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select
                  size="xs"
                  disabled={readOnly}
                  data={properties.map((p) => ({ value: p.id, label: p.name }))}
                  value={s.propertyId}
                  onChange={(v) => v && updateSort(i, { propertyId: v })}
                />
                <Select
                  size="xs"
                  disabled={readOnly}
                  data={[
                    { value: "asc", label: "Ascending" },
                    { value: "desc", label: "Descending" },
                  ]}
                  value={s.direction}
                  onChange={(v) => v && updateSort(i, { direction: v as "asc" | "desc" })}
                />
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Remove sort"
                  disabled={readOnly}
                  onClick={() => removeSort(i)}
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconPlus size={14} />}
              disabled={readOnly || sorts.length >= SORT_CAP || properties.length === 0}
              onClick={addSort}
            >
              Add sort
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}

function FilterValueInput({
  property,
  value,
  disabled,
  onChange,
  onCommit,
}: {
  property: ICollectionProperty;
  value: unknown;
  disabled?: boolean;
  // Local-only update — safe to call on every keystroke, never persists.
  onChange: (v: unknown) => void;
  // Persist now — final value, write it to the server.
  onCommit: (v: unknown) => void;
}) {
  switch (property.type) {
    case "number":
      return (
        <NumberInput
          size="xs"
          disabled={disabled}
          defaultValue={typeof value === "number" ? value : undefined}
          onBlur={(e) => onCommit(toCellValue("number", e.currentTarget.value))}
        />
      );
    case "date":
      // Bare 'YYYY-MM-DD' string end-to-end — same contract as the cell
      // editor's DateInput (see cell-editors/editable-cell.tsx). Mantine
      // parses partial keystrokes into dates, so onChange stays local-only
      // (draft) and only onBlur persists — otherwise every parseable
      // keystroke would write a transient wrong filter to the server.
      return (
        <DateInput
          size="xs"
          disabled={disabled}
          value={typeof value === "string" ? value : null}
          onChange={(d) => onChange(toCellValue("date", d))}
          onBlur={() => onCommit(value)}
        />
      );
    case "select": {
      const choices = property.typeOptions?.choices ?? [];
      return (
        <Select
          size="xs"
          disabled={disabled}
          data={choices.map((c: any) => ({ value: c.id, label: c.name }))}
          value={typeof value === "string" ? value : null}
          onChange={(v) => onCommit(toCellValue("select", v))}
        />
      );
    }
    case "checkbox":
      return (
        <Checkbox
          disabled={disabled}
          checked={value === true}
          onChange={(e) => onCommit(toCellValue("checkbox", e.currentTarget.checked))}
        />
      );
    case "text":
    case "title":
    default:
      return (
        <TextInput
          size="xs"
          disabled={disabled}
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => onCommit(toCellValue("text", e.currentTarget.value))}
        />
      );
  }
}
