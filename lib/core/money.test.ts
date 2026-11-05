import { describe, expect, it } from "vitest";

// Roadmap: S1.1
import {
  formatAmount,
  fromBaseUnits,
  isBaseUnitsString,
  parseBaseUnits,
  roundHalfUp,
  sumAmounts,
  toBaseUnits,
  toBaseUnitsRounded,
} from "./money";

/** The `BaseUnits` brand is compile-time; tests build real values through the validator. */
const u = parseBaseUnits;

describe("money: roundHalfUp", () => {
  it("rounds a remainder of exactly half up, not to even", () => {
    expect(roundHalfUp(5n, 10n)).toBe(1n);
    expect(roundHalfUp(15n, 10n)).toBe(2n);
    expect(roundHalfUp(4n, 10n)).toBe(0n);
    expect(roundHalfUp(6n, 10n)).toBe(1n);
  });

  it("leaves exact division alone", () => {
    expect(roundHalfUp(0n, 7n)).toBe(0n);
    expect(roundHalfUp(21n, 7n)).toBe(3n);
  });

  it("refuses a non-positive denominator and negative amounts", () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => roundHalfUp(1n, -2n)).toThrow(RangeError);
    expect(() => roundHalfUp(-1n, 2n)).toThrow(RangeError);
  });
});

describe("money: toBaseUnits", () => {
  it("converts display amounts for 6 and 18 decimals", () => {
    expect(toBaseUnits("10.5", 6)).toBe("10500000");
    expect(toBaseUnits("0.000001", 6)).toBe("1");
    expect(toBaseUnits("1", 18)).toBe("1000000000000000000");
    expect(toBaseUnits("0.5", 18)).toBe("500000000000000000");
    expect(toBaseUnits("12345678901234567890.5", 18)).toBe(
      "12345678901234567890500000000000000000",
    );
  });

  it("handles 0 and the smallest unit", () => {
    expect(toBaseUnits("0", 6)).toBe("0");
    expect(toBaseUnits("0", 0)).toBe("0");
    expect(toBaseUnits("1", 0)).toBe("1");
    expect(toBaseUnits("0.000001", 6)).toBe("1");
  });

  it("truncates precision the asset cannot hold", () => {
    expect(toBaseUnits("0.0000005", 6)).toBe("0");
    expect(toBaseUnits("1.0000009", 6)).toBe("1000000");
  });

  it("rejects anything that is not a plain decimal string", () => {
    for (const bad of ["", "abc", "-1", "1e6", ".5", "1.", "1,5", "NaN", "Infinity", "1.2.3"]) {
      expect(() => toBaseUnits(bad, 6), bad).toThrow(TypeError);
    }
  });

  it("rejects an impossible decimal count", () => {
    for (const bad of [-1, 1.5, 25, Number.NaN]) {
      expect(() => toBaseUnits("1", bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe("money: toBaseUnitsRounded", () => {
  it("rounds half-up instead of dropping sub-unit precision", () => {
    expect(toBaseUnitsRounded("0.0000005", 6)).toBe("1");
    expect(toBaseUnitsRounded("0.0000004", 6)).toBe("0");
    expect(toBaseUnitsRounded("0.0000015", 6)).toBe("2");
    expect(toBaseUnitsRounded("10.5", 6)).toBe("10500000");
    expect(toBaseUnitsRounded("1", 18)).toBe("1000000000000000000");
  });
});

describe("money: fromBaseUnits", () => {
  it("is exact and trims trailing zeros", () => {
    expect(fromBaseUnits(u("10500000"), 6)).toBe("10.5");
    expect(fromBaseUnits(u("1"), 6)).toBe("0.000001");
    expect(fromBaseUnits(u("0"), 6)).toBe("0");
    expect(fromBaseUnits(u("1000000"), 6)).toBe("1");
    expect(fromBaseUnits(u("12345678901234567890500000000000000000"), 18)).toBe(
      "12345678901234567890.5",
    );
    expect(fromBaseUnits(u("250"), 0)).toBe("250");
  });

  it("round-trips every amount through both directions", () => {
    for (const amount of ["0", "1", "999999", "1000000", "1234567890123"]) {
      expect(toBaseUnits(fromBaseUnits(u(amount), 6), 6)).toBe(amount);
    }
  });

  it("carries yoctoNEAR, the smallest unit in the system", () => {
    // 1Click reports 24 decimals for NEAR-native assets, so the cap has to reach it.
    expect(toBaseUnits("1", 24)).toBe("1000000000000000000000000");
    expect(fromBaseUnits(u("20000000000000000000000000"), 24)).toBe("20");
  });

  it("refuses an impossible decimal count", () => {
    expect(() => fromBaseUnits(u("1"), 25)).toThrow(RangeError);
    expect(() => fromBaseUnits(u("1"), -1)).toThrow(RangeError);
  });
});

describe("money: formatAmount", () => {
  it("groups thousands and keeps every base unit", () => {
    expect(formatAmount(u("1234567890"), 6)).toBe("1,234.56789");
    expect(formatAmount(u("1000000"), 6)).toBe("1");
    expect(formatAmount(u("0"), 6)).toBe("0");
    expect(formatAmount(u("1"), 6)).toBe("0.000001");
    expect(formatAmount(u("1234567890123456789"), 6)).toBe("1,234,567,890,123.456789");
    expect(formatAmount(u("1000"), 0)).toBe("1,000");
  });
});

describe("money: sumAmounts", () => {
  it("adds without float error", () => {
    expect(sumAmounts([])).toBe("0");
    expect(sumAmounts([u("1"), u("2"), u("3")])).toBe("6");
    // 0.1 + 0.2, exact in base units.
    expect(sumAmounts([u("100000000000000000"), u("200000000000000000")])).toBe(
      "300000000000000000",
    );
    expect(sumAmounts([u("99999999999999999999999999"), u("1")])).toBe(
      "100000000000000000000000000",
    );
  });
});

describe("money: base-unit strings", () => {
  it("recognises the shape the DB stores", () => {
    expect(isBaseUnitsString("0")).toBe(true);
    expect(isBaseUnitsString("12345")).toBe(true);
    for (const bad of ["", " 1", "1 ", "-1", "1.0", "e3", "0x1"]) {
      expect(isBaseUnitsString(bad), bad).toBe(false);
    }
  });

  it("brands only valid strings", () => {
    expect(parseBaseUnits("1000000")).toBe("1000000");
    for (const bad of ["1.5", "-1", "", " 1", "abc"]) {
      expect(() => parseBaseUnits(bad), bad).toThrow(TypeError);
    }
  });
});
