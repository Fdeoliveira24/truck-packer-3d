import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const VALID_ROLES = new Set(["owner", "admin", "member"]);

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

async function ownerCount(sb: ReturnType<typeof serviceClient>, orgId: string): Promise<number> {
  const { count, error } = await sb
    .from("organization_members")
    .select("user_id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("role", "owner");

  if (error) throw error;
  return Number(count || 0);
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

    if (!orgId) return json({ error: "Missing org_id" }, { status: 400, origin });
    if (!targetUserId) return json({ error: "Missing user_id" }, { status: 400, origin });
    if (!nextRole) return json({ error: "Invalid role" }, { status: 400, origin });

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

    if (actor.role !== "owner" && (nextRole === "owner" || targetRole === "owner")) {
      return json({ error: "Only owners can manage owner role." }, { status: 403, origin });
    }

    if (targetRole === "owner" && nextRole !== "owner") {
      const owners = await ownerCount(sb, orgId);
      if (owners <= 1) {
        return json({ error: "Cannot demote the last owner." }, { status: 409, origin });
      }
    }

    if (targetRole === nextRole) {
      return json({ ok: true, role: targetRole }, { status: 200, origin });
    }

    const { data: updated, error: updateErr } = await sb
      .from("organization_members")
      .update({ role: nextRole })
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId)
      .select("id, organization_id, user_id, role, joined_at")
      .maybeSingle();

    if (updateErr) throw updateErr;

    return json({ ok: true, member: updated }, { status: 200, origin });
  } catch (e) {
    const code = (e as any)?.code;
    if (code === "42P01") {
      return json(
        { error: "organization_members table is missing. Run migrations first." },
        { status: 500, origin },
      );
    }

    const status = (e as any)?.status ?? 500;
    const message = (e as Error).message ?? "Server error";
    console.error("org-member-role-update error", e);
    return json({ error: message }, { status, origin });
  }
});
