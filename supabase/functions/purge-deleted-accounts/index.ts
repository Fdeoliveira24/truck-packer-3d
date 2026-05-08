import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/auth.ts";

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;

type ProfileCandidate = {
  id: string;
  deletion_status: string | null;
  purge_after: string | null;
};

function responseOriginFor(req: Request): { allowed: boolean; origin: string | null } {
  const allowedOrigin = getAllowedOrigin(req);
  if (allowedOrigin === null) return { allowed: false, origin: null };
  return { allowed: true, origin: allowedOrigin === "*" ? null : allowedOrigin };
}

function getExpectedSecret(): string {
  try {
    return String(Deno.env.get("PURGE_ACCOUNTS_INVOCATION_SECRET") || "").trim();
  } catch {
    return "";
  }
}

function getRequestSecret(req: Request): string {
  const direct = String(req.headers.get("x-purge-secret") || "").trim();
  if (direct) return direct;

  const authorization = String(req.headers.get("authorization") || req.headers.get("Authorization") || "").trim();
  if (!authorization) return "";

  const lower = authorization.toLowerCase();
  return lower.startsWith("bearer ") ? authorization.slice(7).trim() : authorization;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseBatchLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_LIMIT;
  return Math.min(parsed, MAX_BATCH_LIMIT);
}

async function hasWorkspaceOwnerReference(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("organizations")
    .select("id")
    .eq("owner_id", userId)
    .limit(1);

  if (error) {
    console.error("purge-deleted-accounts: owner reference lookup failed", error);
    throw new Error("owner reference lookup failed");
  }

  return Array.isArray(data) && data.length > 0;
}

async function markProfilePurged(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("profiles")
    .update({ deletion_status: "purged" })
    .eq("id", userId)
    .eq("deletion_status", "requested")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("purge-deleted-accounts: mark purged failed", error);
    throw new Error("profile purged update failed");
  }

  return Boolean(data?.id);
}

async function revertProfileToRequested(
  sb: ReturnType<typeof serviceClient>,
  userId: string,
): Promise<void> {
  const { error } = await sb
    .from("profiles")
    .update({ deletion_status: "requested" })
    .eq("id", userId)
    .eq("deletion_status", "purged");

  if (error) {
    console.error("purge-deleted-accounts: revert to requested failed", error);
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const { allowed, origin } = responseOriginFor(req);

  try {
    if (!allowed) return json({ error: "Origin not allowed" }, { status: 403, origin: null });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405, origin });

    const expectedSecret = getExpectedSecret();
    if (!expectedSecret) {
      console.error("purge-deleted-accounts: invocation secret is not configured");
      return json({ error: "Account purge is not configured" }, { status: 500, origin });
    }

    if (getRequestSecret(req) !== expectedSecret) {
      return json({ error: "Unauthorized" }, { status: 401, origin });
    }

    const body = await readBody(req);
    const batchLimit = parseBatchLimit(body.batch_limit ?? body.limit);
    const sb = serviceClient();
    const nowIso = new Date().toISOString();

    const { data: candidates, error: candidatesErr } = await sb
      .from("profiles")
      .select("id, deletion_status, purge_after")
      .eq("deletion_status", "requested")
      .lte("purge_after", nowIso)
      .order("purge_after", { ascending: true })
      .limit(batchLimit);

    if (candidatesErr) {
      console.error("purge-deleted-accounts: candidate lookup failed", candidatesErr);
      return json({ error: "Failed to load purge candidates" }, { status: 500, origin });
    }

    let purged = 0;
    let skipped = 0;
    let errors = 0;

    for (const candidate of (Array.isArray(candidates) ? candidates as ProfileCandidate[] : [])) {
      const userId = String(candidate?.id || "");
      if (!userId) {
        skipped += 1;
        continue;
      }

      try {
        if (await hasWorkspaceOwnerReference(sb, userId)) {
          skipped += 1;
          continue;
        }

        const marked = await markProfilePurged(sb, userId);
        if (!marked) {
          skipped += 1;
          continue;
        }

        let deleteErr: unknown | null = null;
        try {
          const { error } = await sb.auth.admin.deleteUser(userId);
          deleteErr = error || null;
        } catch (err) {
          deleteErr = err;
        }

        if (deleteErr) {
          console.error("purge-deleted-accounts: auth user delete failed", deleteErr);
          await revertProfileToRequested(sb, userId);
          errors += 1;
          continue;
        }

        purged += 1;
      } catch (err) {
        console.error("purge-deleted-accounts: candidate processing failed", err);
        errors += 1;
      }
    }

    return json({ ok: true, purged, skipped, errors }, { status: 200, origin });
  } catch (err) {
    console.error("purge-deleted-accounts fatal:", err);
    return json({ error: "Failed to purge deleted accounts" }, { status: 500, origin });
  }
});
