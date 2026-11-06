import { demoActionInput, demoSimulateInput } from "@/lib/core/schemas";
import { getServerDeps } from "@/lib/server/deps";
import { resetDemo, simulatePayment, startDemoSession } from "@/lib/server/demo";
import { clientIp, json, notFound, parseJsonBody, route } from "@/lib/server/http";

/**
 * `/api/demo/:action` — `session`, `simulate-payment`, `reset`.
 * Roadmap: S6.4 · Spec: ARCHITECTURE.md §3.1, §7 · PRD.md FR-22..FR-24
 *
 * Unauthenticated on purpose: the demo is the part of Settle a judge sees without a wallet, and the
 * pay page it drives has no session either (§6). What makes that safe is not this file — every action
 * is refused unless the process is in demo mode, and `lib/server/adapters.ts` refuses to let demo mode
 * run next to `DATABASE_URL` or a public `PUBLIC_APP_URL`. There is no real data here to protect.
 *
 * `GET` is offered for `session` only, and it does write: seeding on first read is what makes the demo
 * one command (`pnpm demo` → open `/demo`) instead of a setup step. It is idempotent, so a reload
 * reads rather than reseeds.
 */

type Action = "session" | "simulate-payment" | "reset";

function parseAction(action: string): Action {
  const parsed = demoActionInput.safeParse(action);
  if (!parsed.success) throw notFound(`No demo action called "${action}".`);
  return parsed.data;
}

async function handle(action: string, request: Request): Promise<Response> {
  const deps = await getServerDeps();
  const ip = clientIp(request);

  switch (parseAction(action)) {
    case "session": {
      // The cookie is the demo's sign-in: `/demo` opens the dashboard as the fictional freelancer.
      const signedIn = await startDemoSession(deps, ip);
      return json(signedIn.view, { headers: { "Set-Cookie": signedIn.cookie } });
    }
    case "reset": {
      const signedIn = await resetDemo(deps, ip);
      return json(signedIn.view, { headers: { "Set-Cookie": signedIn.cookie } });
    }
    case "simulate-payment": {
      const input = await parseJsonBody(request, demoSimulateInput);
      return json(
        await simulatePayment(deps, { publicId: input.publicId, ip, outcome: input.outcome }),
      );
    }
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<Response> {
  return route(async () => {
    const { action } = await params;
    if (action !== "session") throw notFound(`Only "session" answers a GET; "${action}" is a POST.`);
    return handle(action, request);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<Response> {
  return route(async () => {
    const { action } = await params;
    return handle(action, request);
  });
}
