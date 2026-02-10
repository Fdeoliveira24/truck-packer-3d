import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient, assertAllowedPrice, buildReturnUrls } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin) return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const { user } = await requireUser(req);

    const body = await req.json().catch(() => ({}));
    const price_id = String(body.price_id ?? "");
    if (!price_id) return json({ error: "Missing price_id" }, { status: 400, origin });

    assertAllowedPrice(price_id);

    const sb = serviceClient();
    const stripe = stripeClient();

    const { data: existing, error: mapErr } = await sb
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mapErr) throw mapErr;

    let stripeCustomerId = existing?.stripe_customer_id ?? null;

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
