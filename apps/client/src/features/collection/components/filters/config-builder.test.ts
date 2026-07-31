import { describe, it, expect } from "vitest";
import { buildViewConfig } from "./config-builder";

describe("buildViewConfig", () => {
  it("caps sorts at 5", () => {
    const sorts = Array.from({ length: 7 }, (_, i) => ({
      propertyId: `p${i}`,
      direction: "asc" as const,
    }));
    const result = buildViewConfig([], sorts, {});
    expect(result.sorts).toHaveLength(5);
  });

  it("drops filter conditions with no propertyId", () => {
    const result = buildViewConfig(
      [{ propertyId: "", operator: "equals", value: "x" }],
      [],
      {},
    );
    expect(result.filters).toEqual([]);
  });

  it("drops non-empty-operator conditions with no value", () => {
    const result = buildViewConfig(
      [{ propertyId: "p1", operator: "equals", value: undefined }],
      [],
      {},
    );
    expect(result.filters).toEqual([]);
  });

  it("keeps is_empty/is_not_empty conditions without a value", () => {
    const result = buildViewConfig(
      [{ propertyId: "p1", operator: "is_empty" }],
      [],
      {},
    );
    expect(result.filters).toEqual([{ propertyId: "p1", operator: "is_empty" }]);
  });

  it("preserves base config fields (columnOrder, hiddenColumns)", () => {
    const result = buildViewConfig([], [], {
      columnOrder: ["a", "b"],
      hiddenColumns: ["c"],
    });
    expect(result.columnOrder).toEqual(["a", "b"]);
    expect(result.hiddenColumns).toEqual(["c"]);
  });
});
