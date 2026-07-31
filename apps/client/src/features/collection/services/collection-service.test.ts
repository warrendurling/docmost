import { describe, it, expect, vi } from "vitest";

const postMock = vi.fn();
vi.mock("@/lib/api-client", () => ({
  default: { post: (...args: any[]) => postMock(...args) },
}));

import {
  listRows,
  updateRow,
  createProperty,
  updateView,
} from "./collection-service";

describe("collection-service", () => {
  it("listRows posts collections/rows/list with collectionPageId + viewId", async () => {
    postMock.mockResolvedValue({ data: { rows: [] } });
    await listRows({ collectionPageId: "cp1", viewId: "v1" });
    expect(postMock).toHaveBeenCalledWith("/collections/rows/list", {
      collectionPageId: "cp1",
      viewId: "v1",
    });
  });

  it("updateRow posts collections/rows/update with rowId + cells", async () => {
    postMock.mockResolvedValue({ data: {} });
    await updateRow({ rowId: "r1", cells: { p1: "hello" } });
    expect(postMock).toHaveBeenCalledWith("/collections/rows/update", {
      rowId: "r1",
      cells: { p1: "hello" },
    });
  });

  it("createProperty posts collections/properties/create with body", async () => {
    postMock.mockResolvedValue({ data: {} });
    await createProperty({
      collectionPageId: "cp1",
      name: "Status",
      type: "select",
    });
    expect(postMock).toHaveBeenCalledWith("/collections/properties/create", {
      collectionPageId: "cp1",
      name: "Status",
      type: "select",
    });
  });

  it("updateView posts collections/views/update with body", async () => {
    postMock.mockResolvedValue({ data: {} });
    await updateView({ id: "v1", name: "Board" });
    expect(postMock).toHaveBeenCalledWith("/collections/views/update", {
      id: "v1",
      name: "Board",
    });
  });
});
