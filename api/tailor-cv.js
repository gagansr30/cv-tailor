// /api/tailor-cv.js
// Accepts { cv, jobDescription } and returns a tailored, structured CV as JSON.
// Calls the Anthropic Claude API server-side. The API key is read from the
// CLAUDE_API_KEY environment variable and is never sent to the frontend.
// Requires a logged-in Supabase user and enforces the free-tier usage limit.

const { getAuthedUser } = require("./_lib/auth");
const { getSupabaseAdmin } = require("./_lib/supabaseAdmin");
const { FREE_LIFETIME_LIMIT, MONTHLY_SUBSCRIBER_LIMIT } = require("./_lib/constants");
const { normalizeCvShape, normalizeSectionOrder, serializeCvToText } = require("./_lib/cvShape");
const { scoreCvText, sanitizeKeywords } = require("./_lib/atsScore");

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
- Within the professional summary and each experience/project bullet, wrap the
  3-6 most job-relevant keywords, tools, technologies, or quantified results
  per item in **double asterisks** (e.g. "increased test coverage by **15%**
  using **FastAPI**"), so a recruiter scanning quickly sees what matches the
  job description at a glance. Be selective - bold only genuinely relevant
  terms, not every noun. Never bold something that isn't a real, verifiable
  fact from the original CV.
- Ignore any editorial notes or placeholders enclosed in double or triple
  parentheses, such as ((this is a note)) or (((note))). These are not part
  of the candidate's real CV and should not appear in the output.
- If the original CV contains broken formatting, line-wrapped bullets, or
  stray hyphen markers, clean them into properly formatted bullet strings.
- In the changes array, mention any issues you fixed in the original CV,
  such as removed editorial notes, merged wrapped bullets, or corrected
  malformed contact/section formatting.

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
- HYPERLINKS ARE SACRED: every URL in the original CV (contact links,
  project links, "Link:" lines, portfolio/demo/repo URLs) must appear in
  your output copied character-for-character (same https:// / www. / bare
  form, same casing, same path). Never drop, shorten, reformat, or invent a
  URL. A link attached to a specific role or project goes in that entry's
  "link" field; contact links stay in "contact".
- LABELED LINKS: the CV may contain [Visible Text](url) markdown-style links
  in the contact line or in certifications (e.g. [LinkedIn](https://...)).
  Preserve each one EXACTLY as written - same visible text, same brackets,
  same URL, character-for-character. Never unwrap them into a bare URL,
  never change the label, never drop them.
- ONE PAGE: strong CVs fit one page. Keep the summary to 2-3 sentences.
  Keep 3-5 of the MOST RELEVANT bullets per role/project for THIS job and
  keep each bullet under ~25 words. Prefer cutting weaker bullets over
  shortening strong ones. Never cut entire roles, projects, education
  entries, or certifications - trim within entries, not across them.

Return ONLY valid JSON (no markdown code fences, no commentary, no preamble)
matching exactly this shape:

{
  "tailoredCv": {
    "name": "string, candidate's full name",
    "jobTitle": "string, the EXACT job title of the role from the job description (e.g. 'AI Engineer', 'Senior Machine Learning Engineer') - this is printed under the candidate's name as the target role headline",
    "companyName": "string, the hiring company's name from the job description, or empty string if the JD doesn't state it - used for the download filename, never printed on the CV",
    "contact": "string, a single pipe-separated line: email | phone | location | link | link. Copy each value EXACTLY as it appears in the original CV (same URL format - do not add or remove https:// or www. compared to the original). Include each contact method and each link (e.g. LinkedIn, GitHub) exactly ONCE - never repeat the same link in a different format (e.g. never include both 'linkedin.com/in/x' and 'https://linkedin.com/in/x' for the same profile).",
    "summary": "string, 2-4 sentence tailored professional summary, with 3-6 key terms wrapped in **bold**",
    "sectionOrder": ["summary", "experience", "projects", "education", "skills", "certifications", "interests"],
    "experience": [
      {
        "title": "string, job title",
        "company": "string, company name",
        "dates": "string, e.g. 'Jan 2020 - Present'",
        "bullets": ["string, with relevant keywords wrapped in **bold**", "string"],
        "link": "string, optional URL if one belongs to this role in the original CV, otherwise omit or empty string"
      }
    ],
    "projects": [
      {
        "title": "string, project name",
        "company": "string, e.g. 'Personal Project' or the institution/context",
        "dates": "string, e.g. 'Jul 2026 - Present'",
        "bullets": ["string, with relevant keywords wrapped in **bold**", "string"],
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
    "certifications": ["string - copy each certification verbatim, including any [Text](url) links exactly as written", "string"],
    "interests": "string, comma-separated list as a single string, e.g. 'Travel, Music, Chess'"
  },
  "changes": [
    {
      "summary": "string, a short, specific description of one thing you changed (e.g. 'Moved RAG/LLM experience to the top of the summary')",
      "reason": "string, why this change helps match the job description (e.g. 'The job description leads with LLM integration as the primary responsibility')"
    }
  ],
  "missingSkills": [
    "string - a CONCISE skill/tool name (1-4 words) exactly as it would appear in a CV skills list, e.g. 'LangGraph', 'Terraform', 'LLM Evaluation', 'Prompt Versioning'. NEVER a sentence or description. If the JD names several tools in one requirement (e.g. 'LangGraph, CrewAI, or AutoGen'), list each tool as its own separate entry. Only include skills NOT present anywhere in the candidate's original CV - never anything the candidate already has evidence of"
  ],
  "irrelevantSkills": [
    "string, copied EXACTLY (same spelling/casing) from tailoredCv.skills - a skill the candidate genuinely has, but that has no clear relevance to THIS specific job description, so the candidate may want to remove it from this tailored version to keep the skills section focused"
  ],
  "recommendedSectionOrder": ["summary", "experience", "projects", "education", "skills", "certifications", "interests"],
  "sectionOrderReason": "string, 1-2 sentences explaining why this section order best sells the candidate for THIS job (e.g. leading with projects because the role is hands-on and the candidate's projects match the stack more directly than their employment history)",
  "atsKeywords": [
    {
      "keyword": "string, one screening keyword/requirement from the JOB DESCRIPTION exactly as an ATS or recruiter search would look for it (e.g. 'Python', 'LangGraph', 'Terraform', 'RAG', \"Bachelor's degree\")",
      "required": "boolean - true if the JD treats it as a must-have/required, false for nice-to-have/preferred",
      "aliases": ["string - alternate forms that should count as the same match, e.g. 'Retrieval-Augmented Generation' for 'RAG', 'JS' for 'JavaScript', 'K8s' for 'Kubernetes'. Empty array if none"]
    }
  ]
}

List 3-6 of the most significant changes, not every minor rewording. For
missingSkills, only list genuine gaps - be conservative, and never list
something the candidate's CV already demonstrates even if worded differently.
If there are no meaningful gaps, return an empty array. For irrelevantSkills,
actively flag any skill from tailoredCv.skills that is NOT referenced,
implied, or clearly useful for THIS specific job description - even if it's
a perfectly legitimate skill in general. The goal is a focused, tailored
skills section for this one application, not a complete inventory of
everything the candidate knows. Only leave a skill unflagged if the job
description's responsibilities, requirements, or tech stack connect to it in
some clear way. It's normal and expected for several skills to be flagged -
don't default to an empty list just to be safe. Every string in
irrelevantSkills MUST be an exact match to an entry already present in
tailoredCv.skills.

SECTION ORDER: "recommendedSectionOrder" is your professional recommendation
for the order the CV sections should appear for THIS job, using only these
keys: "summary", "experience", "projects", "education", "skills",
"certifications", "interests" (include every key, even for empty sections -
empty ones simply won't render). Think like a recruiter for this role: a
recent graduate applying for a hands-on role may lead with projects or
education; an experienced hire should usually lead with experience; if the
JD is skills/keyword-driven, skills may deserve to sit higher. Set
tailoredCv.sectionOrder to the SAME array as recommendedSectionOrder, and
explain your reasoning briefly in sectionOrderReason.

ATS KEYWORDS: extract 12-25 keywords from the JOB DESCRIPTION the way real
ATS software and recruiter keyword searches actually screen candidates:
concrete hard skills, tools, frameworks, languages, platforms,
methodologies, certifications, and degree/experience requirements. Skip
vague soft skills ("team player", "communication") unless the JD makes one a
central, explicit requirement. Mark required=true only for genuine
must-haves. In aliases, include real alternate forms a CV might use for the
same thing (abbreviations, expansions, product renames) - never loosely
related different skills. These keywords are used to COMPUTE the candidate's
match score deterministically, so extract them faithfully from the JD - do
not tune them toward what the candidate happens to have.

If a section is not present in the original CV (e.g. no education, no projects,
no certifications, or no interests listed), return an empty array (or empty
string for interests) for it rather than inventing content. Output raw JSON
only.`;
function stripBracketedNotes(text) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\(\(\(?[\s\S]*?\)\)+/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "")
    .trim();
}

// Cleans up the AI-generated contact line: removes duplicate contact methods
// or links that were included more than once in different formats (e.g. a
// bare domain and the same URL again with https:// or www.).
function dedupeContactLine(contact) {
  if (!contact) return "";
  const parts = contact.split("|").map((p) => p.trim()).filter(Boolean);

  const normalize = (p) => {
    // A [Label](url) part dedupes by its URL, so "[LinkedIn](https://linkedin.com/in/x)"
    // and a bare "linkedin.com/in/x" are recognized as the same link.
    const md = p.match(/^\[[^\]]+\]\(\s*([^)\s]+)\s*\)$/);
    const value = md ? md[1] : p;
    return value
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");
  };

  const seen = new Map();
  const deduped = [];
  parts.forEach((part) => {
    const key = normalize(part);
    const isLabeled = /^\[[^\]]+\]\(/.test(part);
    if (!seen.has(key)) {
      seen.set(key, deduped.length);
      deduped.push(part);
    } else if (isLabeled) {
      // Keep the labeled [Text](url) form over a bare duplicate of the same link.
      deduped[seen.get(key)] = part;
    }
  });

  return deduped.join(" | ");
}

function normalizeBulletText(item) {
  if (typeof item !== "string" || !item.trim()) return [];
  const lines = item.replace(/\r\n/g, "\n").split("\n");
  const bullets = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const normalized = line.replace(/^[\-\u2022•\*]+\s*/, "").trim();
    if (/^[\-\u2022•\*]+\s*/.test(line)) {
      bullets.push(normalized);
    } else if (bullets.length > 0) {
      bullets[bullets.length - 1] += " " + normalized;
    } else {
      bullets.push(normalized);
    }
  });

  return bullets.filter(Boolean);
}

function sanitizeTailoredCv(cv) {
  if (!cv || typeof cv !== "object") return;

  const sanitizeString = (value) => stripBracketedNotes(String(value || ""));

  cv.name = sanitizeString(cv.name);
  cv.jobTitle = sanitizeString(cv.jobTitle);
  cv.companyName = sanitizeString(cv.companyName);
  cv.contact = dedupeContactLine(sanitizeString(cv.contact));
  cv.summary = sanitizeString(cv.summary);

  if (Array.isArray(cv.experience)) {
    cv.experience = cv.experience.map((entry) => ({
      ...entry,
      title: sanitizeString(entry.title),
      company: sanitizeString(entry.company),
      dates: sanitizeString(entry.dates),
      link: sanitizeString(entry.link),
      bullets: Array.isArray(entry.bullets)
        ? entry.bullets.flatMap(normalizeBulletText).map(sanitizeString)
        : [],
    }));
  }

  if (Array.isArray(cv.projects)) {
    cv.projects = cv.projects.map((project) => ({
      ...project,
      title: sanitizeString(project.title),
      company: sanitizeString(project.company),
      dates: sanitizeString(project.dates),
      link: sanitizeString(project.link),
      bullets: Array.isArray(project.bullets)
        ? project.bullets.flatMap(normalizeBulletText).map(sanitizeString)
        : [],
    }));
  }

  if (Array.isArray(cv.education)) {
    cv.education = cv.education.map((edu) => ({
      ...edu,
      degree: sanitizeString(edu.degree),
      institution: sanitizeString(edu.institution),
      dates: sanitizeString(edu.dates),
    }));
  }

  if (Array.isArray(cv.skills)) {
    cv.skills = cv.skills.map(sanitizeString).filter(Boolean);
  }

  if (Array.isArray(cv.certifications)) {
    cv.certifications = cv.certifications.map(sanitizeString).filter(Boolean);
  }

  cv.interests = sanitizeString(cv.interests);
}
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
    const { cv, baseCv, jobDescription } = req.body || {};

    if (!jobDescription || typeof jobDescription !== "string") {
      res.status(400).json({ error: "The 'jobDescription' text is required." });
      return;
    }

    // The CV source is either the saved structured base CV (preferred) or
    // legacy raw text. The structured CV is serialized back to clean text so
    // the same prompt handles both, with links and section order intact.
    let cvText;
    if (baseCv && typeof baseCv === "object" && !Array.isArray(baseCv)) {
      normalizeCvShape(baseCv);
      cvText = serializeCvToText(baseCv);
    } else if (typeof cv === "string" && cv.trim()) {
      cvText = cv;
    } else {
      res.status(400).json({ error: "A CV is required - save your profile or paste your CV text." });
      return;
    }

    if (cvText.length > 20000 || jobDescription.length > 20000) {
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

    const sanitizedCvText = stripBracketedNotes(cvText);
    const userMessage = `ORIGINAL CV:
"""
${sanitizedCvText}
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
        max_tokens: 12000,
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
    const rawIrrelevantSkills = Array.isArray(parsed.irrelevantSkills) ? parsed.irrelevantSkills : [];

    sanitizeTailoredCv(tailoredCv);

    // Basic shape defaults so downstream rendering never crashes.
    tailoredCv.name = tailoredCv.name || "";
    tailoredCv.jobTitle = typeof tailoredCv.jobTitle === "string" ? tailoredCv.jobTitle.trim() : "";
    tailoredCv.companyName = typeof tailoredCv.companyName === "string" ? tailoredCv.companyName.trim() : "";
    tailoredCv.contact = dedupeContactLine(tailoredCv.contact || "");
    tailoredCv.summary = tailoredCv.summary || "";
    tailoredCv.experience = Array.isArray(tailoredCv.experience)
      ? tailoredCv.experience
      : [];
    tailoredCv.education = Array.isArray(tailoredCv.education)
      ? tailoredCv.education
      : [];
    tailoredCv.skills = Array.isArray(tailoredCv.skills) ? tailoredCv.skills : [];
    // Only keep irrelevantSkills entries that exactly match a real skill in
    // the final list - defensive against the model paraphrasing a skill name
    // slightly differently than how it appears in tailoredCv.skills.
    const irrelevantSkills = rawIrrelevantSkills.filter((s) => tailoredCv.skills.includes(s));
    tailoredCv.projects = Array.isArray(tailoredCv.projects) ? tailoredCv.projects : [];
    tailoredCv.certifications = Array.isArray(tailoredCv.certifications)
      ? tailoredCv.certifications
      : [];
    tailoredCv.interests = typeof tailoredCv.interests === "string" ? tailoredCv.interests : "";

    // Section-order recommendation: prefer the explicit recommendation, fall
    // back to whatever order the model put on the CV itself, then defaults.
    const recommendedSectionOrder = normalizeSectionOrder(
      Array.isArray(parsed.recommendedSectionOrder) && parsed.recommendedSectionOrder.length > 0
        ? parsed.recommendedSectionOrder
        : tailoredCv.sectionOrder
    );
    tailoredCv.sectionOrder = recommendedSectionOrder.slice();
    const sectionOrderReason =
      typeof parsed.sectionOrderReason === "string" ? parsed.sectionOrderReason.trim() : "";

    // ATS score: the model extracts the JD's screening keywords; the score
    // itself is COMPUTED from real keyword coverage - the same way ATS
    // filters and recruiter searches work - for both the original CV text
    // and the tailored version. The keywords are returned so the frontend
    // can re-score live when the user adds/removes skills.
    const atsKeywords = sanitizeKeywords(parsed.atsKeywords);
    const tailoredText = [tailoredCv.jobTitle, serializeCvToText(tailoredCv)].filter(Boolean).join("\n");
    const beforeResult = scoreCvText(cvText, atsKeywords);
    const afterResult = scoreCvText(tailoredText, atsKeywords);
    const ats = {
      keywords: atsKeywords,
      before: beforeResult.score,
      after: afterResult.score,
      missingBefore: beforeResult.missing.map((k) => k.keyword),
      matchedAfter: afterResult.matched.map((k) => k.keyword),
      missingAfter: afterResult.missing.map((k) => k.keyword),
    };

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

    res.status(200).json({
      tailoredCv,
      changes,
      missingSkills,
      irrelevantSkills,
      recommendedSectionOrder,
      sectionOrderReason,
      ats,
    });
  } catch (err) {
    console.error("Unexpected error in /api/tailor-cv:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};