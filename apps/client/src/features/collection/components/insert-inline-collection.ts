import type { Editor, Range } from "@tiptap/core";
import { v7 as uuid7 } from "uuid";
import { notifications } from "@mantine/notifications";
import { getPageById } from "@/features/page/services/page-service.ts";
import { createCollection } from "@/features/collection/services/collection-service";
import i18n from "@/i18n.ts";
import { getApiErrorMessage } from "@/lib/api-error";

function findInlineCollectionPlaceholderPos(
  editor: Editor,
  pendingKey: string,
): number | null {
  let foundPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (
      node.type.name === "inlineCollection" &&
      node.attrs.pendingKey === pendingKey
    ) {
      foundPos = pos;
      return false;
    }
    return true;
  });
  return foundPos;
}

export async function insertInlineCollection(
  editor: Editor,
  opts: { range?: Range } = {},
): Promise<void> {
  // @ts-ignore - editor.storage.pageId is set by the host editor (page-editor.tsx onCreate)
  const parentPageId = editor.storage?.pageId as string | undefined;
  if (!parentPageId) return;

  const pendingKey = uuid7();

  const chain = editor.chain().focus();
  if (opts.range) chain.deleteRange(opts.range);
  chain.insertInlineCollection({ pageId: null, pendingKey }).run();

  try {
    const hostPage = await getPageById({ pageId: parentPageId });

    const res = await createCollection({
      spaceId: hostPage.spaceId,
      title: "Database",
      parentPageId,
      isInline: true,
    });

    const pos = findInlineCollectionPlaceholderPos(editor, pendingKey);
    if (pos === null) return;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, {
          pageId: res.database.id,
          pendingKey: null,
        });
        return true;
      })
      .run();
  } catch (err) {
    const pos = findInlineCollectionPlaceholderPos(editor, pendingKey);
    if (pos !== null) {
      editor
        .chain()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos);
          if (node) tr.delete(pos, pos + node.nodeSize);
          return true;
        })
        .run();
    }
    notifications.show({
      message: getApiErrorMessage(err, i18n.t("Failed to create database")),
      color: "red",
    });
  }
}
