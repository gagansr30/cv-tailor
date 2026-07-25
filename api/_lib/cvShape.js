// api/_lib/cvShape.js
// Shared helpers for the structured CV object: canonical section keys,
// shape normalization (so downstream rendering never crashes), and
// serialization of a structured base CV back into readable text for the
// tailoring prompt.

const SECTION_KEYS = [
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "certifications",
  "interests",
];

// Filters an arbitrary array down to a valid, de-duplicated section order,
// then appends any missing canonical keys so every section always has a slot.
function normalizeSectionOrder(order) {
  const seen = new Set();
  const result = [];
  (Array.isArray(order) ? order : []).forEach((key) => {
    if (SECTION_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  });
  SECTION_KEYS.forEach((key) => {
    if (!seen.has(key)) result.push(key);
  });
  return result;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : [];
}

// Coerces a CV-shaped object (from the model, the client, or the database)
// into a predictable structure. Mutates and returns the object.
function normalizeCvShape(cv) {
  if (!cv || typeof cv !== "object") return cv;

  cv.name = asString(cv.name).trim();
  cv.contact = asString(cv.contact).trim();
  cv.summary = asString(cv.summary).trim();
  cv.interests = asString(cv.interests).trim();
  cv.skills = asStringArray(cv.skills);
  cv.certifications = asStringArray(cv.certifications);
  cv.sectionOrder = normalizeSectionOrder(cv.sectionOrder);

  const normalizeRole = (entry) => ({
    title: asString(entry && entry.title).trim(),
    company: asString(entry && entry.company).trim(),
    dates: asString(entry && entry.dates).trim(),
    link: asString(entry && entry.link).trim(),
    bullets: asStringArray(entry && entry.bullets),
  });

  cv.experience = (Array.isArray(cv.experience) ? cv.experience : []).map(normalizeRole);
  cv.projects = (Array.isArray(cv.projects) ? cv.projects : []).map(normalizeRole);
  cv.education = (Array.isArray(cv.education) ? cv.education : []).map((edu) => ({
    degree: asString(edu && edu.degree).trim(),
    institution: asString(edu && edu.institution).trim(),
    dates: asString(edu && edu.dates).trim(),
  }));

  return cv;
}

// Serializes the structured base CV back into clean, readable text for the
// tailoring prompt, preserving section order and every hyperlink verbatim.
function serializeCvToText(cv) {
  const lines = [];

  if (cv.name) lines.push(cv.name);
  if (cv.contact) lines.push(cv.contact);
  lines.push("");

  const sectionTitle = {
    summary: "PROFESSIONAL SUMMARY",
    experience: "WORK EXPERIENCE",
    projects: "PROJECTS",
    education: "EDUCATION",
    skills: "SKILLS",
    certifications: "CERTIFICATIONS",
    interests: "INTERESTS",
  };

  const pushRole = (entry) => {
    const header = [entry.title, entry.company].filter(Boolean).join(" | ");
    lines.push([header, entry.dates].filter(Boolean).join(" | "));
    (entry.bullets || []).forEach((b) => lines.push(`- ${b}`));
    if (entry.link) lines.push(`Link: ${entry.link}`);
    lines.push("");
  };

  normalizeSectionOrder(cv.sectionOrder).forEach((key) => {
    switch (key) {
      case "summary":
        if (cv.summary) {
          lines.push(sectionTitle.summary, cv.summary, "");
        }
        break;
      case "experience":
        if (cv.experience && cv.experience.length > 0) {
          lines.push(sectionTitle.experience);
          cv.experience.forEach(pushRole);
        }
        break;
      case "projects":
        if (cv.projects && cv.projects.length > 0) {
          lines.push(sectionTitle.projects);
          cv.projects.forEach(pushRole);
        }
        break;
      case "education":
        if (cv.education && cv.education.length > 0) {
          lines.push(sectionTitle.education);
          cv.education.forEach((edu) => {
            lines.push([edu.degree, edu.institution, edu.dates].filter(Boolean).join(" | "));
          });
          lines.push("");
        }
        break;
      case "skills":
        if (cv.skills && cv.skills.length > 0) {
          lines.push(sectionTitle.skills, cv.skills.join(", "), "");
        }
        break;
      case "certifications":
        if (cv.certifications && cv.certifications.length > 0) {
          lines.push(sectionTitle.certifications);
          cv.certifications.forEach((c) => lines.push(`- ${c}`));
          lines.push("");
        }
        break;
      case "interests":
        if (cv.interests) {
          lines.push(sectionTitle.interests, cv.interests, "");
        }
        break;
    }
  });

  return lines.join("\n").trim();
}

module.exports = { SECTION_KEYS, normalizeSectionOrder, normalizeCvShape, serializeCvToText };
