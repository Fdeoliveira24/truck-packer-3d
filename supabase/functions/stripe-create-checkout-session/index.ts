import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient, assertAllowedPrice, buildReturnUrls } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    const debug = Deno.env.get("SUPABASE_DEBUG") === "1";
    if (debug) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      const raw = authHeader.replace(/^bearer\\s+/i, "").trim();
      console.log("auth header present:", !!authHeader);
      console.log("auth header starts with Bearer:", authHeader.toLowerCase().startsWith("bearer "));
      console.log("jwt segments:", raw ? raw.split(".").length : 0);
      console.log("jwt len:", raw.length);
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin) return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: 401, origin });
    }
    const user = auth.user;

    const body = await req.json().catch(() => ({}));
    const price_id = String(body.price_id ?? "");
    if (!price_id) return json({ error: "Missing price_id" }, { status: 400, origin });

    assertAllowedPrice(price_id);

    const sb = serviceClient();
    const stripe = stripeClient();

    // If user already has an active/trialing subscription, send them to the portal
    const { data: existingSub, error: subErr } = await sb
      .from("subscriptions")
      .select("status, stripe_subscription_id, stripe_customer_id, current_period_end, cancel_at_period_end, created_at")
      .eq("user_id", user.id)
      .or("status.in.(active,trialing,past_due,unpaid),cancel_at_period_end.eq.true")
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      console.error("stripe-create-checkout-session: subscription lookup error", subErr);
    }

    const { data: existing, error: mapErr } = await sb
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mapErr) throw mapErr;

    let stripeCustomerId = existingSub?.stripe_customer_id ?? existing?.stripe_customer_id ?? null;

    if (existingSub && existingSub.status) {
      if (!stripeCustomerId) {
        return json({ error: "Existing subscription found but no Stripe customer" }, { status: 409, origin });
      }
      const return_url = new URL(origin);
      return_url.pathname = "/index.html";
      return_url.searchParams.set("billing", "portal_return");

      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: return_url.toString(),
      });

      return json({ url: session.url }, { status: 200, origin });
    }

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });

      stripeCustomerId = customer.id;

      const { error: insErr } = await sb.from("stripe_customers").insert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        email: user.email,
      });

      if (insErr) throw insErr;
    }

    const success_url = buildReturnUrls(origin, "success");
    const cancel_url = buildReturnUrls(origin, "cancel");

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: stripeCustomerId,
        line_items: [{ price: price_id, quantity: 1 }],
        success_url,
        cancel_url,
        allow_promotion_codes: false,
        billing_address_collection: "auto",
        client_reference_id: user.id,
        metadata: { supabase_user_id: user.id, price_id },
      },
      { idempotencyKey: crypto.randomUUID() },
    );

    return json({ url: session.url }, { status: 200, origin });
  } catch (e) {
    const status = (e as any).status ?? 500;
    const message = (e as Error).message ?? "Server error";
    return json({ error: message }, { status, origin });
  }
});
