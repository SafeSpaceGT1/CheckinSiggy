// delete-account: verifies the caller, then removes their auth user with the
// service-role admin API. Every table references auth.users ON DELETE CASCADE,
// so all check-ins, journals, plans, shares, clients, and notes go with it.
import { createClient } from "npm:@supabase/supabase-js@2.110.7";

import { guardRequest, json, errorResponse } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const rejected = guardRequest(req);
  if (rejected) return rejected;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "unauthorized" }, 401);

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error } = await adminClient.auth.admin.deleteUser(user.id);
    if (error) return json({ error: "delete_failed" }, 500);

    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});
