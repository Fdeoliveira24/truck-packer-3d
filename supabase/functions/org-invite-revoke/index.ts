import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const REVOKABLE_INVITE_ROLES = new Set(["admin", "member"]);

type InviteRow = {
  id: string;
  organization_id: string;
  role: string | null;
  status: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
};

async function getActorRole(
  sb: ReturnType<typeof serviceClient>,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ? String(data.role).toLowerCase() : null;
}

async function getInvite(
  sb: ReturnType<typeof serviceClient>,
  inviteId: string,
): Promise<InviteRow | null> {
  const { data, error } = await sb
    .from("organization_invites")
    .select("id, organization_id, role, status, accepted_at, revoked_at")
    .eq("id", inviteId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    organization_id: String(data.organization_id || ""),
    role: data.role ? String(data.role).toLowerCase() : null,
    status: data.status ? String(data.status).toLowerCase() : null,
    accepted_at: data.accepted_at ? String(data.accepted_at) : null,
    revoked_at: data.revoked_at ? String(data.revoked_at) : null,
  };
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
    const inviteId = String(body.invite_id || body.id || "").trim();
    const requestedOrgId = String(body.organization_id || body.org_id || "").trim();

    if (!inviteId) return json({ error: "Missing invite_id" }, { status: 400, origin });

    const sb = serviceClient();
    const invite = await getInvite(sb, inviteId);
    if (!invite || !invite.organization_id) {
      return json({ error: "Invite not found." }, { status: 404, origin });
    }
    if (requestedOrgId && requestedOrgId !== invite.organization_id) {
      return json({ error: "Invite not found." }, { status: 404, origin });
    }

    const actorRole = await getActorRole(sb, invite.organization_id, auth.user.id);
    if (!actorRole || !MANAGER_ROLES.has(actorRole)) {
      return json({ error: "Only workspace owners/admins can revoke invites." }, { status: 403, origin });
    }

    const inviteRole = String(invite.role || "member").toLowerCase();
    if (inviteRole === "owner") {
      return json({ error: "Owner-role invite rows are invalid and cannot be revoked." }, { status: 409, origin });
    }
    if (!REVOKABLE_INVITE_ROLES.has(inviteRole)) {
      return json({ error: "Invalid invite role cannot be revoked." }, { status: 409, origin });
    }
    if (invite.status === "accepted" || invite.accepted_at) {
      return json({ error: "Accepted invites cannot be revoked." }, { status: 409, origin });
    }
    if (invite.status === "revoked" || invite.revoked_at) {
      return json(
        {
          ok: true,
          already_revoked: true,
          invite_id: invite.id,
          organization_id: invite.organization_id,
        },
        { status: 200, origin },
      );
    }
    if (invite.status !== "pending") {
      return json({ error: "Only pending invites can be revoked." }, { status: 409, origin });
    }
    if (actorRole === "admin" && inviteRole !== "member") {
      return json({ error: "Only workspace owners can revoke admin invites." }, { status: 403, origin });
    }

    const nowIso = new Date().toISOString();
    const { data: revoked, error: updateErr } = await sb
      .from("organization_invites")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("id", invite.id)
      .eq("status", "pending")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id, organization_id")
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!revoked) {
      const latest = await getInvite(sb, invite.id);
      if (latest && (latest.status === "revoked" || latest.revoked_at)) {
        return json(
          {
            ok: true,
            already_revoked: true,
            invite_id: invite.id,
            organization_id: invite.organization_id,
          },
          { status: 200, origin },
        );
      }
      if (latest && (latest.status === "accepted" || latest.accepted_at)) {
        return json({ error: "Accepted invites cannot be revoked." }, { status: 409, origin });
      }
      return json({ error: "Invite could not be revoked. Please refresh and try again." }, { status: 409, origin });
    }

    return json(
      {
        ok: true,
        invite_id: String(revoked.id || invite.id),
        organization_id: String(revoked.organization_id || invite.organization_id),
      },
      { status: 200, origin },
    );
  } catch (e) {
    const code = (e as any)?.code;
    if (code === "42P01") {
      return json(
        { error: "organization_invites table is missing. Run migrations first." },
        { status: 500, origin },
      );
    }

    const status = (e as any)?.status ?? 500;
    const message = (e as Error).message ?? "Server error";
    console.error("org-invite-revoke error", e);
    return json({ error: message }, { status, origin });
  }
});
