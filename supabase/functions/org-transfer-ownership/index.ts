import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
