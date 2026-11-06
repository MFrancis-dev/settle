import { describe, expect, it } from "vitest";

// Roadmap: S1.6
import {
  createInvoiceInput,
  demoActionInput,
  invoiceListQueryInput,
  payQuoteInput,
  payoutInput,
  receiptQueryInput,
  signInInput,
  submitTxInput,
} from "./schemas";

const LINE = { description: "Landing page", quantity: "3", unitPrice: "800000000" };
const INVOICE = { clientName: "Acme", items: [LINE] };
const CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/** Schemas only check the *shape* here; `lib/near/nep413.ts` is what rebuilds and verifies it. */
const SIGNED = {
  message: "Settle payout change to alice.testnet on near",
  recipient: "localhost:3000",
  nonce: "c3RhdHVtLW5vbmNlLWF0LWxlYXN0LXRoaXJ0eS1ieXRl",
  signature: "NQxLct",
  publicKey: "ed25519:7sB2Tn",
};

describe("schemas: createInvoiceInput", () => {
  it("accepts a minimal and a full invoice", () => {
    expect(createInvoiceInput.safeParse(INVOICE).success).toBe(true);
    expect(
      createInvoiceInput.safeParse({
        ...INVOICE,
        clientEmail: "accounts@acme.test",
        memo: "Net 14",
        dueDate: "2026-11-13",
        items: [LINE, { description: "Hosting", quantity: "12.5", unitPrice: "1" }],
      }).success,
    ).toBe(true);
  });

  it("needs a client and at least one line", () => {
    expect(createInvoiceInput.safeParse({ items: [] }).success).toBe(false);
    expect(createInvoiceInput.safeParse({ items: [LINE] }).success).toBe(false);
    expect(createInvoiceInput.safeParse({ clientName: "  ", items: [LINE] }).success).toBe(false);
  });

  it("bounds the line count and the text lengths", () => {
    expect(
      createInvoiceInput.safeParse({ clientName: "A", items: Array(51).fill(LINE) }).success,
    ).toBe(false);
    expect(
      createInvoiceInput.safeParse({
        clientName: "A".repeat(121),
        items: [LINE],
      }).success,
    ).toBe(false);
  });

  it("rejects money that is not base units or a quantity with too much precision", () => {
    for (const bad of [
      { ...LINE, unitPrice: "0.8" },
      { ...LINE, unitPrice: "-1" },
      { ...LINE, unitPrice: "1e9" },
      { ...LINE, quantity: "3.000001" },
      { ...LINE, quantity: "three" },
      { ...LINE, description: "" },
    ]) {
      expect(
        createInvoiceInput.safeParse({ clientName: "A", items: [bad] }).success,
        bad.description,
      ).toBe(false);
    }
  });
});

describe("schemas: payoutInput", () => {
  const base = {
    assetId: "nep141:wrap.near",
    chain: "near",
    address: "alice.testnet",
    addressConfirm: "alice.testnet",
    ...SIGNED,
  };

  it("accepts a matching pair on a supported chain", () => {
    expect(payoutInput.safeParse(base).success).toBe(true);
    expect(
      payoutInput.safeParse({
        ...base,
        chain: "ethereum",
        address: CHECKSUMMED,
        addressConfirm: CHECKSUMMED,
      }).success,
    ).toBe(true);
  });

  it("requires the address to be typed twice, identically", () => {
    const result = payoutInput.safeParse({ ...base, addressConfirm: "alice2.testnet" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("addressConfirm");
    }
  });

  it("carries the chain validator's reason to the address field", () => {
    const result = payoutInput.safeParse({
      ...base,
      chain: "ethereum",
      address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd",
      addressConfirm: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAEd",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((each) => each.path.join(".") === "address");
      expect(issue?.message).toContain("checksum");
    }
  });

  it("requires every field that is inside the signed payload", () => {
    for (const field of ["message", "recipient", "nonce", "signature", "publicKey"] as const) {
      const { [field]: _omitted, ...withoutField } = base;
      expect(payoutInput.safeParse(withoutField).success).toBe(false);
      expect(payoutInput.safeParse({ ...base, [field]: "" }).success).toBe(false);
    }
  });

  it("refuses a chain it cannot check", () => {
    const result = payoutInput.safeParse({
      ...base,
      chain: "bitcoin",
      address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      addressConfirm: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("supported:");
  });
});

describe("schemas: the remaining bodies", () => {
  it("requires dry to be an explicit boolean", () => {
    expect(
      payQuoteInput.safeParse({ originAsset: "nep141:wrap.near", refundTo: "a.near", dry: true })
        .success,
    ).toBe(true);
    expect(
      payQuoteInput.safeParse({ originAsset: "nep141:wrap.near", refundTo: "a.near" }).success,
    ).toBe(false);
    expect(
      payQuoteInput.safeParse({ originAsset: "nep141:wrap.near", refundTo: "  ", dry: false })
        .success,
    ).toBe(false);
  });

  it("takes a tx hash and trims it", () => {
    const parsed = submitTxInput.safeParse({ txHash: " 7Gh1T " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.txHash).toBe("7Gh1T");
    expect(submitTxInput.safeParse({ txHash: "" }).success).toBe(false);
  });

  it("takes the signed message and the account that signed it", () => {
    expect(signInInput.safeParse({ ...SIGNED, accountId: "alice.testnet" }).success).toBe(true);
    expect(signInInput.safeParse({ signature: "NQxLct", publicKey: "k" }).success).toBe(false);
    expect(signInInput.safeParse({ ...SIGNED, accountId: "a" }).success).toBe(false);
  });

  it("only accepts the two demo actions", () => {
    expect(demoActionInput.safeParse("simulate-payment").success).toBe(true);
    expect(demoActionInput.safeParse("reset").success).toBe(true);
    expect(demoActionInput.safeParse("pay-real-usdc").success).toBe(false);
  });

  it("requires a receipt token of unguessable length", () => {
    expect(receiptQueryInput.safeParse({ token: "c2VjcmV0dG9rZW4xMjM0NTY3ODkw" }).success).toBe(true);
    expect(receiptQueryInput.safeParse({ token: "short" }).success).toBe(false);
    expect(receiptQueryInput.safeParse({}).success).toBe(false);
  });

  it("coerces the invoice list query to the status union", () => {
    expect(invoiceListQueryInput.safeParse({ status: "paid", limit: "7" }).success).toBe(true);
    expect(invoiceListQueryInput.safeParse({}).success).toBe(true);
    expect(invoiceListQueryInput.safeParse({ status: "settled" }).success).toBe(false);
    expect(invoiceListQueryInput.safeParse({ limit: "0" }).success).toBe(false);
    expect(invoiceListQueryInput.safeParse({ limit: "9999" }).success).toBe(false);
  });
});
