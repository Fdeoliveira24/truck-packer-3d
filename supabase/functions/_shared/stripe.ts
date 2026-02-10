import Stripe from "npm:stripe@16.2.0";

export function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key, { apiVersion: "2024-06-20" });
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
