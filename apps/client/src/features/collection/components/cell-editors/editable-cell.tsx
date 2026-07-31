import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { TextInput, NumberInput, Select, Checkbox, Badge } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  ICollectionProperty,
  ICollectionRow,
} from "@/features/collection/services/collection-service";
import { toCellValue } from "@/features/collection/components/cell-editors/to-cell-value";
import { useUpdateRowMutation } from "@/features/collection/queries/collection-query";
import { useUpdatePageMutation } from "@/features/page/queries/page-query";

interface EditableCellProps {
  row: ICollectionRow;
  property: ICollectionProperty;
  collectionPageId: string;
}

// Click-to-edit dispatcher for one cell. Commits on blur/Enter, cancels on
// Escape. Title writes through updatePage, which only invalidates the page
// itself (not the rows list), so we invalidate ["collection-rows", ...]
// ourselves on success. Every other type writes through updateRow, which
// already invalidates the rows list on its own.
export function EditableCell({ row, property, collectionPageId }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const updateRowMutation = useUpdateRowMutation(collectionPageId);
  const updatePageMutation = useUpdatePageMutation();
  const queryClient = useQueryClient();

  const commit = (raw: unknown) => {
    const value = toCellValue(property.type, raw);
    if (property.type === "title") {
      if (value !== row.title) {
        updatePageMutation.mutate(
          { pageId: row.pageId, title: value as string },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({
                queryKey: ["collection-rows", collectionPageId],
              });
            },
          },
        );
      }
    } else {
      updateRowMutation.mutate({ rowId: row.id, cells: { [property.id]: value } });
    }
    setEditing(false);
  };

  if (property.type === "title") {
    if (!editing) {
      return <span onClick={() => setEditing(true)}>{row.title}</span>;
    }
    return (
      <TextInput
        autoFocus
        defaultValue={row.title}
        size="xs"
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  const value = row.cells?.[property.id];

  switch (property.type) {
    case "checkbox":
      return (
        <Checkbox
          checked={!!value}
          onChange={(e) => commit(e.currentTarget.checked)}
        />
      );

    case "select": {
      const choices = property.typeOptions?.choices ?? [];
      if (!editing) {
        const choice = choices.find((c: any) => c.id === value);
        return (
          <span onClick={() => setEditing(true)}>
            {choice ? <Badge color={choice.color}>{choice.name}</Badge> : ""}
          </span>
        );
      }
      return (
        <Select
          autoFocus
          size="xs"
          data={choices.map((c: any) => ({ value: c.id, label: c.name }))}
          value={typeof value === "string" ? value : null}
          clearable
          onChange={(v) => commit(v)}
          onDropdownClose={() => setEditing(false)}
        />
      );
    }

    case "date": {
      // No Date object anywhere here — value is a bare 'YYYY-MM-DD' string
      // end-to-end, matching toCellValue's output and DateInput's own
      // string-based value/onChange. Constructing a Date from it would
      // reintroduce the UTC-midnight drift this fixes.
      if (!editing) {
        return (
          <span onClick={() => setEditing(true)}>
            {typeof value === "string" ? value : ""}
          </span>
        );
      }
      return (
        <DateInput
          autoFocus
          size="xs"
          value={typeof value === "string" ? value : null}
          onChange={(d) => commit(d)}
          onBlur={() => setEditing(false)}
        />
      );
    }

    case "number":
      if (!editing) {
        return (
          <span onClick={() => setEditing(true)}>
            {value === null || value === undefined ? "" : String(value)}
          </span>
        );
      }
      return (
        <NumberInput
          autoFocus
          size="xs"
          defaultValue={typeof value === "number" ? value : undefined}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      );

    case "text":
    default:
      if (!editing) {
        return (
          <span onClick={() => setEditing(true)}>
            {typeof value === "string" ? value : ""}
          </span>
        );
      }
      return (
        <TextInput
          autoFocus
          size="xs"
          defaultValue={typeof value === "string" ? value : ""}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      );
  }
}
