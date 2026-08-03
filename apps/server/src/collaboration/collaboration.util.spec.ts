import { jsonToHtml, jsonToText, jsonToNode, tiptapExtensions } from './collaboration.util';
import { InlineCollection } from '@docmost/editor-ext';

describe('inlineCollection node registration', () => {
  const pageId = '11111111-1111-1111-1111-111111111111';
  const doc = {
    type: 'doc',
    content: [{ type: 'inlineCollection', attrs: { pageId } }],
  };

  it('is registered in tiptapExtensions', () => {
    expect(tiptapExtensions).toContain(InlineCollection);
  });

  it('serializes to HTML without throwing', () => {
    const html = jsonToHtml(doc);
    expect(html).toContain('data-type="inline-collection"');
    expect(html).toContain(`data-page-id="${pageId}"`);
  });

  it('converts to plain text without throwing', () => {
    expect(() => jsonToText(doc)).not.toThrow();
  });

  it('constructs a prosemirror node without throwing', () => {
    const node = jsonToNode(doc);
    expect(node).toBeDefined();
    expect(node.content.firstChild.type.name).toBe('inlineCollection');
  });
});
