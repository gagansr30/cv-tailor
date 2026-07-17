// /api/generate-docx.js
// Accepts the tailored CV as structured JSON and returns a formatted .docx file.

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
} = require("docx");

const FONT = "Calibri";
const ACCENT_COLOR = "1F3864"; // dark navy blue

function sectionHeading(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    border: {
      bottom: {
        color: ACCENT_COLOR,
        space: 2,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    },
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function buildDocument(cv) {
  const children = [];

  // Name
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: cv.name || "Your Name",
          bold: true,
          size: 44, // 22pt
          color: ACCENT_COLOR,
          font: FONT,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    })
  );

  // Contact
  if (cv.contact) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: cv.contact,
            size: 20, // 10pt
            font: FONT,
            color: "444444",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );
  }

  // Professional Summary
  if (cv.summary) {
    children.push(sectionHeading("Professional Summary"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.summary, font: FONT, size: 22 })],
        spacing: { after: 160 },
      })
    );
  }

  // Work Experience
  if (cv.experience && cv.experience.length > 0) {
    children.push(sectionHeading("Work Experience"));
    cv.experience.forEach((job) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: job.title || "",
              bold: true,
              size: 22,
              font: FONT,
            }),
            new TextRun({
              text: job.company ? `  |  ${job.company}` : "",
              italics: true,
              size: 22,
              font: FONT,
            }),
          ],
          spacing: { before: 120, after: 20 },
        })
      );
      if (job.dates) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: job.dates,
                size: 20,
                color: "666666",
                font: FONT,
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }
      (job.bullets || []).forEach((bullet) => {
        children.push(bulletParagraph(bullet));
      });
    });
  }

  // Projects
  if (cv.projects && cv.projects.length > 0) {
    children.push(sectionHeading("Projects"));
    cv.projects.forEach((proj) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: proj.title || "",
              bold: true,
              size: 22,
              font: FONT,
            }),
            new TextRun({
              text: proj.company ? `  |  ${proj.company}` : "",
              italics: true,
              size: 22,
              font: FONT,
            }),
          ],
          spacing: { before: 120, after: 20 },
        })
      );
      if (proj.dates) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: proj.dates,
                size: 20,
                color: "666666",
                font: FONT,
              }),
            ],
            spacing: { after: 60 },
          })
        );
      }
      (proj.bullets || []).forEach((bullet) => {
        children.push(bulletParagraph(bullet));
      });
      if (proj.link) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Live demo: ", font: FONT, size: 22 }),
              new ExternalHyperlink({
                link: proj.link,
                children: [
                  new TextRun({ text: proj.link, font: FONT, size: 22, style: "Hyperlink" }),
                ],
              }),
            ],
            bullet: { level: 0 },
            spacing: { after: 80 },
          })
        );
      }
    });
  }

  // Education
  if (cv.education && cv.education.length > 0) {
    children.push(sectionHeading("Education"));
    cv.education.forEach((edu) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: edu.degree || "",
              bold: true,
              size: 22,
              font: FONT,
            }),
            new TextRun({
              text: edu.institution ? `  |  ${edu.institution}` : "",
              italics: true,
              size: 22,
              font: FONT,
            }),
          ],
          spacing: { before: 100, after: 20 },
        })
      );
      if (edu.dates) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: edu.dates,
                size: 20,
                color: "666666",
                font: FONT,
              }),
            ],
            spacing: { after: 100 },
          })
        );
      }
    });
  }

  // Skills
  if (cv.skills && cv.skills.length > 0) {
    children.push(sectionHeading("Skills"));
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: cv.skills.join("  •  "),
            size: 22,
            font: FONT,
          }),
        ],
        spacing: { after: 100 },
      })
    );
  }

  // Certifications
  if (cv.certifications && cv.certifications.length > 0) {
    children.push(sectionHeading("Certifications"));
    cv.certifications.forEach((cert) => {
      children.push(bulletParagraph(cert));
    });
  }

  // Interests
  if (cv.interests) {
    children.push(sectionHeading("Interests"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.interests, size: 22, font: FONT })],
        spacing: { after: 100 },
      })
    );
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 }, // 0.5in margins
          },
        },
        children,
      },
    ],
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
        },
      },
    },
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
