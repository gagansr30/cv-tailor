require("./_lib/loadEnv");
const Stripe = require("stripe");
const { readRawBody } = require("./_lib/rawBody");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");

module.exports.config = {
  api: {
    bodyParser: false,
  },
};

async function setSubscriptionStatus({ supabaseUserId, customerId, status, subscriptionId }) {
  const supabase = getSupabaseAdmin();

  const updates = { subscription_status: status };
  if (subscriptionId) updates.stripe_subscription_id = subscriptionId;
  if (customerId) updates.stripe_customer_id = customerId;

  let query = supabase.from("profiles").update(updates);

  if (supabaseUserId) {
    query = query.eq("id", supabaseUserId);
  } else if (customerId) {
    query = query.eq("stripe_customer_id", customerId);
  } else {
    console.error("setSubscriptionStatus called with no identifying field.");
    return;
  }

  const { error } = await query;
  if (error) {
    console.error("Failed to update subscription status:", error.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !secretKey) {
    console.error("Stripe webhook env vars missing.");
    res.status(500).send("Webhook not configured.");
    return;
  }

  const stripe = new Stripe(secretKey);
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const supabaseUserId = session.client_reference_id || session.metadata?.supabase_user_id;
        await setSubscriptionStatus({
          supabaseUserId,
          customerId: session.customer,
          subscriptionId: session.subscription,
          status: "active",
        });
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const isActive = ["active", "trialing"].includes(subscription.status);
        await setSubscriptionStatus({
          customerId: subscription.customer,
          subscriptionId: subscription.id,
          status: isActive ? "active" : "canceled",
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await setSubscriptionStatus({
          customerId: subscription.customer,
          subscriptionId: subscription.id,
          status: "canceled",
        });
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error("Error handling Stripe webhook event:", err);
    res.status(500).send("Webhook handler error.");
  }
};