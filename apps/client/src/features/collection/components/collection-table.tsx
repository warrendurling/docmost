import { useMemo, useRef } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader, Text, Checkbox, Badge } from "@mantine/core";
import {
  useCollectionInfoQuery,
  useRowsListQuery,
} from "@/features/collection/queries/collection-query";
import {
  ICollectionProperty,
  ICollectionRow,
} from "@/features/collection/services/collection-service";
import { buildColumns } from "@/features/collection/components/build-columns";

interface CollectionTableProps {
  collectionPageId: string;
  viewId: string;
}

const ROW_HEIGHT = 36;
const TABLE_MAX_HEIGHT = "calc(100vh - 220px)";

function renderCell(row: ICollectionRow, property: ICollectionProperty) {
  if (property.type === "title") {
    return row.title;
  }

  const value = row.cells?.[property.id];

  switch (property.type) {
    case "text":
      return typeof value === "string" ? value : "";
    case "number":
      return value === null || value === undefined ? "" : String(value);
    case "select": {
      const choices = property.typeOptions?.choices ?? [];
      const choice = choices.find((c: any) => c.id === value);
      if (!choice) return "";
      return <Badge color={choice.color}>{choice.name}</Badge>;
    }
    case "date":
      return value ? new Date(value).toLocaleDateString() : "";
    case "checkbox":
      return <Checkbox checked={!!value} disabled readOnly />;
    default:
      return "";
  }
}

export function CollectionTable({
  collectionPageId,
  viewId,
}: CollectionTableProps) {
  const { data: info, isLoading: infoLoading } =
    useCollectionInfoQuery(collectionPageId);
  const { data: rowsData, isLoading: rowsLoading } = useRowsListQuery(
    collectionPageId,
    viewId,
  );

  const view = info?.views.find((v) => v.id === viewId);
  const rows = rowsData?.rows ?? [];

  const builtColumns = useMemo(
    () => buildColumns(info?.properties ?? [], view?.config),
    [info?.properties, view?.config],
  );

  const columns = useMemo<ColumnDef<ICollectionRow>[]>(
    () =>
      builtColumns.map((col) => ({
        id: col.id,
        header: col.name,
        accessorFn: (row) => row.cells?.[col.propertyId],
        cell: ({ row }) =>
          renderCell(row.original, {
            id: col.propertyId,
            name: col.name,
            type: col.type,
            typeOptions: col.typeOptions,
            position: "",
          }),
      })),
    [builtColumns],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const tableRows = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (infoLoading || rowsLoading) {
    return <Loader size="sm" m="md" />;
  }

  if (rows.length === 0) {
    return (
      <Text c="dimmed" size="sm" m="md">
        No rows
      </Text>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalHeight - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div>
      <div style={{ display: "grid" }}>
        {table.getHeaderGroups().map((headerGroup) => (
          <div
            key={headerGroup.id}
            style={{
              display: "flex",
              position: "sticky",
              top: 0,
              zIndex: 1,
              background: "var(--mantine-color-body)",
              borderBottom: "1px solid var(--mantine-color-default-border)",
              fontWeight: 600,
            }}
          >
            {headerGroup.headers.map((header) => (
              <div key={header.id} style={{ flex: 1, padding: "8px 12px" }}>
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        ref={scrollRef}
        style={{ maxHeight: TABLE_MAX_HEIGHT, overflow: "auto" }}
      >
        <div style={{ height: paddingTop }} />
        {virtualItems.map((virtualRow) => {
          const row = tableRows[virtualRow.index];
          return (
            <div
              key={row.id}
              style={{
                display: "flex",
                height: ROW_HEIGHT,
                alignItems: "center",
                borderBottom: "1px solid var(--mantine-color-default-border)",
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id} style={{ flex: 1, padding: "0 12px" }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          );
        })}
        <div style={{ height: paddingBottom }} />
      </div>
    </div>
  );
}
