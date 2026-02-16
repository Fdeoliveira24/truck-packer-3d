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

// ── Event handlers ──────────────────────────────────────────────

async function upsertSubscription(
  sb: ReturnType<typeof serviceClient>,
  sub: Record<string, unknown>,
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
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error("stripe-webhook upsert error:", error);
    throw error;
  }

  if (debug) console.log("stripe-webhook: upserted subscription", subId, status);
}

async function handleInvoice(
  sb: ReturnType<typeof serviceClient>,
  invoice: Record<string, unknown>,
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

    // Idempotency: record event
    const { error: dupErr } = await sb.from("webhook_events").insert({
      event_id: event.id,
      event_type: event.type,
      livemode: event.livemode,
      received_at: new Date().toISOString(),
      status: "received",
      payload: event.data.object,
    });

  if (dupErr) {
    // Duplicate event (unique constraint on event_id) — skip
    if (dupErr.code === "23505") {
        if (Deno.env.get("SUPABASE_DEBUG") === "1") {
          console.log("stripe-webhook: duplicate event", event.id);
        }
        return jsonResp({ received: true });
    }
    console.warn("stripe-webhook: event insert warning:", dupErr);
    }

    // Route event
    const obj = event.data.object as Record<string, unknown>;

    switch (event.type) {
      case "checkout.session.completed": {
        // Expand subscription from checkout
        const subId = String(obj.subscription ?? "");
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(sb, sub as unknown as Record<string, unknown>);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await upsertSubscription(sb, obj);
        break;

      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        await handleInvoice(sb, obj);
        break;

      default:
        if (Deno.env.get("SUPABASE_DEBUG") === "1") {
          console.log("stripe-webhook: unhandled event type", event.type);
        }
    }

    // Mark processed
    await sb
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("event_id", event.id);

    return jsonResp({ received: true });
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
