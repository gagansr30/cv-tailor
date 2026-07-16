require("./_lib/loadEnv");
const { getAuthedUser } = require("./_lib/auth");
const { FREE_LIFETIME_LIMIT, MONTHLY_SUBSCRIBER_LIMIT } = require("./_lib/constants");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authed = await getAuthedUser(req);
    if (!authed) {
      res.status(401).json({ error: "Not logged in." });
      return;
    }

    const { user, profile } = authed;
    const isSubscribed = profile.subscription_status === "active";

    const remaining = isSubscribed
      ? Math.max(0, MONTHLY_SUBSCRIBER_LIMIT - profile.monthly_usage_count)
      : Math.max(0, FREE_LIFETIME_LIMIT - profile.usage_count);

    res.status(200).json({
      email: user.email,
      usageCount: profile.usage_count,
      monthlyUsageCount: profile.monthly_usage_count,
      subscriptionStatus: profile.subscription_status,
      freeLimit: FREE_LIFETIME_LIMIT,
      monthlyLimit: MONTHLY_SUBSCRIBER_LIMIT,
      remaining,
      remainingFree: remaining,
      isSubscribed,
    });
  } catch (err) {
    console.error("Error in /api/user-status:", err);
    res.status(500).json({ error: "Something went wrong loading your account status." });
  }
};