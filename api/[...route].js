// /api/[...route].js
// Single catch-all serverless function that dispatches to every endpoint.
//
// Why: Vercel's Hobby plan allows at most 12 serverless functions, and every
// .js file directly under /api counts as one. This file collapses all JSON
// endpoints into ONE function while keeping the public URLs identical
// (/api/tailor-cv, /api/generate-pdf, etc.), so the frontend needs no changes.
//
// The only endpoint kept as its own separate function is /api/stripe-webhook:
// it must disable Vercel's body parser (bodyParser: false) to verify Stripe's
// signature against the raw request bytes, and that config is per-function.
// An exact file match (api/stripe-webhook.js) always takes priority over this
// catch-all, so webhook traffic never lands here.
//
// The handler implementations live in /api/_handlers/. Folders whose names
// start with "_" are ignored by Vercel's function detection (same reason
// /api/_lib doesn't count), so those files add zero functions.
//
// NOTE: requires are intentionally static (no dynamic require(variable)) so
// Vercel's bundler can trace every handler and its dependencies.

const handlers = {
  "ats-check": require("./_handlers/ats-check.js"),
  "base-cv": require("./_handlers/base-cv.js"),
  "config": require("./_handlers/config.js"),
  "create-checkout-session": require("./_handlers/create-checkout-session.js"),
  "debug-config": require("./_handlers/debug-config.js"),
  "debug-env": require("./_handlers/debug-env.js"),
  "extract-cv-text": require("./_handlers/extract-cv-text.js"),
  "generate-docx": require("./_handlers/generate-docx.js"),
  "generate-pdf": require("./_handlers/generate-pdf.js"),
  "parse-cv": require("./_handlers/parse-cv.js"),
  "tailor-cv": require("./_handlers/tailor-cv.js"),
  "user-status": require("./_handlers/user-status.js"),
};

function resolveRoute(req) {
  // Vercel populates req.query.route for a [...route] catch-all.
  // It is normally an array of path segments, but be tolerant of a plain
  // string (some dev-server versions) and fall back to parsing req.url.
  const raw = req.query && req.query.route;
  if (Array.isArray(raw) && raw.length > 0) return raw.join("/");
  if (typeof raw === "string" && raw) return raw;

  const path = (req.url || "").split("?")[0];
  return path.replace(/^\/?api\/?/, "").replace(/\/+$/, "");
}

module.exports = async (req, res) => {
  const route = resolveRoute(req);
  const handler = handlers[route];

  if (!handler) {
    res.status(404).json({ error: `Unknown API route: /api/${route}` });
    return;
  }

  return handler(req, res);
};
