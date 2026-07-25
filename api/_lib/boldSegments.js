// /api/_lib/boldSegments.js
// Parses **bold** markdown-style markers out of a plain string into an array
// of { text, bold } segments, so recruiter-relevant keywords the AI marks
// can be rendered as real bold text in DOCX/PDF/HTML output.

function parseBoldSegments(text) {
  if (!text) return [{ text: "", bold: false }];
  const segments = [];
  const regex = /\*\*([\s\S]*?)\*\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }
  return segments.length > 0 ? segments : [{ text, bold: false }];
}

module.exports = { parseBoldSegments, parseLinkSegments };

// Parses [Label](url) markdown-style links out of a string into an array of
// { text, url? } segments, so links whose visible text differs from their URL
// (e.g. "LinkedIn" in the contact line, or a certification's verify link) can
// be rendered as real clickable text in DOCX/PDF/HTML output.
function parseLinkSegments(text) {
  if (!text) return [{ text: "" }];
  const segments = [];
  const regex = /\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }
    segments.push({ text: match[1], url: match[2] });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ text }];
}
