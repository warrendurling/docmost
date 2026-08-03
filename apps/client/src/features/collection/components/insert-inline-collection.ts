import type { Editor, Range } from "@tiptap/core";
import { notifications } from "@mantine/notifications";
import { getPageById } from "@/features/page/services/page-service.ts";
import { createCollection } from "@/features/collection/services/collection-service";
import i18n from "@/i18n.ts";
import { getApiErrorMessage } from "@/lib/api-error";

export async function insertInlineCollection(
  editor: Editor,
  opts: { range?: Range } = {},
): Promise<void> {
  // @ts-ignore - editor.storage.pageId is set by the host editor (page-editor.tsx onCreate)
  const parentPageId = editor.storage?.pageId as string | undefined;
  if (!parentPageId) return;

  try {
    const hostPage = await getPageById({ pageId: parentPageId });

    const res = await createCollection({
      spaceId: hostPage.spaceId,
      title: "Database",
      parentPageId,
      isInline: true,
    });

    const chain = editor.chain().focus();
    if (opts.range) chain.deleteRange(opts.range);
    chain.insertInlineCollection({ pageId: res.database.id }).run();
  } catch (err) {
    notifications.show({
      message: getApiErrorMessage(err, i18n.t("Failed to create database")),
      color: "red",
    });
  }
}
