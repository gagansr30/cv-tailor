// /api/extract-cv-text.js
// Accepts a base64-encoded PDF or DOCX file and returns extracted plain text,
// so the user can upload a CV file instead of pasting text.

const mammoth = require("mammoth");
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

const MAX_BYTES = 8 * 1024 * 1024; // 8MB safety cap

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
    const isPdf =
      (mimeType && mimeType.includes("pdf")) || lowerName.endsWith(".pdf");
    const isDocx =
      (mimeType &&
        mimeType.includes("officedocument.wordprocessingml.document")) ||
      lowerName.endsWith(".docx");

    let text = "";

    if (isPdf) {
      const parsed = await pdfParse(buffer);
      text = parsed.text || "";
    } else if (isDocx) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else {
      res.status(400).json({
        error: "Unsupported file type. Please upload a PDF or Word (.docx) file.",
      });
      return;
    }

    text = text.trim();

    if (!text) {
      res.status(422).json({
        error:
          "Couldn't extract any text from that file. It may be a scanned image rather than a text-based document - try pasting the CV text directly instead.",
      });
      return;
    }

    res.status(200).json({ text });
  } catch (err) {
    console.error("Error extracting CV text:", err);
    res.status(500).json({
      error: "Failed to read that file. Please try a different file, or paste the CV text directly.",
    });
  }
};
