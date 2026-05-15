import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

const VALID_ROLES = new Set(["admin", "member"]);
const MANAGER_ROLES = new Set(["owner", "admin"]);
const INVITE_EXPIRATION_DAYS = 7;
type InviteEmailStatus = "sent" | "not_configured" | "send_failed";

function normalizeRole(value: unknown): "admin" | "member" | null {
  const role = String(value || "member").trim().toLowerCase();
  if (!VALID_ROLES.has(role)) return null;
  return role as "admin" | "member";
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function createInviteToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  bytes.forEach((b) => {
    raw += String.fromCharCode(b);
  });
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function buildInviteLink(origin: string | null, token: string): string | null {
  const base =
    (origin && origin !== "*" && origin !== "null" ? origin : null) ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("SUPABASE_SITE_URL") ||
    null;

  if (!base) return null;

  try {
    const url = new URL(base);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/index.html";
    }
    url.searchParams.set("invite_token", token);
    return url.toString();
  } catch {
    return null;
  }
}

function inviteExpiresAt(now: Date): string {
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  return expiresAt.toISOString();
}

function getEnvTrimmed(name: string): string {
  return String(Deno.env.get(name) || "").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roleLabel(role: string): string {
  const normalized = String(role || "member").trim().toLowerCase();
  return normalized === "admin" ? "Admin" : "Member";
}

function formatExpiration(expiresAt: unknown): string | null {
  const raw = String(expiresAt || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toUTCString();
}

async function getOrganizationName(
  sb: ReturnType<typeof serviceClient>,
  orgId: string,
): Promise<string> {
  const { data, error } = await sb
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  if (error) return "your Truck Packer 3D workspace";
  const name = String(data?.name || "").trim();
  return name || "your Truck Packer 3D workspace";
}

function buildInviteEmail(input: {
  workspaceName: string;
  role: string;
  inviteLink: string;
  expiresAt?: unknown;
  supportEmail?: string;
}) {
  const workspaceName = input.workspaceName || "your Truck Packer 3D workspace";
  const role = roleLabel(input.role);
  const expiresAt = formatExpiration(input.expiresAt);
  const supportEmail = String(input.supportEmail || "").trim();
  const expirationText = expiresAt
    ? `This invite expires on ${expiresAt}.`
    : "This invite expires in 7 days.";
  const supportText = supportEmail ? `Need help? Contact ${supportEmail}.` : "";

  const text = [
    `You're invited to join ${workspaceName} in Truck Packer 3D.`,
    `Role: ${role}`,
    expirationText,
    "",
    `Accept invite: ${input.inviteLink}`,
    supportText,
  ].filter(Boolean).join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #18212f;">
    <h2 style="margin: 0 0 12px;">You're invited to Truck Packer 3D</h2>
    <p>You have been invited to join <strong>${escapeHtml(workspaceName)}</strong>.</p>
    <p><strong>Role:</strong> ${escapeHtml(role)}</p>
    <p>${escapeHtml(expirationText)}</p>
    <p><a href="${escapeHtml(input.inviteLink)}" style="display: inline-block; padding: 10px 14px; background: #18212f; color: #ffffff; text-decoration: none; border-radius: 6px;">Accept invite</a></p>
    <p>If the button does not work, paste this link into your browser:<br>${escapeHtml(input.inviteLink)}</p>
    ${supportEmail ? `<p>${escapeHtml(supportText)}</p>` : ""}
  </body>
</html>`;

  return {
    subject: "You're invited to join a Truck Packer 3D workspace",
    text,
    html,
  };
}

async function sendInviteEmail(input: {
  organizationId: string;
  invitedEmail: string;
  role: string;
  inviteLink: string | null;
  workspaceName: string;
  expiresAt?: unknown;
}): Promise<{ email_sent: boolean; email_status: InviteEmailStatus }> {
  const apiKey = getEnvTrimmed("RESEND_API_KEY");
  const from = getEnvTrimmed("INVITE_EMAIL_FROM");
  const supportEmail = getEnvTrimmed("SUPPORT_EMAIL");

  if (!apiKey || !from || !input.inviteLink) {
    return { email_sent: false, email_status: "not_configured" };
  }

  const email = buildInviteEmail({
    workspaceName: input.workspaceName,
    role: input.role,
    inviteLink: input.inviteLink,
    expiresAt: input.expiresAt,
    supportEmail,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.invitedEmail,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (res.ok) {
      return { email_sent: true, email_status: "sent" };
    }

    console.warn("org-invite email send failed", {
      organization_id: input.organizationId,
      invited_email: input.invitedEmail,
      role: input.role,
      email_status: "send_failed",
      status: res.status,
    });
    return { email_sent: false, email_status: "send_failed" };
  } catch {
    console.warn("org-invite email send failed", {
      organization_id: input.organizationId,
      invited_email: input.invitedEmail,
      role: input.role,
      email_status: "send_failed",
      status: null,
    });
    return { email_sent: false, email_status: "send_failed" };
  }
}

async function getActorRole(sb: ReturnType<typeof serviceClient>, orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ? String(data.role).toLowerCase() : null;
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
    const email = normalizeEmail(body.email);
    const requestedRole = String(body.role || "member").trim().toLowerCase();
    const role = normalizeRole(requestedRole);

    if (Deno.env.get("SUPABASE_DEBUG") === "1") {
      console.log("org-invite request", {
        orgId,
        role: requestedRole,
        hasEmail: Boolean(email),
      });
    }

    if (!orgId) return json({ error: "Missing organization_id" }, { status: 400, origin });
    if (!email) return json({ error: "Missing email" }, { status: 400, origin });
    if (requestedRole === "owner") {
      return json(
        { error: "Owner invites are not allowed. Invite as Admin or Member, then promote in Members." },
        { status: 400, origin },
      );
    }
    if (!role) return json({ error: "Invalid role. Allowed roles: member, admin." }, { status: 400, origin });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid email address." }, { status: 400, origin });
    }

    const sb = serviceClient();
    const actorRole = await getActorRole(sb, orgId, auth.user.id);
    if (!actorRole || !MANAGER_ROLES.has(actorRole)) {
      return json({ error: "Only owners/admins can invite members." }, { status: 403, origin });
    }
    if (actorRole === "admin" && role === "admin") {
      return json({ error: "Only workspace owners can invite admins." }, { status: 403, origin });
    }

    const workspaceName = await getOrganizationName(sb, orgId);
    const token = createInviteToken();
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAtIso = inviteExpiresAt(now);

    const { data: pendingRows, error: pendingErr } = await sb
      .from("organization_invites")
      .select("id, email")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .is("accepted_at", null)
      .is("revoked_at", null)
      .limit(200);

    if (pendingErr) throw pendingErr;

    const existingPending = (Array.isArray(pendingRows) ? pendingRows : []).find(
      (row) => String(row?.email || "").trim().toLowerCase() === email,
    );

    const payload = {
      email,
      role,
      status: "pending",
      token,
      invited_by: auth.user.id,
      invited_at: nowIso,
      expires_at: expiresAtIso,
      accepted_at: null,
      revoked_at: null,
    };

    let inviteRecord: Record<string, unknown> | null = null;

    if (existingPending?.id) {
      const { data, error } = await sb
        .from("organization_invites")
        .update(payload)
        .eq("id", String(existingPending.id))
        .select("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at")
        .single();
      if (error) throw error;
      inviteRecord = data as Record<string, unknown>;
    } else {
      const { data, error } = await sb
        .from("organization_invites")
        .insert({
          organization_id: orgId,
          ...payload,
        })
        .select("id, organization_id, email, role, status, invited_by, invited_at, expires_at, accepted_at, revoked_at")
        .single();
      if (error) throw error;
      inviteRecord = data as Record<string, unknown>;
    }

    const inviteLink = buildInviteLink(origin, token);
    const emailResult = await sendInviteEmail({
      organizationId: orgId,
      invitedEmail: email,
      role,
      inviteLink,
      workspaceName,
      expiresAt: inviteRecord?.expires_at,
    });

    return json(
      {
        ok: true,
        invite: inviteRecord,
        invite_link: inviteLink,
        email_sent: emailResult.email_sent,
        email_status: emailResult.email_status,
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
    console.error("org-invite error", { status });
    return json({ error: message }, { status, origin });
  }
});
