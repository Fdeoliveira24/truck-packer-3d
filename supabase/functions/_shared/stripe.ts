import Stripe from "npm:stripe@22.0.2";

export function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
}

export function isMissingPortalSubscriptionError(error: unknown): boolean {
  const e = error as Record<string, unknown> | null;
  const raw = e?.raw && typeof e.raw === "object" ? e.raw as Record<string, unknown> : null;
  const type = String(e?.type ?? raw?.type ?? "").toLowerCase();
  const rawType = String(e?.rawType ?? "").toLowerCase();
  const code = String(e?.code ?? raw?.code ?? "").toLowerCase();
  const param = String(e?.param ?? raw?.param ?? "").toLowerCase();
  const msg = String(e?.message ?? raw?.message ?? "").toLowerCase();

  const isInvalidRequest =
    type === "invalid_request_error" ||
    type === "stripeinvalidrequesterror" ||
    rawType === "invalid_request_error";
  const matchesSubscriptionParam = param === "flow_data[subscription_update][subscription]";
  const mentionsMissingSubscription =
    msg.includes("no such subscription") ||
    (msg.includes("subscription") && (msg.includes("does not exist") || msg.includes("not found")));

  return code === "resource_missing" && (isInvalidRequest || matchesSubscriptionParam) &&
    (matchesSubscriptionParam || mentionsMissingSubscription);
}

export function isScheduleManagedPortalSubscriptionError(error: unknown): boolean {
  const e = error as Record<string, unknown> | null;
  const raw = e?.raw && typeof e.raw === "object" ? e.raw as Record<string, unknown> : null;
  const msg = String(e?.message ?? raw?.message ?? "").toLowerCase();
  return msg.includes("managed by a subscription schedule");
}

export function assertStripeEnv(names: string[]): void {
  const missing = names.filter((name) => !String(Deno.env.get(name) || "").trim());
  if (!missing.length) return;
  const err = new Error(`Missing required Stripe secrets: ${missing.join(", ")}`);
  (err as { status?: number }).status = 500;
  throw err;
}

export function assertAllowedPrice(priceId: string): void {
  const allowed = new Set(
    [
      Deno.env.get("STRIPE_PRICE_PRO_MONTHLY"),
      Deno.env.get("STRIPE_PRICE_PRO_YEARLY"),
    ].filter(Boolean) as string[],
  );

  if (!allowed.has(priceId)) {
    const err = new Error("Invalid price_id");
    (err as any).status = 400;
    throw err;
  }
}

export function buildReturnUrls(origin: string, mode: "success" | "cancel") {
  const u = new URL(origin);
  u.pathname = "/index.html";
  u.searchParams.set("billing", mode);
  return u.toString();
}
