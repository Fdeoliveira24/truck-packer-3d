import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient, assertAllowedPrice, assertStripeEnv, buildReturnUrls } from "../_shared/stripe.ts";

const STRIPE_BLOCKING_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BILLING_INTERVALS = new Set(["month", "year"]);

function utcMinuteBucket(date = new Date()): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  return `${y}${mo}${d}${h}${m}`;
}

function checkoutIdempotencyKey(userId: string, priceId: string): string {
  return `checkout:${userId}:${priceId}:${utcMinuteBucket()}`;
}

function getPortalConfigurationId(): string | null {
  const id = String(Deno.env.get("STRIPE_PORTAL_CONFIGURATION_ID") || "").trim();
  return id || null;
}

async function createPortalUrl(
  stripe: ReturnType<typeof stripeClient>,
  stripeCustomerId: string,
  origin: string,
): Promise<string> {
  const return_url = new URL(origin);
  return_url.pathname = "/index.html";
  return_url.searchParams.set("billing", "portal_return");

  const portalConfigurationId = getPortalConfigurationId();
  const sessionPayload: Record<string, unknown> = {
    customer: stripeCustomerId,
    return_url: return_url.toString(),
  };
  if (portalConfigurationId) {
    sessionPayload.configuration = portalConfigurationId;
  }

  const session = await stripe.billingPortal.sessions.create(sessionPayload as any);

  return session.url;
}

async function hasBlockingStripeSubscription(
  stripe: ReturnType<typeof stripeClient>,
  stripeCustomerId: string,
  organizationId: string,
  allowMissingOrgMetadata: boolean,
): Promise<boolean> {
  const list = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 100,
  });
  const subs = Array.isArray(list.data) ? list.data : [];
  return subs.some((s) => {
    const status = String(s.status || "");
    if (!STRIPE_BLOCKING_STATUSES.has(status)) return false;
    const metadataOrgId = readOrganizationIdFromMetadata((s as Record<string, unknown>)?.metadata ?? null);
    if (metadataOrgId) return metadataOrgId === organizationId;
    return allowMissingOrgMetadata;
  });
}

function normalizeOrganizationId(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function normalizeInterval(value: unknown): "month" | "year" | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  return BILLING_INTERVALS.has(raw) ? (raw as "month" | "year") : null;
}

function priceIdFromInterval(interval: "month" | "year"): string {
  const monthly = String(Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || "").trim();
  const yearly = String(Deno.env.get("STRIPE_PRICE_PRO_YEARLY") || "").trim();
  return interval === "year" ? yearly : monthly;
}

function readOrganizationIdFromMetadata(metadata: unknown): string | null {
  const source = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : null;
  if (!source) return null;
  return normalizeOrganizationId(source.organization_id ?? source.organizationId ?? null);
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  const e = error as Record<string, unknown> | null;
  const code = String(e?.code ?? "");
  const message = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const needle = columnName.toLowerCase();
  return message.toLowerCase().includes(needle) || details.toLowerCase().includes(needle);
}

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
    if (!origin || origin === "*") return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: 401, origin });
    }
    const user = auth.user;
    assertStripeEnv(["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_YEARLY"]);

    const body = await req.json().catch(() => ({}));
    const hasInterval = typeof body.interval !== "undefined" && body.interval !== null && String(body.interval).trim() !== "";
    const interval = normalizeInterval(hasInterval ? body.interval : "month");
    if (!interval) {
      return json({ error: "interval must be either 'month' or 'year'" }, { status: 400, origin });
    }
    const legacyPriceId = String(body.price_id ?? "").trim();
    let price_id = "";
    if (legacyPriceId && !hasInterval) {
      price_id = legacyPriceId;
      assertAllowedPrice(price_id);
    } else {
      price_id = priceIdFromInterval(interval);
      if (!price_id) {
        return json({ error: `Price not configured for interval: ${interval}` }, { status: 400, origin });
      }
      assertAllowedPrice(price_id);
    }
    const organizationId = normalizeOrganizationId(body.organization_id ?? body.org_id ?? null);
    if (!organizationId) return json({ error: "organization_id must be a UUID" }, { status: 400, origin });

    const sb = serviceClient();
    const stripe = stripeClient();

    const { data: memberRow, error: memberErr } = await sb
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberErr) throw memberErr;
    const memberRole = String(memberRow?.role || "").toLowerCase();
    if (memberRole !== "owner" && memberRole !== "admin") {
      return json({ error: "Only owners/admins can manage billing for this organization" }, { status: 403, origin });
    }

    let allowLegacyUserScopedFallback = false;
    const orgCountRes = await sb
      .from("organization_members")
      .select("organization_id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (!orgCountRes.error) {
      allowLegacyUserScopedFallback = Number(orgCountRes.count || 0) === 1;
    }

    const { data: billingCustomerRow, error: billingCustomerErr } = await sb
      .from("billing_customers")
      .select("stripe_customer_id, stripe_subscription_id, status, current_period_end, trial_ends_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (billingCustomerErr) {
      console.warn("stripe-create-checkout-session: billing_customers lookup error", billingCustomerErr);
    }

    // Org-scoped active subscription check:
    // 1) direct org-scoped subscriptions when organization_id column exists
    // 2) fallback to legacy user-scoped rows matched by metadata.organization_id
    let existingSub: Record<string, unknown> | null = null;
    const scopedSub = await sb
      .from("subscriptions")
      .select("status, stripe_subscription_id, stripe_customer_id, current_period_end, created_at, metadata")
      .eq("organization_id", organizationId)
      .in("status", Array.from(STRIPE_BLOCKING_STATUSES))
      .order("current_period_end", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(20);

    if (scopedSub.error) {
      if (!isMissingColumnError(scopedSub.error, "organization_id")) {
        console.error("stripe-create-checkout-session: org-scoped subscription lookup error", scopedSub.error);
      } else {
        const legacySub = await sb
          .from("subscriptions")
          .select("status, stripe_subscription_id, stripe_customer_id, current_period_end, created_at, metadata")
          .eq("user_id", user.id)
          .in("status", Array.from(STRIPE_BLOCKING_STATUSES))
          .order("current_period_end", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
        if (legacySub.error) {
          console.error("stripe-create-checkout-session: legacy subscription lookup error", legacySub.error);
        } else {
          const list = Array.isArray(legacySub.data) ? legacySub.data : [];
          existingSub = list.find((row) => {
            const metadataOrgId = readOrganizationIdFromMetadata((row as Record<string, unknown>)?.metadata ?? null);
            if (metadataOrgId) return metadataOrgId === organizationId;
            return allowLegacyUserScopedFallback;
          }) ?? null;
        }
      }
    } else {
      const scopedList = Array.isArray(scopedSub.data) ? scopedSub.data : [];
      existingSub = scopedList.length ? (scopedList[0] as Record<string, unknown>) : null;
    }

    if (scopedSub.error && !isMissingColumnError(scopedSub.error, "organization_id")) {
      console.error("stripe-create-checkout-session: subscriptions query error", scopedSub.error);
    }

    const { data: existing, error: mapErr } = await sb
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mapErr) throw mapErr;

    let stripeCustomerId =
      (billingCustomerRow?.stripe_customer_id ? String(billingCustomerRow.stripe_customer_id) : "") ||
      (existingSub?.stripe_customer_id ? String(existingSub.stripe_customer_id) : "") ||
      (existing?.stripe_customer_id ? String(existing.stripe_customer_id) : "") ||
      null;

    const billingCustomerStatus = String(billingCustomerRow?.status || "").toLowerCase();
    if (!existingSub && stripeCustomerId && STRIPE_BLOCKING_STATUSES.has(billingCustomerStatus)) {
      if (debug) {
        console.log("stripe-create-checkout-session: duplicate blocked via billing_customers", {
          user_id: user.id,
          organization_id: organizationId,
          stripe_customer_id: stripeCustomerId,
          billing_status: billingCustomerStatus,
        });
      }
      const url = await createPortalUrl(stripe, stripeCustomerId, origin);
      return json({ url }, { status: 200, origin });
    }

    if (existingSub && existingSub.status && stripeCustomerId) {
      if (debug) {
        console.log("stripe-create-checkout-session: duplicate blocked via subscriptions table", {
          user_id: user.id,
          organization_id: organizationId,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: String(existingSub.stripe_subscription_id || ""),
          status: String(existingSub.status || ""),
        });
      }
      const url = await createPortalUrl(stripe, stripeCustomerId, origin);
      return json({ url }, { status: 200, origin });
    }

    // Race guard: DB projection can lag webhooks. Query Stripe directly before creating checkout.
    if (stripeCustomerId) {
      const hasBlocking = await hasBlockingStripeSubscription(
        stripe,
        stripeCustomerId,
        organizationId,
        true,
      );
      if (hasBlocking) {
        if (debug) {
          console.log("stripe-create-checkout-session: duplicate blocked via Stripe customer lookup", {
            user_id: user.id,
            organization_id: organizationId,
            stripe_customer_id: stripeCustomerId,
          });
        }
        const url = await createPortalUrl(stripe, stripeCustomerId, origin);
        return json({ url }, { status: 200, origin });
      }
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

    if (stripeCustomerId) {
      await sb.from("billing_customers").upsert(
        {
          organization_id: organizationId,
          stripe_customer_id: stripeCustomerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      );
    }

    const success_url = buildReturnUrls(origin, "success");
    const cancel_url = buildReturnUrls(origin, "cancel");
    if (debug) {
      console.log("stripe-create-checkout-session", {
        user_id: user.id,
        organization_id: organizationId || null,
        interval,
        price_id,
        has_customer: Boolean(stripeCustomerId),
      });
    }

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
        metadata: {
          supabase_user_id: user.id,
          price_id,
          ...(organizationId ? { organization_id: organizationId } : {}),
        },
        subscription_data: {
          metadata: {
            supabase_user_id: user.id,
            ...(organizationId ? { organization_id: organizationId } : {}),
          },
        },
      },
      { idempotencyKey: checkoutIdempotencyKey(user.id, price_id) },
    );

    return json({ url: session.url }, { status: 200, origin });
  } catch (e) {
    const status = (e as any).status ?? 500;
    const message = (e as Error).message ?? "Server error";
    return json({ error: message }, { status, origin });
  }
});
