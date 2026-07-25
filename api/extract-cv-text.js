// /api/extract-cv-text.js
// Accepts a base64-encoded PDF or DOCX file and returns extracted plain text,
// so the user can upload a CV file instead of pasting text.
//
// Hyperlink preservation:
// - DOCX: plain-text extraction drops embedded hyperlinks entirely, so the
//   file is ALSO converted to HTML (mammoth.convertToHtml) and every
//   <a href="..."> is collected. Links whose URL isn't already visible in the
//   text are appended in a "Hyperlinks found in the document" appendix that
//   the parse/tailor prompts know how to re-attach.
// - PDF: pdf-parse only extracts drawn text, so link ANNOTATIONS (clickable
//   regions whose URL isn't printed on the page) would be lost. pdf-lib is
//   used to walk each page's /Annots array and pull out every URI action.

const mammoth = require("mammoth");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = require("pdf-lib");

const MAX_BYTES = 8 * 1024 * 1024; // 8MB safety cap

// Normalizes a URL for duplicate detection only (display form is untouched).
function linkKey(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^mailto:/, "")
    .replace(/^tel:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

// Appends links that aren't already visible in the extracted text, so the
// parser can re-attach them without ever inventing or duplicating URLs.
function appendHiddenLinks(text, links) {
  const textKeyed = text.toLowerCase();
  const seen = new Set();
  const hidden = [];

  links.forEach(({ label, url }) => {
    const cleaned = String(url || "").trim();
    if (!cleaned || /^(#|javascript:)/i.test(cleaned)) return;
    const key = linkKey(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    // If the URL (in any common form) is already present in the text, the
    // parser will pick it up from there - no need to repeat it.
    if (textKeyed.includes(key)) return;
    const display = cleaned.replace(/^mailto:/i, "").replace(/^tel:/i, "");
    hidden.push(label && label.trim() && linkKey(label) !== key ? `- ${label.trim()}: ${display}` : `- ${display}`);
  });

  if (hidden.length === 0) return text;
  return `${text}\n\nHyperlinks found in the document:\n${hidden.join("\n")}`;
}

// --- DOCX ------------------------------------------------------------------

async function extractDocx(buffer) {
  const rawResult = await mammoth.extractRawText({ buffer });
  const text = (rawResult.value || "").trim();

  let links = [];
  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const html = htmlResult.value || "";
    const anchorRegex = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html)) !== null) {
      const url = match[1].replace(/&amp;/g, "&");
      const label = match[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
      links.push({ label, url });
    }
  } catch (err) {
    console.error("DOCX hyperlink extraction failed (continuing with text only):", err);
  }

  return { text, links };
}

// --- PDF -------------------------------------------------------------------

function pdfStringValue(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return "";
}

async function extractPdfLinkAnnotations(buffer) {
  const links = [];
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    pdfDoc.getPages().forEach((page) => {
      const annots = page.node.lookup(PDFName.of("Annots"));
      if (!(annots instanceof PDFArray)) return;
      for (let i = 0; i < annots.size(); i++) {
        const annot = annots.lookup(i);
        if (!(annot instanceof PDFDict)) continue;
        const subtype = annot.lookup(PDFName.of("Subtype"));
        if (!subtype || subtype.toString() !== "/Link") continue;
        const action = annot.lookup(PDFName.of("A"));
        if (!(action instanceof PDFDict)) continue;
        const actionType = action.lookup(PDFName.of("S"));
        if (!actionType || actionType.toString() !== "/URI") continue;
        const uri = pdfStringValue(action.lookup(PDFName.of("URI")));
        if (uri) links.push({ label: "", url: uri });
      }
    });
  } catch (err) {
    console.error("PDF link annotation extraction failed (continuing with text only):", err);
  }
  return links;
}

async function extractPdf(buffer) {
  const parsed = await pdfParse(buffer);
  const text = (parsed.text || "").trim();
  const links = await extractPdfLinkAnnotations(buffer);
  return { text, links };
}

// --- handler ---------------------------------------------------------------

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { filename, mimeType, base64Data } = req.body || {};

    if (!base64Data || typeof base64Data !== "string") {
      res.status(400).json({ error: "No file data received." });
      return;
    }

    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.length > MAX_BYTES) {
      res.status(400).json({ error: "File is too large (8MB limit)." });
      return;
    }

    const lowerName = (filename || "").toLowerCase();
    const isPdf = (mimeType && mimeType.includes("pdf")) || lowerName.endsWith(".pdf");
    const isDocx =
      (mimeType && mimeType.includes("officedocument.wordprocessingml.document")) ||
      lowerName.endsWith(".docx");

    let extracted;

    if (isPdf) {
      extracted = await extractPdf(buffer);
    } else if (isDocx) {
      extracted = await extractDocx(buffer);
    } else {
      res.status(400).json({
        error: "Unsupported file type. Please upload a PDF or Word (.docx) file.",
      });
      return;
    }

    const text = extracted.text;

    if (!text) {
      res.status(422).json({
        error:
          "Couldn't extract any text from that file. It may be a scanned image rather than a text-based document - try pasting the CV text directly instead.",
      });
      return;
    }

    res.status(200).json({ text: appendHiddenLinks(text, extracted.links) });
  } catch (err) {
    console.error("Error extracting CV text:", err);
    res.status(500).json({
      error: "Failed to read that file. Please try a different file, or paste the CV text directly.",
    });
  }
};
