// supabase/functions/stripe-webhook/index.ts
//
// Receives Stripe webhook events and syncs subscription state to Supabase.
// Requires env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { serviceClient } from "../_shared/auth.ts";
import { assertStripeEnv, stripeClient } from "../_shared/stripe.ts";

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

class NonRetriableWebhookError extends Error {}

function toUnixSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  }
  return null;
}

async function resolveStripeEventCreatedSeconds(
  stripe: ReturnType<typeof stripeClient>,
  event: { id?: unknown; created?: unknown },
): Promise<number | null> {
  const direct = toUnixSeconds(event.created);
  if (direct !== null) return direct;

  const eventId = String(event.id ?? "");
  if (!eventId) return null;
  try {
    const fresh = await stripe.events.retrieve(eventId);
    return toUnixSeconds((fresh as { created?: unknown }).created);
  } catch (err) {
    console.warn("stripe-webhook: could not resolve event.created from Stripe API", err);
    return null;
  }
}

function toEventCreatedMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value * 1000);
  }
  if (typeof value === "bigint") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * 1000);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n * 1000);
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function toIsoFromUnixSeconds(value: unknown): string | null {
  const seconds = toUnixSeconds(value);
  if (seconds === null) return null;
  return new Date(seconds * 1000).toISOString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOrganizationId(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function readOrganizationIdFromMetadata(metadata: unknown): string | null {
  const source = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : null;
  if (!source) return null;
  return normalizeOrganizationId(source.organization_id ?? source.organizationId ?? null);
}

async function resolveSingleOrganizationForUser(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
  debug: boolean,
): Promise<string | null> {
  if (!userId) return null;
  const memberships = await sb
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(2);

  if (memberships.error) {
    if (debug) {
      console.warn("stripe-webhook: user membership lookup warning", { userId, error: memberships.error });
    }
    return null;
  }

  const orgIds = Array.from(
    new Set(
      (Array.isArray(memberships.data) ? memberships.data : [])
        .map((row) => normalizeOrganizationId((row as Record<string, unknown>)?.organization_id ?? null))
        .filter(Boolean),
    ),
  ) as string[];
  if (orgIds.length === 1) return orgIds[0];
  return null;
}

async function resolveOrganizationIdForBillingSync(
  sb: ReturnType<typeof serviceClient>,
  input: {
    metadataSubscriptionOrganizationId: string | null;
    metadataCustomerOrganizationId: string | null;
    metadataCheckoutOrganizationId: string | null;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    userId: string;
    debug: boolean;
  },
): Promise<{
  organizationId: string | null;
  source:
    | "metadata_subscription"
    | "metadata_customer"
    | "metadata_checkout"
    | "subscriptions"
    | "subscriptions_user_membership"
    | "billing_customers_subscription"
    | "billing_customers_customer"
    | "user_membership"
    | "none";
}> {
  const {
    metadataSubscriptionOrganizationId,
    metadataCustomerOrganizationId,
    metadataCheckoutOrganizationId,
    stripeSubscriptionId,
    stripeCustomerId,
    userId,
    debug,
  } = input;

  if (metadataSubscriptionOrganizationId) {
    return { organizationId: metadataSubscriptionOrganizationId, source: "metadata_subscription" };
  }
  if (metadataCustomerOrganizationId) {
    return { organizationId: metadataCustomerOrganizationId, source: "metadata_customer" };
  }
  if (metadataCheckoutOrganizationId) {
    return { organizationId: metadataCheckoutOrganizationId, source: "metadata_checkout" };
  }

  if (stripeSubscriptionId) {
    let subscriptionUserId = "";
    const subLookup = await sb
      .from("subscriptions")
      .select("organization_id,user_id")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .limit(2);

    if (subLookup.error) {
      if (!isColumnError(subLookup.error, "organization_id")) {
        console.warn("stripe-webhook: subscriptions org lookup warning", {
          stripe_subscription_id: stripeSubscriptionId,
          error: subLookup.error,
        });
      }
      const legacySubLookup = await sb
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_subscription_id", stripeSubscriptionId)
        .maybeSingle();
      if (!legacySubLookup.error) {
        subscriptionUserId = String(legacySubLookup.data?.user_id || "");
      }
    } else {
      const rows = Array.isArray(subLookup.data) ? subLookup.data : [];
      const orgIds = Array.from(
        new Set(
          rows
            .map((row) => normalizeOrganizationId((row as Record<string, unknown>)?.organization_id ?? null))
            .filter(Boolean),
        ),
      ) as string[];
      if (orgIds.length === 1) {
        return { organizationId: orgIds[0], source: "subscriptions" };
      }
      if (debug && orgIds.length > 1) {
        console.warn("stripe-webhook: ambiguous subscriptions org by subscription", {
          stripe_subscription_id: stripeSubscriptionId,
          organization_ids: orgIds,
        });
      }
      subscriptionUserId = String((rows[0] as Record<string, unknown> | undefined)?.user_id || "");
    }

    const resolvedFromSubUser = await resolveSingleOrganizationForUser(sb, subscriptionUserId, debug);
    if (resolvedFromSubUser) {
      return { organizationId: resolvedFromSubUser, source: "subscriptions_user_membership" };
    }

    const bySubscription = await sb
      .from("billing_customers")
      .select("organization_id")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .limit(2);
    if (bySubscription.error) {
      console.warn("stripe-webhook: billing_customers subscription lookup warning", {
        stripe_subscription_id: stripeSubscriptionId,
        error: bySubscription.error,
      });
    } else {
      const orgIds = Array.from(
        new Set(
          (Array.isArray(bySubscription.data) ? bySubscription.data : [])
            .map((row) => normalizeOrganizationId((row as Record<string, unknown>)?.organization_id ?? null))
            .filter(Boolean),
        ),
      ) as string[];
      if (orgIds.length === 1) {
        return { organizationId: orgIds[0], source: "billing_customers_subscription" };
      }
      if (debug && orgIds.length > 1) {
        console.warn("stripe-webhook: ambiguous billing_customers org by subscription", {
          stripe_subscription_id: stripeSubscriptionId,
          organization_ids: orgIds,
        });
      }
    }
  }

  if (stripeCustomerId) {
    const byCustomer = await sb
      .from("billing_customers")
      .select("organization_id")
      .eq("stripe_customer_id", stripeCustomerId)
      .limit(2);
    if (byCustomer.error) {
      console.warn("stripe-webhook: billing_customers customer lookup warning", {
        stripe_customer_id: stripeCustomerId,
        error: byCustomer.error,
      });
    } else {
      const orgIds = Array.from(
        new Set(
          (Array.isArray(byCustomer.data) ? byCustomer.data : [])
            .map((row) => normalizeOrganizationId((row as Record<string, unknown>)?.organization_id ?? null))
            .filter(Boolean),
        ),
      ) as string[];
      if (orgIds.length === 1) {
        return { organizationId: orgIds[0], source: "billing_customers_customer" };
      }
      if (debug && orgIds.length > 1) {
        console.warn("stripe-webhook: ambiguous billing_customers org by customer", {
          stripe_customer_id: stripeCustomerId,
          organization_ids: orgIds,
        });
      }
    }
  }

  const resolvedFromUser = await resolveSingleOrganizationForUser(sb, userId, debug);
  if (resolvedFromUser) {
    return { organizationId: resolvedFromUser, source: "user_membership" };
  }

  return { organizationId: null, source: "none" };
}

function isColumnError(error: unknown, columnName: string): boolean {
  const e = error as Record<string, unknown> | null;
  const code = String(e?.code ?? "");
  const message = String(e?.message ?? "");
  const details = String(e?.details ?? "");
  if (code === "PGRST204" || code === "42703") return true;
  const needle = columnName.toLowerCase();
  return message.toLowerCase().includes(needle) || details.toLowerCase().includes(needle);
}

function eventCreatedFieldValue(seconds: number | null): string | number | null {
  if (Number.isFinite(seconds as number)) return Number(seconds);
  const iso = toIsoFromUnixSeconds(seconds);
  if (iso) return iso;
  return null;
}

async function markWebhookEventFailure(
  sb: ReturnType<typeof serviceClient>,
  eventId: string,
  errorMessage: string,
) {
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("webhook_events")
    .update({
      status: "failed",
      error: errorMessage,
      processed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("event_id", eventId);

  if (error) {
    console.error("stripe-webhook: failed to mark event failure:", {
      eventId,
      error,
    });
  }
}

async function markWebhookEventProcessed(
  sb: ReturnType<typeof serviceClient>,
  eventId: string,
) {
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("webhook_events")
    .update({
      status: "processed",
      error: null,
      processed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("event_id", eventId);
  return error ?? null;
}

async function backfillLastStripeEventCreated(
  sb: ReturnType<typeof serviceClient>,
  subscriptionId: string,
  eventCreatedSeconds: number | null,
) {
  if (!subscriptionId || !Number.isFinite(eventCreatedSeconds as number)) return;

  const { data: existing } = await sb
    .from("subscriptions")
    .select("last_stripe_event_created")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  const incomingMs = Math.floor(Number(eventCreatedSeconds) * 1000);
  const storedMs = toEventCreatedMillis(existing?.last_stripe_event_created ?? null);
  if (Number.isFinite(storedMs as number) && (storedMs as number) >= incomingMs) {
    return;
  }

  const payload: Record<string, unknown> = {
    last_stripe_event_created: eventCreatedFieldValue(eventCreatedSeconds),
    updated_at: new Date().toISOString(),
  };

  let { error } = await sb
    .from("subscriptions")
    .update(payload)
    .eq("stripe_subscription_id", subscriptionId);

  if (error && isColumnError(error, "last_stripe_event_created")) {
    payload.last_stripe_event_created = Number(eventCreatedSeconds);
    ({ error } = await sb
      .from("subscriptions")
      .update(payload)
      .eq("stripe_subscription_id", subscriptionId));
  }

  if (error) {
    console.error("stripe-webhook: failed timestamp backfill for subscription:", subscriptionId, error);
  }
}

async function maybeBackfillSubscriptionTimestampForProcessedDuplicate(
  sb: ReturnType<typeof serviceClient>,
  eventType: string,
  obj: Record<string, unknown>,
  eventCreatedSeconds: number | null,
) {
  let subId = "";
  if (
    eventType === "customer.subscription.created" ||
    eventType === "customer.subscription.updated" ||
    eventType === "customer.subscription.deleted"
  ) {
    subId = String(obj.id ?? "");
  } else if (
    eventType === "invoice.payment_succeeded" ||
    eventType === "invoice.payment_failed" ||
    eventType === "invoice.paid"
  ) {
    subId = String(obj.subscription ?? "");
  } else if (eventType === "checkout.session.completed") {
    subId = String(obj.subscription ?? "");
  }

  if (!subId) return;
  await backfillLastStripeEventCreated(sb, subId, eventCreatedSeconds);
}

// ── Event handlers ──────────────────────────────────────────────

async function upsertSubscription(
  sb: ReturnType<typeof serviceClient>,
  sub: Record<string, unknown>,
  stripe: ReturnType<typeof stripeClient>,
  eventCreatedSeconds: number | null,
  context: {
    eventType: string;
    eventId: string;
    metadataCheckoutOrganizationId?: string | null;
    metadataCustomerOrganizationId?: string | null;
  },
) {
  const debug = Deno.env.get("SUPABASE_DEBUG") === "1";
  const subId = String(sub.id ?? "");
  const customerRef = sub.customer;
  const customerId = typeof customerRef === "string"
    ? customerRef
    : String((customerRef as Record<string, unknown> | null)?.id ?? "");
  const status = String(sub.status ?? "");
  const priceId =
    (sub.items as any)?.data?.[0]?.price?.id ?? null;
  const productId =
    (sub.items as any)?.data?.[0]?.price?.product ?? null;
  const intervalRaw =
    (sub.items as any)?.data?.[0]?.price?.recurring?.interval ?? null;
  let interval =
    intervalRaw === "month" || intervalRaw === "year" ? intervalRaw : null;
  const metadataObj = ((sub as any)?.metadata && typeof (sub as any).metadata === "object")
    ? ((sub as any).metadata as Record<string, unknown>)
    : {};
  const customerMetadataObj = customerRef && typeof customerRef === "object"
    ? (((customerRef as Record<string, unknown>).metadata as Record<string, unknown> | undefined) ?? {})
    : {};
  const metadataSubscriptionOrganizationId = readOrganizationIdFromMetadata(metadataObj);
  const metadataCustomerOrganizationId = readOrganizationIdFromMetadata(customerMetadataObj) ||
    normalizeOrganizationId(context.metadataCustomerOrganizationId ?? null);
  const metadataCheckoutOrganizationId = normalizeOrganizationId(context.metadataCheckoutOrganizationId ?? null);
  const metadataKeys = Array.from(
    new Set([
      ...Object.keys(metadataObj),
      ...Object.keys(customerMetadataObj),
    ]),
  );

  // Find Supabase user for this Stripe customer
  const { data: customerRow, error: customerRowErr } = await sb
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (customerRowErr) {
    throw new Error(
      `stripe-webhook: stripe_customers lookup failed (eventType=${context.eventType}, eventId=${context.eventId}, customerId=${customerId || "null"}, subId=${subId || "null"}): ${customerRowErr.message}`,
    );
  }

  const userId = customerRow?.user_id ?? null;
  if (!userId) {
    throw new Error(
      `stripe-webhook: no user for customer (eventType=${context.eventType}, eventId=${context.eventId}, customerId=${customerId || "null"}, subId=${subId || "null"})`,
    );
  }

  // Stripe Dashboard / portal updates can emit events without metadata.
  // Metadata-only org resolution is not reliable, so we fall back to DB mappings.
  const resolvedOrg = await resolveOrganizationIdForBillingSync(sb, {
    metadataSubscriptionOrganizationId,
    metadataCustomerOrganizationId,
    metadataCheckoutOrganizationId,
    stripeSubscriptionId: subId,
    stripeCustomerId: customerId,
    userId: String(userId),
    debug,
  });
  if (!resolvedOrg.organizationId) {
    throw new NonRetriableWebhookError(
      `stripe-webhook: organization unresolved (eventType=${context.eventType}, eventId=${context.eventId}, source=${resolvedOrg.source}, customerId=${customerId || "null"}, subId=${subId || "null"}, metadataKeys=${metadataKeys.join(",") || "none"})`,
    );
  }

  let existingSub: { last_stripe_event_created?: string | null } | null = null;
  if (subId) {
    const { data: existing } = await sb
      .from("subscriptions")
      .select("last_stripe_event_created, interval")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    existingSub = existing ?? null;
    if (!interval) {
      const existingInterval = String((existing as Record<string, unknown> | null)?.interval ?? "");
      if (existingInterval === "month" || existingInterval === "year") {
        interval = existingInterval;
      }
    }
  }

  // Guard against out-of-order Stripe deliveries.
  // If this event is older than the last applied event for this subscription,
  // skip mutation to avoid rolling state backward.
  if (subId && Number.isFinite(eventCreatedSeconds as number)) {
    const incomingMs = Math.floor(Number(eventCreatedSeconds) * 1000);
    const storedMs = toEventCreatedMillis(existingSub?.last_stripe_event_created ?? null);
    if (Number.isFinite(incomingMs) && Number.isFinite(storedMs as number) && incomingMs < (storedMs as number)) {
      if (debug) {
        console.log(
          "stripe-webhook: skipped out-of-order event",
          { subId, incoming: eventCreatedSeconds, stored: existingSub?.last_stripe_event_created ?? null },
        );
      }
      return;
    }
  }
  if ((status === "active" || status === "trialing") && !interval) {
    throw new Error(
      `stripe-webhook: missing billing interval for active/trialing subscription (eventType=${context.eventType}, eventId=${context.eventId}, customerId=${customerId || "null"}, subId=${subId || "null"})`,
    );
  }

  const currentPeriodEndSeconds = toUnixSeconds(sub.current_period_end);
  let cancelAtSeconds = toUnixSeconds(sub.cancel_at);
  let cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);

  // Some Stripe portal/dashboard flows drive cancellation from subscription schedules.
  // In those cases cancel_at_period_end can remain false on the subscription payload.
  if (!cancelAtPeriodEnd && !cancelAtSeconds && (status === "active" || status === "trialing")) {
    const scheduleRef = (sub as Record<string, unknown>).schedule;
    const scheduleId = typeof scheduleRef === "string"
      ? scheduleRef
      : String((scheduleRef as Record<string, unknown> | null)?.id ?? "");

    if (scheduleId) {
      try {
        const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
        const endBehavior = String((schedule as Record<string, unknown>)?.end_behavior ?? "");
        if (endBehavior === "cancel") {
          const phases = Array.isArray((schedule as Record<string, unknown>)?.phases)
            ? ((schedule as Record<string, unknown>).phases as Array<Record<string, unknown>>)
            : [];
          const currentPhase = ((schedule as Record<string, unknown>)?.current_phase as Record<string, unknown> | null) ?? null;
          const candidateEnd = toUnixSeconds(currentPhase?.end_date) ??
            toUnixSeconds(phases[phases.length - 1]?.end_date);
          if (candidateEnd) {
            cancelAtSeconds = candidateEnd;
          }
        }
      } catch (scheduleErr) {
        if (debug) {
          console.warn("stripe-webhook: failed schedule cancellation lookup", {
            eventType: context.eventType,
            eventId: context.eventId,
            subId,
            scheduleId,
            error: (scheduleErr as Error)?.message ?? String(scheduleErr),
          });
        }
      }
    }
  }

  if (!cancelAtPeriodEnd && cancelAtSeconds && currentPeriodEndSeconds && cancelAtSeconds <= currentPeriodEndSeconds) {
    cancelAtPeriodEnd = true;
  }

  const baseRow: Record<string, unknown> = {
    user_id: userId,
    stripe_subscription_id: subId,
    stripe_customer_id: customerId,
    status,
    price_id: priceId,
    product_id: productId,
    interval,
    current_period_start: sub.current_period_start
      ? new Date((sub.current_period_start as number) * 1000).toISOString()
      : null,
    current_period_end: currentPeriodEndSeconds
      ? new Date(currentPeriodEndSeconds * 1000).toISOString()
      : null,
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: cancelAtSeconds
      ? new Date(cancelAtSeconds * 1000).toISOString()
      : null,
    canceled_at: sub.canceled_at
      ? new Date((sub.canceled_at as number) * 1000).toISOString()
      : null,
    trial_start: sub.trial_start
      ? new Date((sub.trial_start as number) * 1000).toISOString()
      : null,
    trial_end: sub.trial_end
      ? new Date((sub.trial_end as number) * 1000).toISOString()
      : null,
    ended_at: sub.ended_at
      ? new Date((sub.ended_at as number) * 1000).toISOString()
      : null,
    last_stripe_event_created:
      eventCreatedFieldValue(eventCreatedSeconds) ??
      (existingSub?.last_stripe_event_created ?? null),
    updated_at: new Date().toISOString(),
  };
  if (resolvedOrg.organizationId) {
    baseRow.organization_id = resolvedOrg.organizationId;
  }

  const writeSubscription = async (row: Record<string, unknown>) => {
    if (existingSub) {
      const { error: updErr } = await sb
        .from("subscriptions")
        .update(row)
        .eq("stripe_subscription_id", subId);
      return updErr ?? null;
    }
    const { error: insErr } = await sb
      .from("subscriptions")
      .insert(row);
    if (insErr?.code === "23505") {
      const { error: updErr } = await sb
        .from("subscriptions")
        .update(row)
        .eq("stripe_subscription_id", subId);
      return updErr ?? null;
    }
    return insErr ?? null;
  };

  let row = { ...baseRow };
  let error: { code?: string; message?: string; details?: string } | null = await writeSubscription(row);

  // Backward-compat fallback when subscriptions.organization_id is not present yet.
  if (error && resolvedOrg.organizationId && isColumnError(error, "organization_id")) {
    delete row.organization_id;
    error = await writeSubscription(row);
  }

  // Backward-compat fallback when timestamp column expects a numeric epoch.
  if (error && isColumnError(error, "last_stripe_event_created")) {
    row.last_stripe_event_created = Number.isFinite(eventCreatedSeconds as number) ? Number(eventCreatedSeconds) : null;
    error = await writeSubscription(row);
  }

  if (error) {
    console.error("stripe-webhook upsert error:", error);
    throw error;
  }

  // Keep one active/trialing subscription projection per scope to avoid
  // stale duplicate "active" rows driving incorrect billing status.
  if (subId && (status === "active" || status === "trialing")) {
    const competingStatuses = ["active", "trialing", "past_due", "unpaid"];
    let dedupeQuery = sb
      .from("subscriptions")
      .update({
        status: "canceled",
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .neq("stripe_subscription_id", subId)
      .in("status", competingStatuses);

    if (resolvedOrg.organizationId) {
      dedupeQuery = dedupeQuery.eq("organization_id", resolvedOrg.organizationId);
    } else if (customerId) {
      dedupeQuery = dedupeQuery.eq("stripe_customer_id", customerId);
    }

    let { error: dedupeErr } = await dedupeQuery;
    if (dedupeErr && resolvedOrg.organizationId && isColumnError(dedupeErr, "organization_id")) {
      ({ error: dedupeErr } = await sb
        .from("subscriptions")
        .update({
          status: "canceled",
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .neq("stripe_subscription_id", subId)
        .contains("metadata", { organization_id: resolvedOrg.organizationId })
        .in("status", competingStatuses));
      if (dedupeErr) {
        ({ error: dedupeErr } = await sb
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: true,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .neq("stripe_subscription_id", subId)
          .eq("stripe_customer_id", customerId)
          .in("status", competingStatuses));
      }
    }
    if (dedupeErr) {
      console.warn("stripe-webhook: competing subscription cleanup failed", {
        subId,
        userId,
        error: dedupeErr,
      });
    }
  }

  const allowedBillingStatuses = new Set(["active", "trialing", "past_due", "canceled", "unpaid"]);
  const normalizedTrialEndsAt = status === "trialing"
    ? (baseRow.trial_end ?? null)
    : null;
  const billingRow: Record<string, unknown> = {
    organization_id: resolvedOrg.organizationId,
    stripe_customer_id: customerId || null,
    stripe_subscription_id: subId || null,
    status: allowedBillingStatuses.has(status) ? status : null,
    plan_name: "pro",
    billing_interval: interval,
    current_period_start: baseRow.current_period_start ?? null,
    current_period_end: baseRow.current_period_end ?? null,
    cancel_at_period_end: Boolean(baseRow.cancel_at_period_end),
    trial_ends_at: normalizedTrialEndsAt,
    updated_at: new Date().toISOString(),
  };
  if (!allowedBillingStatuses.has(status)) {
    delete billingRow.status;
  }

  const { error: billingErr } = await sb
    .from("billing_customers")
    .upsert(billingRow, { onConflict: "organization_id" });
  if (billingErr) {
    throw new Error(
      `stripe-webhook: billing_customers upsert failed (eventType=${context.eventType}, eventId=${context.eventId}, orgId=${resolvedOrg.organizationId}, customerId=${customerId || "null"}, subId=${subId || "null"}): ${billingErr.message}`,
    );
  }

  if (debug) {
    console.log("stripe-webhook event sync", {
      eventType: context.eventType,
      eventId: context.eventId,
      resolvedOrgId: resolvedOrg.organizationId,
      source: resolvedOrg.source,
      customerId: customerId || null,
      subId: subId || null,
      interval: interval || null,
      status,
    });
  }
}

async function handleInvoice(
  sb: ReturnType<typeof serviceClient>,
  invoice: Record<string, unknown>,
  stripe: ReturnType<typeof stripeClient>,
  eventCreatedSeconds: number | null,
  context: {
    eventType: string;
    eventId: string;
  },
) {
  const subId = String(invoice.subscription ?? "");
  if (!subId) return;

  const invoiceId = String(invoice.id ?? "");
  const invoiceStatus = String(invoice.status ?? "");

  const { error } = await sb
    .from("subscriptions")
    .update({
      latest_invoice_id: invoiceId,
      latest_invoice_status: invoiceStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subId);

  if (error) {
    console.error("stripe-webhook invoice update error:", error);
  }

  // Keep subscription status aligned on payment events.
  try {
    const sub = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price", "customer"] });
    await upsertSubscription(sb, sub as unknown as Record<string, unknown>, stripe, eventCreatedSeconds, context);
  } catch (err) {
    console.error("stripe-webhook invoice subscription resync error:", err);
    throw err;
  }
}

// ── Main handler ────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Only POST allowed
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  try {
    assertStripeEnv(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
    const stripe = stripeClient();
    const webhookSecret = getEnv("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return jsonResp({ error: "Missing stripe-signature" }, 400);
    }

    const body = await req.text();

    // Verify signature
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
      );
    } catch (err) {
      console.error("stripe-webhook: signature verification failed:", err);
      return jsonResp({ error: "Invalid signature" }, 400);
    }

    const sb = serviceClient();

    const nowIso = new Date().toISOString();
    const eventCreatedSeconds = await resolveStripeEventCreatedSeconds(
      stripe,
      event as { id?: unknown; created?: unknown },
    );
    const eventObj = event.data.object as Record<string, unknown>;
    const debug = Deno.env.get("SUPABASE_DEBUG") === "1";
    const eventCustomerId = String(
      (eventObj && (eventObj.customer as string | undefined)) ||
        "",
    );
    const eventSubscriptionId = String(
      (eventObj && (eventObj.subscription as string | undefined)) ||
        (eventObj && (eventObj.id as string | undefined)) ||
        "",
    );
    if (debug) {
      console.log("stripe-webhook: received", {
        eventId: event.id,
        eventType: event.type,
        livemode: Boolean(event.livemode),
        eventCreated: eventCreatedSeconds,
        customerId: eventCustomerId || null,
        subscriptionId: eventSubscriptionId || null,
      });
    }

    // Idempotency with retry-safety:
    // - processed => return early
    // - received/failed => continue processing (retry path)
    const { data: existingEvent, error: existingErr } = await sb
      .from("webhook_events")
      .select("status,event_created")
      .eq("event_id", event.id)
      .maybeSingle();

    if (existingErr) {
      console.error("stripe-webhook: failed reading existing event row:", existingErr);
      await markWebhookEventFailure(sb, event.id, `webhook-event-read-failed: ${existingErr.message}`);
      return jsonResp({ error: "Failed reading webhook event state" }, 500);
    }

    if (!existingEvent) {
      const eventCreatedValue = eventCreatedFieldValue(eventCreatedSeconds);
      let { error: insErr } = await sb.from("webhook_events").insert({
        event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload: event.data.object,
        event_created: eventCreatedValue,
        received_at: nowIso,
        status: "received",
        error: null,
        processed_at: null,
        updated_at: nowIso,
      });
      if (insErr && isColumnError(insErr, "event_created")) {
        ({ error: insErr } = await sb.from("webhook_events").insert({
          event_id: event.id,
          event_type: event.type,
          livemode: event.livemode,
          payload: event.data.object,
          event_created: Number.isFinite(eventCreatedSeconds as number) ? Number(eventCreatedSeconds) : null,
          received_at: nowIso,
          status: "received",
          error: null,
          processed_at: null,
          updated_at: nowIso,
        }));
      }
      if (insErr) {
        if (insErr.code === "23505") {
          const { data: duplicateEvent, error: duplicateErr } = await sb
            .from("webhook_events")
            .select("status,event_created")
            .eq("event_id", event.id)
            .maybeSingle();

          if (duplicateErr) {
            console.error("stripe-webhook: failed reading duplicate event row:", duplicateErr);
            await markWebhookEventFailure(sb, event.id, `duplicate-event-read-failed: ${duplicateErr.message}`);
            return jsonResp({ error: "Failed reading duplicate webhook event state" }, 500);
          }

          if (duplicateEvent?.status === "processed") {
            await maybeBackfillSubscriptionTimestampForProcessedDuplicate(
              sb,
              event.type,
              eventObj,
              eventCreatedSeconds,
            );
            if (Deno.env.get("SUPABASE_DEBUG") === "1") {
              console.log("stripe-webhook: already processed event", event.id);
            }
            return jsonResp({ received: true });
          }
        } else {
          console.error("stripe-webhook: event insert failed:", insErr);
          await markWebhookEventFailure(sb, event.id, `webhook-event-insert-failed: ${insErr.message}`);
          return jsonResp({ error: "Failed recording webhook event" }, 500);
        }
      }
    } else {
      const eventCreatedValue = eventCreatedFieldValue(eventCreatedSeconds);
      let { error: syncErr } = await sb
        .from("webhook_events")
        .update({
          event_type: event.type,
          livemode: event.livemode,
          payload: event.data.object,
          event_created: eventCreatedValue ?? (existingEvent.event_created ?? null),
          received_at: nowIso,
          updated_at: nowIso,
        })
        .eq("event_id", event.id);
      if (syncErr && isColumnError(syncErr, "event_created")) {
        ({ error: syncErr } = await sb
          .from("webhook_events")
          .update({
            event_type: event.type,
            livemode: event.livemode,
            payload: event.data.object,
            event_created:
              Number.isFinite(eventCreatedSeconds as number)
                ? Number(eventCreatedSeconds)
                : (existingEvent.event_created ?? null),
            received_at: nowIso,
            updated_at: nowIso,
          })
          .eq("event_id", event.id));
      }
      if (syncErr) {
        console.error("stripe-webhook: failed syncing existing event metadata:", syncErr);
        await markWebhookEventFailure(sb, event.id, `webhook-event-sync-failed: ${syncErr.message}`);
        return jsonResp({ error: "Failed syncing webhook event metadata" }, 500);
      }
      if (existingEvent.status === "processed") {
        await maybeBackfillSubscriptionTimestampForProcessedDuplicate(
          sb,
          event.type,
          eventObj,
          eventCreatedSeconds,
        );
        if (Deno.env.get("SUPABASE_DEBUG") === "1") {
          console.log("stripe-webhook: already processed event", event.id);
        }
        return jsonResp({ received: true });
      }
    }

    // Do not write a transient "processing" status because some deployments
    // constrain status to received/processed/failed, which would leave events
    // stuck at "received" if this update fails.

    try {
      // Route event
      const obj = eventObj;

      switch (event.type) {
        case "checkout.session.completed": {
          // Expand subscription from checkout
          const subId = String(obj.subscription ?? "");
          const sessionMetadataOrgId = readOrganizationIdFromMetadata((obj as Record<string, unknown>)?.metadata ?? null);
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price", "customer"] });
            const subForUpsert = sub as unknown as Record<string, unknown>;
            if (
              sessionMetadataOrgId &&
              !readOrganizationIdFromMetadata((subForUpsert as any)?.metadata ?? null)
            ) {
              const existingMeta = (
                (subForUpsert as any)?.metadata && typeof (subForUpsert as any).metadata === "object"
              ) ? (subForUpsert as any).metadata as Record<string, unknown> : {};
              (subForUpsert as any).metadata = {
                ...existingMeta,
                organization_id: sessionMetadataOrgId,
              };
            }
            await upsertSubscription(
              sb,
              subForUpsert,
              stripe,
              eventCreatedSeconds,
              {
                eventType: event.type,
                eventId: event.id,
                metadataCheckoutOrganizationId: sessionMetadataOrgId,
              },
            );
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subId = String(obj.id ?? "");
          if (!subId) {
            throw new Error(`stripe-webhook: missing subscription id on ${event.type} event`);
          }
          const latest = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price", "customer"] });
          await upsertSubscription(
            sb,
            latest as unknown as Record<string, unknown>,
            stripe,
            eventCreatedSeconds,
            { eventType: event.type, eventId: event.id },
          );
          break;
        }
        case "customer.subscription.deleted":
          await upsertSubscription(
            sb,
            obj,
            stripe,
            eventCreatedSeconds,
            { eventType: event.type, eventId: event.id },
          );
          break;

        case "invoice.payment_succeeded":
        case "invoice.payment_failed":
        case "invoice.paid":
          await handleInvoice(sb, obj, stripe, eventCreatedSeconds, { eventType: event.type, eventId: event.id });
          break;
        case "payment_method.attached":
        case "payment_method.detached":
          if (debug) {
            console.log("stripe-webhook: payment_method event ignored", {
              eventType: event.type,
              eventId: event.id,
              customerId: eventCustomerId || null,
            });
          }
          break;

        default:
          if (Deno.env.get("SUPABASE_DEBUG") === "1") {
            console.log("stripe-webhook: unhandled event type", event.type);
          }
      }

      const markProcessedErr = await markWebhookEventProcessed(sb, event.id);

      if (markProcessedErr) {
        console.error("stripe-webhook: failed to mark processed:", markProcessedErr);
        await markWebhookEventFailure(sb, event.id, `mark-processed-failed: ${markProcessedErr.message}`);
        return jsonResp({ error: "Failed to persist processed status" }, 500);
      }

      if (debug) {
        console.log("stripe-webhook: processed", {
          eventId: event.id,
          eventType: event.type,
          customerId: eventCustomerId || null,
          subscriptionId: eventSubscriptionId || null,
        });
      }

      return jsonResp({ received: true });
    } catch (procErr) {
      const errMsg = String((procErr as Error)?.message ?? procErr);
      try {
        await markWebhookEventFailure(sb, event.id, errMsg);
      } catch (markErr) {
        console.error("stripe-webhook: failed to mark event as failed:", markErr);
      }
      console.error("stripe-webhook processing error:", procErr);
      if (procErr instanceof NonRetriableWebhookError) {
        return jsonResp({ received: true }, 200);
      }
      return jsonResp({ error: errMsg }, 500);
    }
  } catch (e) {
    console.error("stripe-webhook fatal:", e);

    // Try to mark as failed if we have the event id
    try {
      const sb = serviceClient();
      // Can't get event.id here reliably, so just log
    } catch { /* ignore */ }

    return jsonResp({ error: String((e as Error).message ?? e) }, 500);
  }
});
