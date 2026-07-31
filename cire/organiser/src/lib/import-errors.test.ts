import { describe, expect, it } from "vitest";

import { formatImportError } from "./import-errors";

/**
 * The contract these lock down: every locating field the API sends (reason, row,
 * column, sheet) reaches the organiser, and the message says what to change.
 * The regression being guarded is the original one — a 422 rendering as the bare
 * word "Malformed spreadsheet" for fourteen different problems.
 */
describe("formatImportError — malformed spreadsheet", () => {
  it("names the sheet, the row and the column", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "Start must be an ISO-8601 timestamp",
      row: 4,
      column: 2,
      sheet: "events",
    });
    expect(msg).toContain("events sheet");
    expect(msg).toContain("row 4");
    expect(msg).toContain("column 2");
    // And an example of the shape actually wanted, not just the format's name.
    expect(msg).toContain("2026-11-14T15:00+11:00");
  });

  it("warns that spreadsheet apps rewrite date cells (the most likely cause)", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "Start must be an ISO-8601 timestamp",
      row: 2,
      column: 2,
      sheet: "events",
    });
    expect(msg).toMatch(/excel|numbers|sheets/i);
  });

  it("explains an unterminated quote in terms of the file, not the parser", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "unterminated quoted cell",
      row: null,
      column: null,
      sheet: "events",
    });
    expect(msg).toContain("events sheet");
    expect(msg).toMatch(/quote/i);
    expect(msg).not.toBe("Malformed spreadsheet");
  });

  it("tells the organiser a 'blank' row is only skipped when every cell is empty", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "Guest First Name is required",
      row: 9,
      column: 3,
      sheet: "guests",
    });
    expect(msg).toContain("row 9");
    expect(msg).toContain("Guest First Name");
    expect(msg).toMatch(/every single cell/i);
  });

  it("falls back to the server's reason for one this build doesn't know", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "some future rule",
      row: 3,
      sheet: "guests",
    });
    expect(msg).toContain("some future rule");
    expect(msg).toContain("row 3");
  });

  it("omits the location entirely when the API gave none", () => {
    const msg = formatImportError(422, {
      error: "Malformed spreadsheet",
      reason: "empty events sheet",
    });
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("null");
    expect(msg).toMatch(/empty/i);
  });
});

describe("formatImportError — column problems", () => {
  it("quotes the missing column and points at the template", () => {
    const msg = formatImportError(422, {
      error: "Missing required column",
      column: "Event Name",
      sheet: "events",
    });
    expect(msg).toContain('"Event Name"');
    expect(msg).toContain("events sheet");
    expect(msg).toMatch(/template/i);
  });

  it("explains an unmatched event column and how to resolve it", () => {
    const msg = formatImportError(422, {
      error: "Unmatched event column",
      column: "Sangeet",
      sheet: "guests",
    });
    expect(msg).toContain('"Sangeet"');
    // The fix is order-of-operations: the event has to exist first.
    expect(msg).toMatch(/events sheet|Schedule tab/i);
  });

  it("says which characters trip the formula guard", () => {
    const msg = formatImportError(422, {
      error: "Formula-injection guard tripped",
      row: 5,
      column: 3,
      sheet: "events",
    });
    expect(msg).toContain("row 5");
    expect(msg).toContain("=");
  });
});

describe("formatImportError — non-parse failures", () => {
  it("explains a 409 as 'press Preview again'", () => {
    const msg = formatImportError(409, { error: "State changed — re-preview" });
    expect(msg).toMatch(/preview again/i);
  });

  it("gives the size limit on a 413", () => {
    const msg = formatImportError(413, { error: "Payload too large" });
    expect(msg).toMatch(/1 MB/i);
  });

  it("names the cap on a capacity 402", () => {
    const msg = formatImportError(402, { error: "payment_required", limit: 120, current: 118 });
    expect(msg).toContain("120");
  });

  it("falls back to the API error string, then the status", () => {
    expect(formatImportError(500, { error: "Storage error" })).toBe("Storage error");
    expect(formatImportError(503, {})).toBe("Request failed (503)");
  });
});
