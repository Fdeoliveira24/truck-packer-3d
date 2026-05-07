import { getAllowedOrigin, json } from "../_shared/cors.ts";

const RETIRED_ERROR = "This endpoint has been retired. Use request-account-deletion.";

Deno.serve(async (req) => {
  const origin = getAllowedOrigin(req);
  const responseOrigin = origin && origin !== "*" ? origin : null;

  if (req.method === "OPTIONS") return json({ ok: true }, { origin: responseOrigin });
  return json({ error: RETIRED_ERROR }, { status: 410, origin: responseOrigin });
});
