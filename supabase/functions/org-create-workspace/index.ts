import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { getBillingCatalog } from "../_shared/billing-catalog.ts";

const MAX_WORKSPACE_NAME_LENGTH = 120;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_WORKSPACE_NAME_LENGTH) return null;
  return normalized;
}

type RpcErrorContract = {
  status: number;
  code: string;
  message: string;
};

function rpcErrorContract(error: unknown): RpcErrorContract {
  const raw = [
    (error as { message?: string })?.message,
    (error as { details?: string })?.details,
    (error as { hint?: string })?.hint,
  ]
    .filter(Boolean)
    .join(" ");

  if (raw.includes("TP3D_CREATE_INVALID_NAME")) {
    return {
      status: 400,
      code: "invalid_workspace_name",
      message: "Enter a workspace name between 1 and 120 characters.",
    };
  }
  if (raw.includes("TP3D_CREATE_ACTOR_REQUIRED")) {
    return { status: 401, code: "unauthorized", message: "Unauthorized" };
  }
  if (raw.includes("TP3D_CREATE_WORKSPACE_LIMIT_REACHED")) {
    return {
      status: 409,
      code: "workspace_limit_reached",
      message: "Workspace limit reached. Upgrade your plan before creating another workspace.",
    };
  }
  if (raw.includes("TP3D_CREATE_BILLING_IDENTITY_UNSAFE")) {
    return {
      status: 409,
      code: "workspace_billing_identity_unsafe",
      message: "Workspace billing identity could not be verified safely.",
    };
  }
  if (raw.includes("TP3D_CREATE_ENTITLEMENT_UNAVAILABLE") ||
      raw.includes("TP3D_CREATE_ENTITLEMENT_CONFIG_INVALID")) {
    return {
      status: 503,
      code: "workspace_entitlement_unavailable",
      message: "Workspace entitlement is temporarily unavailable. Try again later.",
    };
  }
  return {
    status: 500,
    code: "workspace_creation_failed",
    message: "Failed to create workspace.",
  };
}

function buildWorkspaceEntitlementConfig() {
  const catalog = getBillingCatalog();
  const business = catalog.tiers.business;
  const businessPriceIds = Array.from(new Set([
    business.prices.month,
    business.prices.year,
    ...business.legacyPrices.month,
    ...business.legacyPrices.year,
  ].map((value) => String(value || "").trim()).filter(Boolean)));

  return {
    version: 1,
    trial_limit: catalog.tiers.trial.workspaceLimit,
    pro_limit: catalog.tiers.pro.workspaceLimit,
    business_limit: business.workspaceLimit,
    business_price_ids: businessPriceIds,
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const origin = getAllowedOrigin(req);

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed", code: "invalid_request" }, { status: 405, origin });
    }
    if (!origin || origin === "*") {
      return json({ error: "Origin not allowed", code: "forbidden" }, { status: 403, origin: null });
    }

    let auth;
    try {
      auth = await requireUser(req);
    } catch {
      // A Functions client without a signed-in user can still send the public
      // anon key as its gateway Authorization value. Treat that as an
      // unauthenticated request instead of exposing an auth-client failure.
      return json({ error: "Unauthorized", code: "unauthorized" }, { status: 401, origin });
    }
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized", code: "unauthorized" }, {
        status: auth.status || 401,
        origin,
      });
    }

    const body = await req.json().catch(() => ({}));
    const name = normalizeWorkspaceName((body as Record<string, unknown>).name);
    if (!name) {
      return json({
        error: "Enter a workspace name between 1 and 120 characters.",
        code: "invalid_workspace_name",
      }, { status: 400, origin });
    }

    // Each accepted request creates one distinct workspace. The browser owns
    // single-flight submission; the server never guesses that equal names are retries.
    const sb = serviceClient();
    const { data, error } = await sb.rpc("tp3d_create_workspace", {
      p_actor_id: auth.user.id,
      p_name: name,
      p_entitlement_config: buildWorkspaceEntitlementConfig(),
    });

    if (error) {
      const contract = rpcErrorContract(error);
      if (contract.status >= 500) {
        console.error("org-create-workspace rpc error", {
          code: String((error as { code?: string })?.code || "rpc_failed"),
        });
      }
      return json({ error: contract.message, code: contract.code }, {
        status: contract.status,
        origin,
      });
    }

    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const organizationId = String(result.organization_id || "");
    const ownerId = String(result.owner_id || "");
    if (!organizationId || ownerId !== auth.user.id) {
      console.error("org-create-workspace invalid rpc result");
      return json({
        error: "Failed to create workspace.",
        code: "workspace_creation_failed",
      }, { status: 500, origin });
    }

    return json({
      ok: true,
      organization: {
        id: organizationId,
        name: String(result.name || name),
        slug: String(result.slug || organizationId),
        owner_id: ownerId,
      },
      membership: {
        id: String(result.membership_id || ""),
        organization_id: organizationId,
        user_id: ownerId,
        role: "owner",
      },
    }, { status: 200, origin });
  } catch {
    console.error("org-create-workspace fatal");
    return json({
      error: "Failed to create workspace.",
      code: "workspace_creation_failed",
    }, { status: 500, origin });
  }
});
