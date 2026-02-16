// supabase/functions/stripe-webhook/index.ts
//
// Receives Stripe webhook events and syncs subscription state to Supabase.
// Requires env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { serviceClient } from "../_shared/auth.ts";
import { stripeClient } from "../_shared/stripe.ts";

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

  const { error } = await sb
    .from("subscriptions")
    .update({
      last_stripe_event_created: Number(eventCreatedSeconds),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

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
  } else if (eventType === "invoice.payment_succeeded" || eventType === "invoice.payment_failed") {
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
  eventCreatedSeconds: number | null,
) {
  const debug = Deno.env.get("SUPABASE_DEBUG") === "1";
  const subId = String(sub.id ?? "");
  const customerId = String(sub.customer ?? "");
  const status = String(sub.status ?? "");
  const priceId =
    (sub.items as any)?.data?.[0]?.price?.id ?? null;
  const productId =
    (sub.items as any)?.data?.[0]?.price?.product ?? null;
  const intervalRaw =
    (sub.items as any)?.data?.[0]?.price?.recurring?.interval ?? null;
  const interval =
    intervalRaw === "month" || intervalRaw === "year" ? intervalRaw : null;

  // Find Supabase user for this Stripe customer
  const { data: customerRow } = await sb
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  const userId = customerRow?.user_id ?? null;
  if (!userId) {
    console.warn("stripe-webhook: no user for customer", customerId);
    return;
  }

  let existingSub: { last_stripe_event_created?: string | null } | null = null;
  if (subId) {
    const { data: existing } = await sb
      .from("subscriptions")
      .select("last_stripe_event_created")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    existingSub = existing ?? null;
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

  const row = {
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
    current_period_end: sub.current_period_end
      ? new Date((sub.current_period_end as number) * 1000).toISOString()
      : null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    cancel_at: sub.cancel_at
      ? new Date((sub.cancel_at as number) * 1000).toISOString()
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
      Number.isFinite(eventCreatedSeconds as number)
        ? Number(eventCreatedSeconds)
        : (existingSub?.last_stripe_event_created ?? null),
    updated_at: new Date().toISOString(),
  };

  let error: { message?: string } | null = null;
  if (existingSub) {
    const { error: updErr } = await sb
      .from("subscriptions")
      .update(row)
      .eq("stripe_subscription_id", subId);
    error = updErr;
  } else {
    const { error: insErr } = await sb
      .from("subscriptions")
      .insert(row);
    if (insErr?.code === "23505") {
      const { error: updErr } = await sb
        .from("subscriptions")
        .update(row)
        .eq("stripe_subscription_id", subId);
      error = updErr;
    } else {
      error = insErr;
    }
  }

  if (error) {
    console.error("stripe-webhook upsert error:", error);
    throw error;
  }

  if (debug) console.log("stripe-webhook: upserted subscription", subId, status);
}

async function handleInvoice(
  sb: ReturnType<typeof serviceClient>,
  invoice: Record<string, unknown>,
  stripe: ReturnType<typeof stripeClient>,
  eventCreatedSeconds: number | null,
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
    const sub = await stripe.subscriptions.retrieve(subId);
    await upsertSubscription(sb, sub as unknown as Record<string, unknown>, eventCreatedSeconds);
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
      return jsonResp({ error: "Failed reading webhook event state" }, 500);
    }

    if (!existingEvent) {
      const { error: insErr } = await sb.from("webhook_events").insert({
        event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload: event.data.object,
        event_created: eventCreatedSeconds,
        received_at: nowIso,
        status: "received",
        error: null,
        processed_at: null,
        updated_at: nowIso,
      });
      if (insErr) {
        if (insErr.code === "23505") {
          const { data: duplicateEvent, error: duplicateErr } = await sb
            .from("webhook_events")
            .select("status,event_created")
            .eq("event_id", event.id)
            .maybeSingle();

          if (duplicateErr) {
            console.error("stripe-webhook: failed reading duplicate event row:", duplicateErr);
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
          return jsonResp({ error: "Failed recording webhook event" }, 500);
        }
      }
    } else {
      const { error: syncErr } = await sb
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
        .eq("event_id", event.id);
      if (syncErr) {
        console.error("stripe-webhook: failed syncing existing event metadata:", syncErr);
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

    const { error: processingErr } = await sb
      .from("webhook_events")
      .update({
        status: "processing",
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", event.id);

    if (processingErr) {
      console.error("stripe-webhook: failed to mark processing:", processingErr);
      return jsonResp({ error: "Failed to persist processing status" }, 500);
    }

    try {
      // Route event
      const obj = eventObj;

      switch (event.type) {
        case "checkout.session.completed": {
          // Expand subscription from checkout
          const subId = String(obj.subscription ?? "");
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await upsertSubscription(sb, sub as unknown as Record<string, unknown>, eventCreatedSeconds);
          }
          break;
        }

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await upsertSubscription(sb, obj, eventCreatedSeconds);
          break;

        case "invoice.payment_succeeded":
        case "invoice.payment_failed":
          await handleInvoice(sb, obj, stripe, eventCreatedSeconds);
          break;

        default:
          if (Deno.env.get("SUPABASE_DEBUG") === "1") {
            console.log("stripe-webhook: unhandled event type", event.type);
          }
      }

      const { error: markProcessedErr } = await sb
        .from("webhook_events")
        .update({
          status: "processed",
          error: null,
          processed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("event_id", event.id);

      if (markProcessedErr) {
        console.error("stripe-webhook: failed to mark processed:", markProcessedErr);
        return jsonResp({ error: "Failed to persist processed status" }, 500);
      }

      return jsonResp({ received: true });
    } catch (procErr) {
      const errMsg = String((procErr as Error)?.message ?? procErr);
      try {
        await sb
          .from("webhook_events")
          .update({
            status: "failed",
            error: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("event_id", event.id);
      } catch (markErr) {
        console.error("stripe-webhook: failed to mark event as failed:", markErr);
      }
      console.error("stripe-webhook processing error:", procErr);
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
