import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKING_TRANSFER_BILLING_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);
const SAFE_NO_SUBSCRIPTION_BILLING_STATUSES = new Set([
  "trialing",
  "trial_expired",
  "canceled",
]);

type BillingProjectionRow = Record<string, unknown>;
type TransferBillingGuardResult =
  | { ok: true }
  | {
    ok: false;
    code: "workspace_has_active_billing" | "workspace_billing_state_unavailable";
    reason: string;
  };

function normalizeBillingStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeStripeSubscriptionId(value: unknown): string {
  return String(value ?? "").trim();
}

function blockedTransferBilling(reason: string): TransferBillingGuardResult {
  return { ok: false, code: "workspace_has_active_billing", reason };
}

function evaluateWorkspaceTransferBillingState(
  billingCustomerRows: BillingProjectionRow[],
  subscriptionRows: BillingProjectionRow[],
): TransferBillingGuardResult {
  if (billingCustomerRows.length > 1) {
    return blockedTransferBilling("ambiguous_billing_customer_rows");
  }

  const subscriptionRowsById = new Map<string, BillingProjectionRow[]>();
  for (const row of subscriptionRows) {
    const status = normalizeBillingStatus(row?.status);
    const stripeSubscriptionId = normalizeStripeSubscriptionId(row?.stripe_subscription_id);

    // A subscriptions projection represents a Stripe-owned object. Only an
    // explicitly ended/canceled object is safe to transfer; missing, live,
    // resumable, payment-problem, and unsupported states all fail closed.
    if (!status || status !== "canceled") {
      return blockedTransferBilling(
        BLOCKING_TRANSFER_BILLING_STATUSES.has(status)
          ? `blocking_subscription_status:${status}`
          : "unknown_subscription_status",
      );
    }

    if (stripeSubscriptionId) {
      const rows = subscriptionRowsById.get(stripeSubscriptionId) || [];
      rows.push(row);
      subscriptionRowsById.set(stripeSubscriptionId, rows);
    }
  }

  const billingCustomer = billingCustomerRows[0] || null;
  if (!billingCustomer) return { ok: true };

  const billingStatus = normalizeBillingStatus(billingCustomer.status);
  const billingCustomerId = normalizeStripeSubscriptionId(
    billingCustomer.stripe_customer_id,
  );
  const billingSubscriptionId = normalizeStripeSubscriptionId(
    billingCustomer.stripe_subscription_id,
  );

  if (!billingSubscriptionId) {
    // Repeat-owner workspaces are intentionally seeded with an empty
    // billing_customers placeholder. With no Stripe customer, subscription, or
    // non-canceled subscription projection, this is proven setup data rather
    // than an unresolved money object.
    if (!billingStatus && !billingCustomerId) return { ok: true };

    // No-card/internal trials are not Stripe money objects. Other live or
    // unsupported billing statuses remain blocking even without a usable ID.
    if (SAFE_NO_SUBSCRIPTION_BILLING_STATUSES.has(billingStatus)) return { ok: true };
    return blockedTransferBilling(
      BLOCKING_TRANSFER_BILLING_STATUSES.has(billingStatus)
        ? `blocking_billing_customer_status:${billingStatus}`
        : "unknown_billing_customer_status",
    );
  }

  // A non-null billing_customers subscription ID must be corroborated by one
  // organization-scoped, explicitly canceled subscriptions row. A missing,
  // duplicated, conflicting, or unsupported projection fails closed.
  if (billingStatus !== "canceled") {
    return blockedTransferBilling(
      BLOCKING_TRANSFER_BILLING_STATUSES.has(billingStatus)
        ? `blocking_billing_customer_status:${billingStatus}`
        : "unresolved_billing_customer_subscription",
    );
  }

  const matchingSubscriptions = subscriptionRowsById.get(billingSubscriptionId) || [];
  if (matchingSubscriptions.length !== 1) {
    return blockedTransferBilling("unresolved_billing_customer_subscription");
  }

  return { ok: true };
}

async function resolveWorkspaceTransferBillingGuard(
  sb: ReturnType<typeof serviceClient>,
  organizationId: string,
): Promise<TransferBillingGuardResult> {
  const billingCustomersRes = await sb
    .from("billing_customers")
    .select("status, stripe_customer_id, stripe_subscription_id")
    .eq("organization_id", organizationId);
  if (billingCustomersRes.error) {
    console.error("org-transfer-ownership billing_customers lookup failed", billingCustomersRes.error);
    return {
      ok: false,
      code: "workspace_billing_state_unavailable",
      reason: "billing_customers_lookup_failed",
    };
  }

  const subscriptionsRes = await sb
    .from("subscriptions")
    .select("status, stripe_subscription_id")
    .eq("organization_id", organizationId);
  if (subscriptionsRes.error) {
    console.error("org-transfer-ownership subscriptions lookup failed", subscriptionsRes.error);
    return {
      ok: false,
      code: "workspace_billing_state_unavailable",
      reason: "subscriptions_lookup_failed",
    };
  }

  return evaluateWorkspaceTransferBillingState(
    Array.isArray(billingCustomersRes.data)
      ? billingCustomersRes.data as BillingProjectionRow[]
      : [],
    Array.isArray(subscriptionsRes.data)
      ? subscriptionsRes.data as BillingProjectionRow[]
      : [],
  );
}

function transferBillingGuardResponse(
  guard: Exclude<TransferBillingGuardResult, { ok: true }>,
  origin: string | null,
  organizationId: string,
): Response {
  console.warn("org-transfer-ownership billing guard blocked transfer", {
    organization_id: organizationId,
    reason: guard.reason,
  });
  const status = guard.code === "workspace_has_active_billing" ? 409 : 503;
  return json({ error: guard.code }, { status, origin });
}

function mapTransferError(error: unknown): { status: number; message: string } {
  const raw = [
    (error as { message?: string })?.message,
    (error as { details?: string })?.details,
    (error as { hint?: string })?.hint,
  ]
    .filter(Boolean)
    .join(" ");

  if (raw.includes("TP3D_TRANSFER_NOT_PRIMARY_OWNER")) {
    return { status: 403, message: "Only the current workspace owner can transfer ownership." };
  }
  if (raw.includes("TP3D_TRANSFER_ORG_NOT_FOUND")) {
    return { status: 404, message: "Workspace not found." };
  }
  if (raw.includes("TP3D_TRANSFER_TARGET_NOT_MEMBER")) {
    return { status: 404, message: "The new owner must already be a member of this workspace." };
  }
  if (raw.includes("TP3D_TRANSFER_TARGET_IS_ACTOR")) {
    return { status: 400, message: "Choose another workspace member as the new owner." };
  }
  if (raw.includes("TP3D_TRANSFER_ACTOR_MEMBERSHIP_MISSING")) {
    return {
      status: 409,
      message: "Workspace ownership is inconsistent. Contact support before transferring ownership.",
    };
  }
  return { status: 500, message: "Failed to transfer workspace ownership." };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const origin = getAllowedOrigin(req);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin || origin === "*") return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401, origin });
    }

    const body = await req.json().catch(() => ({}));
    const orgId = String(body.organization_id || body.org_id || "").trim();
    const newOwnerId = String(body.new_owner_id || body.user_id || "").trim();

    if (!UUID_RE.test(orgId)) {
      return json({ error: "Invalid organization_id" }, { status: 400, origin });
    }
    if (!UUID_RE.test(newOwnerId)) {
      return json({ error: "Invalid new_owner_id" }, { status: 400, origin });
    }
    if (newOwnerId === auth.user.id) {
      return json({ error: "Choose another workspace member as the new owner." }, { status: 400, origin });
    }

    const sb = serviceClient();

    const organizationRes = await sb
      .from("organizations")
      .select("id, owner_id")
      .eq("id", orgId)
      .maybeSingle();
    if (organizationRes.error) {
      console.error("org-transfer-ownership organization lookup failed", organizationRes.error);
      return json({ error: "Failed to verify workspace ownership." }, { status: 500, origin });
    }
    if (!organizationRes.data) {
      return json({ error: "Workspace not found." }, { status: 404, origin });
    }
    if (String(organizationRes.data.owner_id || "") !== String(auth.user.id || "")) {
      return json(
        { error: "Only the current workspace owner can transfer ownership." },
        { status: 403, origin },
      );
    }

    const initialBillingGuard = await resolveWorkspaceTransferBillingGuard(sb, orgId);
    if (!initialBillingGuard.ok) {
      return transferBillingGuardResponse(initialBillingGuard, origin, orgId);
    }

    const targetMemberRes = await sb
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", newOwnerId)
      .maybeSingle();
    if (targetMemberRes.error) {
      console.error("org-transfer-ownership target membership lookup failed", targetMemberRes.error);
      return json({ error: "Failed to verify the new workspace owner." }, { status: 500, origin });
    }
    if (!targetMemberRes.data) {
      return json(
        { error: "The new owner must already be a member of this workspace." },
        { status: 404, origin },
      );
    }

    // Defense in depth for the separate Edge/RPC operations: repeat the
    // organization-scoped billing check immediately before the locked transfer
    // RPC. Stripe remains external to this database transaction, so a new
    // subscription could still activate after this check and before RPC commit.
    const finalBillingGuard = await resolveWorkspaceTransferBillingGuard(sb, orgId);
    if (!finalBillingGuard.ok) {
      return transferBillingGuardResponse(finalBillingGuard, origin, orgId);
    }

    const { data, error } = await sb.rpc("tp3d_transfer_workspace_ownership", {
      p_org_id: orgId,
      p_new_owner_id: newOwnerId,
      p_actor_id: auth.user.id,
    });

    if (error) {
      const mapped = mapTransferError(error);
      if (mapped.status >= 500) console.error("org-transfer-ownership rpc error", error);
      return json({ error: mapped.message }, { status: mapped.status, origin });
    }

    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    return json(
      {
        ok: true,
        organization_id: String(result.organization_id || orgId),
        old_owner_id: String(result.old_owner_id || auth.user.id),
        new_owner_id: String(result.new_owner_id || newOwnerId),
      },
      { status: 200, origin },
    );
  } catch (e) {
    console.error("org-transfer-ownership fatal:", e);
    return json({ error: "Failed to transfer workspace ownership." }, { status: 500, origin });
  }
});
