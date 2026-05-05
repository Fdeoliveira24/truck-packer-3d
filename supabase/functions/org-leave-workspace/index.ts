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

async function getOrgOwnerId(sb: ReturnType<typeof serviceClient>, orgId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .maybeSingle();

  if (error) throw error;
  return data && data.owner_id ? String(data.owner_id) : null;
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

    if (!orgId) return json({ error: "Missing organization_id" }, { status: 400, origin });

    const userId = auth.user.id;
    const sb = serviceClient();

    const membership = await getMembership(sb, orgId, userId);
    if (!membership) {
      return json({ error: "You are not a member of this workspace." }, { status: 403, origin });
    }

    const orgOwnerId = await getOrgOwnerId(sb, orgId);
    if (orgOwnerId && orgOwnerId === userId) {
      return json(
        { error: "You cannot leave this workspace because you are the primary owner. Transfer ownership first." },
        { status: 409, origin },
      );
    }

    if (membership.role === "owner") {
      const owners = await ownerCount(sb, orgId);
      if (owners <= 1) {
        return json(
          {
            error:
              "You cannot leave this workspace because you are the last owner. Transfer ownership or add another owner first.",
          },
          { status: 409, origin },
        );
      }
    }

    const { error: deleteErr } = await sb
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId);

    if (deleteErr) throw deleteErr;

    return json({ ok: true, organization_id: orgId }, { status: 200, origin });
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
    console.error("org-leave-workspace error", e);
    return json({ error: message }, { status, origin });
  }
});
