import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(["owner", "admin", "member"]);
const OWNERSHIP_TRANSFER_REQUIRED = "ownership_change_requires_transfer";

function normalizeRole(value: unknown): "owner" | "admin" | "member" | null {
  const role = String(value || "").trim().toLowerCase();
  if (!VALID_ROLES.has(role)) return null;
  return role as "owner" | "admin" | "member";
}

async function getMembership(
  sb: ReturnType<typeof serviceClient>,
  orgId: string,
  userId: string,
): Promise<{ role: string } | null> {
  const { data, error } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { role: String(data.role || "member").toLowerCase() };
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
    const orgId = String(body.org_id || body.organization_id || "").trim();
    const targetUserId = String(body.user_id || "").trim();
    const nextRole = normalizeRole(body.role);

    if (!UUID_RE.test(orgId)) return json({ error: "Invalid org_id" }, { status: 400, origin });
    if (!UUID_RE.test(targetUserId)) return json({ error: "Invalid user_id" }, { status: 400, origin });
    if (!nextRole) return json({ error: "Invalid role" }, { status: 400, origin });
    if (nextRole === "owner") {
      return json({ error: OWNERSHIP_TRANSFER_REQUIRED }, { status: 409, origin });
    }

    const sb = serviceClient();
    const actor = await getMembership(sb, orgId, auth.user.id);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      return json({ error: "Only owners/admins can update roles." }, { status: 403, origin });
    }

    const target = await getMembership(sb, orgId, targetUserId);
    if (!target) {
      return json({ error: "Target member not found." }, { status: 404, origin });
    }

    const targetRole = target.role;

    if (targetRole === "owner") {
      return json({ error: OWNERSHIP_TRANSFER_REQUIRED }, { status: 409, origin });
    }

    // Admins cannot promote to admin or demote/edit existing admins — owner only.
    if (actor.role !== "owner" && (nextRole === "admin" || targetRole === "admin")) {
      return json({ error: "Only owners can manage admin roles." }, { status: 403, origin });
    }

    const { data: organization, error: organizationErr } = await sb
      .from("organizations")
      .select("owner_id")
      .eq("id", orgId)
      .maybeSingle();

    if (organizationErr) throw organizationErr;
    if (!organization) {
      return json({ error: "Workspace not found." }, { status: 404, origin });
    }
    if (String(organization.owner_id || "") === targetUserId) {
      return json({ error: OWNERSHIP_TRANSFER_REQUIRED }, { status: 409, origin });
    }

    if (targetRole === nextRole) {
      return json({ ok: true, role: targetRole }, { status: 200, origin });
    }

    const { data: updated, error: updateErr } = await sb
      .from("organization_members")
      .update({ role: nextRole })
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId)
      .eq("role", targetRole)
      .select("id, organization_id, user_id, role, joined_at")
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) {
      return json({ error: "member_role_update_failed" }, { status: 409, origin });
    }

    return json({ ok: true, member: updated }, { status: 200, origin });
  } catch (e) {
    console.error("org-member-role-update error", e);
    return json({ error: "member_role_update_failed" }, { status: 500, origin });
  }
});
