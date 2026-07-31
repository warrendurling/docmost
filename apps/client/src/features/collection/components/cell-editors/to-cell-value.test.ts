import { describe, it, expect } from "vitest";
import { toCellValue } from "@/features/collection/components/cell-editors/to-cell-value";

describe("toCellValue", () => {
  it("number: parses numeric strings", () => {
    expect(toCellValue("number", "42")).toBe(42);
  });
  it("number: empty -> null", () => {
    expect(toCellValue("number", "")).toBeNull();
  });
  it("number: non-numeric -> null", () => {
    expect(toCellValue("number", "abc")).toBeNull();
  });

  it("date: valid YYYY-MM-DD passes through as-is", () => {
    expect(toCellValue("date", "2026-01-15")).toBe("2026-01-15");
  });
  it("date: empty -> null", () => {
    expect(toCellValue("date", "")).toBeNull();
  });
  it("date: invalid -> null", () => {
    expect(toCellValue("date", "not-a-date")).toBeNull();
  });

  it("text: empty -> null", () => {
    expect(toCellValue("text", "")).toBeNull();
  });
  it("text: string passes through", () => {
    expect(toCellValue("text", "hello")).toBe("hello");
  });

  it("checkbox: stays boolean", () => {
    expect(toCellValue("checkbox", true)).toBe(true);
    expect(toCellValue("checkbox", false)).toBe(false);
  });

  it("select: id passes through", () => {
    expect(toCellValue("select", "choice1")).toBe("choice1");
  });
  it("select: empty -> null", () => {
    expect(toCellValue("select", "")).toBeNull();
  });

  it("title: empty string is preserved, not nulled", () => {
    expect(toCellValue("title", "")).toBe("");
    expect(toCellValue("title", "My Page")).toBe("My Page");
  });
});
