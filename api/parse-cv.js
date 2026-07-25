// /api/parse-cv.js
// Accepts { cvText } and returns the CV parsed into the structured profile
// schema (same shape the tailoring flow uses), WITHOUT tailoring or rewriting
// anything. Used for the one-time "fill your profile from your CV" step.
// Does NOT consume a tailoring credit - it only reads/structures the CV.

const { getAuthedUser } = require("./_lib/auth");
const { normalizeCvShape } = require("./_lib/cvShape");

const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

const PARSE_SYSTEM_PROMPT = `You are a precise CV/resume parser. You will be given the raw text of a
candidate's CV. Your ONLY job is to structure it into JSON. You are NOT
rewriting, improving, tailoring, summarizing, or editorializing anything.

RULES:
- Copy the candidate's actual wording. Do not rephrase, shorten, embellish,
  or "improve" any content. Fix only obvious extraction artifacts: merge
  bullets that were wrapped across lines, remove stray bullet markers,
  repair words broken by line-wrapping.
- NEVER invent content. If a section is absent, return an empty array (or
  empty string) for it.
- HYPERLINKS ARE SACRED: copy every URL character-for-character exactly as it
  appears (same https:// or www. or bare-domain form, same casing, same path).
  Never drop a URL that appears in the CV, and never add one that doesn't.
  If the extracted text contains a "Hyperlinks found in the document" list at
  the end, those are real links embedded in the original file - attach each
  one to the most relevant place: contact links go in "contact", a link that
  clearly belongs to a specific project/job goes in that entry's "link"
  field, a certification's link goes into that certification's string. An
  appendix entry of the form "Label: url" means the original document showed
  "Label" as the clickable text - reattach it as [Label](url).
  Do not include that appendix list itself as CV content.
- The "contact" field is one pipe-separated line: email | phone | location |
  link | link. Include each contact method and each link exactly once.
- LABELED LINKS: when a hyperlink's visible text differs from its URL (e.g.
  the word "LinkedIn" or "GitHub" or "Portfolio" linking to a profile URL,
  often listed in the "Hyperlinks found in the document" appendix), write it
  as [Visible Text](url) - square brackets around the visible text, the exact
  URL in parentheses. This applies inside "contact" and inside any
  certification. Example contact: "a@b.com | +44 7000 000000 | Leeds, UK |
  [LinkedIn](https://linkedin.com/in/x) | [GitHub](https://github.com/x)".
- Certifications: copy each certification verbatim as one string. If a
  certification has a hyperlink (credential/verify link, or the name itself
  is a link), embed it with the same [Text](url) format, e.g.
  "AWS Certified Cloud Practitioner (2025) - [Verify](https://credly.com/...)"
  or "[Neural Networks Specialization](https://coursera.org/...)".
- "sectionOrder" must list the sections in the order they appear in the
  ORIGINAL CV, using only these keys (omit keys for sections the CV doesn't
  have): "summary", "experience", "projects", "education", "skills",
  "certifications", "interests".

Return ONLY valid JSON (no markdown fences, no commentary) in exactly this shape:

{
  "cv": {
    "name": "string",
    "contact": "string, pipe-separated as described above",
    "summary": "string, the candidate's existing summary/profile text verbatim, or empty string",
    "sectionOrder": ["summary", "experience", "projects", "education", "skills", "certifications", "interests"],
    "experience": [
      { "title": "string", "company": "string", "dates": "string", "bullets": ["string"], "link": "string URL if one belongs to this role, else omit" }
    ],
    "projects": [
      { "title": "string", "company": "string, e.g. 'Personal Project' or the context", "dates": "string", "bullets": ["string"], "link": "string URL if one exists for this project, else omit" }
    ],
    "education": [
      { "degree": "string", "institution": "string", "dates": "string" }
    ],
    "skills": ["string"],
    "certifications": ["string, verbatim, including any [Text](url) links"],
    "interests": "string, comma-separated single string, or empty string"
  }
}`;

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
      error: "You're sending requests too quickly. Please wait a minute and try again.",
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
    res.status(401).json({ error: "Please log in first." });
    return;
  }

  try {
    const { cvText } = req.body || {};

    if (!cvText || typeof cvText !== "string" || !cvText.trim()) {
      res.status(400).json({ error: "No CV text received." });
      return;
    }

    if (cvText.length > 20000) {
      res.status(400).json({ error: "CV is too long (20,000 character limit)." });
      return;
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error("CLAUDE_API_KEY is not set in the environment.");
      res.status(500).json({
        error: "Server is not configured correctly (missing API key). Contact the site owner.",
      });
      return;
    }

    const userMessage = `CV TEXT:
"""
${cvText.trim()}
"""

Parse this CV into the JSON structure per your instructions. Return only the JSON object.`;

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error (parse-cv):", anthropicResponse.status, errText);
      res.status(502).json({ error: "The AI service returned an error. Please try again shortly." });
      return;
    }

    const data = await anthropicResponse.json();
    const textBlock = (data.content || []).find((block) => block.type === "text");

    if (!textBlock || !textBlock.text) {
      res.status(502).json({ error: "The AI service returned an empty response." });
      return;
    }

    const cleaned = textBlock.text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Failed to parse Claude JSON response (parse-cv):", cleaned);
      res.status(502).json({ error: "Could not parse the AI's response. Please try again." });
      return;
    }

    const cv = parsed.cv || parsed;
    normalizeCvShape(cv);

    res.status(200).json({ cv });
  } catch (err) {
    console.error("Unexpected error in /api/parse-cv:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
