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
const { parseBoldSegments } = require("./_lib/boldSegments");

const FONT = "Calibri";
const BODY_SIZE = 23; // 11.5pt, half-points
const NAME_SIZE = 26; // 13pt
const DATE_TAB_POSITION = 9350; // right tab stop for dates, twips

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
          new TextRun({ text: "Live demo: ", size: BODY_SIZE, font: FONT }),
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

  // Contact
  if (cv.contact || Array.isArray(cv.contactLinks)) {
    const contactLineRuns = [];
    const contactParagraphs = [];

    const normalizeString = (value) => String(value || "").trim();
    const contactText = normalizeString(cv.contact);
    const emails = contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const phones = contactText.match(/\+?\d[\d\s().-]{6,}\d/g) || [];
    const urls = (contactText.match(/(?:https?:\/\/|www\.)[^\s,;]+|linkedin\.com\/[^
\s,;]+|github\.com\/[^
\s,;]+/gi) || []).map(normalizeUrl);
    const location = contactText
      .replace(/(?:https?:\/\/|www\.)[^\s,;]+/gi, "")
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

    const allLinks = new Set(urls);
    if (Array.isArray(cv.contactLinks)) {
      cv.contactLinks.forEach((url) => {
        const normalized = normalizeUrl(url);
        if (normalized) allLinks.add(normalized);
      });
    }
    if (allLinks.size > 0) {
      const linkRuns = [];
      Array.from(allLinks).forEach((url, index) => {
        if (index > 0) linkRuns.push(new TextRun({ text: " | ", size: BODY_SIZE, font: FONT }));
        linkRuns.push(
          new ExternalHyperlink({
            link: url,
            children: [new TextRun({ text: url, size: BODY_SIZE, font: FONT, style: "Hyperlink" })],
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

  // Professional Summary
  if (cv.summary) {
    children.push(sectionHeading("Profile"));
    children.push(
      new Paragraph({
        children: textRunsFromSegments(cv.summary),
        spacing: { after: 160 },
        alignment: AlignmentType.JUSTIFIED,
      })
    );
  }

  // Work Experience
  if (cv.experience && cv.experience.length > 0) {
    children.push(sectionHeading("Work Experience"));
    cv.experience.forEach((job) => {
      children.push(...buildRoleBlock({ company: job.company, dates: job.dates, title: job.title, bullets: job.bullets }));
    });
  }

  // Projects
  if (cv.projects && cv.projects.length > 0) {
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
  }

  // Education
  if (cv.education && cv.education.length > 0) {
    children.push(sectionHeading("Education"));
    cv.education.forEach((edu) => {
      children.push(...buildRoleBlock({ company: edu.institution, dates: edu.dates, title: edu.degree, bullets: [] }));
    });
  }

  // Skills
  if (cv.skills && cv.skills.length > 0) {
    children.push(sectionHeading("Skills"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "•  " + cv.skills.join("  •  "), size: BODY_SIZE, font: FONT })],
        spacing: { after: 100 },
        alignment: AlignmentType.JUSTIFIED,
      })
    );
  }

  // Certifications
  if (cv.certifications && cv.certifications.length > 0) {
    children.push(sectionHeading("Certifications"));
    cv.certifications.forEach((cert) => children.push(bulletParagraph(cert)));
  }

  // Interests
  if (cv.interests) {
    children.push(sectionHeading("Interests"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.interests, size: BODY_SIZE, font: FONT })],
        spacing: { after: 100 },
        alignment: AlignmentType.JUSTIFIED,
      })
    );
  }

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

    const filename = `${(tailoredCv.name || "tailored-cv").replace(/[^a-z0-9]+/gi, "-")}.docx`;

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
