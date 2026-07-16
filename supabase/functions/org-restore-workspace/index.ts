import { getAllowedOrigin, handleCors, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { workspaceLimitForRestoreCandidate } from "../_shared/billing-catalog.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RESTORE_LIMIT_ERROR =
  "This workspace cannot be restored under the current workspace limit. Archive another active workspace, upgrade, or contact support first.";

type Candidate = {
  organization_id: string;
  status: string;
  price_id: string;
  plan_name: string;
  current_period_end: string | null;
  trial_end: string | null;
  created_at: string | null;
};

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function isCandidateUsable(candidate: Candidate): boolean {
  const status = String(candidate.status || "").toLowerCase();
  if (status === "active") return true;
  if (status === "trialing") {
    const trialEnd = parseTimestamp(candidate.trial_end);
    return !trialEnd || trialEnd > Date.now();
  }
  if (status === "past_due" || status === "unpaid") {
    const currentPeriodEnd = parseTimestamp(candidate.current_period_end);
    return currentPeriodEnd > Date.now();
  }
  return false;
}

function candidateRank(candidate: Candidate): number {
  const status = String(candidate.status || "").toLowerCase();
  if (status === "business") return 4;
  if (status === "active") return 3;
  if (status === "trialing") return 2;
  if (status === "past_due" || status === "unpaid") return 1;
  return 0;
}

function pickBestCandidate(candidates: Candidate[]): Candidate | null {
  const usable = candidates.filter(isCandidateUsable);
  usable.sort((a, b) => {
    const rankDiff = candidateRank(b) - candidateRank(a);
    if (rankDiff) return rankDiff;
    return (
      parseTimestamp(b.current_period_end || b.trial_end || b.created_at) -
      parseTimestamp(a.current_period_end || a.trial_end || a.created_at)
    );
  });
  return usable[0] || null;
}

async function verifyRestoreFitsWorkspaceLimit(
  sb: ReturnType<typeof serviceClient>,
  ownerId: string,
  restoreOrgId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: ownedOrgs, error: ownedErr } = await sb
    .from("organizations")
    .select("id, created_at, archived_at")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (ownedErr) {
    console.error("org-restore-workspace: owner workspace lookup failed", ownedErr);
    throw new Error("Failed to verify workspace limit");
  }

  const ownerWorkspaces = Array.isArray(ownedOrgs) ? ownedOrgs : [];
  const ownerWorkspaceIds = ownerWorkspaces
    .map((row) => String(row?.id || ""))
    .filter((id) => id.length > 0);

  if (!ownerWorkspaceIds.includes(restoreOrgId)) {
    return { ok: false, message: "Workspace ownership could not be verified" };
  }

  const [subscriptionResult, customerResult] = await Promise.all([
    sb
      .from("subscriptions")
      .select("organization_id, status, price_id, current_period_end, trial_end, created_at")
      .in("organization_id", ownerWorkspaceIds),
    sb
      .from("billing_customers")
      .select("organization_id, status, plan_name, billing_interval, current_period_end, trial_ends_at, created_at")
      .in("organization_id", ownerWorkspaceIds),
  ]);

  if (subscriptionResult.error) {
    console.error("org-restore-workspace: subscription projection lookup failed", subscriptionResult.error);
    throw new Error("Failed to verify workspace limit");
  }
  if (customerResult.error) {
    console.error("org-restore-workspace: customer projection lookup failed", customerResult.error);
    throw new Error("Failed to verify workspace limit");
  }

  const candidates: Candidate[] = [];
  for (const row of Array.isArray(subscriptionResult.data) ? subscriptionResult.data : []) {
    candidates.push({
      organization_id: String(row?.organization_id || ""),
      status: String(row?.status || ""),
      price_id: String(row?.price_id || ""),
      plan_name: "",
      current_period_end: row?.current_period_end || null,
      trial_end: row?.trial_end || null,
      created_at: row?.created_at || null,
    });
  }
  for (const row of Array.isArray(customerResult.data) ? customerResult.data : []) {
    candidates.push({
      organization_id: String(row?.organization_id || ""),
      status: String(row?.status || ""),
      price_id: String(row?.billing_interval || ""),
      plan_name: String(row?.plan_name || ""),
      current_period_end: row?.current_period_end || null,
      trial_end: row?.trial_ends_at || null,
      created_at: row?.created_at || null,
    });
  }

  const bestCandidate = pickBestCandidate(candidates);
  const workspaceLimit = bestCandidate
    ? workspaceLimitForRestoreCandidate(
      bestCandidate.price_id,
      bestCandidate.plan_name,
      bestCandidate.status,
    )
    : 0;
  if (!bestCandidate || workspaceLimit <= 0) {
    return { ok: false, message: RESTORE_LIMIT_ERROR };
  }

  const ownerWorkspacesForLimit = ownerWorkspaces
    .sort((a, b) => parseTimestamp(a?.created_at || null) - parseTimestamp(b?.created_at || null));

  const included = new Set<string>();
  const entitlementOrgId = String(bestCandidate.organization_id || "");
  if (entitlementOrgId) included.add(entitlementOrgId);
  for (const row of ownerWorkspacesForLimit) {
    if (included.size >= workspaceLimit) break;
    const id = String(row?.id || "");
    if (id) included.add(id);
  }

  if (!included.has(restoreOrgId)) {
    return { ok: false, message: RESTORE_LIMIT_ERROR };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);
  const cors = handleCors(req, origin);
  if (cors) return cors;
  if (!origin || origin === "*") {
    return json({ error: "Origin not allowed" }, { status: 403, origin });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, origin });
  }

  const auth = await requireUser(req);
  if (!auth.ok) {
    return json({ error: auth.error }, { status: auth.status, origin });
  }

  let body: { organization_id?: unknown; org_id?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const organizationId = body.organization_id || body.org_id;
  if (!isUuid(organizationId)) {
    return json({ error: "A valid organization_id is required" }, { status: 400, origin });
  }

  const sb = serviceClient();
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id, owner_id, archived_at, created_at")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgErr) {
    console.error("org-restore-workspace: organization lookup failed", orgErr);
    return json({ error: "Failed to verify workspace" }, { status: 500, origin });
  }
  if (!org) {
    return json({ error: "Workspace not found" }, { status: 404, origin });
  }
  if (String(org.owner_id || "") !== String(auth.user.id || "")) {
    return json({ error: "Only the primary owner can restore this workspace" }, { status: 403, origin });
  }
  if (!org.archived_at) {
    return json({ ok: true, already_restored: true, organization_id: organizationId }, { status: 200, origin });
  }

  try {
    const limitCheck = await verifyRestoreFitsWorkspaceLimit(sb, String(auth.user.id || ""), organizationId);
    if (!limitCheck.ok) {
      return json({ error: limitCheck.message }, { status: 409, origin });
    }
  } catch (err) {
    console.error("org-restore-workspace: workspace limit verification failed", err);
    return json({ error: "Failed to verify workspace limit" }, { status: 500, origin });
  }

  const { data: restored, error: restoreErr } = await sb
    .from("organizations")
    .update({ archived_at: null })
    .eq("id", organizationId)
    .eq("owner_id", auth.user.id)
    .not("archived_at", "is", null)
    .select("id, archived_at")
    .maybeSingle();

  if (restoreErr) {
    console.error("org-restore-workspace: restore failed", restoreErr);
    return json({ error: "Failed to restore workspace" }, { status: 500, origin });
  }
  if (!restored) {
    return json({ error: "Workspace could not be restored" }, { status: 409, origin });
  }

  return json({ ok: true, organization_id: organizationId }, { status: 200, origin });
});
