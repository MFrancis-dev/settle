import { describe, expect, it } from "vitest";

// Roadmap: S1.2
import {
  computeInvoice,
  formatInvoiceNumber,
  isInvoiceNumber,
  lineAmount,
  nextInvoiceNumber,
  quantityTicks,
} from "./invoice";

describe("invoice: quantityTicks", () => {
  it("scales a quantity to 4-decimal ticks", () => {
    expect(quantityTicks("1")).toBe(10_000n);
    expect(quantityTicks("2.5")).toBe(25_000n);
    expect(quantityTicks("0.0001")).toBe(1n);
    expect(quantityTicks("0")).toBe(0n);
    expect(quantityTicks("007.1230")).toBe(71_230n);
  });

  it("rejects more precision than the column holds", () => {
    for (const bad of ["0.00001", "-1", "1e3", ".5", "", "abc"]) {
      expect(() => quantityTicks(bad), bad).toThrow(TypeError);
    }
  });
});

describe("invoice: lineAmount", () => {
  it("multiplies exactly when the product fits", () => {
    expect(lineAmount("2.5", "1000000")).toBe("2500000");
    expect(lineAmount("0", "1000000")).toBe("0");
    expect(lineAmount("1", "1")).toBe("1");
    expect(lineAmount("3", "333333")).toBe("999999");
  });

  it("rounds half-up when it does not", () => {
    // 0.5 × 1 base unit = 0.5 base unit → 1, not 0 and not banker's rounding.
    expect(lineAmount("0.5", "1")).toBe("1");
    expect(lineAmount("1.5", "1")).toBe("2");
    expect(lineAmount("0.4", "1")).toBe("0");
    // 0.3333 × 3 = 0.9999 → 1, and a true tie 0.5 × 3 = 1.5 → 2.
    expect(lineAmount("0.3333", "3")).toBe("1");
    expect(lineAmount("0.5", "3")).toBe("2");
  });

  it("keeps large values exact", () => {
    expect(lineAmount("1000000.25", "1000000000000000000")).toBe("1000000250000000000000000");
  });

  it("refuses a price that is not base units", () => {
    expect(() => lineAmount("1", "1.5")).toThrow(TypeError);
    expect(() => lineAmount("1", "-1")).toThrow(TypeError);
  });
});

describe("invoice: computeInvoice", () => {
  it("totals the rounded lines, not the raw quantities", () => {
    const { lines, total } = computeInvoice([
      { description: "A", quantity: "0.5", unitPrice: "1" },
      { description: "B", quantity: "0.5", unitPrice: "1" },
      { description: "C", quantity: "0.4", unitPrice: "1" },
    ]);
    expect(lines.map((line) => line.amount)).toEqual(["1", "1", "0"]);
    // Summing the raw quantities (1.4) would round to 1; the client owes the sum of lines.
    expect(total).toBe("2");
  });

  it("passes the input fields through untouched", () => {
    const { lines } = computeInvoice([{ description: "Design", quantity: "3", unitPrice: "250" }]);
    expect(lines).toEqual([
      { description: "Design", quantity: "3", unitPrice: "250", amount: "750" },
    ]);
  });

  it("handles a single zero base unit and a large invoice", () => {
    expect(computeInvoice([{ description: "x", quantity: "1", unitPrice: "1" }]).total).toBe("1");
    expect(computeInvoice([{ description: "x", quantity: "0", unitPrice: "1" }]).total).toBe("0");
    const many = Array.from({ length: 50 }, () => ({
      description: "line",
      quantity: "1.5",
      unitPrice: "1000000",
    }));
    // 1.5 × 1e6 = 1.5e6 exactly; 50 lines → 75e6.
    expect(computeInvoice(many).total).toBe("75000000");
  });

  it("refuses an invoice with no lines", () => {
    expect(() => computeInvoice([])).toThrow(RangeError);
  });
});

describe("invoice: numbering", () => {
  it("starts at INV-0001 for a user with no invoices", () => {
    expect(nextInvoiceNumber([])).toBe("INV-0001");
  });

  it("follows the highest number a user already has", () => {
    expect(nextInvoiceNumber(["INV-0001"])).toBe("INV-0002");
    expect(nextInvoiceNumber(["INV-0001", "INV-0007", "INV-0003"])).toBe("INV-0008");
  });

  it("ignores anything that is not a numbered invoice", () => {
    expect(nextInvoiceNumber(["INV-0001", "INV-3", "abc", ""])).toBe("INV-0002");
  });

  it("grows past four digits without truncating", () => {
    expect(nextInvoiceNumber(["INV-9999"])).toBe("INV-10000");
    expect(nextInvoiceNumber(["INV-12345"])).toBe("INV-12346");
  });

  it("formats and recognises numbers", () => {
    expect(formatInvoiceNumber(1n)).toBe("INV-0001");
    expect(formatInvoiceNumber(42n)).toBe("INV-0042");
    expect(formatInvoiceNumber(123456789n)).toBe("INV-123456789");
    expect(() => formatInvoiceNumber(0n)).toThrow(RangeError);
    expect(isInvoiceNumber("INV-0001")).toBe(true);
    expect(isInvoiceNumber("INV-1")).toBe(false);
    expect(isInvoiceNumber("inv-0001")).toBe(false);
  });
});
