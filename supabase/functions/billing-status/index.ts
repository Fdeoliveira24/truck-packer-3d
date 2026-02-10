import { getAllowedOrigin, json } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);

  if (req.method === "OPTIONS") return json({ ok: true }, { origin });

  try {
    if (req.method !== "GET") return json({ error: "Method not allowed" }, { status: 405, origin });
    if (!origin) return json({ error: "Origin not allowed" }, { status: 403, origin: null });

    const { user } = await requireUser(req);
    const sb = serviceClient();

    const { data, error } = await sb
      .from("subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .order("current_period_end", { ascending: false })
      .limit(1);

    if (error) throw error;

    const sub = data?.[0] ?? null;

    return json(
      { user_id: user.id, subscription: sub, is_active: sub ? ["active", "trialing"].includes(sub.status) : false },
      { status: 200, origin },
    );
  } catch (e) {
    const status = (e as any).status ?? 500;
    const message = (e as Error).message ?? "Server error";
    return json({ error: message }, { status, origin });
  }
});
