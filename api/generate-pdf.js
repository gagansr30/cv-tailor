// /api/generate-pdf.js
// Accepts the tailored CV as structured JSON and returns a formatted .pdf file.
// pdf-lib is low-level, so this file includes small helpers for text wrapping
// and pagination (adding new pages when content runs out of room).

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54; // 0.75in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const ACCENT_COLOR = rgb(0x1f / 255, 0x38 / 255, 0x64 / 255);
const GRAY = rgb(0.4, 0.4, 0.4);
const BLACK = rgb(0.1, 0.1, 0.1);

function wrapText(text, font, size, maxWidth) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
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

  drawLine({
    text,
    font = this.fonts.regular,
    size = 11,
    color = BLACK,
    gapAfter = 4,
    align = "left",
    indent = 0,
  }) {
    this.ensureSpace(size + gapAfter);
    let x = MARGIN + indent;
    if (align === "center") {
      const textWidth = font.widthOfTextAtSize(text, size);
      x = (PAGE_WIDTH - textWidth) / 2;
    }
    this.page.drawText(text, { x, y: this.y - size, size, font, color });
    this.y -= size + gapAfter;
  }

  drawWrapped({
    text,
    font = this.fonts.regular,
    size = 11,
    color = BLACK,
    lineGap = 3,
    gapAfter = 8,
    indent = 0,
  }) {
    const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
    lines.forEach((line) => {
      this.ensureSpace(size + lineGap);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color,
      });
      this.y -= size + lineGap;
    });
    this.y -= gapAfter;
  }

  drawSectionHeading(text) {
    this.ensureSpace(30);
    this.y -= 8;
    this.page.drawText(text.toUpperCase(), {
      x: MARGIN,
      y: this.y - 12,
      size: 13,
      font: this.fonts.bold,
      color: ACCENT_COLOR,
    });
    this.y -= 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 1,
      color: ACCENT_COLOR,
    });
    this.y -= 14;
  }

  drawBullet(text, font, size) {
    const bulletIndent = 14;
    const lines = wrapText(text, font, size, CONTENT_WIDTH - bulletIndent);
    lines.forEach((line, i) => {
      this.ensureSpace(size + 4);
      if (i === 0) {
        this.page.drawText("•", {
          x: MARGIN,
          y: this.y - size,
          size,
          font,
          color: BLACK,
        });
      }
      this.page.drawText(line, {
        x: MARGIN + bulletIndent,
        y: this.y - size,
        size,
        font,
        color: BLACK,
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

  // Name
  writer.drawLine({
    text: cv.name || "Your Name",
    font: fonts.bold,
    size: 22,
    color: ACCENT_COLOR,
    align: "center",
    gapAfter: 6,
  });

  // Contact
  if (cv.contact) {
    writer.drawLine({
      text: cv.contact,
      font: fonts.regular,
      size: 10,
      color: GRAY,
      align: "center",
      gapAfter: 16,
    });
  }

  // Summary
  if (cv.summary) {
    writer.drawSectionHeading("Professional Summary");
    writer.drawWrapped({ text: cv.summary, size: 11, gapAfter: 10 });
  }

  // Experience
  if (cv.experience && cv.experience.length > 0) {
    writer.drawSectionHeading("Work Experience");
    cv.experience.forEach((job) => {
      const titleLine = [job.title, job.company].filter(Boolean).join("  |  ");
      if (titleLine) {
        writer.drawLine({ text: titleLine, font: fonts.bold, size: 12, gapAfter: 2 });
      }
      if (job.dates) {
        writer.drawLine({ text: job.dates, font: fonts.italic, size: 10, color: GRAY, gapAfter: 6 });
      }
      (job.bullets || []).forEach((bullet) => {
        writer.drawBullet(bullet, fonts.regular, 11);
      });
      writer.y -= 6;
    });
  }

  // Projects
  if (cv.projects && cv.projects.length > 0) {
    writer.drawSectionHeading("Projects");
    cv.projects.forEach((proj) => {
      const titleLine = [proj.title, proj.company].filter(Boolean).join("  |  ");
      if (titleLine) {
        writer.drawLine({ text: titleLine, font: fonts.bold, size: 12, gapAfter: 2 });
      }
      if (proj.dates) {
        writer.drawLine({ text: proj.dates, font: fonts.italic, size: 10, color: GRAY, gapAfter: 6 });
      }
      (proj.bullets || []).forEach((bullet) => {
        writer.drawBullet(bullet, fonts.regular, 11);
      });
      if (proj.link) {
        writer.drawWrapped({
          text: `Live demo: ${proj.link}`,
          font: fonts.regular,
          size: 10,
          color: rgb(0.1, 0.2, 0.6),
          gapAfter: 4,
        });
      }
      writer.y -= 6;
    });
  }

  // Education
  if (cv.education && cv.education.length > 0) {
    writer.drawSectionHeading("Education");
    cv.education.forEach((edu) => {
      const line = [edu.degree, edu.institution].filter(Boolean).join("  |  ");
      if (line) {
        writer.drawLine({ text: line, font: fonts.bold, size: 12, gapAfter: 2 });
      }
      if (edu.dates) {
        writer.drawLine({ text: edu.dates, font: fonts.italic, size: 10, color: GRAY, gapAfter: 8 });
      }
    });
  }

  // Skills
  if (cv.skills && cv.skills.length > 0) {
    writer.drawSectionHeading("Skills");
    writer.drawWrapped({ text: cv.skills.join("   •   "), size: 11, gapAfter: 6 });
  }

  // Certifications
  if (cv.certifications && cv.certifications.length > 0) {
    writer.drawSectionHeading("Certifications");
    cv.certifications.forEach((cert) => {
      writer.drawBullet(cert, fonts.regular, 11);
    });
    writer.y -= 4;
  }

  // Interests
  if (cv.interests) {
    writer.drawSectionHeading("Interests");
    writer.drawWrapped({ text: cv.interests, size: 11, gapAfter: 6 });
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
