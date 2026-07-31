// Note: @testing-library/jest-dom is broken in this pnpm store (ESM chunk
// does `import 'lodash/isEqualWith'` without the .js extension lodash's
// package.json exports map requires) — skip its matchers, plain
// getByText/queryByText + .checked assertions cover the same ground.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { CollectionTable } from "@/features/collection/components/collection-table";
import {
  useCollectionInfoQuery,
  useRowsListQuery,
  useUpdateRowMutation,
  useCreateRowMutation,
  useDeleteRowMutation,
  useCreatePropertyMutation,
  useUpdatePropertyMutation,
  useDeletePropertyMutation,
  useUpdateViewMutation,
} from "@/features/collection/queries/collection-query";
import {
  ICollectionInfo,
  ICollectionRow,
} from "@/features/collection/services/collection-service";
import { useUpdatePageMutation } from "@/features/page/queries/page-query";

// jsdom has no matchMedia; MantineProvider's color-scheme effect needs it.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

vi.mock("@/features/collection/queries/collection-query", () => ({
  useCollectionInfoQuery: vi.fn(),
  useRowsListQuery: vi.fn(),
  useUpdateRowMutation: vi.fn(),
  useCreateRowMutation: vi.fn(),
  useDeleteRowMutation: vi.fn(),
  useCreatePropertyMutation: vi.fn(),
  useUpdatePropertyMutation: vi.fn(),
  useDeletePropertyMutation: vi.fn(),
  useUpdateViewMutation: vi.fn(),
}));

vi.mock("@/features/page/queries/page-query", () => ({
  useUpdatePageMutation: vi.fn(),
}));

// jsdom never lays out elements, so the real virtualizer computes an
// outerSize of 0 and renders nothing. Stub it with a trivial "render
// everything" implementation just for this test.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => {
    const items = Array.from({ length: options.count }, (_, index) => ({
      index,
      start: index * 36,
      end: index * 36 + 36,
      key: index,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => options.count * 36,
    };
  },
}));

const info: ICollectionInfo = {
  database: {},
  properties: [
    { id: "title", name: "Name", type: "title", position: "a" },
    {
      id: "prop_status",
      name: "Status",
      type: "select",
      position: "b",
      typeOptions: {
        choices: [
          { id: "c1", name: "Todo", color: "blue" },
          { id: "c2", name: "Done", color: "green" },
        ],
      },
    },
    { id: "prop_active", name: "Active", type: "checkbox", position: "c" },
    { id: "prop_notes", name: "Notes", type: "text", position: "d" },
  ],
  views: [
    { id: "view1", type: "table", name: "Default", config: {}, position: "a" },
  ],
};

const rows: ICollectionRow[] = [
  {
    id: "row1",
    pageId: "p1",
    title: "Row One",
    cells: { prop_status: "c1", prop_active: true, prop_notes: "hello" },
    position: "a",
  },
  {
    id: "row2",
    pageId: "p2",
    title: "Row Two",
    // select cell points at a choice id that no longer exists on the
    // property (property deleted/renamed) — should render blank, not throw.
    cells: {
      prop_status: "deleted-choice-id",
      prop_active: false,
      prop_notes: "world",
    },
    position: "b",
  },
];

describe("CollectionTable", () => {
  it("renders headers, row values, select choice names, checkbox state, and tolerates a deleted choice", () => {
    vi.mocked(useCollectionInfoQuery).mockReturnValue({
      data: info,
      isLoading: false,
    } as any);
    vi.mocked(useRowsListQuery).mockReturnValue({
      data: { rows },
      isLoading: false,
    } as any);
    vi.mocked(useUpdateRowMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);
    vi.mocked(useCreateRowMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as any);
    vi.mocked(useDeleteRowMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as any);
    vi.mocked(useUpdatePageMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);
    vi.mocked(useCreatePropertyMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);
    vi.mocked(useUpdatePropertyMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);
    vi.mocked(useDeletePropertyMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);
    vi.mocked(useUpdateViewMutation).mockReturnValue({
      mutate: vi.fn(),
    } as any);

    render(
      <MantineProvider>
        <CollectionTable collectionPageId="page1" viewId="view1" />
      </MantineProvider>,
    );

    // column headers, by property name
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();

    // row title text
    expect(screen.getByText("Row One")).toBeTruthy();
    expect(screen.getByText("Row Two")).toBeTruthy();

    // select cell renders the choice name, not the raw id
    expect(screen.getByText("Todo")).toBeTruthy();
    expect(screen.queryByText("deleted-choice-id")).toBeNull();

    // checkbox cells reflect the row's boolean value
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });

  it("calls createRow with collectionPageId when the New button is clicked", () => {
    vi.mocked(useCollectionInfoQuery).mockReturnValue({
      data: info,
      isLoading: false,
    } as any);
    vi.mocked(useRowsListQuery).mockReturnValue({
      data: { rows },
      isLoading: false,
    } as any);
    vi.mocked(useUpdateRowMutation).mockReturnValue({ mutate: vi.fn() } as any);
    const mockCreateMutate = vi.fn();
    vi.mocked(useCreateRowMutation).mockReturnValue({
      mutate: mockCreateMutate,
      isPending: false,
    } as any);
    vi.mocked(useDeleteRowMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as any);
    vi.mocked(useUpdatePageMutation).mockReturnValue({ mutate: vi.fn() } as any);
    vi.mocked(useCreatePropertyMutation).mockReturnValue({ mutate: vi.fn() } as any);
    vi.mocked(useUpdatePropertyMutation).mockReturnValue({ mutate: vi.fn() } as any);
    vi.mocked(useDeletePropertyMutation).mockReturnValue({ mutate: vi.fn() } as any);
    vi.mocked(useUpdateViewMutation).mockReturnValue({ mutate: vi.fn() } as any);

    render(
      <MantineProvider>
        <CollectionTable collectionPageId="page1" viewId="view1" />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByText("New"));

    expect(mockCreateMutate).toHaveBeenCalledWith({ collectionPageId: "page1" });
  });
});
