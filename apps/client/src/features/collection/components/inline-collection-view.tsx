import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { Box, Text } from "@mantine/core";
import { useCollectionInfoQuery } from "@/features/collection/queries/collection-query";
import { CollectionTable } from "@/features/collection/components/collection-table";

// Bounded height so the table's virtualizer has a definite size to measure
// inside a document flow (it has no full-viewport flex parent here, unlike
// the standalone collection page).
const INLINE_TABLE_HEIGHT = 480;

export function InlineCollectionView({ node, editor }: NodeViewProps) {
  const pageId = node.attrs.pageId as string | null;
  const pendingKey = node.attrs.pendingKey as string | null;
  // Suppress the query while insertInlineCollection awaits the
  // server-assigned pageId; useCollectionInfoQuery would otherwise fire
  // with an empty key.
  const { data: info, isLoading, isError } = useCollectionInfoQuery(
    pendingKey ? "" : pageId ?? "",
  );
  const viewId = info?.views?.[0]?.id;

  let content: React.ReactNode;
  if (pendingKey) {
    content = (
      <Box p="md">
        <Text c="dimmed">Creating database...</Text>
      </Box>
    );
  } else if (!pageId) {
    content = (
      <Box p="md">
        <Text c="red">Invalid database (missing page id)</Text>
      </Box>
    );
  } else if (isLoading) {
    content = (
      <Box p="md">
        <Text c="dimmed">Loading...</Text>
      </Box>
    );
  } else if (isError || !viewId) {
    content = (
      <Box p="md" bg="gray.0" style={{ borderRadius: 8 }}>
        <Text c="dimmed">You don't have access to this database.</Text>
      </Box>
    );
  } else {
    content = (
      <div
        style={{
          height: INLINE_TABLE_HEIGHT,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--mantine-color-gray-3)",
          borderRadius: 8,
        }}
      >
        <CollectionTable
          collectionPageId={pageId}
          viewId={viewId}
          readOnly={!editor.isEditable}
        />
      </div>
    );
  }

  return (
    <NodeViewWrapper contentEditable={false}>{content}</NodeViewWrapper>
  );
}
