// /api/base-cv.js
// Stores, retrieves, and clears the user's saved "base CV" profile.
// Requires this one-time addition to the Supabase `profiles` table:
//
//   alter table profiles add column if not exists base_cv jsonb;
//   alter table profiles add column if not exists base_cv_updated_at timestamptz;
//
// GET    -> { baseCv: {...} | null, updatedAt: string | null }
// POST   -> body { baseCv: {...} }, saves and returns the normalized CV
// DELETE -> clears the saved base CV

const { getAuthedUser } = require("./_lib/auth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { normalizeCvShape } = require("./_lib/cvShape");

const MAX_BASE_CV_BYTES = 100 * 1024; // generous cap for a JSON CV

module.exports = async (req, res) => {
  let authed;
  try {
    authed = await getAuthedUser(req);
  } catch (err) {
    console.error("Error verifying user:", err);
    res.status(500).json({ error: "Could not verify your account. Please try again." });
    return;
  }

  if (!authed) {
    res.status(401).json({ error: "Please log in first." });
    return;
  }

  const { user, profile } = authed;
  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      res.status(200).json({
        baseCv: profile.base_cv || null,
        updatedAt: profile.base_cv_updated_at || null,
      });
      return;
    }

    if (req.method === "POST") {
      const { baseCv } = req.body || {};
      if (!baseCv || typeof baseCv !== "object" || Array.isArray(baseCv)) {
        res.status(400).json({ error: "Missing 'baseCv' object in request body." });
        return;
      }

      if (JSON.stringify(baseCv).length > MAX_BASE_CV_BYTES) {
        res.status(400).json({ error: "Profile is too large to save." });
        return;
      }

      normalizeCvShape(baseCv);

      if (!baseCv.name && baseCv.experience.length === 0 && baseCv.education.length === 0 && !baseCv.summary) {
        res.status(400).json({ error: "Profile looks empty - add at least your name or some experience before saving." });
        return;
      }

      const updatedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ base_cv: baseCv, base_cv_updated_at: updatedAt })
        .eq("id", user.id);

      if (updateError) {
        console.error("Failed to save base CV:", updateError.message);
        res.status(500).json({
          error:
            "Could not save your profile. If this keeps happening, the 'base_cv' column may be missing from the profiles table.",
        });
        return;
      }

      res.status(200).json({ baseCv, updatedAt });
      return;
    }

    if (req.method === "DELETE") {
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ base_cv: null, base_cv_updated_at: null })
        .eq("id", user.id);

      if (updateError) {
        console.error("Failed to clear base CV:", updateError.message);
        res.status(500).json({ error: "Could not clear your profile. Please try again." });
        return;
      }

      res.status(200).json({ baseCv: null, updatedAt: null });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Unexpected error in /api/base-cv:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
