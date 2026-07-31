import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef,
  Header,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Button, Loader, Text } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  useCollectionInfoQuery,
  useCreateRowMutation,
  useDeleteRowMutation,
  useRowsListQuery,
  useUpdateViewMutation,
} from "@/features/collection/queries/collection-query";
import {
  ICollectionInfo,
  ICollectionRow,
  ICollectionView,
} from "@/features/collection/services/collection-service";
import { buildColumns, IBuiltColumn } from "@/features/collection/components/build-columns";
import { EditableCell } from "@/features/collection/components/cell-editors/editable-cell";
import { ColumnHeaderMenu } from "@/features/collection/components/column-header-menu";
import { reorderColumns } from "@/features/collection/components/reorder-columns";
import { FilterSortBar } from "@/features/collection/components/filter-sort-bar";

interface CollectionTableProps {
  collectionPageId: string;
  viewId: string;
  readOnly?: boolean;
}

const ROW_HEIGHT = 36;
const TABLE_MAX_HEIGHT = "calc(100vh - 220px)";
const COLUMN_DRAG_TYPE = "collection-column";

function ColumnHeaderCell({
  header,
  col,
  collectionPageId,
  viewId,
  viewConfig,
  onReorder,
  readOnly,
}: {
  header: Header<ICollectionRow, unknown>;
  col: IBuiltColumn | undefined;
  collectionPageId: string;
  viewId: string;
  viewConfig: ICollectionView["config"];
  onReorder: (fromId: string, toId: string) => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: COLUMN_DRAG_TYPE, columnId: header.column.id }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === COLUMN_DRAG_TYPE &&
          source.data.columnId !== header.column.id,
        onDrop: ({ source }) => {
          onReorder(source.data.columnId as string, header.column.id);
        },
      }),
    );
  }, [header.column.id, onReorder]);

  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        padding: "8px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        cursor: "grab",
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
      {col && (
        <ColumnHeaderMenu
          collectionPageId={collectionPageId}
          viewId={viewId}
          viewConfig={viewConfig}
          property={{ id: col.propertyId, name: col.name, type: col.type }}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

export function CollectionTable({
  collectionPageId,
  viewId,
  readOnly = false,
}: CollectionTableProps) {
  const queryClient = useQueryClient();
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
  const builtColumnsById = useMemo(
    () => new Map(builtColumns.map((c) => [c.id, c])),
    [builtColumns],
  );

  const updateViewMutation = useUpdateViewMutation(collectionPageId);
  const createRowMutation = useCreateRowMutation(collectionPageId);
  const deleteRowMutation = useDeleteRowMutation(collectionPageId);

  const handleAddRow = () => {
    createRowMutation.mutate({ collectionPageId });
  };

  const handleDeleteRow = (rowId: string) => {
    if (window.confirm("Delete this row? This cannot be undone.")) {
      deleteRowMutation.mutate({ rowId });
    }
  };

  const allPropertyIds = useMemo(
    () => (info?.properties ?? []).map((p) => p.id),
    [info?.properties],
  );
  const columnOrder = view?.config?.columnOrder ?? [];
  const handleColumnReorder = useCallback(
    (fromId: string, toId: string) => {
      const newOrder = reorderColumns(columnOrder, allPropertyIds, fromId, toId);
      // ponytail: read the freshest cached config instead of the render-captured
      // view?.config to narrow (not close) the stale-write race with other
      // concurrent config edits (e.g. column sort). Full fix = optimistic
      // cache updates.
      const freshConfig = queryClient.getQueryData<ICollectionInfo>([
        "collection-info",
        collectionPageId,
      ])?.views.find((v) => v.id === viewId)?.config;
      updateViewMutation.mutate({
        id: viewId,
        config: { ...(freshConfig ?? view?.config), columnOrder: newOrder },
      });
    },
    [
      columnOrder,
      allPropertyIds,
      view?.config,
      viewId,
      updateViewMutation,
      queryClient,
      collectionPageId,
    ],
  );

  const columns = useMemo<ColumnDef<ICollectionRow>[]>(
    () =>
      builtColumns.map((col) => ({
        id: col.id,
        header: col.name,
        accessorFn: (row) => row.cells?.[col.propertyId],
        cell: ({ row }) => (
          <EditableCell
            row={row.original}
            property={{
              id: col.propertyId,
              name: col.name,
              type: col.type,
              typeOptions: col.typeOptions,
              position: "",
            }}
            collectionPageId={collectionPageId}
            readOnly={readOnly}
          />
        ),
      })),
    [builtColumns, collectionPageId, readOnly],
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

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalHeight - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div>
      <FilterSortBar
        collectionPageId={collectionPageId}
        viewId={viewId}
        properties={info?.properties ?? []}
        viewConfig={view?.config}
        readOnly={readOnly}
      />
      {!readOnly && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "6px 12px",
          }}
        >
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconPlus size={14} />}
            loading={createRowMutation.isPending}
            onClick={handleAddRow}
          >
            New
          </Button>
        </div>
      )}
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
              <ColumnHeaderCell
                key={header.id}
                header={header}
                col={builtColumnsById.get(header.column.id)}
                collectionPageId={collectionPageId}
                viewId={viewId}
                viewConfig={view?.config}
                onReorder={handleColumnReorder}
                readOnly={readOnly}
              />
            ))}
            <div style={{ width: 14 + 16, marginRight: 8, flexShrink: 0 }} />
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <Text c="dimmed" size="sm" m="md">
          No rows
        </Text>
      ) : (
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
                {!readOnly && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Delete row"
                    style={{ marginRight: 8, flexShrink: 0 }}
                    onClick={() => handleDeleteRow(row.original.id)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </div>
            );
          })}
          <div style={{ height: paddingBottom }} />
        </div>
      )}
    </div>
  );
}
