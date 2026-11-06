/**
 * `/api/demo/:action` — the three buttons on `/demo`, exercised through the exported route handlers.
 * Roadmap: S6.4, S6.5 · Spec: ARCHITECTURE.md §3.1, §7 · PRD.md FR-22..FR-24
 *
 * The harness is opened with `{ demo: true }`, which sets `DEMO_MODE` and injects *no* transport, so
 * the quotes in here come from the demo transport `createPaymentAdapters` composes, with the network
 * cut (AGENTS.md §8: no network, and nothing of Settle's own is mocked).
 *
 * What these tests are for is the promise in §7: the demo does not run a parallel implementation. A
 * simulated payment is written with the same functions the worker uses, the invoice status is derived
 * rather than chosen, and the public status poll reads the simulation back through the vendor's own
 * status shape — so "the pay page shows paid" and "the demo said paid" cannot disagree.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET, POST } from "./route";
import { GET as STATUS } from "../../pay/[publicId]/status/route";
import { POST as QUOTE } from "../../pay/[publicId]/quote/route";
import { GET as ME } from "../../me/route";
import { DEMO_ACCOUNT_ID } from "@/lib/db/seed-demo";
import {
  apiRequest,
  createRouteHarness,
  errorOf,
  jsonOf,
  type RouteHarness,
} from "@/lib/server/__fixtures__/routes";
import type { DemoInvoiceSummary, DemoSessionView, DemoSimulationView } from "@/lib/api/types";

/** The route's own context argument: `{ action }` behind a promise, as Next 15 hands it over. */
function ctx(action: string) {
  return { params: Promise.resolve({ action }) };
}

function invoiceWith(view: DemoSessionView, predicate: (invoice: DemoInvoiceSummary) => boolean) {
  const found = view.invoices.find(predicate);
  if (!found) {
    throw new Error(`the demo seed has no invoice in that state; it has ${view.invoices.map((i) => i.status).join(", ")}`);
  }
  return found;
}

describe("the demo routes on a server that is not in demo mode", () => {
  let harness: RouteHarness;

  beforeAll(async () => {
    harness = await createRouteHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("refuses every action, because there is nothing fictional to serve", async () => {
    const get = await GET(apiRequest("/api/demo/session"), ctx("session"));
    expect(get.status).toBe(403);
    expect((await errorOf(get)).message).toContain("not in demo mode");

    const post = await POST(apiRequest("/api/demo/session", { method: "POST" }), ctx("session"));
    expect(post.status).toBe(403);

    const reset = await POST(apiRequest("/api/demo/reset", { method: "POST" }), ctx("reset"));
    expect(reset.status).toBe(403);
  });
});

describe("the demo routes in demo mode", () => {
  let harness: RouteHarness;

  beforeAll(async () => {
    harness = await createRouteHarness({ demo: true });
  });

  afterAll(async () => {
    await harness?.close();
  });

  describe("GET /api/demo/session", () => {
    it("seeds the story on first read and signs the visitor in as the freelancer", async () => {
      const response = await GET(apiRequest("/api/demo/session", { ip: "203.0.113.21" }), ctx("session"));
      expect(response.status).toBe(200);

      const view = (await jsonOf(response)) as unknown as DemoSessionView;
      expect(view.demo).toBe(true);
      expect(view.seeded).toBe(true);
      expect(view.account.nearAccountId).toBe(DEMO_ACCOUNT_ID);
      expect(view.account.payoutAddress).not.toBe("");
      expect(view.invoices).toHaveLength(10);

      // An invoice that was never paid must not be reported as one whose payments have finished,
      // or the demo page tells a judge there is nothing left to show on the very first card.
      expect(view.invoices.find((i) => i.status === "draft")?.finishedPayments).toBe(0);
      expect(view.invoices.find((i) => i.status === "paid")?.finishedPayments).toBeGreaterThan(0);

      const cookie = response.headers.get("set-cookie")?.split(";")[0]?.trim();
      expect(cookie).toBeTruthy();

      // The cookie is a real session cookie: /api/me accepts it, and says the account is the demo one.
      const me = await jsonOf(await ME(apiRequest("/api/me", { cookie: cookie ?? null })));
      expect(me.nearAccountId).toBe(DEMO_ACCOUNT_ID);
      expect(me.isDemo).toBe(true);
    });

    it("reads rather than reseeds on the next call, so a reload never duplicates the story", async () => {
      const first = (await jsonOf(
        await GET(apiRequest("/api/demo/session", { ip: "203.0.113.22" }), ctx("session")),
      )) as unknown as DemoSessionView;
      expect(first.seeded).toBe(false);

      const second = (await jsonOf(
        await GET(apiRequest("/api/demo/session", { ip: "203.0.113.23" }), ctx("session")),
      )) as unknown as DemoSessionView;
      expect(second.seeded).toBe(false);
      expect(second.invoices).toHaveLength(10);
      expect(second.invoices.map((invoice) => invoice.publicId)).toEqual(
        first.invoices.map((invoice) => invoice.publicId),
      );
    });

    it("answers 404 for an action that does not exist, and for a POST-only action", async () => {
      const unknown = await GET(apiRequest("/api/demo/nope"), ctx("nope"));
      expect(unknown.status).toBe(404);
      expect((await errorOf(unknown)).message).toContain("nope");

      const wrongMethod = await GET(apiRequest("/api/demo/reset"), ctx("reset"));
      expect(wrongMethod.status).toBe(404);
      expect((await errorOf(wrongMethod)).message).toContain("POST");

      const unknownPost = await POST(
        apiRequest("/api/demo/nope", { method: "POST", body: {} }),
        ctx("nope"),
      );
      expect(unknownPost.status).toBe(404);
    });
  });

  describe("POST /api/demo/simulate-payment", () => {
    /**
     * Restart the story before each walk.
     *
     * The seed has two invoices with nothing in flight, and every outcome below spends one of them, so
     * a shared story would run out mid-suite. Resetting is also what the "Restart the story" button on
     * `/demo` does, which keeps these tests on the path a judge takes rather than beside it.
     */
    async function restart(ip: string): Promise<DemoSessionView> {
      const response = await POST(apiRequest("/api/demo/reset", { method: "POST", ip }), ctx("reset"));
      expect(response.status).toBe(200);
      return (await jsonOf(response)) as unknown as DemoSessionView;
    }

    /** Start a real payment through the pay route, so the walk begins at `awaiting_deposit`. */
    async function openAttempt(publicId: string, ip: string): Promise<string> {
      const quote = await QUOTE(
        apiRequest(`/api/pay/${publicId}/quote`, {
          method: "POST",
          ip,
          body: { originAsset: "nep141:wrap.near", refundTo: "client.near", dry: false },
        }),
        { params: Promise.resolve({ publicId }) },
      );
      expect(quote.status).toBe(200);
      const body = (await jsonOf(quote)) as { attempt?: { status: string; depositAddress: string } };
      expect(body.attempt?.status).toBe("awaiting_deposit");
      expect(body.attempt?.depositAddress.startsWith("settle-demo-")).toBe(true);
      return body.attempt!.depositAddress;
    }

    async function simulate(publicId: string, outcome: string, ip: string): Promise<DemoSimulationView> {
      const response = await POST(
        apiRequest("/api/demo/simulate-payment", { method: "POST", ip, body: { publicId, outcome } }),
        ctx("simulate-payment"),
      );
      if (!response.ok) throw new Error(`simulate ${outcome} answered ${response.status}`);
      return (await jsonOf(response)) as unknown as DemoSimulationView;
    }

    async function pollStatus(publicId: string, ip: string) {
      const response = await STATUS(apiRequest(`/api/pay/${publicId}/status`, { ip }), {
        params: Promise.resolve({ publicId }),
      });
      return (await jsonOf(response)) as {
        invoiceStatus: string;
        polled: boolean;
        paid: boolean;
        attempt: { status: string } | null;
      };
    }

    it("walks the happy path one press at a time, and the invoice follows", async () => {
      const target = invoiceWith(await restart("203.0.113.30"), (i) => i.status === "open");
      await openAttempt(target.publicId, "203.0.113.30");

      const seen: string[] = [];
      for (const index of [0, 1, 2]) {
        const step = await simulate(target.publicId, "next", `203.0.113.${31 + index}`);
        seen.push(step.attempt.status);
        // Every step still offers the next one, right up to the one that settles the payment.
        expect(step.paid).toBe(step.attempt.status === "success");
        expect(step.next.includes("next")).toBe(step.attempt.status !== "success");
        expect(step.invoiceStatus).toBe(step.attempt.status === "success" ? "paid" : step.attempt.status);
      }
      expect(seen).toEqual(["payment_detected", "processing", "success"]);
      expect(await pollStatus(target.publicId, "203.0.113.34")).toMatchObject({
        invoiceStatus: "paid",
        paid: true,
      });

      // Nothing is left to move: a terminal attempt answers 409 rather than inventing a step.
      const finished = await POST(
        apiRequest("/api/demo/simulate-payment", {
          method: "POST",
          ip: "203.0.113.40",
          body: { publicId: target.publicId, outcome: "next" },
        }),
        ctx("simulate-payment"),
      );
      expect(finished.status).toBe(409);
      expect((await errorOf(finished)).message).toContain("no open payment");
    });

    it("leaves a seeded settled invoice paid, with a receipt the pay page can open", async () => {
      const paid = invoiceWith(await restart("203.0.113.41"), (i) => i.status === "paid");

      expect(paid.receiptUrl).toContain("/receipt/");
      expect(paid.activeAttempt).toBeNull();
      expect(await pollStatus(paid.publicId, "203.0.113.42")).toMatchObject({
        invoiceStatus: "paid",
        paid: true,
        attempt: { status: "success" },
      });
    });

    it("reads a simulation back through the public status poll, so the two cannot disagree", async () => {
      const target = invoiceWith(await restart("203.0.113.43"), (i) => i.status === "payment_detected");

      const step = await simulate(target.publicId, "next", "203.0.113.44");
      expect(step.attempt.status).toBe("processing");

      // The poll asked the demo transport, which mirrors the row the simulation wrote: same status,
      // and the invoice derived from it rather than carried alongside it.
      const status = await pollStatus(target.publicId, "203.0.113.45");
      expect(status.polled).toBe(true);
      expect(status.attempt?.status).toBe("processing");
      expect(status.invoiceStatus).toBe(step.invoiceStatus);
      expect(status.paid).toBe(false);
    });

    it("shows a short deposit as underpaid, and the invoice as still owed", async () => {
      const target = invoiceWith(await restart("203.0.113.50"), (i) => i.status === "open");
      await openAttempt(target.publicId, "203.0.113.50");

      const step = await simulate(target.publicId, "underpaid", "203.0.113.51");
      expect(step.oneclickStatus).toBe("INCOMPLETE_DEPOSIT");
      expect(step.attempt.status).toBe("underpaid");
      expect(step.invoiceStatus).toBe("underpaid");
      expect(step.paid).toBe(false);
      // The receipt token is minted when the quote is, so the URL exists before the money does; the
      // pay page gates the link on `paid`, which is the field that says whether to show it.
      expect(step.receiptUrl).toContain("/receipt/");
      // A short deposit can still be topped up, so the walk is not over.
      expect(step.next).toContain("next");
    });

    it("puts a refunded payment's invoice back to open, as §3.3 requires", async () => {
      const target = invoiceWith(await restart("203.0.113.52"), (i) => i.status === "open");
      await openAttempt(target.publicId, "203.0.113.52");

      const step = await simulate(target.publicId, "refunded", "203.0.113.53");
      expect(step.attempt.status).toBe("refunded");
      expect(step.invoiceStatus).toBe("open");
      expect(step.paid).toBe(false);
      expect(step.next).toEqual([]);
      expect(await pollStatus(target.publicId, "203.0.113.56")).toMatchObject({
        invoiceStatus: "open",
        paid: false,
      });
    });

    it("expires a lapsed quote, which is terminal and leaves the invoice payable", async () => {
      const target = invoiceWith(await restart("203.0.113.54"), (i) => i.status === "open");
      await openAttempt(target.publicId, "203.0.113.54");

      const step = await simulate(target.publicId, "expired", "203.0.113.55");
      // `expired` is Settle's own status: the service keeps no record of a quote that lapsed unpaid,
      // which is why there is no 1Click status to report for it.
      expect(step.oneclickStatus).toBeNull();
      expect(step.attempt.status).toBe("expired");
      expect(step.invoiceStatus).toBe("open");
      expect(step.next).toEqual([]);
    });

    it("answers 404 for an unknown payment link and 409 for one with nothing in flight", async () => {
      const session = await restart("203.0.113.60");

      const missing = await POST(
        apiRequest("/api/demo/simulate-payment", {
          method: "POST",
          ip: "203.0.113.61",
          body: { publicId: "inv_does_not_exist", outcome: "next" },
        }),
        ctx("simulate-payment"),
      );
      expect(missing.status).toBe(404);

      const settled = invoiceWith(session, (i) => i.status === "paid");
      const nothing = await POST(
        apiRequest("/api/demo/simulate-payment", {
          method: "POST",
          ip: "203.0.113.62",
          body: { publicId: settled.publicId, outcome: "next" },
        }),
        ctx("simulate-payment"),
      );
      expect(nothing.status).toBe(409);
      expect((await errorOf(nothing)).message).toContain("no open payment");

      const badOutcome = await POST(
        apiRequest("/api/demo/simulate-payment", {
          method: "POST",
          ip: "203.0.113.63",
          body: { publicId: settled.publicId, outcome: "teleported" },
        }),
        ctx("simulate-payment"),
      );
      expect(badOutcome.status).toBe(400);
    });
  });

  describe("POST /api/demo/reset", () => {
    it("wipes the story, seeds it again, and hands back a fresh cookie", async () => {
      const response = await POST(
        apiRequest("/api/demo/reset", { method: "POST", ip: "203.0.113.70" }),
        ctx("reset"),
      );
      expect(response.status).toBe(200);

      const view = (await jsonOf(response)) as unknown as DemoSessionView;
      expect(view.seeded).toBe(true);
      expect(view.invoices).toHaveLength(10);
      // Every walk the earlier tests ran is gone: the story starts from its own statuses again.
      expect(view.invoices.filter((invoice) => invoice.status === "open").length).toBeGreaterThan(0);

      const cookie = response.headers.get("set-cookie")?.split(";")[0]?.trim();
      const me = await jsonOf(await ME(apiRequest("/api/me", { cookie: cookie ?? null })));
      expect(me.nearAccountId).toBe(DEMO_ACCOUNT_ID);
    });
  });
});
