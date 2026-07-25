// api/_lib/atsScore.js
// Deterministic ATS-style keyword-coverage scoring.
//
// Real applicant tracking systems (Workday, Greenhouse, Taleo, iCIMS…) don't
// "rate" a CV holistically - they index its text and filter/search on the
// job's keywords and requirements. So instead of asking the model to guess a
// number, the model extracts the screening keywords from the job description
// ONCE, and the score is then COMPUTED from actual keyword coverage of the
// CV text. That makes the score transparent, reproducible, and instantly
// recomputable when the user adds/removes skills.

// Normalizes text for matching: lowercase, keep letters/digits and the
// symbols that are part of real skill names (c++, c#, .net, node.js),
// collapse everything else to single spaces.
function normalizeForMatch(text) {
  return (
    " " +
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

// A keyword matches if the keyword itself or any alias appears in the text
// as a whole token sequence (space-bounded after normalization).
function keywordMatches(normalizedText, keywordEntry) {
  const candidates = [keywordEntry.keyword, ...(keywordEntry.aliases || [])];
  return candidates.some((candidate) => {
    const normalized = normalizeForMatch(candidate).trim();
    if (!normalized) return false;
    return normalizedText.includes(" " + normalized + " ");
  });
}

// Scores CV text against the JD's keywords. Required keywords weigh double.
// Returns { score, matched: [entry], missing: [entry] }.
function scoreCvText(cvText, keywords) {
  const list = Array.isArray(keywords) ? keywords : [];
  if (list.length === 0) return { score: null, matched: [], missing: [] };

  const normalizedText = normalizeForMatch(cvText);
  const matched = [];
  const missing = [];
  let matchedWeight = 0;
  let totalWeight = 0;

  list.forEach((entry) => {
    const weight = entry.required ? 2 : 1;
    totalWeight += weight;
    if (keywordMatches(normalizedText, entry)) {
      matched.push(entry);
      matchedWeight += weight;
    } else {
      missing.push(entry);
    }
  });

  const score = totalWeight > 0 ? Math.round((100 * matchedWeight) / totalWeight) : null;
  return { score, matched, missing };
}

// Coerces the model's atsKeywords output into a clean, de-duplicated list.
function sanitizeKeywords(raw) {
  const seen = new Set();
  const result = [];
  (Array.isArray(raw) ? raw : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const keyword = String(entry.keyword || "").trim();
    if (!keyword || keyword.length > 60) return;
    const key = keyword.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      keyword,
      required: Boolean(entry.required),
      aliases: (Array.isArray(entry.aliases) ? entry.aliases : [])
        .map((a) => String(a || "").trim())
        .filter((a) => a && a.length <= 60)
        .slice(0, 6),
    });
  });
  return result.slice(0, 30);
}

module.exports = { normalizeForMatch, keywordMatches, scoreCvText, sanitizeKeywords };
