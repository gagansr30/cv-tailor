// /api/generate-pdf.js
// Accepts the tailored CV as structured JSON and returns a formatted .pdf file,
// matching the same template style as generate-docx.js: centered plain
// headings, tab-aligned dates, italic titles, hyphen bullets, and inline
// **bold** keyword emphasis (rendered as mixed bold/regular text runs).
// Links (LinkedIn/GitHub in the header, and project demo links) are real
// clickable PDF annotations, not just styled text.

const { PDFDocument, StandardFonts, rgb, PDFString, PDFName, setWordSpacing } = require("pdf-lib");
const { parseBoldSegments, parseLinkSegments } = require("./_lib/boldSegments");
const { getTemplate } = require("./_lib/templates");

// A4 paper with tight margins (matching a 10pt LaTeX one-page layout:
// left/right 0.40in, top 0.25in, bottom 0.15in) to maximize what fits on
// one page before the auto-fit scaling even engages.
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 28.8; // 0.40in left/right
const MARGIN_TOP = 18; // 0.25in
const MARGIN_BOTTOM = 10.8; // 0.15in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.4, 0.4, 0.4);
const LINK_COLOR = rgb(0.1, 0.2, 0.6);

function hexToRgb(hex) {
  if (!hex) return null;
  const n = parseInt(hex, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function segmentsToWords(segments) {
  const words = [];
  segments.forEach((seg) => {
    const parts = seg.text.split(" ");
    parts.forEach((part, i) => {
      if (part === "" && i === parts.length - 1) return;
      words.push({ text: part + (i < parts.length - 1 ? " " : ""), bold: seg.bold, url: seg.url });
    });
  });
  return words.filter((w) => w.text.length > 0);
}

// Turns a string that may contain [Label](url) markdown links into the same
// word model used for wrapping, tagging each word of a link's label with its
// destination URL so it can be drawn in link color with a real annotation.
function linkAwareWords(text) {
  const words = [];
  parseLinkSegments(text).forEach((seg) => {
    segmentsToWords(parseBoldSegments(seg.text)).forEach((w) => {
      words.push({ ...w, url: seg.url });
    });
  });
  return words;
}

// Merges consecutive same-styled words back into a single continuous run.
// Word-level splitting is only needed to calculate where lines wrap; once
// wrapping is decided, drawing word-by-word creates a separate PDF text
// object per word, which many text extractors (including ATS parsers) treat
// as a line break - splitting keyword phrases like "Machine Learning" into
// "Machine" / "Learning" on separate lines. Merging back into style-runs
// keeps the extracted text continuous while still supporting inline **bold**.
function mergeWordsIntoRuns(words) {
  const runs = [];
  words.forEach((w) => {
    const last = runs[runs.length - 1];
    if (last && last.bold === w.bold && last.url === w.url) {
      last.text += w.text;
    } else {
      runs.push({ text: w.text, bold: w.bold, url: w.url });
    }
  });
  return runs;
}

// Splits a "contact" string (e.g. "email | phone | location | [LinkedIn](url) | github url")
// into an info line (email/phone/location) and an array of { text, url } links, so links
// can be rendered as individually clickable regions on their own centered line - showing
// the label for [Label](url) parts and the URL itself for bare-URL parts.
function splitContactParts(contact) {
  if (!contact) return { infoLine: "", linkParts: [] };
  const parts = contact.split("|").map((p) => p.trim()).filter(Boolean);
  const markdownLink = (p) => p.match(/^\[([^\]]+)\]\(\s*([^)\s]+)\s*\)$/);
  const isBareLink = (p) => /^https?:\/\//i.test(p) || /linkedin\.com|github\.com/i.test(p);
  const infoParts = [];
  const linkParts = [];
  parts.forEach((part) => {
    const md = markdownLink(part);
    if (md) {
      linkParts.push({ text: md[1].trim(), url: md[2] });
    } else if (isBareLink(part)) {
      linkParts.push({ text: part, url: part });
    } else {
      infoParts.push(part);
    }
  });
  return { infoLine: infoParts.join("  |  "), linkParts };
}

// pdf-lib has no high-level "clickable link" API, so link annotations are
// built manually: a Link annotation dict with a URI action, registered on
// the page's /Annots array, positioned over the drawn text's bounding box.
// PDF viewers treat a URI without a scheme (e.g. "linkedin.com/in/x") as a
// relative local file path, not a website - this normalizes the actual link
// destination while leaving the displayed text exactly as written.
function ensureUrlScheme(url) {
  if (!url) return url;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function addLinkAnnotation(page, url, x, y, width, height) {
  const doc = page.doc;
  const linkAnnotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + width, y + height],
    Border: [0, 0, 0],
    A: {
      Type: "Action",
      S: "URI",
      URI: PDFString.of(ensureUrlScheme(url)),
    },
  });
  const linkRef = doc.context.register(linkAnnotation);
  const existingAnnots = page.node.lookup(PDFName.of("Annots"));
  if (existingAnnots) {
    existingAnnots.push(linkRef);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([linkRef]));
  }
}

class PdfWriter {
  constructor(pdfDoc, fonts, tpl, gapScale = 1) {
    this.pdfDoc = pdfDoc;
    this.fonts = fonts;
    this.tpl = tpl;
    this.gs = gapScale;
    this.accent = hexToRgb(tpl.accent);
    this.page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  ensureSpace(neededHeight) {
    if (this.y - neededHeight < MARGIN_BOTTOM) {
      this.page = this.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN_TOP;
    }
  }

  drawLine({ text, font = this.fonts.regular, size = 11, color = BLACK, gapAfter = 4, align = "left", url = null }) {
    this.ensureSpace(size + gapAfter);
    let x = MARGIN;
    const textWidth = font.widthOfTextAtSize(text, size);
    if (align === "center") {
      x = (PAGE_WIDTH - textWidth) / 2;
    }
    const yBaseline = this.y - size;
    this.page.drawText(text, { x, y: yBaseline, size, font, color });
    if (url) {
      addLinkAnnotation(this.page, url, x, yBaseline - 2, textWidth, size + 4);
    }
    this.y -= size + gapAfter;
  }

  // Draws multiple centered parts on one line, separated by " | ", where each
  // part can optionally have its own clickable URL (used for the header's
  // LinkedIn / GitHub line, since each needs a separate link target).
  drawCenteredLinkParts({ parts, font, size = 10, color = LINK_COLOR, gapAfter = 16, align = "center" }) {
    if (!parts || parts.length === 0) return;
    this.ensureSpace(size + gapAfter);
    const separator = "  |  ";
    const sepWidth = font.widthOfTextAtSize(separator, size);
    const widths = parts.map((p) => font.widthOfTextAtSize(p.text, size));
    const totalWidth = widths.reduce((a, b) => a + b, 0) + sepWidth * (parts.length - 1);
    let x = align === "left" ? MARGIN : (PAGE_WIDTH - totalWidth) / 2;
    const yBaseline = this.y - size;

    parts.forEach((part, i) => {
      this.page.drawText(part.text, { x, y: yBaseline, size, font, color });
      addLinkAnnotation(this.page, part.url, x, yBaseline - 2, widths[i], size + 4);
      x += widths[i];
      if (i < parts.length - 1) {
        this.page.drawText(separator, { x, y: yBaseline, size, font, color: GRAY });
        x += sepWidth;
      }
    });
    this.y -= size + gapAfter * this.gs;
  }

  drawMixedWrapped({ text, size = 11, gapAfter = 8, lineGap = 3, indent = 0, center = false, justify = false }) {
    const words = segmentsToWords(parseBoldSegments(text));
    const maxWidth = CONTENT_WIDTH - indent;

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
        if (w.text.endsWith(" ")) spaceCount += 1;
      });

      const isLastLine = index === lines.length - 1;
      const runs = mergeWordsIntoRuns(line);
      // Justify using the PDF word-spacing operator (Tw), which stretches
      // every literal space character within a drawn string uniformly. This
      // gives smooth, even justification across the whole line while still
      // drawing each same-styled run as ONE continuous text object (so
      // extracted/ATS-parsed text isn't fragmented at every word).
      const wordSpacing =
        justify && !center && !isLastLine && spaceCount > 0 ? (maxWidth - lineWidth) / spaceCount : 0;
      let x = center ? MARGIN + indent + (maxWidth - lineWidth) / 2 : MARGIN + indent;

      if (wordSpacing > 0) this.page.pushOperators(setWordSpacing(wordSpacing));

      runs.forEach((run) => {
        const font = run.bold ? this.fonts.bold : this.fonts.regular;
        this.page.drawText(run.text, { x, y: this.y - size, size, font, color: BLACK });
        const spacesInRun = (run.text.match(/ /g) || []).length;
        x += font.widthOfTextAtSize(run.text, size) + spacesInRun * wordSpacing;
      });

      if (wordSpacing > 0) this.page.pushOperators(setWordSpacing(0));
      this.y -= size + lineGap;
    });
    this.y -= gapAfter;
  }

  // Wraps plain (single-font) text - used for role/degree titles, which can
  // run long (e.g. degree name + module list) and must not run off the page.
  drawWrappedPlain({ text, font = this.fonts.regular, size = 11, color = BLACK, gapAfter = 6, lineGap = 3 }) {
    const words = text.split(" ").filter(Boolean);
    const lines = [];
    let currentLine = [];
    let currentWidth = 0;

    words.forEach((word) => {
      const wordWithSpace = word + " ";
      const wWidth = font.widthOfTextAtSize(wordWithSpace, size);
      if (currentWidth + wWidth > CONTENT_WIDTH && currentLine.length > 0) {
        lines.push(currentLine.join(" "));
        currentLine = [];
        currentWidth = 0;
      }
      currentLine.push(word);
      currentWidth += wWidth;
    });
    if (currentLine.length > 0) lines.push(currentLine.join(" "));

    lines.forEach((line) => {
      this.ensureSpace(size + lineGap);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= size + lineGap;
    });
    this.y -= gapAfter - lineGap;
  }

  drawSectionHeading(text) {
    this.ensureSpace(34);
    this.y -= 6;
    const upper = text.toUpperCase();
    const size = Math.round(this.tpl.pdfBody + 1);
    // gaps around headings scale with the fit pass
    const textWidth = this.fonts.bold.widthOfTextAtSize(upper, size);
    const x = this.tpl.headingAlign === "left" ? MARGIN : (PAGE_WIDTH - textWidth) / 2;
    const headingColor = this.accent && this.tpl.headingUseAccent !== false ? this.accent : BLACK;
    this.page.drawText(upper, { x, y: this.y - size, size, font: this.fonts.bold, color: headingColor });
    this.y -= size + 4 * this.gs;
    if (this.tpl.headingRule) {
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y },
        thickness: 0.7,
        color: this.accent || rgb(0.65, 0.65, 0.65),
      });
      this.y -= 6 * this.gs;
    }
    this.y -= 8 * this.gs;
  }

  drawRoleHeader(company, dates) {
    this.ensureSpace(16);
    const size = this.tpl.pdfBody;
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
    const words = linkAwareWords(text);
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
      const runs = mergeWordsIntoRuns(line);
      runs.forEach((run) => {
        const font = run.bold ? this.fonts.bold : this.fonts.regular;
        const runWidth = font.widthOfTextAtSize(run.text, size);
        this.page.drawText(run.text, { x, y: this.y - size, size, font, color: run.url ? LINK_COLOR : BLACK });
        if (run.url) {
          addLinkAnnotation(this.page, run.url, x, this.y - size - 2, runWidth, size + 4);
        }
        x += runWidth;
      });
      this.y -= size + 4 * this.gs;
    });
    this.y -= 2 * this.gs;
  }
}

async function renderPdfOnce(cv, templateId, scale) {
  const baseTpl = getTemplate(templateId);
  const tpl = {
    ...baseTpl,
    pdfBody: baseTpl.pdfBody * scale,
    pdfName: baseTpl.pdfName * Math.max(scale, 0.92), // name shrinks less
  };
  const pdfDoc = await PDFDocument.create();
  const fonts =
    tpl.pdfFont === "times"
      ? {
          regular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
          bold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
          italic: await pdfDoc.embedFont(StandardFonts.TimesRomanItalic),
        }
      : {
          regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
          bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
          italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
        };

  const gapScale = scale >= 1 ? 1 : scale >= 0.95 ? 0.8 : scale >= 0.9 ? 0.65 : 0.55;
  const writer = new PdfWriter(pdfDoc, fonts, tpl, gapScale);
  const headerAlign = tpl.nameAlign === "left" ? "left" : "center";

  writer.drawLine({
    text: tpl.nameCaps ? (cv.name || "Your Name").toUpperCase() : cv.name || "Your Name",
    font: fonts.bold,
    size: tpl.pdfName,
    align: headerAlign,
    gapAfter: 6,
    color: writer.accent || BLACK,
  });
  if (cv.jobTitle) {
    writer.drawLine({ text: cv.jobTitle, font: fonts.regular, size: tpl.pdfBody + 0.5, color: GRAY, align: headerAlign, gapAfter: 6 });
  }
  if (cv.contact) {
    const { infoLine, linkParts } = splitContactParts(cv.contact);
    if (infoLine) {
      writer.drawLine({ text: infoLine, font: fonts.regular, size: tpl.pdfBody - 1, color: GRAY, align: headerAlign, gapAfter: 2 });
    }
    if (linkParts.length > 0) {
      writer.drawCenteredLinkParts({ parts: linkParts, font: fonts.regular, size: tpl.pdfBody - 1, gapAfter: 16, align: headerAlign });
    } else if (infoLine) {
      writer.y -= 14;
    }
  }

  const drawRoleBlock = (entry) => {
    writer.drawRoleHeader(entry.company, entry.dates);
    if (entry.title) {
      writer.drawWrappedPlain({ text: entry.title, font: fonts.italic, size: tpl.pdfBody, gapAfter: 6 });
    }
    (entry.bullets || []).forEach((b) => writer.drawMixedBullet(b, tpl.pdfBody));
    if (entry.link) {
      writer.drawLine({
        text: `Link: ${entry.link}`,
        font: fonts.regular,
        size: 9,
        color: LINK_COLOR,
        gapAfter: 4,
        url: entry.link,
      });
    }
    writer.y -= 6 * gapScale;
  };

  // Body sections, rendered in the CV's sectionOrder (falling back to the
  // default order for any keys the order array is missing).
  const sectionRenderers = {
    summary: () => {
      if (!cv.summary) return;
      writer.drawSectionHeading("Profile");
      writer.drawMixedWrapped({ text: cv.summary, size: tpl.pdfBody, gapAfter: 10, justify: true });
    },
    experience: () => {
      if (!cv.experience || cv.experience.length === 0) return;
      writer.drawSectionHeading("Work Experience");
      cv.experience.forEach(drawRoleBlock);
    },
    projects: () => {
      if (!cv.projects || cv.projects.length === 0) return;
      writer.drawSectionHeading("Projects");
      cv.projects.forEach(drawRoleBlock);
    },
    education: () => {
      if (!cv.education || cv.education.length === 0) return;
      writer.drawSectionHeading("Education");
      cv.education.forEach((edu) =>
        drawRoleBlock({ company: edu.institution, dates: edu.dates, title: edu.degree, bullets: [] })
      );
    },
    skills: () => {
      if (!cv.skills || cv.skills.length === 0) return;
      writer.drawSectionHeading("Skills");
      writer.drawMixedWrapped({ text: cv.skills.join(", "), size: tpl.pdfBody, gapAfter: 6, justify: true });
    },
    certifications: () => {
      if (!cv.certifications || cv.certifications.length === 0) return;
      writer.drawSectionHeading("Certifications");
      cv.certifications.forEach((cert) => writer.drawMixedBullet(cert, tpl.pdfBody));
      writer.y -= 4;
    },
    interests: () => {
      if (!cv.interests) return;
      writer.drawSectionHeading("Interests");
      writer.drawMixedWrapped({ text: cv.interests, size: tpl.pdfBody, gapAfter: 6, justify: true });
    },
  };

  const defaultOrder = Object.keys(sectionRenderers);
  const requestedOrder = Array.isArray(cv.sectionOrder) ? cv.sectionOrder : [];
  const order = [];
  requestedOrder.forEach((key) => {
    if (sectionRenderers[key] && !order.includes(key)) order.push(key);
  });
  defaultOrder.forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });
  order.forEach((key) => sectionRenderers[key]());

  return { bytes: await pdfDoc.save(), pages: pdfDoc.getPageCount() };
}

// Auto-fit: most CVs should be one page. Render at full size first; if the
// result spills past one page, retry with progressively tighter type and
// spacing down to a readability floor (~85% type, ~65% gaps). If even the
// floor can't fit one page there's genuinely too much content - return the
// full-size readable multi-page version instead of shrinking further.
async function buildPdf(cv, templateId) {
  const passes = [1, 0.95, 0.9, 0.85];
  let firstResult = null;
  for (const scale of passes) {
    const result = await renderPdfOnce(cv, templateId, scale);
    if (scale === 1) firstResult = result;
    if (result.pages <= 1) return result.bytes;
  }
  return firstResult.bytes;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { tailoredCv, template } = req.body || {};
    if (!tailoredCv || typeof tailoredCv !== "object") {
      res.status(400).json({ error: "Missing 'tailoredCv' object in request body." });
      return;
    }

    const pdfBytes = await buildPdf(tailoredCv, template);
    const filenameBase = [tailoredCv.name, tailoredCv.jobTitle, tailoredCv.companyName]
      .map((p) => String(p || "").trim())
      .filter(Boolean)
      .join(" - ")
      .replace(/[^a-z0-9 \-]+/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "tailored-cv";
    const filename = `${filenameBase}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error generating PDF:", err);
    res.status(500).json({ error: "Failed to generate PDF document." });
  }
};
module.exports.renderPdfOnce = renderPdfOnce;