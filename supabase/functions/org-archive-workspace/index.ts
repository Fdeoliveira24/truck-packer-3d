import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

type OrganizationRow = {
  id: string;
  owner_id: string | null;
  archived_at: string | null;
};

async function getOrganization(
  sb: ReturnType<typeof serviceClient>,
  orgId: string,
): Promise<OrganizationRow | null> {
  const { data, error } = await sb
    .from("organizations")
    .select("id, owner_id, archived_at")
    .eq("id", orgId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id),
    owner_id: data.owner_id ? String(data.owner_id) : null,
    archived_at: data.archived_at ? String(data.archived_at) : null,
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
    const orgId = String(body.organization_id || body.org_id || "").trim();
    if (!orgId) return json({ error: "Missing organization_id" }, { status: 400, origin });

    const sb = serviceClient();
    const org = await getOrganization(sb, orgId);
    if (!org) {
      return json({ error: "Workspace not found." }, { status: 404, origin });
    }
    if (!org.owner_id || org.owner_id !== auth.user.id) {
      return json({ error: "Only the workspace owner can archive this workspace." }, { status: 403, origin });
    }
    if (org.archived_at) {
      return json(
        {
          ok: true,
          already_archived: true,
          organization_id: org.id,
          archived_at: org.archived_at,
        },
        { status: 200, origin },
      );
    }

    const nowIso = new Date().toISOString();
    const { data: archived, error: updateErr } = await sb
      .from("organizations")
      .update({ archived_at: nowIso })
      .eq("id", org.id)
      .eq("owner_id", auth.user.id)
      .is("archived_at", null)
      .select("id, archived_at")
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!archived) {
      const latest = await getOrganization(sb, org.id);
      if (latest && latest.archived_at) {
        return json(
          {
            ok: true,
            already_archived: true,
            organization_id: latest.id,
            archived_at: latest.archived_at,
          },
          { status: 200, origin },
        );
      }
      return json({ error: "Workspace could not be archived. Please refresh and try again." }, { status: 409, origin });
    }

    return json(
      {
        ok: true,
        organization_id: String(archived.id || org.id),
        archived_at: String(archived.archived_at || nowIso),
      },
      { status: 200, origin },
    );
  } catch (e) {
    const code = (e as any)?.code;
    if (code === "42703") {
      return json(
        { error: "Workspace archive column is missing. Run migrations first." },
        { status: 500, origin },
      );
    }
    if (code === "42P01") {
      return json(
        { error: "Required tables are missing. Run migrations first." },
        { status: 500, origin },
      );
    }

    const status = (e as any)?.status ?? 500;
    const message = (e as Error).message ?? "Server error";
    console.error("org-archive-workspace error", e);
    return json({ error: message }, { status, origin });
  }
});
