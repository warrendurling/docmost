import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RowPropertiesPanel } from "@/features/collection/components/row-properties-panel";
import {
  useRowContextQuery,
  useUpdateRowMutation,
} from "@/features/collection/queries/collection-query";
import { ICollectionRowContext } from "@/features/collection/services/collection-service";

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

// jsdom has no ResizeObserver; Mantine Select's dropdown ScrollArea needs it.
global.ResizeObserver =
  global.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

vi.mock("@/features/collection/queries/collection-query", () => ({
  useRowContextQuery: vi.fn(),
  useUpdateRowMutation: vi.fn(),
}));

const rowContext: ICollectionRowContext = {
  collectionPageId: "cpage1",
  rowId: "row1",
  title: "Row One",
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
    { id: "prop_notes", name: "Notes", type: "text", position: "c" },
  ],
  cells: { prop_status: "c1", prop_notes: "hello" },
};

function setup() {
  vi.mocked(useRowContextQuery).mockReturnValue({
    data: rowContext,
    isLoading: false,
  } as any);
  vi.mocked(useUpdateRowMutation).mockReturnValue({
    mutate: vi.fn(),
  } as any);

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <RowPropertiesPanel pageId="p1" />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe("RowPropertiesPanel", () => {
  it("renders a label + control per non-title property and skips the title property", () => {
    setup();

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.queryByText("Name")).toBeNull();
  });

  it("renders the select choice name for the row's value", () => {
    setup();

    expect(screen.getByDisplayValue("Todo")).toBeTruthy();
  });

  it("renders the text property's value in an input", () => {
    setup();

    const input = screen.getByDisplayValue("hello");
    expect(input).toBeTruthy();
  });
});
