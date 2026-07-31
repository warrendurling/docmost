import { describe, it, expect } from "vitest";
import { reorderColumns } from "@/features/collection/components/reorder-columns";

describe("reorderColumns", () => {
  it("moves a column right", () => {
    expect(reorderColumns(["a", "b", "c", "d"], ["a", "b", "c", "d"], "a", "c")).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("moves a column left", () => {
    expect(reorderColumns(["a", "b", "c", "d"], ["a", "b", "c", "d"], "d", "b")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("falls back to allPropertyIds order when currentOrder is empty", () => {
    expect(reorderColumns([], ["x", "y", "z"], "x", "z")).toEqual(["y", "x", "z"]);
  });

  it("is a no-op when moving to the same spot", () => {
    expect(reorderColumns(["a", "b", "c"], ["a", "b", "c"], "b", "b")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("tolerates an unknown id and returns the base order unchanged", () => {
    expect(reorderColumns(["a", "b", "c"], ["a", "b", "c"], "a", "zzz")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(reorderColumns(["a", "b", "c"], ["a", "b", "c"], "zzz", "b")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
