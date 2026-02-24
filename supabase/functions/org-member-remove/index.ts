import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

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

    if (!orgId) return json({ error: "Missing org_id" }, { status: 400, origin });
    if (!targetUserId) return json({ error: "Missing user_id" }, { status: 400, origin });

    const sb = serviceClient();

    const actor = await getMembership(sb, orgId, auth.user.id);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
      return json({ error: "Only owners/admins can remove members." }, { status: 403, origin });
    }

    if (targetUserId === auth.user.id) {
      return json({ error: "You cannot remove yourself." }, { status: 400, origin });
    }

    const target = await getMembership(sb, orgId, targetUserId);
    if (!target) {
      return json({ error: "Target member not found." }, { status: 404, origin });
    }

    const targetRole = target.role;

    if (targetRole === "owner") {
      if (actor.role !== "owner") {
        return json({ error: "Only owners can remove owners." }, { status: 403, origin });
      }
      const owners = await ownerCount(sb, orgId);
      if (owners <= 1) {
        return json({ error: "Cannot remove the last owner." }, { status: 409, origin });
      }
    }

    const { error: deleteErr } = await sb
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId);

    if (deleteErr) throw deleteErr;

    return json({ ok: true }, { status: 200, origin });
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
    console.error("org-member-remove error", e);
    return json({ error: message }, { status, origin });
  }
});
