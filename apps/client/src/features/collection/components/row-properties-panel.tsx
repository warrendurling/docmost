import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, Group, Text, TextInput, NumberInput, Select, Checkbox, Badge } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { ICollectionProperty } from "@/features/collection/services/collection-service";
import { toCellValue } from "@/features/collection/components/cell-editors/to-cell-value";
import {
  useRowContextQuery,
  useUpdateRowMutation,
} from "@/features/collection/queries/collection-query";

interface RowPropertiesPanelProps {
  pageId: string;
  readOnly?: boolean;
}

// Same buffer-then-commit-on-blur fix as the table's DateCellEditor —
// DateInput fires onChange on the first parseable keystroke.
function DateValueEditor({
  initialValue,
  onCommit,
}: {
  initialValue: string | null;
  onCommit: (raw: unknown) => void;
}) {
  const [localValue, setLocalValue] = useState<string | null>(initialValue);
  return (
    <DateInput
      size="xs"
      value={localValue}
      onChange={setLocalValue}
      onBlur={() => onCommit(localValue)}
    />
  );
}

function PropertyValueEditor({
  property,
  value,
  readOnly,
  onCommit,
}: {
  property: ICollectionProperty;
  value: unknown;
  readOnly: boolean;
  onCommit: (raw: unknown) => void;
}) {
  if (property.type === "select") {
    const choices = property.typeOptions?.choices ?? [];
    if (readOnly) {
      const choice = choices.find((c: any) => c.id === value);
      return choice ? <Badge color={choice.color}>{choice.name}</Badge> : <Text c="dimmed" size="sm">—</Text>;
    }
    return (
      <Select
        size="xs"
        data={choices.map((c: any) => ({ value: c.id, label: c.name }))}
        value={typeof value === "string" ? value : null}
        clearable
        onChange={(v) => onCommit(v)}
      />
    );
  }

  if (property.type === "checkbox") {
    return (
      <Checkbox
        checked={!!value}
        disabled={readOnly}
        onChange={(e) => onCommit(e.currentTarget.checked)}
      />
    );
  }

  if (property.type === "date") {
    const dateValue = typeof value === "string" ? value : null;
    if (readOnly) {
      return <Text size="sm">{dateValue ?? "—"}</Text>;
    }
    return <DateValueEditor initialValue={dateValue} onCommit={onCommit} />;
  }

  if (property.type === "number") {
    if (readOnly) {
      return <Text size="sm">{value === null || value === undefined ? "—" : String(value)}</Text>;
    }
    return (
      <NumberInput
        size="xs"
        defaultValue={typeof value === "number" ? value : undefined}
        onBlur={(e) => onCommit(e.currentTarget.value)}
      />
    );
  }

  // text
  if (readOnly) {
    return <Text size="sm">{typeof value === "string" ? value : "—"}</Text>;
  }
  return (
    <TextInput
      size="xs"
      defaultValue={typeof value === "string" ? value : ""}
      onBlur={(e) => onCommit(e.currentTarget.value)}
    />
  );
}

// Properties panel for a collection row's own page: renders the database's
// non-title properties with this row's values, editable inline. Title is
// NOT shown here — it's handled by the page's own title editor.
export function RowPropertiesPanel({ pageId, readOnly = false }: RowPropertiesPanelProps) {
  const { data, isLoading } = useRowContextQuery(pageId);
  const queryClient = useQueryClient();
  const updateRowMutation = useUpdateRowMutation(data?.collectionPageId ?? "");

  if (isLoading || !data) {
    return null;
  }

  const properties = data.properties.filter(
    (p) => p.type !== "title" && !(p as any).is_primary,
  );

  if (properties.length === 0) {
    return null;
  }

  const commit = (property: ICollectionProperty, raw: unknown) => {
    const value = toCellValue(property.type, raw);
    updateRowMutation.mutate(
      { rowId: data.rowId, cells: { [property.id]: value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["collection-row", pageId] });
        },
      },
    );
  };

  return (
    <Stack gap={4} px={0} py="sm">
      {properties.map((property) => (
        <Group key={property.id} gap="sm" wrap="nowrap">
          <Text size="sm" c="dimmed" w={140} style={{ flexShrink: 0 }}>
            {property.name}
          </Text>
          <PropertyValueEditor
            property={property}
            value={data.cells?.[property.id]}
            readOnly={readOnly}
            onCommit={(raw) => commit(property, raw)}
          />
        </Group>
      ))}
    </Stack>
  );
}
