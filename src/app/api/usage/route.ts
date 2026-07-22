import { createClient, createServiceClient } from "@/lib/supabase-server";
import { computeMeter } from "@/lib/aiBudget";

// GET /api/usage — the signed-in user's AI credit meter.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Server is not configured" }, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plans, subscription_status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const meter = await computeMeter(createServiceClient(), user.id, profile ?? null);
  return Response.json({ plans: profile?.plans ?? [], ...meter });
}
