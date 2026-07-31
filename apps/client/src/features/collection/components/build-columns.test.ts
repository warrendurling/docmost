import { describe, it, expect } from "vitest";
import { buildColumns } from "./build-columns";
import { ICollectionProperty } from "@/features/collection/services/collection-service";

const props: ICollectionProperty[] = [
  { id: "p1", name: "Title", type: "title", position: "a" },
  { id: "p2", name: "Status", type: "select", position: "b" },
  { id: "p3", name: "Due", type: "date", position: "c" },
];

describe("buildColumns", () => {
  it("orders by config.columnOrder when present", () => {
    const result = buildColumns(props, { columnOrder: ["p3", "p1", "p2"] });
    expect(result.map((c) => c.id)).toEqual(["p3", "p1", "p2"]);
  });

  it("falls back to property.position when columnOrder absent", () => {
    const result = buildColumns(props, undefined);
    expect(result.map((c) => c.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("omits ids listed in hiddenColumns", () => {
    const result = buildColumns(props, { hiddenColumns: ["p2"] });
    expect(result.map((c) => c.id)).toEqual(["p1", "p3"]);
  });

  it("tolerates a columnOrder/hiddenColumns id that no longer exists (no throw)", () => {
    expect(() =>
      buildColumns(props, {
        columnOrder: ["ghost", "p2", "p1"],
        hiddenColumns: ["also-ghost", "p3"],
      }),
    ).not.toThrow();
    const result = buildColumns(props, {
      columnOrder: ["ghost", "p2", "p1"],
      hiddenColumns: ["also-ghost", "p3"],
    });
    expect(result.map((c) => c.id)).toEqual(["p2", "p1"]);
  });

  it("sorts position fallback bytewise (matches Postgres collate \"C\"), not by localeCompare", () => {
    // localeCompare would put "aa" before "aA"; bytewise (0x41 < 0x61) puts "aA" first.
    const caseProps: ICollectionProperty[] = [
      { id: "p1", name: "A", type: "title", position: "aa" },
      { id: "p2", name: "B", type: "select", position: "aA" },
    ];
    const result = buildColumns(caseProps, undefined);
    expect(result.map((c) => c.id)).toEqual(["p2", "p1"]);
  });
});
