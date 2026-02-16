// supabase/functions/billing-status/index.ts
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient } from "../_shared/stripe.ts";

function json(req: Request, status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
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

    // 1) Read user from JWT
    const auth = await requireUser(req);
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

    // 2) Use service role for DB reads if needed
    const admin = serviceClient();

    // Load all subscriptions for this user and pick the best one by priority
    let subscription: Record<string, unknown> | null = null;
    try {
      const { data: subs, error } = await admin
        .from("subscriptions")
        .select(
          "status, price_id, current_period_end, trial_end, cancel_at_period_end, cancel_at, interval, stripe_subscription_id, stripe_customer_id, created_at",
        )
        .eq("user_id", userId);

      if (error) throw error;

      const list = Array.isArray(subs) ? subs : [];

      const priority: Record<string, number> = {
        active: 6,
        trialing: 5,
        past_due: 4,
        unpaid: 3,
        canceled: 2,
        incomplete: 1,
        incomplete_expired: 0,
      };

      const pickBest = (rows: any[]) => {
        let best: any = null;
        let bestScore = -1;
        let bestEnd = -1;
        let bestCreated = -1;
        rows.forEach(r => {
          const status = String(r.status || "");
          const score = priority.hasOwnProperty(status) ? priority[status] : -1;
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
      };

      subscription = list.length ? pickBest(list) : null;
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

    // Normalize into a flat, stable contract
    const subStatus = subscription ? String(subscription.status ?? "none") : "none";
    const isTrial = subStatus === "trialing";
    const isActive = subStatus === "active" || isTrial;

    const proMonthly = Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") || "";
    const proYearly = Deno.env.get("STRIPE_PRICE_PRO_YEARLY") || "";
    const priceId = subscription ? String(subscription.price_id ?? "") : "";

    let plan: "free" | "pro" = "free";
    if (isActive) plan = "pro";

    let interval: "month" | "year" | null = null;
    const storedInterval = subscription?.interval ? String(subscription.interval) : "";
    if (storedInterval === "month" || storedInterval === "year") {
      interval = storedInterval;
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

    const trialEndsAt = subscription?.trial_end
      ? String(subscription.trial_end)
      : subscription?.current_period_end && isTrial
        ? String(subscription.current_period_end)
        : null;

    const currentPeriodEnd = subscription?.current_period_end
      ? String(subscription.current_period_end)
      : null;

    const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
    const cancelAt = subscription?.cancel_at ? String(subscription.cancel_at) : null;

    return json(req, 200, {
      ok: true,
      plan,
      status: subStatus,
      isActive,
      interval,
      trialEndsAt,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      cancelAt,
    });
  } catch (e) {
    console.error("billing-status fatal:", e);
    return json(req, 500, { error: String(e?.message ?? e) });
  }
});
