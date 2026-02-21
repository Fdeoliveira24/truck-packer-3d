// supabase/functions/billing-status/index.ts
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { stripeClient } from "../_shared/stripe.ts";

const SUBSCRIPTION_STATUS_PRIORITY: Record<string, number> = {
  active: 6,
  trialing: 5,
  past_due: 4,
  unpaid: 3,
  canceled: 2,
  incomplete: 1,
  incomplete_expired: 0,
};

function json(req: Request, status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function pickBestSubscription(rows: any[]) {
  let best: any = null;
  let bestScore = -1;
  let bestEnd = -1;
  let bestCreated = -1;
  rows.forEach(r => {
    const status = String(r.status || "");
    const score = Object.prototype.hasOwnProperty.call(SUBSCRIPTION_STATUS_PRIORITY, status)
      ? SUBSCRIPTION_STATUS_PRIORITY[status]
      : -1;
    const endMs = r.current_period_end ? new Date(r.current_period_end as string).getTime() : -1;
    const createdMs = r.created_at ? new Date(r.created_at as string).getTime() : -1;

    if (!best) {
      best = r; bestScore = score; bestEnd = endMs; bestCreated = createdMs; return;
    }
    if (score > bestScore) {
      best = r; bestScore = score; bestEnd = endMs; bestCreated = createdMs; return;
    }
    if (score === bestScore) {
      if (endMs > bestEnd) {
        best = r; bestEnd = endMs; bestCreated = createdMs; return;
      }
      if (endMs === bestEnd && createdMs > bestCreated) {
        best = r; bestCreated = createdMs;
      }
    }
  });
  return best;
}

function activeRowCount(rows: any[]): number {
  return rows.filter((r) => String(r?.status || "") === "active").length;
}

function statusPriority(status: unknown): number {
  const normalized = String(status || "");
  return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_STATUS_PRIORITY, normalized)
    ? SUBSCRIPTION_STATUS_PRIORITY[normalized]
    : -1;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOrgId(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function normalizeSupabaseUrl(raw: string): { url: string | null; host: string | null; error: string | null } {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return { url: null, host: null, error: "URL and SUPABASE_URL are missing" };
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[a-z0-9-]+\.supabase\.co$/i.test(candidate)) {
      candidate = `https://${candidate}`;
    } else if (/^[a-z0-9]+$/i.test(candidate)) {
      candidate = `https://${candidate}.supabase.co`;
    } else {
      return { url: null, host: null, error: "value is not a URL, supabase host, or project ref" };
    }
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) {
      return { url: null, host: null, error: "URL hostname is empty" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: null, host: null, error: "URL protocol must be http or https" };
    }
    return { url: candidate, host: parsed.hostname, error: null };
  } catch {
    return { url: null, host: null, error: "URL parsing failed" };
  }
}

function metadataOrgId(metadata: unknown): string | null {
  const source = (metadata && typeof metadata === "object") ? (metadata as Record<string, unknown>) : null;
  if (!source) return null;
  return normalizeOrgId(source.organization_id ?? source.organizationId ?? null);
}

function isMissingColumnError(error: unknown, column: string): boolean {
  const e = error as Record<string, unknown> | null;
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const needle = column.toLowerCase();
  return msg.toLowerCase().includes(needle) || details.toLowerCase().includes(needle);
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getJwtFromRequest(req: Request): string | null {
  // Primary: explicit header used by the app
  const xUserJwt = req.headers.get("x-user-jwt") || req.headers.get("X-User-JWT");
  if (xUserJwt && xUserJwt.trim()) return xUserJwt.trim();

  // Fallback: Authorization bearer (some clients may use this)
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^bearer\s+/i, "").trim();
  return bearer ? bearer : null;
}

async function requireUserLocal(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<{ ok: true; user: { id: string } } | { ok: false; status: number; error: string }> {
  const jwt = getJwtFromRequest(req);
  if (!jwt) {
    return { ok: false, status: 401, error: "Missing authorization" };
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await authClient.auth.getUser(jwt);
    if (error || !data?.user?.id) {
      return { ok: false, status: 401, error: "Invalid or expired token" };
    }

    return { ok: true, user: { id: data.user.id } };
  } catch (e) {
    return { ok: false, status: 500, error: String((e as any)?.message || e) };
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const debug = Deno.env.get("SUPABASE_DEBUG") === "1";
    if (debug) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      console.log("auth header present:", !!authHeader);
      console.log("auth header starts with Bearer:", authHeader.toLowerCase().startsWith("bearer "));
      const raw = authHeader.replace(/^bearer\\s+/i, "").trim();
      console.log("jwt segments:", raw ? raw.split(".").length : 0);
      console.log("jwt len:", raw.length);
    }

    const requestUrl = new URL(req.url);
    const responseDebugEnabled = requestUrl.searchParams.get("tp3dDebug") === "1";
    const requestedOrgRaw =
      requestUrl.searchParams.get("organization_id") ||
      requestUrl.searchParams.get("org_id") ||
      "";
    const requestedOrgId = normalizeOrgId(requestedOrgRaw);
    const hadInvalidOrgParam = Boolean(String(requestedOrgRaw || "").trim()) && !requestedOrgId;
    let resolvedOrgId: string | null = requestedOrgId;
    if (!requestedOrgId && String(requestedOrgRaw || "").trim() && debug) {
      console.warn("billing-status: ignoring non-UUID organization_id", { organization_id: requestedOrgRaw });
    }

    // 1) Resolve Supabase URL and anon key for auth lookup
    const rawUrl = Deno.env.get("URL") || "";
    const rawSupabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const envKeyUsed: "URL" | "SUPABASE_URL" | "none" = rawUrl.trim()
      ? "URL"
      : rawSupabaseUrl.trim()
        ? "SUPABASE_URL"
        : "none";
    const normalizedSupabaseUrl = normalizeSupabaseUrl(envKeyUsed === "URL" ? rawUrl : rawSupabaseUrl);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";

    // Startup log: helps confirm what the function sees in the Edge runtime
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const hasServiceRoleKey = Boolean(serviceRoleKey);
    console.log("billing-status startup", {
      envKeyUsed,
      hasServiceRoleKey,
      hasAnonKey: Boolean(anonKey),
      normalizedHost: normalizedSupabaseUrl.host,
    });

    if (!normalizedSupabaseUrl.url) {
      return json(req, 500, {
        error: "Invalid Supabase URL env",
        details: normalizedSupabaseUrl.error || "unknown",
      });
    }

    if (!anonKey) {
      return json(req, 500, { error: "Missing SUPABASE_ANON_KEY" });
    }

    // 2) Read user from JWT using anon key + normalized URL
    const auth = await requireUserLocal(req, normalizedSupabaseUrl.url, anonKey);
    if (!auth.ok) {
      return json(req, auth.status, { error: auth.error });
    }

    const userId = auth.user.id;
    if (!userId) {
      return json(req, 401, { error: "Missing user id" });
    }

    const uuidLike = /^[0-9a-fA-F-]{36}$/;
    if (!uuidLike.test(userId)) {
      return json(req, 500, { error: "Invalid user id format" });
    }

    // 3) Use service role for DB reads
    if (!serviceRoleKey) {
      return json(req, 500, { error: "Missing SUPABASE_SERVICE_ROLE_KEY" });
    }
    const usedServiceRole = true;
    const admin = createClient(normalizedSupabaseUrl.url, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let eligibleUserIds = [userId];
    let allowLegacyUserScopedFallback = false;
    let billingCustomer: Record<string, unknown> | null = null;

    if (!resolvedOrgId) {
      const profileOrgRes = await admin
        .from("profiles")
        .select("current_organization_id")
        .eq("id", userId)
        .maybeSingle();
      if (profileOrgRes.error) {
        if (debug) {
          console.warn("billing-status: failed to resolve profile.current_organization_id", profileOrgRes.error);
        }
      } else {
        resolvedOrgId = normalizeOrgId(profileOrgRes.data?.current_organization_id ?? null);
      }
    }
    if (hadInvalidOrgParam && !resolvedOrgId) {
      return json(req, 400, { error: "organization_id must be a UUID", orgId: null });
    }

    if (resolvedOrgId) {
      const { data: memberships, error: membershipsErr } = await admin
        .from("organization_members")
        .select("user_id, role")
        .eq("organization_id", resolvedOrgId);

      if (membershipsErr) {
        console.error("billing-status membership lookup error:", membershipsErr);
        return json(req, 500, { error: "Organization membership lookup failed" });
      }

      const rows = Array.isArray(memberships) ? memberships : [];
      const isMember = rows.some(r => String(r?.user_id || "") === userId);
      if (!isMember) {
        return json(req, 403, { error: "Not authorized for this organization billing status" });
      }

      const managerIds = uniq(
        rows
          .filter(r => {
            const role = String(r?.role || "").toLowerCase();
            return role === "owner" || role === "admin";
          })
          .map(r => String(r?.user_id || "")),
      );
      eligibleUserIds = managerIds.length ? managerIds : [userId];

      // Legacy compatibility: if this user belongs to exactly one org, allow
      // fallback to older user-scoped subscriptions that predate org metadata.
      const orgCountRes = await admin
        .from("organization_members")
        .select("organization_id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (!orgCountRes.error) {
        allowLegacyUserScopedFallback = Number(orgCountRes.count || 0) === 1;
      } else if (debug) {
        console.warn("billing-status: org count lookup failed", orgCountRes.error);
      }

      const billingCustomerRes = await admin
        .from("billing_customers")
        .select("organization_id, stripe_customer_id, stripe_subscription_id, status, plan_name, billing_interval, current_period_end, cancel_at_period_end, trial_ends_at")
        .eq("organization_id", resolvedOrgId)
        .maybeSingle();
      billingCustomer = billingCustomerRes.data ?? null;
      console.log("billing_customers lookup", {
        orgId: resolvedOrgId,
        found: !!billingCustomer,
        error: billingCustomerRes.error?.message || null,
      });
      if (billingCustomerRes.error) {
        return json(req, 500, {
          error: "billing_customers lookup failed",
          details: String(billingCustomerRes.error?.message || "unknown"),
        });
      }
    }

    // Load subscriptions scoped to org when possible, otherwise legacy user scope.
    let subscription: Record<string, unknown> | null = null;
    let dbStatus = "";
    let duplicateActiveCount = 0;
    try {
      const selectColumns =
        "status, price_id, current_period_end, trial_end, cancel_at_period_end, cancel_at, interval, stripe_subscription_id, stripe_customer_id, created_at";
      if (resolvedOrgId) {
        const scoped = await admin
          .from("subscriptions")
          .select(selectColumns)
          .eq("organization_id", resolvedOrgId);

        if (scoped.error) {
          if (!isMissingColumnError(scoped.error, "organization_id")) throw scoped.error;
          if (debug) {
            console.log("billing-status: subscriptions.organization_id column unavailable, using Stripe fallback");
          }
        } else {
          const scopedList = Array.isArray(scoped.data) ? scoped.data : [];
          duplicateActiveCount = Math.max(duplicateActiveCount, activeRowCount(scopedList));
          subscription = scopedList.length ? pickBestSubscription(scopedList) : null;
        }
      }

      if (!subscription && resolvedOrgId && allowLegacyUserScopedFallback) {
        const legacy = await admin
          .from("subscriptions")
          .select(selectColumns)
          .eq("user_id", userId);
        if (legacy.error) {
          throw legacy.error;
        }
        const legacyList = Array.isArray(legacy.data) ? legacy.data : [];
        duplicateActiveCount = Math.max(duplicateActiveCount, activeRowCount(legacyList));
        const legacyBest = legacyList.length ? pickBestSubscription(legacyList) : null;
        if (legacyBest) {
          subscription = {
            ...legacyBest,
            organization_id: resolvedOrgId,
          };
          if (debug) {
            console.log("billing-status: using legacy user-scoped subscription", {
              userId,
              resolvedOrgId,
              stripeSubscriptionId: (legacyBest as Record<string, unknown>).stripe_subscription_id ?? null,
            });
          }
        }
      }

      if (!subscription && !resolvedOrgId) {
        const { data: subs, error } = await admin
          .from("subscriptions")
          .select(selectColumns)
          .eq("user_id", userId);
        if (error) throw error;
        const list = Array.isArray(subs) ? subs : [];
        duplicateActiveCount = Math.max(duplicateActiveCount, activeRowCount(list));
        subscription = list.length ? pickBestSubscription(list) : null;
      }
      dbStatus = subscription ? String(subscription.status || "") : "";
    } catch (e) {
      const code = (e as any)?.code;
      const message = (e as Error)?.message ?? String(e);

      if (code === "42P01") {
        console.warn("subscriptions table missing; returning minimal payload");
      } else {
        console.error("billing-status query error:", e);
        return json(req, 500, { error: "Subscription lookup failed", details: code ?? message });
      }
    }

    const shouldStripeResync =
      !subscription || !dbStatus || (dbStatus !== "active" && dbStatus !== "trialing");

    // If org has a known Stripe subscription id on billing_customers, prefer it.
    // This avoids treating paid orgs as trial just because billing_customers.status is "trialing".
    if (
      resolvedOrgId &&
      !subscription &&
      billingCustomer &&
      String(billingCustomer.stripe_subscription_id || "").trim() &&
      Deno.env.get("STRIPE_SECRET_KEY")
    ) {
      try {
        const stripe = stripeClient();
        const stripeSub = await stripe.subscriptions.retrieve(
          String(billingCustomer.stripe_subscription_id),
          { expand: ["items.data.price"] },
        );

        const orgIdFromMetadata = metadataOrgId((stripeSub as any)?.metadata ?? null);
        if (!orgIdFromMetadata || orgIdFromMetadata === resolvedOrgId) {
          subscription = {
            user_id: userId,
            organization_id: orgIdFromMetadata || resolvedOrgId,
            status: (stripeSub as any)?.status ?? null,
            price_id: (stripeSub as any)?.items?.data?.[0]?.price?.id ?? null,
            current_period_end: (stripeSub as any)?.current_period_end
              ? new Date(Number((stripeSub as any).current_period_end) * 1000).toISOString()
              : null,
            trial_end: (stripeSub as any)?.trial_end
              ? new Date(Number((stripeSub as any).trial_end) * 1000).toISOString()
              : null,
            cancel_at_period_end: Boolean((stripeSub as any)?.cancel_at_period_end),
            cancel_at: (stripeSub as any)?.cancel_at
              ? new Date(Number((stripeSub as any).cancel_at) * 1000).toISOString()
              : null,
            interval: (() => {
              const raw = (stripeSub as any)?.items?.data?.[0]?.price?.recurring?.interval ?? null;
              return raw === "month" || raw === "year" ? raw : null;
            })(),
            stripe_subscription_id: (stripeSub as any)?.id ?? null,
            stripe_customer_id: String(billingCustomer.stripe_customer_id || "") || null,
            created_at: (stripeSub as any)?.created
              ? new Date(Number((stripeSub as any).created) * 1000).toISOString()
              : null,
          };
          dbStatus = subscription ? String((subscription as any).status || "") : "";
        }
      } catch {
        // ignore; other fallback strategies may still determine status
      }
    }

    // Fallback re-sync: if DB projection is missing/stale, query Stripe directly.
    if (shouldStripeResync && Deno.env.get("STRIPE_SECRET_KEY")) {
      try {
        const { data: customerRows, error: customerErr } = await admin
          .from("stripe_customers")
          .select("user_id, stripe_customer_id")
          .in("user_id", eligibleUserIds);
        if (customerErr) throw customerErr;

        const customerList = Array.isArray(customerRows) ? customerRows : [];
        const customerToUser = new Map<string, string>();
        customerList.forEach((row) => {
          const cid = String(row?.stripe_customer_id || "");
          const uid = String(row?.user_id || "");
          if (cid && uid) customerToUser.set(cid, uid);
        });
        const stripeCustomerIds = uniq(Array.from(customerToUser.keys()));

        if (stripeCustomerIds.length) {
          const stripe = stripeClient();
          const mapped: any[] = [];

          for (const stripeCustomerId of stripeCustomerIds) {
            const stripeSubs = await stripe.subscriptions.list({
              customer: stripeCustomerId,
              status: "all",
              limit: 100,
              expand: ["data.items.data.price"],
            });
            const list = Array.isArray(stripeSubs.data) ? stripeSubs.data : [];
            list.forEach((s: any) => {
              const orgIdFromMetadata = metadataOrgId(s?.metadata ?? null);
              const mappedUserId = customerToUser.get(stripeCustomerId) ?? null;
              if (resolvedOrgId && orgIdFromMetadata && orgIdFromMetadata !== resolvedOrgId) {
                return;
              }
              if (resolvedOrgId && !orgIdFromMetadata) {
                if (!allowLegacyUserScopedFallback || mappedUserId !== userId) {
                  return;
                }
              }
              mapped.push({
                user_id: mappedUserId,
                organization_id: orgIdFromMetadata || (resolvedOrgId && allowLegacyUserScopedFallback ? resolvedOrgId : null),
                status: s?.status ?? null,
                price_id: s?.items?.data?.[0]?.price?.id ?? null,
                current_period_end: s?.current_period_end
                  ? new Date(Number(s.current_period_end) * 1000).toISOString()
                  : null,
                trial_end: s?.trial_end
                  ? new Date(Number(s.trial_end) * 1000).toISOString()
                  : null,
                cancel_at_period_end: Boolean(s?.cancel_at_period_end),
                cancel_at: s?.cancel_at
                  ? new Date(Number(s.cancel_at) * 1000).toISOString()
                  : null,
                interval: (() => {
                  const raw = s?.items?.data?.[0]?.price?.recurring?.interval ?? null;
                  return raw === "month" || raw === "year" ? raw : null;
                })(),
                stripe_subscription_id: s?.id ?? null,
                stripe_customer_id: stripeCustomerId,
                created_at: s?.created
                  ? new Date(Number(s.created) * 1000).toISOString()
                  : null,
              });
            });
          }

          const bestStripe = mapped.length ? pickBestSubscription(mapped) : null;
          duplicateActiveCount = Math.max(duplicateActiveCount, activeRowCount(mapped));
          if (bestStripe && statusPriority(bestStripe.status) >= statusPriority(dbStatus)) {
            if (debug) {
              console.log("billing-status: stripe fallback selected", {
                userId,
                resolvedOrgId,
                dbStatus,
                stripeStatus: bestStripe.status ?? null,
                stripeSubscriptionId: bestStripe.stripe_subscription_id ?? null,
                duplicateActiveCount,
              });
            }
            subscription = bestStripe;

            try {
              if (bestStripe.stripe_subscription_id) {
                const projection: Record<string, unknown> = {
                  user_id: bestStripe.user_id || userId,
                  stripe_subscription_id: bestStripe.stripe_subscription_id,
                  stripe_customer_id: bestStripe.stripe_customer_id,
                  status: bestStripe.status,
                  price_id: bestStripe.price_id,
                  interval: bestStripe.interval,
                  current_period_end: bestStripe.current_period_end,
                  trial_end: bestStripe.trial_end,
                  cancel_at_period_end: bestStripe.cancel_at_period_end,
                  cancel_at: bestStripe.cancel_at,
                  updated_at: new Date().toISOString(),
                };
                const projectionOrgId = normalizeOrgId(bestStripe.organization_id ?? null) || resolvedOrgId;
                if (projectionOrgId) projection.organization_id = projectionOrgId;

                const attempt = await admin.from("subscriptions").upsert(
                  projection,
                  { onConflict: "stripe_subscription_id" },
                );
                if (attempt.error && projectionOrgId && isMissingColumnError(attempt.error, "organization_id")) {
                  delete projection.organization_id;
                  await admin.from("subscriptions").upsert(projection, { onConflict: "stripe_subscription_id" });
                }
              }
            } catch {
              // Non-fatal: billing response should still reflect Stripe truth.
            }
          }
        }
      } catch (stripeResyncErr) {
        if (debug) {
          console.warn("billing-status: stripe fallback failed", stripeResyncErr);
        }
        // Non-fatal fallback path.
      }
    }

    if (debug && duplicateActiveCount > 1) {
      console.warn("billing-status: duplicate active subscriptions detected", {
        userId,
        orgId: resolvedOrgId,
        duplicateActiveCount,
      });
    }

    // Normalize into a flat, stable contract
    let subStatus = subscription ? String(subscription.status ?? "none") : "none";
    let isTrial = subStatus === "trialing";
    let isActive = subStatus === "active" || isTrial;

    const proMonthly = Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || "";
    const proYearly = Deno.env.get("STRIPE_PRICE_PRO_YEARLY") || "";
    const priceId = subscription ? String(subscription.price_id ?? "") : "";

    let plan: "free" | "pro" = "free";
    if (isActive) plan = "pro";

    let interval: "month" | "year" | "unknown" = "unknown";
    const storedInterval = subscription?.interval ? String(subscription.interval) : "";
    const billingCustomerInterval = billingCustomer?.billing_interval
      ? String(billingCustomer.billing_interval)
      : "";
    if (storedInterval === "month" || storedInterval === "year") {
      interval = storedInterval;
    } else if (billingCustomerInterval === "month" || billingCustomerInterval === "year") {
      interval = billingCustomerInterval;
    } else if (priceId && priceId === proMonthly) {
      interval = "month";
    } else if (priceId && priceId === proYearly) {
      interval = "year";
    } else if (subscription?.stripe_subscription_id && Deno.env.get("STRIPE_SECRET_KEY")) {
      try {
        const stripe = stripeClient();
        const stripeSub = await stripe.subscriptions.retrieve(
          String(subscription.stripe_subscription_id),
          { expand: ["items.data.price"] },
        );
        const intervalRaw = (stripeSub as any)?.items?.data?.[0]?.price?.recurring?.interval ?? null;
        if (intervalRaw === "month" || intervalRaw === "year") {
          interval = intervalRaw;
          try {
            await admin
              .from("subscriptions")
              .update({ interval })
              .eq("stripe_subscription_id", String(subscription.stripe_subscription_id));
          } catch {
            // ignore update errors
          }
        }
      } catch {
        // ignore stripe lookup errors
      }
    }

    const subscriptionTrialEndsAt = subscription?.trial_end
      ? String(subscription.trial_end)
      : subscription?.current_period_end && isTrial
        ? String(subscription.current_period_end)
        : null;
    const billingCustomerStatus = billingCustomer?.status
      ? String(billingCustomer.status).toLowerCase()
      : "";
    const billingCustomerPlanName = billingCustomer?.plan_name
      ? String(billingCustomer.plan_name).toLowerCase()
      : "";
    const billingCustomerTrialEndsAt = billingCustomer?.trial_ends_at
      ? String(billingCustomer.trial_ends_at)
      : null;
    let trialEndsAtCandidate = subscriptionTrialEndsAt || billingCustomerTrialEndsAt;

    // Org-scoped no-card trial fallback:
    // if no active/trialing Stripe subscription exists, use billing_customers.trial_ends_at.
    if (
      !isActive &&
      resolvedOrgId &&
      billingCustomerStatus === "trialing" &&
      !String(billingCustomer?.stripe_subscription_id || "").trim()
    ) {
      if (billingCustomerPlanName === "pro") {
        plan = "pro";
      }
      if (!billingCustomerTrialEndsAt) {
        subStatus = "trialing";
        isTrial = true;
        isActive = true;
        trialEndsAtCandidate = null;
      } else {
        const trialEndMs = new Date(billingCustomerTrialEndsAt).getTime();
        if (Number.isFinite(trialEndMs) && trialEndMs > Date.now()) {
          subStatus = "trialing";
          isTrial = true;
          isActive = true;
          trialEndsAtCandidate = billingCustomerTrialEndsAt;
        } else if (Number.isFinite(trialEndMs)) {
          subStatus = "trial_expired";
          isTrial = false;
          isActive = false;
          trialEndsAtCandidate = billingCustomerTrialEndsAt;
        }
      }
    }

    plan = isActive ? "pro" : "free";
    const trialEndsAt = subStatus === "trialing" ? trialEndsAtCandidate : null;

    // Keep billing_customers state aligned when Stripe/subscriptions already resolved active.
    if (resolvedOrgId && subStatus === "active" && billingCustomerStatus === "trialing") {
      try {
        await admin
          .from("billing_customers")
          .update({ status: "active", trial_ends_at: null })
          .eq("organization_id", resolvedOrgId);
      } catch (syncErr) {
        if (debug) {
          console.warn("billing-status: billing_customers active sync failed", syncErr);
        }
      }
    }

    const currentPeriodEnd = subscription?.current_period_end
      ? String(subscription.current_period_end)
      : billingCustomer?.current_period_end
        ? String(billingCustomer.current_period_end)
      : null;

    const cancelAtPeriodEnd = Boolean(
      subscription?.cancel_at_period_end ??
      billingCustomer?.cancel_at_period_end ??
      false,
    );
    const cancelAt = subscription?.cancel_at
      ? String(subscription.cancel_at)
      : null;
    const portalAvailable = Boolean(
      (subscription?.stripe_customer_id && String(subscription.stripe_customer_id).trim()) ||
      (billingCustomer?.stripe_customer_id && String(billingCustomer.stripe_customer_id).trim()),
    );
    if (!resolvedOrgId && subscription) {
      resolvedOrgId = normalizeOrgId((subscription as Record<string, unknown>).organization_id ?? null);
    }

    const responsePayload: Record<string, unknown> = {
      ok: true,
      userId,
      orgId: resolvedOrgId,
      plan,
      status: subStatus,
      isActive,
      interval,
      duplicateActiveCount,
      trialEndsAt,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      cancelAt,
      portalAvailable,
    };
    if (responseDebugEnabled) {
      responsePayload.debug = {
        billingCustomerFound: !!billingCustomer,
        billingCustomerStatus: billingCustomerStatus || null,
        billingCustomerTrialEndsAt,
        usedServiceRole,
      };
    }
    return json(req, 200, responsePayload);
  } catch (e) {
    console.error("billing-status fatal:", e);
    return json(req, 500, { error: String(e?.message ?? e) });
  }
});
