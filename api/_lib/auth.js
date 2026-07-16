require("./loadEnv");
const { getSupabaseAdmin } = require("./supabaseAdmin");

async function getAuthedUser(req) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) return null;

  const supabase = getSupabaseAdmin();

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData || !userData.user) {
    return null;
  }
  const user = userData.user;

  let { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Failed to load profile: ${profileError.message}`);
  }

  if (!profile) {
    const { data: newProfile, error: insertError } = await supabase
      .from("profiles")
      .insert({ id: user.id, email: user.email, usage_count: 0, subscription_status: "free" })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create profile: ${insertError.message}`);
    }
    profile = newProfile;
  }

  profile = await resetMonthlyUsageIfNewPeriod(supabase, profile);

  return { user, profile };
}

function currentPeriodStart() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function resetMonthlyUsageIfNewPeriod(supabase, profile) {
  const nowPeriod = currentPeriodStart();
  const profilePeriod = profile.usage_period_start
    ? String(profile.usage_period_start).slice(0, 10)
    : null;

  if (profilePeriod === nowPeriod) {
    return profile;
  }

  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ monthly_usage_count: 0, usage_period_start: nowPeriod })
    .eq("id", profile.id)
    .select()
    .single();

  if (error) {
    console.error("Failed to reset monthly usage:", error.message);
    return profile;
  }
  return updated;
}

module.exports = { getAuthedUser };