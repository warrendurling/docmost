import { CollectionPropertyType } from "@/features/collection/services/collection-service";

// Pure: normalises raw editor input into the value sent in updateRow's
// cells[] map (or the title string, for type "title"). Empty/invalid input
// becomes null so the server clears the cell instead of storing garbage.
export function toCellValue(
  type: CollectionPropertyType,
  rawInput: unknown,
): string | number | boolean | null {
  switch (type) {
    case "number": {
      if (rawInput === "" || rawInput === null || rawInput === undefined) {
        return null;
      }
      const n = typeof rawInput === "number" ? rawInput : Number(rawInput);
      return Number.isNaN(n) ? null : n;
    }
    case "date": {
      // Stored/sent as a bare 'YYYY-MM-DD' string (server's ISO_DATE_RE
      // accepts this). Never construct a Date here — `new Date('YYYY-MM-DD')`
      // parses as UTC midnight, which drifts a day for negative-offset users
      // on both commit and display.
      if (typeof rawInput !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawInput)) {
        return null;
      }
      return rawInput;
    }
    case "select": {
      if (typeof rawInput !== "string" || rawInput === "") return null;
      return rawInput;
    }
    case "checkbox":
      return !!rawInput;
    case "title":
      // Titles go through updatePage, which takes a plain (possibly empty)
      // string — never null.
      return typeof rawInput === "string" ? rawInput : "";
    case "text":
    default: {
      if (typeof rawInput !== "string" || rawInput === "") return null;
      return rawInput;
    }
  }
}
