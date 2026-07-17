// /api/tailor-cv.js
// Accepts { cv, jobDescription } and returns a tailored, structured CV as JSON.
// Calls the Anthropic Claude API server-side. The API key is read from the
// CLAUDE_API_KEY environment variable and is never sent to the frontend.
// Requires a logged-in Supabase user and enforces the free-tier usage limit.

const { getAuthedUser } = require("./_lib/auth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { FREE_LIFETIME_LIMIT, MONTHLY_SUBSCRIBER_LIMIT } = require("./_lib/constants");

// --- very simple in-memory rate limiter -------------------------------
// This resets whenever the serverless function cold-starts, so it is NOT a
// robust production rate limiter, just a basic speed bump until payments /
// a real rate-limiting service (e.g. Upstash Redis) are added.
const requestLog = new Map(); // ip -> array of timestamps (ms)
const WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter(
    (t) => now - t < WINDOW_MS
  );
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

const SYSTEM_PROMPT = `You are an expert, meticulous resume writer and career coach.

You will be given a candidate's existing CV and a job description. Your task
is to rewrite/restructure the CV so it better matches the job description:
- Reorder and re-emphasize experience and skills that are most relevant to the job.
- Align wording and terminology with the job description where it is honestly
  applicable (e.g. use the JD's terminology for a skill the candidate already
  has, don't rename an unrelated skill to match).
- Tighten and improve the professional summary so it speaks directly to the
  role.
- Improve clarity, conciseness, and impact of bullet points.

STRICT RULES (do not break these under any circumstances):
- NEVER invent, exaggerate, or embellish any experience, employer, job title,
  skill, certification, metric, number, or achievement that is not present in
  or directly and honestly inferable from the original CV.
- Do not add skills the candidate did not list or clearly demonstrate.
- Do not fabricate quantified results (percentages, dollar amounts, team
  sizes, etc.) that aren't in the original text.
- You may rephrase, reorder, and re-emphasize. You may NOT add new facts.
- If the job description asks for something the candidate's CV does not
  support, simply do not claim it — do not paper over the gap.

Return ONLY valid JSON (no markdown code fences, no commentary, no preamble)
matching exactly this shape:

{
  "tailoredCv": {
    "name": "string, candidate's full name",
    "contact": "string, contact info line (email / phone / location / links), best-effort from original CV",
    "summary": "string, 2-4 sentence tailored professional summary",
    "experience": [
      {
        "title": "string, job title",
        "company": "string, company name",
        "dates": "string, e.g. 'Jan 2020 - Present'",
        "bullets": ["string", "string"]
      }
    ],
    "projects": [
      {
        "title": "string, project name",
        "company": "string, e.g. 'Personal Project' or the institution/context",
        "dates": "string, e.g. 'Jul 2026 - Present'",
        "bullets": ["string", "string"],
        "link": "string, optional URL if a live demo/repo link exists in the original CV, otherwise omit or empty string"
      }
    ],
    "education": [
      {
        "degree": "string",
        "institution": "string",
        "dates": "string"
      }
    ],
    "skills": ["string", "string"],
    "certifications": ["string", "string"],
    "interests": "string, comma-separated list as a single string, e.g. 'Travel, Music, Chess'"
  },
  "changes": [
    {
      "summary": "string, a short, specific description of one thing you changed (e.g. 'Moved RAG/LLM experience to the top of the summary')",
      "reason": "string, why this change helps match the job description (e.g. 'The job description leads with LLM integration as the primary responsibility')"
    }
  ],
  "missingSkills": [
    "string, a skill, tool, or qualification the job description asks for that is NOT present anywhere in the candidate's original CV - do not include anything the candidate already has evidence of"
  ]
}

List 3-6 of the most significant changes, not every minor rewording. For
missingSkills, only list genuine gaps - be conservative, and never list
something the candidate's CV already demonstrates even if worded differently.
If there are no meaningful gaps, return an empty array.

If a section is not present in the original CV (e.g. no education, no projects,
no certifications, or no interests listed), return an empty array (or empty
string for interests) for it rather than inventing content. Output raw JSON
only.`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    res.status(429).json({
      error:
        "You're sending requests too quickly. Please wait a minute and try again.",
    });
    return;
  }

  let authed;
  try {
    authed = await getAuthedUser(req);
  } catch (err) {
    console.error("Error verifying user:", err);
    res.status(500).json({ error: "Could not verify your account. Please try again." });
    return;
  }

  if (!authed) {
    res.status(401).json({ error: "Please log in to tailor your CV." });
    return;
  }

  const { user, profile } = authed;
  const isSubscribed = profile.subscription_status === "active";

  if (!isSubscribed && profile.usage_count >= FREE_LIFETIME_LIMIT) {
    res.status(402).json({
      error: `You've used all ${FREE_LIFETIME_LIMIT} free tailored CVs. Subscribe for up to ${MONTHLY_SUBSCRIBER_LIMIT} per month.`,
      requiresSubscription: true,
    });
    return;
  }

  if (isSubscribed && profile.monthly_usage_count >= MONTHLY_SUBSCRIBER_LIMIT) {
    res.status(402).json({
      error: `You've used all ${MONTHLY_SUBSCRIBER_LIMIT} tailored CVs for this month. Your limit resets on the 1st.`,
      monthlyLimitReached: true,
    });
    return;
  }

  try {
    const { cv, jobDescription } = req.body || {};

    if (
      !cv ||
      !jobDescription ||
      typeof cv !== "string" ||
      typeof jobDescription !== "string"
    ) {
      res
        .status(400)
        .json({ error: "Both 'cv' and 'jobDescription' text are required." });
      return;
    }

    if (cv.length > 20000 || jobDescription.length > 20000) {
      res.status(400).json({
        error: "CV or job description is too long (20,000 character limit each).",
      });
      return;
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error("CLAUDE_API_KEY is not set in the environment.");
      res.status(500).json({
        error:
          "Server is not configured correctly (missing API key). Contact the site owner.",
      });
      return;
    }

    const userMessage = `ORIGINAL CV:
"""
${cv}
"""

JOB DESCRIPTION:
"""
${jobDescription}
"""

Rewrite and restructure the CV per your instructions, and return only the JSON object.`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      res.status(502).json({
        error: "The AI service returned an error. Please try again shortly.",
      });
      return;
    }

    const data = await anthropicResponse.json();
    const textBlock = (data.content || []).find((block) => block.type === "text");

    if (!textBlock || !textBlock.text) {
      res.status(502).json({ error: "The AI service returned an empty response." });
      return;
    }

    // Claude is instructed to return raw JSON, but strip code fences defensively.
    const cleaned = textBlock.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse Claude JSON response:", cleaned);
      res.status(502).json({
        error: "Could not parse the AI's response. Please try again.",
      });
      return;
    }

    // Support both the new wrapped shape ({ tailoredCv, changes, missingSkills })
    // and a bare CV object, in case the model omits the wrapper.
    const tailoredCv = parsed.tailoredCv || parsed;
    const changes = Array.isArray(parsed.changes) ? parsed.changes : [];
    const missingSkills = Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [];

    // Basic shape defaults so downstream rendering never crashes.
    tailoredCv.name = tailoredCv.name || "";
    tailoredCv.contact = tailoredCv.contact || "";
    tailoredCv.summary = tailoredCv.summary || "";
    tailoredCv.experience = Array.isArray(tailoredCv.experience)
      ? tailoredCv.experience
      : [];
    tailoredCv.education = Array.isArray(tailoredCv.education)
      ? tailoredCv.education
      : [];
    tailoredCv.skills = Array.isArray(tailoredCv.skills) ? tailoredCv.skills : [];
    tailoredCv.projects = Array.isArray(tailoredCv.projects) ? tailoredCv.projects : [];
    tailoredCv.certifications = Array.isArray(tailoredCv.certifications)
      ? tailoredCv.certifications
      : [];
    tailoredCv.interests = typeof tailoredCv.interests === "string" ? tailoredCv.interests : "";

    if (!isSubscribed) {
      const supabase = getSupabaseAdmin();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ usage_count: profile.usage_count + 1 })
        .eq("id", user.id);
      if (updateError) {
        console.error("Failed to increment usage_count:", updateError.message);
      }
    } else {
      const supabase = getSupabaseAdmin();
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ monthly_usage_count: profile.monthly_usage_count + 1 })
        .eq("id", user.id);
      if (updateError) {
        console.error("Failed to increment monthly_usage_count:", updateError.message);
      }
    }

    res.status(200).json({ tailoredCv, changes, missingSkills });
  } catch (err) {
    console.error("Unexpected error in /api/tailor-cv:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
