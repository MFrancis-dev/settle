import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The judge journey, end to end, in demo mode and only in demo mode (Roadmap S6.6 · PRD §8).
 *
 * `pnpm demo` is what `webServer` runs, so this suite drives the same command a judge is told to run:
 * no `.env`, no wallet, no network, no real money. What it proves is the thing a unit test cannot —
 * that the screens hang together: the demo cookie really opens her dashboard, a price really turns
 * into an address, one press really moves a payment, and the receipt at the end really opens.
 *
 * PRD §8 step 2 asks for "ETH on Arbitrum". The demo's recorded token list has USDC on Ethereum and
 * on Arbitrum but no native ETH, and CI has no upstream to forward a live list from, so the journey
 * below pays in wNEAR — the asset the recording prices. Step 2 is therefore covered as "choose an
 * asset and a refund address, and get a price", not as that exact asset.
 *
 * Serial, because every test drives one shared story: each starts by restarting it, so a failure
 * cannot be caused by the test before it.
 */
test.describe.configure({ mode: "serial" });

const BANNER = "Demo mode — nothing on this page moves money";

/** Open the demo's front door: this seeds on first read and sets the session cookie for the story. */
async function openDemo(page: Page) {
  await page.goto("/demo");
  await expect(page.getByText("The account you are signed in as")).toBeVisible();
  return page;
}

/** Press "Restart the story" so a test starts from the seed's own statuses, whatever ran before. */
async function restart(page: Page) {
  await openDemo(page);
  await page.getByRole("button", { name: "Restart the story" }).click();
  await expect(page.getByRole("heading", { name: "Ten invoices, one per status" })).toBeVisible();
}

interface DemoInvoice {
  number: string;
  status: string;
  payUrl: string;
  activeAttempt: unknown;
}

/**
 * Restart the story and read one invoice's pay link from the API rather than off the page.
 *
 * Scraping the href races the re-render that follows a reset, and the link it can hand back belongs
 * to the story that was just wiped — which the pay page then answers with "No such payment link".
 */
async function freshPayUrl(
  context: BrowserContext,
  number: string,
  status: string,
): Promise<string> {
  const response = await context.request.post("/api/demo/reset");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { invoices: DemoInvoice[] };
  const match = body.invoices.filter(
    (invoice) => invoice.number === number && invoice.status === status,
  );
  expect(match, `the seed has no ${number} in ${status}`).toHaveLength(1);
  return new URL(match[0]!.payUrl).pathname;
}

test("the demo page says what it is, and shows one invoice per status", async ({ page }) => {
  // Restart first: the seed's statuses are the ones being asserted, and a previous run — or a judge
  // mid-talk — may have walked some of them to Paid.
  await restart(page);

  await expect(page.getByText(BANNER)).toBeVisible();
  await expect(page.getByText("ada.demo.near").first()).toBeVisible();

  const cards = page.locator("article");
  await expect(cards).toHaveCount(10);

  // Every status a dashboard can show is on screen, so a judge never has to manufacture one.
  for (const label of [
    "Draft",
    "Awaiting payment",
    "Payment seen",
    "Converting",
    "Paid",
    "Short payment",
    "Paid twice or over",
    "Cancelled",
    "Paid after you cancelled",
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // An invoice that was never paid must not claim its payments have finished.
  await expect(
    page.getByText("No payment has been started on this invoice yet").first(),
  ).toBeVisible();

  // Restarting is idempotent: the story is written again, not written twice.
  await page.getByRole("button", { name: "Restart the story" }).click();
  await expect(page.locator("article")).toHaveCount(10);
});

test("the demo cookie opens her dashboard, and the ledger export refuses it", async ({
  page,
  context,
}) => {
  await restart(page);

  await page.getByRole("link", { name: "Open her dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // The middleware that guards /dashboard runs on the Edge runtime and the cookie was signed on
  // Node; landing here at all is the assertion that the two agree on one demo key.
  await expect(page.getByText("Ada (demo freelancer)").first()).toBeVisible();

  // Her invoices are behind the same cookie; the nav that gets there is the dashboard's own.
  await page.goto("/invoices");
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByText("INV-0001").first()).toBeVisible();

  // PRD §8's "CSV export downloads" cannot be shown in demo mode, and that is deliberate: the export
  // route refuses a demo session so seeded rows never leave the app looking like a real ledger
  // (`app/api/export.csv/route.ts`). What the demo can prove is that the refusal is the answer.
  const exportResponse = await context.request.get("/api/export.csv");
  expect(exportResponse.status()).toBe(403);
  expect(await exportResponse.text()).toContain("Demo accounts cannot export");
});

test("a client prices a payment, gets one address, and watches it reach Paid", async ({
  page,
  context,
}) => {
  await page.goto(await freshPayUrl(context, "INV-0002", "open"));

  await expect(page.getByText(BANNER)).toBeVisible();

  // Step 2 of PRD §8: choose the asset, give a refund address, and see a price before anything else.
  await page.getByPlaceholder("Search USDC, USDT, DAI…").fill("wNEAR");
  await page.getByText("wNEAR", { exact: false }).first().click();
  await page.getByLabel("Address to refund to").fill("client.demo.near");
  await page.getByRole("button", { name: "Show me the price" }).click();

  await expect(page.getByText("Showing the price starts no payment").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Get a payment address" })).toBeVisible();
  // A dry-run price creates nothing: there is no deposit address on the page yet.
  await expect(page.getByText(/settle-demo-/)).toHaveCount(0);

  await page.getByRole("button", { name: "Get a payment address" }).click();
  await expect(page.getByText(/settle-demo-/).first()).toBeVisible();
  await expect(page.getByText("Send this amount in one payment").first()).toBeVisible();

  // In demo mode the transaction-reference field is replaced by the simulate panel (§7): a payment
  // that was never sent must never look like one that was.
  await expect(page.getByText("Demo controls: simulate this payment")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tell Settle" })).toHaveCount(0);

  // Step 4: the statuses arrive in order, one press each.
  for (const label of ["Payment seen", "Converting", "Paid"]) {
    await page.getByRole("button", { name: "The client sent it" }).click();
    await expect(
      page.getByRole("status").or(page.locator("body")).getByText(label).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
  }

  // Step 5: the receipt opens, with both transaction hashes on it.
  await page.getByRole("link", { name: "Receipt" }).first().click();
  await expect(page).toHaveURL(/\/receipt\/.+attempt=/);
  await expect(page.getByText("TRANSACTIONS").first()).toBeVisible();
  await expect(page.getByText("Into Settle").first()).toBeVisible();
  await expect(page.getByText("Out to the seller").first()).toBeVisible();
  await expect(page.getByText("QUOTE ATTESTATION").first()).toBeVisible();
});

test("the outcomes off the happy path explain themselves", async ({ page, context }) => {
  // A short deposit: the invoice is still owed, and the walk is not over.
  await page.goto(await freshPayUrl(context, "INV-0002", "open"));
  await page.getByPlaceholder("Search USDC, USDT, DAI…").fill("wNEAR");
  await page.getByText("wNEAR", { exact: false }).first().click();
  await page.getByLabel("Address to refund to").fill("client.demo.near");
  await page.getByRole("button", { name: "Show me the price" }).click();
  await page.getByRole("button", { name: "Get a payment address" }).click();
  await page.getByRole("button", { name: "It arrived short" }).click();

  await expect(page.getByText("Short payment").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/arrived short|less than|held/i).first()).toBeVisible();

  // A refund: the attempt is terminal, and §3.3 puts the invoice back to awaiting payment.
  await page.goto(await freshPayUrl(context, "INV-0003", "open"));
  await page.getByPlaceholder("Search USDC, USDT, DAI…").fill("wNEAR");
  await page.getByText("wNEAR", { exact: false }).first().click();
  await page.getByLabel("Address to refund to").fill("client.demo.near");
  await page.getByRole("button", { name: "Show me the price" }).click();
  await page.getByRole("button", { name: "Get a payment address" }).click();
  await page.getByRole("button", { name: "Send it back" }).click();

  await expect(page.getByText("This payment has finished").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Refunded to you").first()).toBeVisible();
  // §3.3: a refund puts the invoice back to open, so the client can pay it again.
  await expect(page.getByText("Awaiting payment").first()).toBeVisible();

  // The receipt still opens, and says what actually happened rather than implying a delivery.
  await page.getByRole("link", { name: "Receipt" }).first().click();
  await expect(page).toHaveURL(/\/receipt\/.+attempt=/);
  await expect(page.getByText("Refunded to you").first()).toBeVisible();
});
