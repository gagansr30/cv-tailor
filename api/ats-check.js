// /api/ats-check.js
// "What does the ATS actually see?" - an honest compatibility check.
//
// Every applicant tracking system - Workday, Greenhouse, iCIMS, Taleo, and
// the rest - starts the same way: parse the uploaded file into plain text,
// index it, then filter/search on the job's keywords (many license the same
// underlying parsers, e.g. Textkernel/Sovren/Daxtra). This endpoint builds
// the candidate's ACTUAL generated document in memory, extracts its text the
// same way a parser does, and runs the checks that pipeline shares:
// text extraction, section heading recognition, contact parsing, date
// recognition, layout safety, and keyword coverage.
//
// It deliberately does NOT pretend to reproduce any one vendor's private
// ranking - that isn't possible from outside, and most of these systems
// don't auto-rank at all.

const mammoth = require("mammoth");
const { Packer } = require("docx");
const { getAuthedUser } = require("./_lib/auth");
const { buildDocument } = require("./generate-docx.js");
const { scoreCvText, sanitizeKeywords } = require("./_lib/atsScore");

const requestLog = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 8;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

const STANDARD_HEADINGS = {
  summary: /\b(profile|summary|professional summary|about)\b/i,
  experience: /\b(work experience|experience|employment)\b/i,
  education: /\b(education)\b/i,
  skills: /\b(skills)\b/i,
};

function runChecks(cv, extractedText, keywords) {
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });

  // 1. Text extraction - the single biggest ATS killer is a CV whose text
  // can't be extracted (images, exotic fonts, text boxes).
  const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
  add(
    "extraction",
    "Text extracts cleanly",
    wordCount > 40,
    wordCount > 40
      ? `${wordCount} words extracted as real, selectable text - no images, text boxes, or columns.`
      : "Very little text could be extracted - an ATS would see an almost empty CV."
  );

  // 2. Contact details recognized
  const email = (extractedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] || "";
  const phone = (extractedText.match(/\+?\d[\d\s().-]{6,}\d/) || [])[0] || "";
  add(
    "contact-email",
    "Email address found by parser",
    Boolean(email),
    email ? `Parsed: ${email}` : "No email detected in the extracted text - add one to your contact line."
  );
  add(
    "contact-phone",
    "Phone number found by parser",
    Boolean(phone),
    phone ? `Parsed: ${phone.trim()}` : "No phone number detected - most ATS contact records expect one."
  );

  // 3. Standard section headings - parsers map content into fields by
  // recognizing conventional headings.
  Object.entries(STANDARD_HEADINGS).forEach(([key, regex]) => {
    const hasContent =
      key === "summary" ? Boolean(cv.summary) :
      key === "experience" ? (cv.experience || []).length > 0 :
      key === "education" ? (cv.education || []).length > 0 :
      (cv.skills || []).length > 0;
    if (!hasContent) return; // nothing to recognize; not a failure
    add(
      `heading-${key}`,
      `"${key.charAt(0).toUpperCase() + key.slice(1)}" section recognized`,
      regex.test(extractedText),
      regex.test(extractedText)
        ? "Standard heading found - parsers will map this section correctly."
        : "Heading not found in extracted text."
    );
  });

  // 4. Dates recognized for experience entries (parsers build a work
  // history timeline; entries without parseable dates often get dropped).
  const entries = (cv.experience || []).concat(cv.projects || []);
  if (entries.length > 0) {
    const dateLike = /\b(19|20)\d{2}\b|present|current/i;
    const withDates = entries.filter((e) => dateLike.test(String(e.dates || "")));
    add(
      "dates",
      "Dates parseable on experience entries",
      withDates.length === entries.length,
      withDates.length === entries.length
        ? "Every entry has a year or 'Present' - timelines will build correctly."
        : `${entries.length - withDates.length} entr${entries.length - withDates.length === 1 ? "y" : "ies"} missing a recognizable date - those may be dropped from the parsed work history.`
    );
  }

  // 5. Layout safety - true by construction for our generated documents,
  // but stated so the user knows WHY this file is parser-safe.
  add(
    "layout",
    "Single column, no tables, no images, no headers/footers",
    true,
    "This generator writes plain single-column paragraphs - the layout profile every parser handles best."
  );

  // 6. Filename & format
  add(
    "format",
    "Standard .docx / .pdf file format",
    true,
    "Both download formats are the standard, universally supported upload types."
  );

  // 7. Keyword coverage against this job's screening keywords
  if (keywords.length > 0) {
    const result = scoreCvText(extractedText, keywords);
    const requiredMissing = result.missing.filter((k) => k.required);
    add(
      "keywords",
      `Keyword coverage: ${result.score}% (${result.matched.length}/${keywords.length} keywords)`,
      requiredMissing.length === 0,
      requiredMissing.length === 0
        ? "Every keyword the job description marks as required was found in the extracted text."
        : `Required keywords still missing from the extracted text: ${requiredMissing.map((k) => k.keyword).join(", ")}.`
    );
  }

  return checks;
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
    res.status(429).json({ error: "You're sending requests too quickly. Please wait a minute and try again." });
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
    const { tailoredCv, atsKeywords } = req.body || {};
    if (!tailoredCv || typeof tailoredCv !== "object") {
      res.status(400).json({ error: "Missing 'tailoredCv' object in request body." });
      return;
    }

    // Build the REAL document the user would download, then extract its
    // text exactly the way an ATS parser ingests an upload.
    const doc = buildDocument(tailoredCv);
    const buffer = await Packer.toBuffer(doc);
    const { value: extractedText } = await mammoth.extractRawText({ buffer });

    const keywords = sanitizeKeywords(atsKeywords);
    const checks = runChecks(tailoredCv, extractedText, keywords);
    const passed = checks.filter((c) => c.pass).length;

    res.status(200).json({
      extractedText: extractedText.trim(),
      checks,
      passed,
      total: checks.length,
    });
  } catch (err) {
    console.error("Unexpected error in /api/ats-check:", err);
    res.status(500).json({ error: "Compatibility check failed. Please try again." });
  }
};
