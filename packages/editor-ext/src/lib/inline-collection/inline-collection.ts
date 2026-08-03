import { Node, mergeAttributes } from '@tiptap/core';

export interface InlineCollectionOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineCollection: {
      insertInlineCollection: (attrs: { pageId: string | null }) => ReturnType;
    };
  }
}

// Schema only — no addNodeView here. The React NodeView is wired up
// client-side via .extend({ addNodeView }) so this stays importable
// by the server (which has no React runtime).
export const InlineCollection = Node.create<InlineCollectionOptions>({
  name: 'inlineCollection',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-page-id'),
        renderHTML: (attrs) =>
          attrs.pageId ? { 'data-page-id': attrs.pageId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="inline-collection"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'inline-collection',
      }),
    ];
  },

  addCommands() {
    return {
      insertInlineCollection:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
