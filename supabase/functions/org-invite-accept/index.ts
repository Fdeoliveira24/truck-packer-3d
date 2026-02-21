import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

function normalizeRole(value: unknown): "owner" | "admin" | "member" {
  const role = String(value || "member").toLowerCase();
  if (role === "owner" || role === "admin") return role;
  return "member";
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

    const auth = await requireUser(req);
    if (!auth.ok || !auth.user) {
      return json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401, origin });
    }

    const user = auth.user;
    const userEmail = String(user.email || "").trim().toLowerCase();
    if (!userEmail) {
      return json({ error: "Authenticated account has no email." }, { status: 400, origin });
    }

    const body = await req.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) {
      return json({ error: "Missing invite token" }, { status: 400, origin });
    }

    const sb = serviceClient();

    const { data: invite, error: inviteErr } = await sb
      .from("organization_invites")
      .select("id, organization_id, email, role, status, accepted_at, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteErr) throw inviteErr;
    if (!invite) {
      return json({ error: "Invite not found or expired." }, { status: 404, origin });
    }

    const inviteStatus = String(invite.status || "").toLowerCase();
    if (inviteStatus === "accepted") {
      return json(
        {
          ok: true,
          already_accepted: true,
          organization_id: invite.organization_id,
        },
        { status: 200, origin },
      );
    }
    if (inviteStatus !== "pending" || invite.revoked_at) {
      return json({ error: "Invite is no longer valid." }, { status: 409, origin });
    }

    const inviteEmail = String(invite.email || "").trim().toLowerCase();
    if (!inviteEmail || inviteEmail !== userEmail) {
      return json(
        { error: "Invite email does not match the signed-in account." },
        { status: 403, origin },
      );
    }

    const role = normalizeRole(invite.role);

    // Insert membership if missing; keep existing role for existing members.
    const { error: memberErr } = await sb
      .from("organization_members")
      .upsert(
        {
          organization_id: invite.organization_id,
          user_id: user.id,
          role,
        },
        {
          onConflict: "organization_id,user_id",
          ignoreDuplicates: true,
        },
      );

    if (memberErr) throw memberErr;

    const acceptedAt = new Date().toISOString();
    const { error: markErr } = await sb
      .from("organization_invites")
      .update({
        status: "accepted",
        accepted_at: acceptedAt,
        revoked_at: null,
      })
      .eq("id", invite.id)
      .eq("status", "pending");

    if (markErr) throw markErr;

    return json(
      {
        ok: true,
        organization_id: invite.organization_id,
        accepted_at: acceptedAt,
        message: "Invite accepted. You are now a member of this organization.",
      },
      { status: 200, origin },
    );
  } catch (e) {
    const code = (e as any)?.code;
    if (code === "42P01") {
      return json(
        { error: "Required invite/member tables are missing. Run migrations first." },
        { status: 500, origin },
      );
    }

    const status = (e as any)?.status ?? 500;
    const message = (e as Error).message ?? "Server error";
    console.error("org-invite-accept error", e);
    return json({ error: message }, { status, origin });
  }
});
