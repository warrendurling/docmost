import { describe, it, expect } from "vitest";
import { operatorsForType, isEmptyOperator } from "./operators";

describe("operatorsForType", () => {
  it("text", () => {
    expect(operatorsForType("text")).toEqual([
      "contains",
      "equals",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("title", () => {
    expect(operatorsForType("title")).toEqual([
      "contains",
      "equals",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("number", () => {
    expect(operatorsForType("number")).toEqual([
      "equals",
      "not_equals",
      "gt",
      "gte",
      "lt",
      "lte",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("date", () => {
    expect(operatorsForType("date")).toEqual([
      "before",
      "after",
      "on",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("select", () => {
    expect(operatorsForType("select")).toEqual([
      "equals",
      "not_equals",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("checkbox", () => {
    expect(operatorsForType("checkbox")).toEqual(["equals"]);
  });
});

describe("isEmptyOperator", () => {
  it("true for is_empty / is_not_empty", () => {
    expect(isEmptyOperator("is_empty")).toBe(true);
    expect(isEmptyOperator("is_not_empty")).toBe(true);
  });

  it("false for other operators", () => {
    expect(isEmptyOperator("equals")).toBe(false);
    expect(isEmptyOperator("contains")).toBe(false);
    expect(isEmptyOperator("gt")).toBe(false);
  });
});
