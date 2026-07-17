// /api/generate-pdf.js
// Accepts the tailored CV as structured JSON and returns a formatted .pdf file,
// matching the same template style as generate-docx.js: centered plain
// headings, tab-aligned dates, italic titles, hyphen bullets, and inline
// **bold** keyword emphasis (rendered as mixed bold/regular text runs).

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { parseBoldSegments } = require("./_lib/boldSegments");

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.4, 0.4, 0.4);
const LINK_COLOR = rgb(0.1, 0.2, 0.6);

// Splits bold-segment text into a flat list of "words" tagged with bold state,
// preserving the single space between words (spaces attach to the word before them).
function segmentsToWords(segments) {
  const words = [];
  segments.forEach((seg) => {
    const parts = seg.text.split(" ");
    parts.forEach((part, i) => {
      if (part === "" && i === parts.length - 1) return; // trailing split artifact
      words.push({ text: part + (i < parts.length - 1 ? " " : ""), bold: seg.bold });
    });
  });
  return words.filter((w) => w.text.length > 0);
}

class PdfWriter {
  constructor(pdfDoc, fonts) {
    this.pdfDoc = pdfDoc;
    this.fonts = fonts;
    this.page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensureSpace(neededHeight) {
    if (this.y - neededHeight < MARGIN) {
      this.page = this.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  drawLine({ text, font = this.fonts.regular, size = 11, color = BLACK, gapAfter = 4, align = "left" }) {
    this.ensureSpace(size + gapAfter);
    let x = MARGIN;
    if (align === "center") {
      const textWidth = font.widthOfTextAtSize(text, size);
      x = (PAGE_WIDTH - textWidth) / 2;
    }
    this.page.drawText(text, { x, y: this.y - size, size, font, color });
    this.y -= size + gapAfter;
  }

  // Draws text with inline **bold** support, wrapped, left-aligned, optionally centered as a whole block.
  drawMixedWrapped({ text, size = 11, gapAfter = 8, lineGap = 3, indent = 0, center = false, justify = false }) {
    const words = segmentsToWords(parseBoldSegments(text));
    const maxWidth = CONTENT_WIDTH - indent;

    // Greedy line wrap, measuring each word with its correct font.
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;
    words.forEach((w) => {
      const font = w.bold ? this.fonts.bold : this.fonts.regular;
      const wWidth = font.widthOfTextAtSize(w.text, size);
      if (currentWidth + wWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
      }
      currentLine.push(w);
      currentWidth += wWidth;
    });
    if (currentLine.length > 0) lines.push(currentLine);

    lines.forEach((line, index) => {
      this.ensureSpace(size + lineGap);
      let lineWidth = 0;
      let spaceCount = 0;
      line.forEach((w) => {
        const font = w.bold ? this.fonts.bold : this.fonts.regular;
        lineWidth += font.widthOfTextAtSize(w.text, size);
        if (w.text.endsWith(" ")) {
          spaceCount += 1;
        }
      });

      const isLastLine = index === lines.length - 1;
      const extraSpace = justify && !center && !isLastLine && spaceCount > 0 ? (maxWidth - lineWidth) / spaceCount : 0;
      let x = center ? MARGIN + indent + (maxWidth - lineWidth) / 2 : MARGIN + indent;

      line.forEach((w) => {
        const font = w.bold ? this.fonts.bold : this.fonts.regular;
        this.page.drawText(w.text, { x, y: this.y - size, size, font, color: BLACK });
        const wordWidth = font.widthOfTextAtSize(w.text, size);
        x += wordWidth;
        if (extraSpace > 0 && w.text.endsWith(" ")) {
          x += extraSpace;
        }
      });
      this.y -= size + lineGap;
    });
    this.y -= gapAfter;
  }

  drawSectionHeading(text) {
    this.ensureSpace(30);
    this.y -= 6;
    const upper = text.toUpperCase();
    const size = 12;
    const textWidth = this.fonts.bold.widthOfTextAtSize(upper, size);
    const x = (PAGE_WIDTH - textWidth) / 2;
    this.page.drawText(upper, { x, y: this.y - size, size, font: this.fonts.bold, color: BLACK });
    this.y -= size + 14;
  }

  drawRoleHeader(company, dates) {
    this.ensureSpace(16);
    const size = 11;
    this.page.drawText(company || "", { x: MARGIN, y: this.y - size, size, font: this.fonts.bold, color: BLACK });
    if (dates) {
      const dateWidth = this.fonts.bold.widthOfTextAtSize(dates, size);
      this.page.drawText(dates, {
        x: PAGE_WIDTH - MARGIN - dateWidth,
        y: this.y - size,
        size,
        font: this.fonts.bold,
        color: BLACK,
      });
    }
    this.y -= size + 4;
  }

  drawMixedBullet(text, size = 11) {
    const bulletIndent = 14;
    const words = segmentsToWords(parseBoldSegments(text));
    const maxWidth = CONTENT_WIDTH - bulletIndent;

    const lines = [];
    let currentLine = [];
    let currentWidth = 0;
    words.forEach((w) => {
      const font = w.bold ? this.fonts.bold : this.fonts.regular;
      const wWidth = font.widthOfTextAtSize(w.text, size);
      if (currentWidth + wWidth > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
      }
      currentLine.push(w);
      currentWidth += wWidth;
    });
    if (currentLine.length > 0) lines.push(currentLine);

    lines.forEach((line, i) => {
      this.ensureSpace(size + 4);
      if (i === 0) {
        this.page.drawText("•", { x: MARGIN, y: this.y - size, size, font: this.fonts.regular, color: BLACK });
      }
      let x = MARGIN + bulletIndent;
      line.forEach((w) => {
        const font = w.bold ? this.fonts.bold : this.fonts.regular;
        this.page.drawText(w.text, { x, y: this.y - size, size, font, color: BLACK });
        x += font.widthOfTextAtSize(w.text, size);
      });
      this.y -= size + 4;
    });
    this.y -= 2;
  }
}

async function buildPdf(cv) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
  };

  const writer = new PdfWriter(pdfDoc, fonts);

  writer.drawLine({ text: cv.name || "Your Name", font: fonts.bold, size: 18, align: "center", gapAfter: 6 });
  if (cv.contact) {
    writer.drawLine({ text: cv.contact, font: fonts.regular, size: 10, color: GRAY, align: "center", gapAfter: 16 });
  }

  if (cv.summary) {
    writer.drawSectionHeading("Profile");
    writer.drawMixedWrapped({ text: cv.summary, size: 11, gapAfter: 10, justify: true });
  }

  const drawRoleBlock = (entry) => {
    writer.drawRoleHeader(entry.company, entry.dates);
    if (entry.title) {
      writer.drawLine({ text: entry.title, font: fonts.italic, size: 11, gapAfter: 6 });
    }
    (entry.bullets || []).forEach((b) => writer.drawMixedBullet(b, 11));
    if (entry.link) {
      writer.drawLine({ text: `Live demo: ${entry.link}`, font: fonts.regular, size: 9, color: LINK_COLOR, gapAfter: 4 });
    }
    writer.y -= 6;
  };

  if (cv.experience && cv.experience.length > 0) {
    writer.drawSectionHeading("Work Experience");
    cv.experience.forEach(drawRoleBlock);
  }

  if (cv.projects && cv.projects.length > 0) {
    writer.drawSectionHeading("Projects");
    cv.projects.forEach(drawRoleBlock);
  }

  if (cv.education && cv.education.length > 0) {
    writer.drawSectionHeading("Education");
    cv.education.forEach((edu) =>
      drawRoleBlock({ company: edu.institution, dates: edu.dates, title: edu.degree, bullets: [] })
    );
  }

  if (cv.skills && cv.skills.length > 0) {
    writer.drawSectionHeading("Skills");
    writer.drawMixedWrapped({ text: "•  " + cv.skills.join("  •  "), size: 11, gapAfter: 6, justify: true });
  }

  if (cv.certifications && cv.certifications.length > 0) {
    writer.drawSectionHeading("Certifications");
    cv.certifications.forEach((cert) => writer.drawMixedBullet(cert, 11));
    writer.y -= 4;
  }

  if (cv.interests) {
    writer.drawSectionHeading("Interests");
    writer.drawMixedWrapped({ text: cv.interests, size: 11, gapAfter: 6, justify: true });
  }

  return pdfDoc.save();
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

    const pdfBytes = await buildPdf(tailoredCv);
    const filename = `${(tailoredCv.name || "tailored-cv").replace(/[^a-z0-9]+/gi, "-")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error generating PDF:", err);
    res.status(500).json({ error: "Failed to generate PDF document." });
  }
};
