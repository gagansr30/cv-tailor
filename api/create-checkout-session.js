require("./_lib/loadEnv");
const Stripe = require("stripe");
const { getAuthedUser } = require("./_lib/auth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const authed = await getAuthedUser(req);
    if (!authed) {
      res.status(401).json({ error: "You must be logged in to subscribe." });
      return;
    }
    const { user, profile } = authed;

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!secretKey || !priceId) {
      console.error("Stripe env vars missing (STRIPE_SECRET_KEY / STRIPE_PRICE_ID).");
      res.status(500).json({ error: "Payments are not configured yet. Contact the site owner." });
      return;
    }

    const stripe = new Stripe(secretKey);

    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      const supabase = getSupabaseAdmin();
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const origin =
      req.headers.origin ||
      `https://${req.headers.host}` ||
      "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { supabase_user_id: user.id },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ error: "Could not start checkout. Please try again." });
  }
};