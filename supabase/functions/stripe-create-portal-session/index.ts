import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient } from "../_shared/stripe.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingColumnError(error: unknown, column: string): boolean {
  const e = error as Record<string, unknown> | null;
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const needle = column.toLowerCase();
  return msg.toLowerCase().includes(needle) || details.toLowerCase().includes(needle);
}

function normalizeOrgId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin || origin === "*") return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: 401, origin });
    }
    const user = auth.user;

    const sb = serviceClient();
    const stripe = stripeClient();
    const body = await req.json().catch(() => ({}));
    const rawOrganizationId = String(body.organization_id ?? body.org_id ?? "").trim();
    if (rawOrganizationId && !normalizeOrgId(rawOrganizationId)) {
      return json({ error: "organization_id must be a UUID" }, { status: 400, origin });
    }
    let organizationId = normalizeOrgId(rawOrganizationId);
    const debug = Deno.env.get("SUPABASE_DEBUG") === "1";

    let stripeCustomerId = "";

    if (!organizationId) {
      const profileRes = await sb
        .from("profiles")
        .select("current_organization_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileRes.error) throw profileRes.error;
      organizationId = normalizeOrgId(profileRes.data?.current_organization_id ?? null);
      if (!organizationId) {
        return json({ error: "organization_id is required" }, { status: 400, origin });
      }
    }

    const { data: memberRow, error: memberErr } = await sb
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberErr) throw memberErr;
    const role = String(memberRow?.role || "").toLowerCase();
    if (role !== "owner" && role !== "admin") {
      return json({ error: "Only owners/admins can manage billing for this organization" }, { status: 403, origin });
    }

    if (!stripeCustomerId) {
      const billingCustomer = await sb
        .from("billing_customers")
        .select("stripe_customer_id")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (billingCustomer.error) throw billingCustomer.error;
      if (billingCustomer.data?.stripe_customer_id) {
        stripeCustomerId = String(billingCustomer.data.stripe_customer_id);
      }
    }

    if (!stripeCustomerId) {
      const scoped = await sb
        .from("subscriptions")
        .select("stripe_customer_id, status, current_period_end")
        .eq("organization_id", organizationId)
        .in("status", ["active", "trialing", "past_due", "unpaid"])
        .order("current_period_end", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (scoped.error) {
        if (!isMissingColumnError(scoped.error, "organization_id")) throw scoped.error;
      } else if (scoped.data?.stripe_customer_id) {
        stripeCustomerId = String(scoped.data.stripe_customer_id);
      }
    }

    if (!stripeCustomerId) {
      const { data: existing, error: mapErr } = await sb
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (mapErr) throw mapErr;
      if (!existing?.stripe_customer_id) return json({ error: "No Stripe customer for user" }, { status: 400, origin });
      stripeCustomerId = String(existing.stripe_customer_id);
    }

    const return_url = new URL(origin);
    return_url.pathname = "/index.html";
    return_url.searchParams.set("billing", "portal_return");

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: return_url.toString(),
    });

    if (debug) {
      console.log("stripe-create-portal-session", {
        user_id: user.id,
        organization_id: organizationId,
        stripe_customer_id: stripeCustomerId,
      });
    }

    return json({ url: session.url }, { status: 200, origin });
  } catch (e) {
    const status = (e as any).status ?? 500;
    const message = (e as Error).message ?? "Server error";
    return json({ error: message }, { status, origin });
  }
});
