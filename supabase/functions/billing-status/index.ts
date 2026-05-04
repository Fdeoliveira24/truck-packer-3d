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

type EntitlementStatus =
  | "active"
  | "trialing"
  | "trial_expired"
  | "included_in_plan"
  | "workspace_limit_reached"
  | "owner_subscription_required"
  | "billing_unavailable";

type OwnerWorkspace = {
  id: string;
  created_at: string | null;
};

type EntitlementCandidate = {
  organization_id: string;
  status: string;
  price_id: string;
  current_period_end: string | null;
  trial_end: string | null;
  created_at: string | null;
  source: "subscription" | "billing_customer";
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  interval?: "month" | "year" | null;
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

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = String(Deno.env.get(name) || "").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBusinessPriceIds(): string[] {
  return uniq([
    String(Deno.env.get("STRIPE_PRICE_BUSINESS_MONTHLY") || "").trim(),
    String(Deno.env.get("STRIPE_PRICE_BUSINESS_YEARLY") || "").trim(),
  ]);
}

function workspaceLimitForEntitlement(status: string, priceId: string): number {
  if (status === "trialing") {
    return parsePositiveIntEnv("TP3D_TRIAL_WORKSPACE_LIMIT", 1);
  }
  const businessPriceIds = getBusinessPriceIds();
  if (businessPriceIds.length && priceId && businessPriceIds.includes(priceId)) {
    return parsePositiveIntEnv("TP3D_BUSINESS_WORKSPACE_LIMIT", 10);
  }
  return parsePositiveIntEnv("TP3D_PRO_WORKSPACE_LIMIT", 3);
}

function normalizeInterval(value: unknown): "month" | "year" | null {
  const raw = String(value || "").trim();
  return raw === "month" || raw === "year" ? raw : null;
}

function normalizePaymentStatus(value: unknown): string | null {
  const raw = String(value || "").trim().toLowerCase();
  return [
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "paused",
    "none",
  ].includes(raw)
    ? raw
    : null;
}

function paymentGraceActive(status: string, currentPeriodEnd: string | null): boolean {
  const graceDaysByStatus: Record<string, number> = {
    past_due: 7,
    unpaid: 3,
  };
  const graceDays = graceDaysByStatus[status];
  if (!graceDays || !currentPeriodEnd) return false;
  const periodEndMs = new Date(currentPeriodEnd).getTime();
  if (!Number.isFinite(periodEndMs)) return false;
  return Date.now() < periodEndMs + graceDays * 86400000;
}

function isUsableEntitlementCandidate(row: EntitlementCandidate): boolean {
  const status = String(row.status || "");
  if (status === "active" || status === "trialing") return true;
  return paymentGraceActive(status, row.current_period_end);
}

function pickBestEntitlementCandidate(rows: EntitlementCandidate[]): EntitlementCandidate | null {
  const usable = rows.filter(isUsableEntitlementCandidate);
  return usable.length ? pickBestSubscription(usable) : null;
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

function isTruthyEnv(name: string): boolean {
  const raw = String(Deno.env.get(name) || "").trim().toLowerCase();
  return raw === "1" || raw === "true";
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
    const backendDebugEnabled = isTruthyEnv("TP3D_DEBUG");
    const debug = Deno.env.get("SUPABASE_DEBUG") === "1" || backendDebugEnabled;
    if (debug) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
      console.log("auth header present:", !!authHeader);
      console.log("auth header starts with Bearer:", authHeader.toLowerCase().startsWith("bearer "));
      const raw = authHeader.replace(/^bearer\\s+/i, "").trim();
      console.log("jwt segments:", raw ? raw.split(".").length : 0);
      console.log("jwt len:", raw.length);
    }

    const requestUrl = new URL(req.url);
    const responseDebugEnabled = backendDebugEnabled && requestUrl.searchParams.get("tp3dDebug") === "1";
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
    if (debug) {
      console.log("billing-status startup", {
        envKeyUsed,
        hasServiceRoleKey,
        hasAnonKey: Boolean(anonKey),
        normalizedHost: normalizedSupabaseUrl.host,
      });
    }

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

    let billingOwnerUserId: string | null = null;
    let workspaceIncluded = false;
    let workspaceCount: number | null = null;
    let workspaceLimit: number | null = null;
    let canManageBilling = false;
    let entitlementStatus: EntitlementStatus = "billing_unavailable";
    let entitlementResolutionFailed = false;
    let ownerWorkspaces: OwnerWorkspace[] = [];
    let ownerEntitlementCandidate: EntitlementCandidate | null = null;
    let ownerEntitlementCandidateCount = 0;
    let ownerHasStripeCustomerForPortal = false;
    let ownerMetadataInterval: "month" | "year" | null = null;
    let ownerMetadataCurrentPeriodEnd: string | null = null;
    let ownerSubscriptionRequiredReason: string | null = null;
    let includedOrgIds: string[] = [];
    let activeOrgCreatedAt: string | null = null;
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

      const activeOrgRes = await admin
        .from("organizations")
        .select("id, owner_id, created_at")
        .eq("id", resolvedOrgId)
        .maybeSingle();

      if (activeOrgRes.error || !activeOrgRes.data) {
        entitlementResolutionFailed = true;
        if (debug) {
          console.warn("billing-status: active workspace owner lookup failed", activeOrgRes.error);
        }
      } else {
        activeOrgCreatedAt = activeOrgRes.data?.created_at ? String(activeOrgRes.data.created_at) : null;
        const ownerFromOrg = activeOrgRes.data?.owner_id ? String(activeOrgRes.data.owner_id) : "";
        const ownerFromMembership = rows.find(r => String(r?.role || "").toLowerCase() === "owner")?.user_id;
        billingOwnerUserId = ownerFromOrg || (ownerFromMembership ? String(ownerFromMembership) : null);
        canManageBilling = Boolean(billingOwnerUserId && billingOwnerUserId === userId);
      }

      if (billingOwnerUserId) {
        const ownerMembershipsRes = await admin
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", billingOwnerUserId)
          .eq("role", "owner");

        if (ownerMembershipsRes.error) {
          entitlementResolutionFailed = true;
          if (debug) {
            console.warn("billing-status: owner membership workspace lookup failed", ownerMembershipsRes.error);
          }
        } else {
          const ownerMembershipOrgIds = uniq(
            (Array.isArray(ownerMembershipsRes.data) ? ownerMembershipsRes.data : [])
              .map(row => normalizeOrgId(row?.organization_id ?? null) || "")
              .filter(Boolean),
          );
          if (ownerMembershipOrgIds.length) {
            const ownerWorkspacesRes = await admin
              .from("organizations")
              .select("id, created_at")
              .eq("owner_id", billingOwnerUserId)
              .in("id", ownerMembershipOrgIds)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true });

            if (ownerWorkspacesRes.error) {
              entitlementResolutionFailed = true;
              if (debug) {
                console.warn("billing-status: owner workspace lookup failed", ownerWorkspacesRes.error);
              }
            } else {
              ownerWorkspaces = (Array.isArray(ownerWorkspacesRes.data) ? ownerWorkspacesRes.data : [])
                .map(row => ({
                  id: normalizeOrgId(row?.id ?? null) || "",
                  created_at: row?.created_at ? String(row.created_at) : null,
                }))
                .filter(row => Boolean(row.id));
            }
          } else {
            ownerWorkspaces = [];
          }
          if (!ownerWorkspaces.some(row => row.id === resolvedOrgId)) {
            const activeOwnerId = normalizeOrgId(activeOrgRes.data?.owner_id ?? null);
            const activeHasOwnerMembership = rows.some(r => {
              const role = String(r?.role || "").toLowerCase();
              return role === "owner" && String(r?.user_id || "") === billingOwnerUserId;
            });
            if (resolvedOrgId && activeOwnerId === billingOwnerUserId && activeHasOwnerMembership) {
              ownerWorkspaces.push({ id: resolvedOrgId, created_at: activeOrgCreatedAt });
              ownerWorkspaces.sort((a, b) => {
                const aMs = a.created_at ? new Date(a.created_at).getTime() : 0;
                const bMs = b.created_at ? new Date(b.created_at).getTime() : 0;
                if (aMs !== bMs) return aMs - bMs;
                return a.id.localeCompare(b.id);
              });
            }
          }
          workspaceCount = ownerWorkspaces.length;
        }
      } else {
        entitlementResolutionFailed = true;
      }

      const billingCustomerRes = await admin
        .from("billing_customers")
        .select("organization_id, stripe_customer_id, stripe_subscription_id, status, plan_name, billing_interval, current_period_end, cancel_at_period_end, trial_ends_at")
        .eq("organization_id", resolvedOrgId)
        .maybeSingle();
      billingCustomer = billingCustomerRes.data ?? null;
      if (debug) {
        console.log("billing_customers lookup", {
          orgId: resolvedOrgId,
          found: !!billingCustomer,
          error: billingCustomerRes.error?.message || null,
        });
      }
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

    if (resolvedOrgId && billingOwnerUserId && ownerWorkspaces.length) {
      const ownerWorkspaceIds = ownerWorkspaces.map(row => row.id).filter(Boolean);
      const ownerWorkspaceIdSet = new Set(ownerWorkspaceIds);
      const entitlementCandidates: EntitlementCandidate[] = [];
      try {
        const ownerBillingCustomerByOrg = new Map<string, Record<string, unknown>>();
        const ownerBillingCustomerBySubscription = new Map<string, Record<string, unknown>>();
        const oldestOwnerWorkspaceId = ownerWorkspaces[0]?.id || "";
        const recordOwnerPaymentMetadata = (row: Record<string, unknown>) => {
          const stripeCustomerId = String(row?.stripe_customer_id || "").trim();
          if (stripeCustomerId) ownerHasStripeCustomerForPortal = true;

          const status = normalizePaymentStatus(row?.status ?? null);
          const periodEnd = row?.current_period_end ? String(row.current_period_end) : null;
          if (!status || (status !== "active" && status !== "trialing" && !paymentGraceActive(status, periodEnd))) {
            return;
          }

          const rowInterval = normalizeInterval(row?.interval ?? row?.billing_interval ?? null);
          if (!ownerMetadataInterval && rowInterval) {
            ownerMetadataInterval = rowInterval;
          }
          if (!ownerMetadataCurrentPeriodEnd && periodEnd) {
            ownerMetadataCurrentPeriodEnd = periodEnd;
          }
        };
        const mapSubscriptionToOwnerWorkspace = (
          stripeSubscriptionId: unknown,
          orgIdFromMetadata: string | null,
        ): string | null => {
          if (orgIdFromMetadata) {
            return ownerWorkspaceIdSet.has(orgIdFromMetadata) ? orgIdFromMetadata : null;
          }
          const sid = String(stripeSubscriptionId || "").trim();
          if (sid) {
            const billingRow = ownerBillingCustomerBySubscription.get(sid);
            const billingOrgId = normalizeOrgId(billingRow?.organization_id ?? null);
            if (billingOrgId && ownerWorkspaceIdSet.has(billingOrgId)) {
              return billingOrgId;
            }
          }
          return oldestOwnerWorkspaceId || null;
        };

        const ownerSubscriptionCandidates: EntitlementCandidate[] = [];
        const pushMappedSubscriptionCandidate = (row: Record<string, unknown>) => {
          const rawOrgId = normalizeOrgId(row?.organization_id ?? null);
          if (rawOrgId && !ownerWorkspaceIdSet.has(rawOrgId)) return;
          const resolvedCandidateOrgId = mapSubscriptionToOwnerWorkspace(
            row?.stripe_subscription_id ?? null,
            rawOrgId,
          );
          if (!resolvedCandidateOrgId) return;
          const candidate: EntitlementCandidate = {
            organization_id: resolvedCandidateOrgId,
            status: String(row?.status || "none"),
            price_id: row?.price_id ? String(row.price_id) : "",
            current_period_end: row?.current_period_end ? String(row.current_period_end) : null,
            trial_end: row?.trial_end ? String(row.trial_end) : null,
            created_at: row?.created_at ? String(row.created_at) : null,
            stripe_subscription_id: row?.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
            stripe_customer_id: row?.stripe_customer_id ? String(row.stripe_customer_id) : null,
            interval: normalizeInterval(row?.interval ?? null),
            source: "subscription",
          };
          ownerSubscriptionCandidates.push(candidate);
          entitlementCandidates.push(candidate);
          recordOwnerPaymentMetadata(candidate as unknown as Record<string, unknown>);
        };
        const subscriptionColumnsWithOrg =
          "organization_id, status, price_id, current_period_end, trial_end, created_at, stripe_subscription_id, stripe_customer_id, interval";
        const subscriptionColumnsWithOrgBasic =
          "organization_id, status, price_id, current_period_end, trial_end, created_at, stripe_subscription_id";
        const subscriptionColumnsNoOrg =
          "status, price_id, current_period_end, trial_end, created_at, stripe_subscription_id, stripe_customer_id, interval";
        const subscriptionColumnsNoOrgBasic =
          "status, price_id, current_period_end, trial_end, created_at, stripe_subscription_id";

        // Owner entitlement subscription lookup: tolerant of missing optional projection columns.
        let ownerSubs = await admin
          .from("subscriptions")
          .select(subscriptionColumnsWithOrg)
          .in("organization_id", ownerWorkspaceIds);

        if (ownerSubs.error && isMissingColumnError(ownerSubs.error, "organization_id")) {
          let ownerSubsNoOrg = await admin
            .from("subscriptions")
            .select(subscriptionColumnsNoOrg)
            .eq("user_id", billingOwnerUserId)
            .in("status", ["active", "trialing", "past_due", "unpaid"])
            .order("created_at", { ascending: false })
            .limit(10);
          if (
            ownerSubsNoOrg.error &&
            (isMissingColumnError(ownerSubsNoOrg.error, "stripe_customer_id") ||
              isMissingColumnError(ownerSubsNoOrg.error, "interval"))
          ) {
            ownerSubsNoOrg = await admin
              .from("subscriptions")
              .select(subscriptionColumnsNoOrgBasic)
              .eq("user_id", billingOwnerUserId)
              .in("status", ["active", "trialing", "past_due", "unpaid"])
              .order("created_at", { ascending: false })
              .limit(10);
          }
          if (ownerSubsNoOrg.error) {
            if (debug) {
              console.warn("billing-status: optional owner org subscription retry skipped", ownerSubsNoOrg.error);
            }
          } else {
            (Array.isArray(ownerSubsNoOrg.data) ? ownerSubsNoOrg.data : [])
              .forEach(row => pushMappedSubscriptionCandidate(row as Record<string, unknown>));
          }
          if (debug) {
            console.warn("billing-status: owner entitlement subscription lookup missing organization_id", ownerSubs.error);
          }
        } else if (
          ownerSubs.error &&
          (isMissingColumnError(ownerSubs.error, "stripe_customer_id") ||
            isMissingColumnError(ownerSubs.error, "interval"))
        ) {
          ownerSubs = await admin
            .from("subscriptions")
            .select(subscriptionColumnsWithOrgBasic)
            .in("organization_id", ownerWorkspaceIds);
          if (ownerSubs.error) {
            if (debug) {
              console.warn("billing-status: owner entitlement subscription basic retry failed", ownerSubs.error);
            }
          } else {
            (Array.isArray(ownerSubs.data) ? ownerSubs.data : []).forEach(row => {
              const orgId = normalizeOrgId(row?.organization_id ?? null);
              if (!orgId) return;
              const candidate: EntitlementCandidate = {
                organization_id: orgId,
                status: String(row?.status || "none"),
                price_id: row?.price_id ? String(row.price_id) : "",
                current_period_end: row?.current_period_end ? String(row.current_period_end) : null,
                trial_end: row?.trial_end ? String(row.trial_end) : null,
                created_at: row?.created_at ? String(row.created_at) : null,
                stripe_subscription_id: row?.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
                stripe_customer_id: null,
                interval: null,
                source: "subscription",
              };
              ownerSubscriptionCandidates.push(candidate);
              entitlementCandidates.push(candidate);
              recordOwnerPaymentMetadata(candidate as unknown as Record<string, unknown>);
            });
          }
        } else if (ownerSubs.error) {
          if (debug) {
            console.warn("billing-status: owner entitlement subscription lookup failed", ownerSubs.error);
          }
        } else {
          (Array.isArray(ownerSubs.data) ? ownerSubs.data : []).forEach(row => {
            const orgId = normalizeOrgId(row?.organization_id ?? null);
            if (!orgId) return;
            const candidate: EntitlementCandidate = {
              organization_id: orgId,
              status: String(row?.status || "none"),
              price_id: row?.price_id ? String(row.price_id) : "",
              current_period_end: row?.current_period_end ? String(row.current_period_end) : null,
              trial_end: row?.trial_end ? String(row.trial_end) : null,
              created_at: row?.created_at ? String(row.created_at) : null,
              stripe_subscription_id: row?.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
              stripe_customer_id: row?.stripe_customer_id ? String(row.stripe_customer_id) : null,
              interval: normalizeInterval(row?.interval ?? null),
              source: "subscription",
            };
            ownerSubscriptionCandidates.push(candidate);
            entitlementCandidates.push(candidate);
            recordOwnerPaymentMetadata(candidate as unknown as Record<string, unknown>);
          });
        }

        const ownerBillingCustomers = await admin
          .from("billing_customers")
          .select("organization_id, status, plan_name, billing_interval, current_period_end, trial_ends_at, created_at, stripe_subscription_id, stripe_customer_id")
          .in("organization_id", ownerWorkspaceIds);

        if (ownerBillingCustomers.error) {
          throw ownerBillingCustomers.error;
        }

        const ownerBillingCustomerRows = Array.isArray(ownerBillingCustomers.data) ? ownerBillingCustomers.data : [];
        ownerBillingCustomerRows.forEach(row => {
          const orgId = normalizeOrgId(row?.organization_id ?? null);
          if (!orgId) return;
          ownerBillingCustomerByOrg.set(orgId, row as Record<string, unknown>);
          const stripeSubscriptionId = String(row?.stripe_subscription_id || "").trim();
          if (stripeSubscriptionId) {
            ownerBillingCustomerBySubscription.set(stripeSubscriptionId, row as Record<string, unknown>);
          }
          recordOwnerPaymentMetadata(row as Record<string, unknown>);
          const status = String(row?.status || "none").toLowerCase();
          const trialEnd = row?.trial_ends_at ? String(row.trial_ends_at) : null;
          if (status === "trialing" && trialEnd) {
            const trialEndMs = new Date(trialEnd).getTime();
            if (Number.isFinite(trialEndMs) && trialEndMs <= Date.now()) return;
          }
          entitlementCandidates.push({
            organization_id: orgId,
            status,
            price_id: "",
            current_period_end: row?.current_period_end ? String(row.current_period_end) : null,
            trial_end: trialEnd,
            created_at: row?.created_at ? String(row.created_at) : null,
            stripe_subscription_id: row?.stripe_subscription_id ? String(row.stripe_subscription_id) : null,
            stripe_customer_id: row?.stripe_customer_id ? String(row.stripe_customer_id) : null,
            interval: normalizeInterval(row?.billing_interval ?? null),
            source: "billing_customer",
          });
        });

        // Legacy owner subscription fallback: tolerant of missing columns
        let legacyOwnerSubs = await admin
          .from("subscriptions")
          .select(subscriptionColumnsWithOrg)
          .eq("user_id", billingOwnerUserId)
          .in("status", ["active", "trialing", "past_due", "unpaid"])
          .order("created_at", { ascending: false })
          .limit(10);

        if (legacyOwnerSubs.error && isMissingColumnError(legacyOwnerSubs.error, "organization_id")) {
          legacyOwnerSubs = await admin
            .from("subscriptions")
            .select(subscriptionColumnsNoOrg)
            .eq("user_id", billingOwnerUserId)
            .in("status", ["active", "trialing", "past_due", "unpaid"])
            .order("created_at", { ascending: false })
            .limit(10);
        }
        if (
          legacyOwnerSubs.error &&
          (isMissingColumnError(legacyOwnerSubs.error, "stripe_customer_id") ||
            isMissingColumnError(legacyOwnerSubs.error, "interval"))
        ) {
          legacyOwnerSubs = await admin
            .from("subscriptions")
            .select(subscriptionColumnsNoOrgBasic)
            .eq("user_id", billingOwnerUserId)
            .in("status", ["active", "trialing", "past_due", "unpaid"])
            .order("created_at", { ascending: false })
            .limit(10);
        }

        if (legacyOwnerSubs.error) {
          if (debug) {
            console.warn("billing-status: owner legacy subscription fallback failed", legacyOwnerSubs.error);
          }
        } else {
          (Array.isArray(legacyOwnerSubs.data) ? legacyOwnerSubs.data : [])
            .forEach(row => pushMappedSubscriptionCandidate(row as Record<string, unknown>));
        }

        const ownerStripeSubscriptionIds = uniq(
          ownerBillingCustomerRows
            .map(row => String(row?.stripe_subscription_id || "").trim())
            .filter(Boolean),
        );
        if (ownerStripeSubscriptionIds.length) {
          let ownerSubsByStripeId = await admin
            .from("subscriptions")
            .select(subscriptionColumnsWithOrg)
            .in("stripe_subscription_id", ownerStripeSubscriptionIds)
            .in("status", ["active", "trialing", "past_due", "unpaid"])
            .limit(20);

          if (ownerSubsByStripeId.error && isMissingColumnError(ownerSubsByStripeId.error, "organization_id")) {
            // Retry without organization_id column
            ownerSubsByStripeId = await admin
              .from("subscriptions")
              .select(subscriptionColumnsNoOrg)
              .in("stripe_subscription_id", ownerStripeSubscriptionIds)
              .in("status", ["active", "trialing", "past_due", "unpaid"])
              .limit(20);
          }
          if (
            ownerSubsByStripeId.error &&
            (isMissingColumnError(ownerSubsByStripeId.error, "stripe_customer_id") ||
              isMissingColumnError(ownerSubsByStripeId.error, "interval"))
          ) {
            ownerSubsByStripeId = await admin
              .from("subscriptions")
              .select(subscriptionColumnsNoOrgBasic)
              .in("stripe_subscription_id", ownerStripeSubscriptionIds)
              .in("status", ["active", "trialing", "past_due", "unpaid"])
              .limit(20);
          }

          if (ownerSubsByStripeId.error) {
            if (debug) {
              console.warn("billing-status: ownerSubsByStripeId fallback failed", ownerSubsByStripeId.error);
            }
          } else {
            (Array.isArray(ownerSubsByStripeId.data) ? ownerSubsByStripeId.data : [])
              .forEach(row => pushMappedSubscriptionCandidate(row as Record<string, unknown>));
          }
        }

        const ownerStripeCustomerIds = uniq(
          ownerBillingCustomerRows
            .map(row => String(row?.stripe_customer_id || "").trim())
            .filter(Boolean),
        );
        if (ownerStripeCustomerIds.length) {
          let ownerSubsByCustomerId = await admin
            .from("subscriptions")
            .select(subscriptionColumnsWithOrg)
            .in("stripe_customer_id", ownerStripeCustomerIds)
            .in("status", ["active", "trialing", "past_due", "unpaid"])
            .limit(20);

          if (ownerSubsByCustomerId.error && isMissingColumnError(ownerSubsByCustomerId.error, "organization_id")) {
            ownerSubsByCustomerId = await admin
              .from("subscriptions")
              .select(subscriptionColumnsNoOrg)
              .in("stripe_customer_id", ownerStripeCustomerIds)
              .in("status", ["active", "trialing", "past_due", "unpaid"])
              .limit(20);
          }
          if (ownerSubsByCustomerId.error && isMissingColumnError(ownerSubsByCustomerId.error, "interval")) {
            ownerSubsByCustomerId = await admin
              .from("subscriptions")
              .select(subscriptionColumnsNoOrgBasic)
              .in("stripe_customer_id", ownerStripeCustomerIds)
              .in("status", ["active", "trialing", "past_due", "unpaid"])
              .limit(20);
          }

          if (ownerSubsByCustomerId.error && isMissingColumnError(ownerSubsByCustomerId.error, "stripe_customer_id")) {
            if (debug) {
              console.warn("billing-status: ownerSubsByCustomerId missing stripe_customer_id column, skipping fallback", ownerSubsByCustomerId.error);
            }
          } else if (ownerSubsByCustomerId.error) {
            if (debug) {
              console.warn("billing-status: ownerSubsByCustomerId fallback failed", ownerSubsByCustomerId.error);
            }
          } else {
            (Array.isArray(ownerSubsByCustomerId.data) ? ownerSubsByCustomerId.data : [])
              .forEach(row => pushMappedSubscriptionCandidate(row as Record<string, unknown>));
          }
        }

        let ownerStripeCustomerId = "";
        try {
          const ownerCustomerRes = await admin
            .from("stripe_customers")
            .select("stripe_customer_id")
            .eq("user_id", billingOwnerUserId)
            .maybeSingle();
          ownerStripeCustomerId = ownerCustomerRes.data?.stripe_customer_id
            ? String(ownerCustomerRes.data.stripe_customer_id)
            : "";
          if (ownerStripeCustomerId) {
            ownerHasStripeCustomerForPortal = true;
          } else if (ownerCustomerRes.error && debug) {
            console.warn("billing-status: owner stripe_customers lookup failed", ownerCustomerRes.error);
          }
        } catch (ownerCustomerLookupErr) {
          if (debug) {
            console.warn("billing-status: owner stripe_customers lookup threw", ownerCustomerLookupErr);
          }
        }

        if (Deno.env.get("STRIPE_SECRET_KEY")) {
          try {
            const stripe = stripeClient();
            const pushStripeSubscriptionCandidate = (s: any) => {
              const orgIdFromMetadata = metadataOrgId(s?.metadata ?? null);
              if (orgIdFromMetadata && !ownerWorkspaceIdSet.has(orgIdFromMetadata)) return;
              const resolvedCandidateOrgId = mapSubscriptionToOwnerWorkspace(s?.id ?? null, orgIdFromMetadata);
              if (!resolvedCandidateOrgId) return;
              const intervalRaw = s?.items?.data?.[0]?.price?.recurring?.interval ?? null;
              const candidate: EntitlementCandidate = {
                organization_id: resolvedCandidateOrgId,
                status: s?.status ? String(s.status) : "none",
                price_id: s?.items?.data?.[0]?.price?.id ? String(s.items.data[0].price.id) : "",
                current_period_end: s?.current_period_end
                  ? new Date(Number(s.current_period_end) * 1000).toISOString()
                  : null,
                trial_end: s?.trial_end
                  ? new Date(Number(s.trial_end) * 1000).toISOString()
                  : null,
                created_at: s?.created
                  ? new Date(Number(s.created) * 1000).toISOString()
                  : null,
                stripe_subscription_id: s?.id ? String(s.id) : null,
                stripe_customer_id: s?.customer ? String(s.customer) : null,
                interval: normalizeInterval(intervalRaw),
                source: "subscription",
              };
              entitlementCandidates.push(candidate);
              recordOwnerPaymentMetadata(candidate as unknown as Record<string, unknown>);
            };

            for (const stripeSubscriptionId of ownerStripeSubscriptionIds) {
              try {
                const stripeSub = await stripe.subscriptions.retrieve(
                  stripeSubscriptionId,
                  { expand: ["items.data.price"] },
                );
                pushStripeSubscriptionCandidate(stripeSub);
              } catch {
                if (debug) {
                  console.warn("billing-status: owner known subscription fallback failed");
                }
              }
            }

            if (ownerStripeCustomerId) {
              const stripeSubs = await stripe.subscriptions.list({
                customer: ownerStripeCustomerId,
                status: "all",
                limit: 100,
                expand: ["data.items.data.price"],
              });
              (Array.isArray(stripeSubs.data) ? stripeSubs.data : [])
                .forEach((s: any) => pushStripeSubscriptionCandidate(s));
            }
          } catch (stripeOwnerEntitlementErr) {
            if (debug) {
              console.warn("billing-status: owner Stripe entitlement fallback failed", stripeOwnerEntitlementErr);
            }
          }
        }

        ownerEntitlementCandidateCount = entitlementCandidates.length;
        ownerEntitlementCandidate = pickBestEntitlementCandidate(entitlementCandidates);
        const ownerEntitlementOrgId = normalizeOrgId(ownerEntitlementCandidate?.organization_id ?? null);
        if (
          ownerEntitlementCandidate &&
          String(ownerEntitlementCandidate.status || "") === "active" &&
          ownerEntitlementOrgId &&
          ownerWorkspaceIdSet.has(ownerEntitlementOrgId)
        ) {
          try {
            const candidateBillingCustomer = ownerBillingCustomerByOrg.get(ownerEntitlementOrgId);
            const candidateBillingStatus = String(candidateBillingCustomer?.status || "").toLowerCase();
            if (candidateBillingStatus === "trialing") {
              await admin
                .from("billing_customers")
                .update({ status: "active", trial_ends_at: null })
                .eq("organization_id", ownerEntitlementOrgId);
            }
          } catch (ownerBillingSyncErr) {
            if (debug) {
              console.warn("billing-status: owner billing_customers active sync failed", ownerBillingSyncErr);
            }
          }
        }
      } catch (ownerEntitlementErr) {
        entitlementResolutionFailed = true;
        if (debug) {
          console.warn("billing-status: owner entitlement lookup failed", ownerEntitlementErr);
        }
      }
    } else if (resolvedOrgId) {
      entitlementResolutionFailed = true;
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

    // Handle billing_customers.status already set to "trial_expired" with no subscription row.
    // Covers orgs where the trial expiry was recorded directly in billing_customers
    // (e.g. bulk update) and no Stripe subscription exists yet.
    if (!isActive && subStatus === "none" && resolvedOrgId && billingCustomerStatus === "trial_expired") {
      subStatus = "trial_expired";
      isTrial = false;
      isActive = false;
      trialEndsAtCandidate = billingCustomerTrialEndsAt ?? trialEndsAtCandidate;
    }

    // Synthesize trial_expired for Stripe-managed trials that expired without paid conversion.
    // Guards: subscription exists, !isActive, not already trialing or trial_expired,
    // trial_end is set and in the past, and no evidence of a paid billing cycle.
    if (!isActive && subscription && subStatus !== "trialing" && subStatus !== "trial_expired") {
      const stripeTrialEndRaw = subscription.trial_end ? String(subscription.trial_end) : null;
      if (stripeTrialEndRaw) {
        const stripeTrialEndMs = new Date(stripeTrialEndRaw).getTime();
        if (Number.isFinite(stripeTrialEndMs) && stripeTrialEndMs < Date.now()) {
          // If current_period_end is >3 days after trial_end the user converted to paid;
          // do NOT emit trial_expired in that case (treat as a normal cancellation).
          const periodEndRaw = subscription.current_period_end ? String(subscription.current_period_end) : null;
          const periodEndMs = periodEndRaw ? new Date(periodEndRaw).getTime() : NaN;
          const hadPaidConversion = Number.isFinite(periodEndMs) && (periodEndMs - stripeTrialEndMs) > 86400000 * 3;
          if (!hadPaidConversion) {
            subStatus = "trial_expired";
            isTrial = false;
            isActive = false;
          }
        }
      }
    }

    plan = isActive ? "pro" : "free";
    let trialEndsAt = subStatus === "trialing" ? trialEndsAtCandidate : null;
    let currentPeriodEnd = subscription?.current_period_end
      ? String(subscription.current_period_end)
      : billingCustomer?.current_period_end
        ? String(billingCustomer.current_period_end)
        : null;

    // ── P0.8: Payment failure grace rules ──
    // Trial logic takes absolute priority — skip payment problem when trial-related.
    const PAYMENT_GRACE_DAYS: Record<string, number> = {
      past_due: 7,
      unpaid: 3,
      incomplete: 0,
      incomplete_expired: 0,
    };
    let paymentProblem = false;
    let paymentGraceUntil: string | null = null;
    let paymentGraceRemainingDays: number | null = null;
    let paymentAction: string | null = null;
    if (
      !isTrial &&
      subStatus !== "trial_expired" &&
      Object.prototype.hasOwnProperty.call(PAYMENT_GRACE_DAYS, subStatus)
    ) {
      paymentProblem = true;
      paymentAction = "fix_payment";
      const graceDays = PAYMENT_GRACE_DAYS[subStatus];
      if (graceDays > 0 && currentPeriodEnd) {
        const periodEndMs = new Date(currentPeriodEnd).getTime();
        if (Number.isFinite(periodEndMs)) {
          const graceEndMs = periodEndMs + graceDays * 86400000;
          paymentGraceUntil = new Date(graceEndMs).toISOString();
          paymentGraceRemainingDays = Math.max(0, Math.ceil((graceEndMs - Date.now()) / 86400000));
          if (Date.now() < graceEndMs) {
            // During grace: keep Pro access
            isActive = true;
            plan = "pro";
          } else {
            // Grace expired: revoke Pro access
            isActive = false;
            plan = "free";
          }
        } else {
          // Can't compute grace without valid period end — treat as expired
          isActive = false;
          plan = "free";
          paymentGraceRemainingDays = 0;
        }
      } else {
        // 0-day grace (incomplete / incomplete_expired) — not active immediately
        isActive = false;
        plan = "free";
        paymentGraceRemainingDays = 0;
      }
    }

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

    const cancelAtPeriodEnd = Boolean(
      subscription?.cancel_at_period_end ??
      billingCustomer?.cancel_at_period_end ??
      false,
    );
    const cancelAt = subscription?.cancel_at
      ? String(subscription.cancel_at)
      : null;
    let portalAvailable = Boolean(
      (subscription?.stripe_customer_id && String(subscription.stripe_customer_id).trim()) ||
      (billingCustomer?.stripe_customer_id && String(billingCustomer.stripe_customer_id).trim()),
    );
    if (!resolvedOrgId && subscription) {
      resolvedOrgId = normalizeOrgId((subscription as Record<string, unknown>).organization_id ?? null);
    }

    const directTrialing = subStatus === "trialing" && isActive;
    const directTrialExpired = subStatus === "trial_expired";
    const directActive =
      (subStatus === "active" && isActive) ||
      (
        isActive &&
        plan === "pro" &&
        paymentProblem &&
        subStatus !== "trialing" &&
        subStatus !== "trial_expired"
      );

    if (ownerEntitlementCandidate && resolvedOrgId && billingOwnerUserId) {
      const resolvedWorkspaceLimit = workspaceLimitForEntitlement(
        String(ownerEntitlementCandidate.status || ""),
        String(ownerEntitlementCandidate.price_id || ""),
      );
      workspaceLimit = resolvedWorkspaceLimit;
      includedOrgIds = [];
      const directOrgId = normalizeOrgId(ownerEntitlementCandidate.organization_id) || "";
      if (directOrgId && resolvedWorkspaceLimit > 0) includedOrgIds.push(directOrgId);
      for (const workspace of ownerWorkspaces) {
        if (includedOrgIds.length >= resolvedWorkspaceLimit) break;
        if (!workspace.id || workspace.id === directOrgId) continue;
        includedOrgIds.push(workspace.id);
      }
      workspaceIncluded = includedOrgIds.includes(resolvedOrgId);
      if (!workspaceIncluded) {
        entitlementStatus = "workspace_limit_reached";
        isActive = false;
        plan = "pro";
      } else if (directOrgId === resolvedOrgId) {
        entitlementStatus = String(ownerEntitlementCandidate.status || "") === "trialing"
          ? "trialing"
          : "active";
        isActive = true;
        plan = "pro";
      } else {
        entitlementStatus = "included_in_plan";
        isActive = true;
        plan = "pro";
      }
    } else if (directActive) {
      entitlementStatus = "active";
      workspaceIncluded = true;
      workspaceLimit = workspaceLimitForEntitlement("active", priceId);
      isActive = true;
      plan = "pro";
      includedOrgIds = resolvedOrgId ? [resolvedOrgId] : [];
    } else if (directTrialing) {
      entitlementStatus = "trialing";
      workspaceIncluded = true;
      workspaceLimit = workspaceLimitForEntitlement("trialing", priceId);
      isActive = true;
      plan = "pro";
      includedOrgIds = resolvedOrgId ? [resolvedOrgId] : [];
    } else if (directTrialExpired) {
      entitlementStatus = "trial_expired";
      workspaceIncluded = false;
      workspaceLimit = parsePositiveIntEnv("TP3D_TRIAL_WORKSPACE_LIMIT", 1);
      isActive = false;
      plan = "free";
    } else if (resolvedOrgId && billingOwnerUserId) {
      entitlementStatus = "owner_subscription_required";
      ownerSubscriptionRequiredReason = ownerWorkspaces.length
        ? "no_usable_owner_entitlement_candidate"
        : "no_valid_owner_workspaces";
      workspaceIncluded = false;
      workspaceLimit = workspaceLimit ?? parsePositiveIntEnv("TP3D_PRO_WORKSPACE_LIMIT", 3);
      isActive = false;
      plan = "free";
    } else {
      workspaceIncluded = false;
      workspaceLimit = null;
      entitlementStatus = "billing_unavailable";
      isActive = false;
      plan = "free";
    }

    if (
      ownerEntitlementCandidate &&
      (entitlementStatus === "active" ||
        entitlementStatus === "trialing" ||
        entitlementStatus === "included_in_plan" ||
        entitlementStatus === "workspace_limit_reached")
    ) {
      const candidatePaymentStatus = normalizePaymentStatus(ownerEntitlementCandidate.status);
      if ((!subStatus || subStatus === "none") && candidatePaymentStatus && candidatePaymentStatus !== "none") {
        subStatus = candidatePaymentStatus;
      }
      const candidateInterval = normalizeInterval(ownerEntitlementCandidate.interval ?? null);
      const ownerLevelInterval = candidateInterval || ownerMetadataInterval;
      if (interval === "unknown" && ownerLevelInterval) {
        interval = ownerLevelInterval;
      }
      if (!currentPeriodEnd && ownerEntitlementCandidate.current_period_end) {
        currentPeriodEnd = ownerEntitlementCandidate.current_period_end;
      }
      if (!currentPeriodEnd && ownerMetadataCurrentPeriodEnd) {
        currentPeriodEnd = ownerMetadataCurrentPeriodEnd;
      }
      if (!trialEndsAt && subStatus === "trialing" && ownerEntitlementCandidate.trial_end) {
        trialEndsAt = ownerEntitlementCandidate.trial_end;
      }
      const hasKnownStripeCustomerForPortal = Boolean(
        (subscription?.stripe_customer_id && String(subscription.stripe_customer_id).trim()) ||
        (billingCustomer?.stripe_customer_id && String(billingCustomer.stripe_customer_id).trim()) ||
        ownerHasStripeCustomerForPortal ||
        (ownerEntitlementCandidate.stripe_customer_id && String(ownerEntitlementCandidate.stripe_customer_id).trim()),
      );
      if (!portalAvailable && canManageBilling && hasKnownStripeCustomerForPortal) {
        portalAvailable = true;
      }
    }

    const responsePayload: Record<string, unknown> = {
      ok: true,
      userId,
      orgId: resolvedOrgId,
      billingOwnerUserId,
      entitlementStatus,
      workspaceIncluded,
      workspaceCount,
      workspaceLimit,
      canManageBilling,
      plan,
      status: subStatus,
      isActive,
      isPro: plan === "pro" && isActive === true,
      interval,
      trialEndsAt,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      cancelAt,
      portalAvailable,
      paymentProblem,
      paymentGraceUntil,
      paymentGraceRemainingDays,
      action: paymentAction,
    };
    if (responseDebugEnabled) {
      responsePayload.debug = {
        billingCustomerFound: !!billingCustomer,
        billingCustomerStatus: billingCustomerStatus || null,
        billingCustomerTrialEndsAt,
        usedServiceRole,
        duplicateActiveCount,
        entitlementStatus,
        billingOwnerUserId,
        workspaceIncluded,
        workspaceCount,
        workspaceLimit,
        ownerEntitlementSource: ownerEntitlementCandidate?.source ?? null,
        ownerEntitlementOrgId: ownerEntitlementCandidate?.organization_id ?? null,
        ownerEntitlementStatus: ownerEntitlementCandidate?.status ?? null,
        ownerEntitlementPriceId: ownerEntitlementCandidate?.price_id ?? null,
        ownerEntitlementCandidateCount,
        ownerSubscriptionRequiredReason,
        includedOrgIds,
        ownerWorkspaceCount: ownerWorkspaces.length,
      };
    }
    return json(req, 200, responsePayload);
  } catch (e) {
    console.error("billing-status fatal:", e);
    return json(req, 500, { error: String(e?.message ?? e) });
  }
});
