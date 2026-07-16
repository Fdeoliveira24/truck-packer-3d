import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const MAX_WORKSPACE_NAME_LENGTH = 120;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > MAX_WORKSPACE_NAME_LENGTH) return null;
  return normalized;
}

function rpcErrorStatus(error: unknown): number {
  const raw = [
    (error as { message?: string })?.message,
    (error as { details?: string })?.details,
    (error as { hint?: string })?.hint,
  ]
    .filter(Boolean)
    .join(" ");

  if (raw.includes("TP3D_CREATE_INVALID_NAME")) return 400;
  if (raw.includes("TP3D_CREATE_ACTOR_REQUIRED")) return 401;
  return 500;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const origin = getAllowedOrigin(req);

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, { status: 405, origin });
    }
    if (!origin || origin === "*") {
      return json({ error: "Origin not allowed" }, { status: 403, origin: null });
    }

    let auth;
    try {
      auth = await requireUser(req);
    } catch {
      // A Functions client without a signed-in user can still send the public
      // anon key as its gateway Authorization value. Treat that as an
      // unauthenticated request instead of exposing an auth-client failure.
      return json({ error: "Unauthorized" }, { status: 401, origin });
    }
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401, origin });
    }

    const body = await req.json().catch(() => ({}));
    const name = normalizeWorkspaceName((body as Record<string, unknown>).name);
    if (!name) {
      return json({ error: "Enter a workspace name between 1 and 120 characters." }, { status: 400, origin });
    }

    // Each accepted request creates one distinct workspace. The browser owns
    // single-flight submission; the server never guesses that equal names are retries.
    const sb = serviceClient();
    const { data, error } = await sb.rpc("tp3d_create_workspace", {
      p_actor_id: auth.user.id,
      p_name: name,
    });

    if (error) {
      const status = rpcErrorStatus(error);
      if (status >= 500) console.error("org-create-workspace rpc error", error);
      const message = status === 400
        ? "Enter a workspace name between 1 and 120 characters."
        : status === 401
        ? "Unauthorized"
        : "Failed to create workspace.";
      return json({ error: message }, { status, origin });
    }

    const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const organizationId = String(result.organization_id || "");
    const ownerId = String(result.owner_id || "");
    if (!organizationId || ownerId !== auth.user.id) {
      console.error("org-create-workspace invalid rpc result");
      return json({ error: "Failed to create workspace." }, { status: 500, origin });
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
  } catch (error) {
    console.error("org-create-workspace fatal", error);
    return json({ error: "Failed to create workspace." }, { status: 500, origin });
  }
});
