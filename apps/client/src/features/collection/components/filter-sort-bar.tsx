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

interface FilterSortBarProps {
  collectionPageId: string;
  viewId: string;
  properties: ICollectionProperty[];
  viewConfig: ICollectionView["config"];
}

// Writes filters/sorts into the view's config; the server (rows/list) does
// all actual filtering/sorting — this only has to produce a config shape it
// understands. See collection.service.ts applyRowFilter/applyRowSort.
export function FilterSortBar({
  collectionPageId,
  viewId,
  properties,
  viewConfig,
}: FilterSortBarProps) {
  const updateView = useUpdateViewMutation(collectionPageId);
  const filters = (viewConfig?.filters ?? []) as FilterCondition[];
  const sorts = (viewConfig?.sorts ?? []) as SortSpec[];
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  const commit = (nextFilters: FilterCondition[], nextSorts: SortSpec[]) => {
    updateView.mutate({
      id: viewId,
      config: buildViewConfig(nextFilters, nextSorts, viewConfig),
    });
  };

  const addFilter = () => {
    const first = properties[0];
    if (!first) return;
    commit(
      [...filters, { propertyId: first.id, operator: operatorsForType(first.type)[0] }],
      sorts,
    );
  };
  const updateFilter = (index: number, patch: Partial<FilterCondition>) =>
    commit(filters.map((f, i) => (i === index ? { ...f, ...patch } : f)), sorts);
  const removeFilter = (index: number) =>
    commit(filters.filter((_, i) => i !== index), sorts);

  const addSort = () => {
    const first = properties[0];
    if (!first || sorts.length >= SORT_CAP) return;
    commit(filters, [...sorts, { propertyId: first.id, direction: "asc" }]);
  };
  const updateSort = (index: number, patch: Partial<SortSpec>) =>
    commit(filters, sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const removeSort = (index: number) =>
    commit(filters, sorts.filter((_, i) => i !== index));

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
                <Group key={i} gap="xs" wrap="nowrap">
                  <Select
                    size="xs"
                    data={properties.map((p) => ({ value: p.id, label: p.name }))}
                    value={f.propertyId}
                    onChange={(v) => {
                      const prop = v ? propertyById.get(v) : undefined;
                      if (!v || !prop) return;
                      updateFilter(i, {
                        propertyId: v,
                        operator: operatorsForType(prop.type)[0],
                        value: undefined,
                      });
                    }}
                  />
                  <Select
                    size="xs"
                    data={ops.map((op) => ({ value: op, label: OPERATOR_LABELS[op] ?? op }))}
                    value={f.operator}
                    onChange={(v) => v && updateFilter(i, { operator: v, value: undefined })}
                  />
                  {property && !isEmptyOperator(f.operator) && (
                    <FilterValueInput
                      key={`${f.propertyId}-${f.operator}`}
                      property={property}
                      value={f.value}
                      onChange={(v) => updateFilter(i, { value: v })}
                    />
                  )}
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label="Remove filter"
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
              disabled={properties.length === 0}
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
                  data={properties.map((p) => ({ value: p.id, label: p.name }))}
                  value={s.propertyId}
                  onChange={(v) => v && updateSort(i, { propertyId: v })}
                />
                <Select
                  size="xs"
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
              disabled={sorts.length >= SORT_CAP || properties.length === 0}
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
  onChange,
}: {
  property: ICollectionProperty;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (property.type) {
    case "number":
      return (
        <NumberInput
          size="xs"
          defaultValue={typeof value === "number" ? value : undefined}
          onBlur={(e) => onChange(toCellValue("number", e.currentTarget.value))}
        />
      );
    case "date":
      // Bare 'YYYY-MM-DD' string end-to-end — same contract as the cell
      // editor's DateInput (see cell-editors/editable-cell.tsx).
      return (
        <DateInput
          size="xs"
          value={typeof value === "string" ? value : null}
          onChange={(d) => onChange(toCellValue("date", d))}
        />
      );
    case "select": {
      const choices = property.typeOptions?.choices ?? [];
      return (
        <Select
          size="xs"
          data={choices.map((c: any) => ({ value: c.id, label: c.name }))}
          value={typeof value === "string" ? value : null}
          onChange={(v) => onChange(toCellValue("select", v))}
        />
      );
    }
    case "checkbox":
      return (
        <Checkbox
          checked={value === true}
          onChange={(e) => onChange(toCellValue("checkbox", e.currentTarget.checked))}
        />
      );
    case "text":
    case "title":
    default:
      return (
        <TextInput
          size="xs"
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => onChange(toCellValue("text", e.currentTarget.value))}
        />
      );
  }
}
