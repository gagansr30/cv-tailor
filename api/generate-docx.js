// /api/generate-docx.js
// Accepts the tailored CV as structured JSON and returns a formatted .docx file,
// matching the user's exact template style: centered bold name/headings (no
// color/border), company + right-tab-aligned dates on one line, italic role
// title below, hyphen bullets, and inline **bold** keyword emphasis.

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  ExternalHyperlink,
} = require("docx");
const { parseBoldSegments, parseLinkSegments } = require("./_lib/boldSegments");

// Builds text runs from a string that may contain [Label](url) markdown
// links: link segments become real clickable hyperlinks showing the label,
// everything else goes through the normal **bold**-aware run builder.
function runsWithLinks(text, extraProps = {}) {
  const children = [];
  parseLinkSegments(text).forEach((seg) => {
    if (seg.url) {
      children.push(
        new ExternalHyperlink({
          link: ensureUrlScheme(normalizeUrl(seg.url)),
          children: [
            new TextRun({
              text: seg.text,
              size: extraProps.size || BODY_SIZE,
              font: FONT,
              style: "Hyperlink",
            }),
          ],
        })
      );
    } else {
      children.push(...textRunsFromSegments(seg.text, extraProps));
    }
  });
  return children;
}

const FONT = "Calibri";
const BODY_SIZE = 23; // 11.5pt, half-points
const NAME_SIZE = 26; // 13pt
const DATE_TAB_POSITION = 9350; // right tab stop for dates, twips

// Trims a regex-matched URL and strips trailing punctuation the match may
// have accidentally swept up (e.g. a comma or period right after a link).
function normalizeUrl(url) {
  if (!url) return "";
  return String(url).trim().replace(/[.,;:]+$/, "");
}

// Word treats a link target without a scheme (e.g. "linkedin.com/in/x") as a
// relative file path - this fixes the destination while leaving displayed
// text exactly as written.
function ensureUrlScheme(url) {
  if (!url) return url;
  return /^https?:\/\/|^mailto:/i.test(url) ? url : `https://${url}`;
}

function textRunsFromSegments(text, extraProps = {}) {
  return parseBoldSegments(text).map(
    (seg) =>
      new TextRun({
        text: seg.text,
        bold: seg.bold || extraProps.bold,
        italics: extraProps.italics,
        size: extraProps.size || BODY_SIZE,
        font: FONT,
      })
  );
}

function sectionHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: BODY_SIZE, font: FONT }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    children: textRunsFromSegments(text),
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function roleHeaderParagraph(company, dates) {
  return new Paragraph({
    children: [
      new TextRun({ text: company, bold: true, size: BODY_SIZE, font: FONT }),
      new TextRun({ text: "\t", font: FONT }),
      new TextRun({ text: dates || "", bold: true, size: BODY_SIZE, font: FONT }),
    ],
    tabStops: [{ type: "right", position: DATE_TAB_POSITION }],
    spacing: { before: 140, after: 20 },
  });
}

function titleParagraph(text) {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, size: BODY_SIZE, font: FONT })],
    spacing: { after: 60 },
  });
}

function buildRoleBlock({ company, dates, title, bullets, link }) {
  const paras = [];
  paras.push(roleHeaderParagraph(company || "", dates || ""));
  if (title) paras.push(titleParagraph(title));
  (bullets || []).forEach((b) => paras.push(bulletParagraph(b)));
  if (link) {
    paras.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Link: ", size: BODY_SIZE, font: FONT }),
          new ExternalHyperlink({
            link,
            children: [new TextRun({ text: link, size: BODY_SIZE, font: FONT, style: "Hyperlink" })],
          }),
        ],
        bullet: { level: 0 },
        spacing: { after: 80 },
      })
    );
  }
  return paras;
}

function buildDocument(cv) {
  const children = [];

  // Name
  children.push(
    new Paragraph({
      children: [new TextRun({ text: cv.name || "Your Name", bold: true, size: NAME_SIZE, font: FONT })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    })
  );

  // Target job title (from the job description), printed under the name.
  if (cv.jobTitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.jobTitle, size: BODY_SIZE, font: FONT, color: "555555" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
      })
    );
  }

  // Contact
  if (cv.contact || Array.isArray(cv.contactLinks)) {
    const contactLineRuns = [];

    const normalizeString = (value) => String(value || "").trim();

    // Pull [Label](url) markdown links out first, so "LinkedIn"/"GitHub"
    // style labeled links render as clickable labels instead of raw URLs
    // (and their labels don't leak into the location text below).
    const labeledLinks = [];
    const contactText = normalizeString(cv.contact)
      .replace(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g, (m, label, url) => {
        labeledLinks.push({ label: label.trim(), url: normalizeUrl(url) });
        return "";
      })
      .replace(/\|\s*(?=\||$)/g, "")
      .trim();
    const emails = contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const phones = contactText.match(/\+?\d[\d\s().-]{6,}\d/g) || [];
    const urls = (
      contactText.match(/(?:https?:\/\/|www\.)[^\s,;]+|linkedin\.com\/[^\s,;]+|github\.com\/[^\s,;]+/gi) || []
    ).map(normalizeUrl);
    const location = contactText
      .replace(/(?:https?:\/\/|www\.)[^\s,;]+/gi, "")
      .replace(/linkedin\.com\/[^\s,;]+/gi, "")
      .replace(/github\.com\/[^\s,;]+/gi, "")
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "")
      .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
      .replace(/[|,\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (emails[0]) {
      contactLineRuns.push(
        new ExternalHyperlink({
          link: `mailto:${emails[0]}`,
          children: [new TextRun({ text: emails[0], size: BODY_SIZE, font: FONT, style: "Hyperlink" })],
        })
      );
    }
    if (phones[0]) {
      if (contactLineRuns.length > 0) contactLineRuns.push(new TextRun({ text: " | ", size: BODY_SIZE, font: FONT }));
      contactLineRuns.push(new TextRun({ text: phones[0], size: BODY_SIZE, font: FONT }));
    }
    if (location) {
      if (contactLineRuns.length > 0) contactLineRuns.push(new TextRun({ text: " | ", size: BODY_SIZE, font: FONT }));
      contactLineRuns.push(new TextRun({ text: location, size: BODY_SIZE, font: FONT }));
    }

    if (contactLineRuns.length > 0) {
      children.push(
        new Paragraph({
          children: contactLineRuns,
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
        })
      );
    }

    // Links line: labeled links first (showing their label), then any bare
    // URLs that aren't the same destination as a labeled one.
    const linkKey = (u) =>
      String(u || "")
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/$/, "");
    const linkEntries = [];
    const seenLinkKeys = new Set();
    labeledLinks.forEach(({ label, url }) => {
      if (!url || seenLinkKeys.has(linkKey(url))) return;
      seenLinkKeys.add(linkKey(url));
      linkEntries.push({ display: label || url, url });
    });
    urls.forEach((url) => {
      if (!url || seenLinkKeys.has(linkKey(url))) return;
      seenLinkKeys.add(linkKey(url));
      linkEntries.push({ display: url, url });
    });
    if (Array.isArray(cv.contactLinks)) {
      cv.contactLinks.forEach((url) => {
        const normalized = normalizeUrl(url);
        if (!normalized || seenLinkKeys.has(linkKey(normalized))) return;
        seenLinkKeys.add(linkKey(normalized));
        linkEntries.push({ display: normalized, url: normalized });
      });
    }
    if (linkEntries.length > 0) {
      const linkRuns = [];
      linkEntries.forEach((entry, index) => {
        if (index > 0) linkRuns.push(new TextRun({ text: " | ", size: BODY_SIZE, font: FONT }));
        linkRuns.push(
          new ExternalHyperlink({
            link: ensureUrlScheme(entry.url),
            children: [new TextRun({ text: entry.display, size: BODY_SIZE, font: FONT, style: "Hyperlink" })],
          })
        );
      });
      children.push(
        new Paragraph({
          children: linkRuns,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })
      );
    }
  }

  // Body sections, rendered in the CV's sectionOrder (falling back to the
  // default order for any keys the order array is missing).
  const sectionBuilders = {
    summary: () => {
      if (!cv.summary) return;
      children.push(sectionHeading("Profile"));
      children.push(
        new Paragraph({
          children: textRunsFromSegments(cv.summary),
          spacing: { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    },
    experience: () => {
      if (!cv.experience || cv.experience.length === 0) return;
      children.push(sectionHeading("Work Experience"));
      cv.experience.forEach((job) => {
        children.push(
          ...buildRoleBlock({
            company: job.company,
            dates: job.dates,
            title: job.title,
            bullets: job.bullets,
            link: job.link,
          })
        );
      });
    },
    projects: () => {
      if (!cv.projects || cv.projects.length === 0) return;
      children.push(sectionHeading("Projects"));
      cv.projects.forEach((proj) => {
        children.push(
          ...buildRoleBlock({
            company: proj.company,
            dates: proj.dates,
            title: proj.title,
            bullets: proj.bullets,
            link: proj.link,
          })
        );
      });
    },
    education: () => {
      if (!cv.education || cv.education.length === 0) return;
      children.push(sectionHeading("Education"));
      cv.education.forEach((edu) => {
        children.push(...buildRoleBlock({ company: edu.institution, dates: edu.dates, title: edu.degree, bullets: [] }));
      });
    },
    skills: () => {
      if (!cv.skills || cv.skills.length === 0) return;
      children.push(sectionHeading("Skills"));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "•  " + cv.skills.join("  •  "), size: BODY_SIZE, font: FONT })],
          spacing: { after: 100 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    },
    certifications: () => {
      if (!cv.certifications || cv.certifications.length === 0) return;
      children.push(sectionHeading("Certifications"));
      cv.certifications.forEach((cert) =>
        children.push(
          new Paragraph({
            children: runsWithLinks(cert),
            bullet: { level: 0 },
            spacing: { after: 80 },
          })
        )
      );
    },
    interests: () => {
      if (!cv.interests) return;
      children.push(sectionHeading("Interests"));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: cv.interests, size: BODY_SIZE, font: FONT })],
          spacing: { after: 100 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    },
  };

  const defaultOrder = Object.keys(sectionBuilders);
  const requestedOrder = Array.isArray(cv.sectionOrder) ? cv.sectionOrder : [];
  const order = [];
  requestedOrder.forEach((key) => {
    if (sectionBuilders[key] && !order.includes(key)) order.push(key);
  });
  defaultOrder.forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });
  order.forEach((key) => sectionBuilders[key]());

  return new Document({
    sections: [
      {
        properties: { page: { margin: { top: 620, bottom: 620, left: 620, right: 620 } } },
        children,
      },
    ],
    styles: { default: { document: { run: { font: FONT, size: BODY_SIZE } } } },
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { tailoredCv } = req.body || {};
    if (!tailoredCv || typeof tailoredCv !== "object") {
      res.status(400).json({ error: "Missing 'tailoredCv' object in request body." });
      return;
    }

    const doc = buildDocument(tailoredCv);
    const buffer = await Packer.toBuffer(doc);

    const filenameBase = [tailoredCv.name, tailoredCv.jobTitle, tailoredCv.companyName]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(" - ")
      .replace(/[^a-z0-9 \-]+/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "tailored-cv";
    const filename = `${filenameBase}.docx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (err) {
    console.error("Error generating DOCX:", err);
    res.status(500).json({ error: "Failed to generate Word document." });
  }
};
module.exports.buildDocument = buildDocument;
