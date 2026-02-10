import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin) return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const { user } = await requireUser(req);

    const sb = serviceClient();
    const stripe = stripeClient();

    const { data: existing, error: mapErr } = await sb
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mapErr) throw mapErr;
    if (!existing?.stripe_customer_id) return json({ error: "No Stripe customer for user" }, { status: 400, origin });

    const return_url = new URL(origin);
    return_url.pathname = "/index.html";
    return_url.searchParams.set("billing", "portal_return");

    const session = await stripe.billingPortal.sessions.create({
      customer: existing.stripe_customer_id,
      return_url: return_url.toString(),
    });

    return json({ url: session.url }, { status: 200, origin });
  } catch (e) {
    const status = (e as any).status ?? 500;
    const message = (e as Error).message ?? "Server error";
    return json({ error: message }, { status, origin });
  }
});
