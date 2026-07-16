// CV Tailor frontend logic

const cvInput = document.getElementById("cv-input");
const jdInput = document.getElementById("jd-input");
const tailorBtn = document.getElementById("tailor-btn");
const statusMsg = document.getElementById("status-msg");
const resultSection = document.getElementById("result-section");
const resultOutput = document.getElementById("result-output");
const downloadDocxBtn = document.getElementById("download-docx-btn");
const downloadPdfBtn = document.getElementById("download-pdf-btn");

let currentTailoredCv = null;

// --- simple client-side usage protection ---------------------------------
// Basic speed bump + daily cap until real payments/rate limiting are added.
const COOLDOWN_MS = 15 * 1000;
const DAILY_LIMIT = 8;
const STORAGE_KEY = "cvTailorUsage";

function getUsage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayString(), count: 0 };
    const parsed = JSON.parse(raw);
    if (parsed.date !== todayString()) return { date: todayString(), count: 0 };
    return parsed;
  } catch {
    return { date: todayString(), count: 0 };
  }
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function recordUsage() {
  const usage = getUsage();
  usage.count += 1;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
}

function startCooldown(ms) {
  tailorBtn.disabled = true;
  let remaining = Math.ceil(ms / 1000);
  const originalText = "Tailor CV";
  tailorBtn.textContent = `Please wait (${remaining}s)`;
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(interval);
      tailorBtn.disabled = false;
      tailorBtn.textContent = originalText;
    } else {
      tailorBtn.textContent = `Please wait (${remaining}s)`;
    }
  }, 1000);
}

// --- rendering -------------------------------------------------------------

function renderTailoredCv(cv) {
  const parts = [];

  if (cv.name) parts.push(`<div class="cv-name">${escapeHtml(cv.name)}</div>`);
  if (cv.contact) parts.push(`<div class="cv-contact">${escapeHtml(cv.contact)}</div>`);

  if (cv.summary) {
    parts.push(`<h3>Professional Summary</h3><p>${escapeHtml(cv.summary)}</p>`);
  }

  if (cv.experience && cv.experience.length > 0) {
    parts.push("<h3>Work Experience</h3>");
    cv.experience.forEach((job) => {
      const titleLine = [job.title, job.company].filter(Boolean).join(" &nbsp;|&nbsp; ");
      parts.push(`<p><strong>${escapeHtml(titleLine)}</strong>`);
      if (job.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(job.dates)}</span>`);
      parts.push("</p>");
      if (job.bullets && job.bullets.length > 0) {
        parts.push("<ul>");
        job.bullets.forEach((b) => parts.push(`<li>${escapeHtml(b)}</li>`));
        parts.push("</ul>");
      }
    });
  }

  if (cv.education && cv.education.length > 0) {
    parts.push("<h3>Education</h3>");
    cv.education.forEach((edu) => {
      const line = [edu.degree, edu.institution].filter(Boolean).join(" &nbsp;|&nbsp; ");
      parts.push(`<p><strong>${escapeHtml(line)}</strong>`);
      if (edu.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(edu.dates)}</span>`);
      parts.push("</p>");
    });
  }

  if (cv.skills && cv.skills.length > 0) {
    parts.push("<h3>Skills</h3>");
    parts.push(`<p>${escapeHtml(cv.skills.join("  •  "))}</p>`);
  }

  resultOutput.innerHTML = parts.join("\n");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function setStatus(message, isError) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", Boolean(isError));
}

// --- main tailor action -----------------------------------------------------

tailorBtn.addEventListener("click", async () => {
  const cv = cvInput.value.trim();
  const jobDescription = jdInput.value.trim();

  if (!cv || !jobDescription) {
    setStatus("Please paste both your CV and the job description.", true);
    return;
  }

  const usage = getUsage();
  if (usage.count >= DAILY_LIMIT) {
    setStatus(
      `You've reached today's limit of ${DAILY_LIMIT} tailored CVs. Please try again tomorrow.`,
      true
    );
    return;
  }

  tailorBtn.disabled = true;
  setStatus("Tailoring your CV… this can take up to 20 seconds.");
  resultSection.classList.add("hidden");

  try {
    const response = await fetch("/api/tailor-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cv, jobDescription }),
    });

    const data = await response.json();

    if (!response.ok) {
      setStatus(data.error || "Something went wrong. Please try again.", true);
      startCooldown(COOLDOWN_MS);
      return;
    }

    currentTailoredCv = data.tailoredCv;
    renderTailoredCv(currentTailoredCv);
    resultSection.classList.remove("hidden");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Done! Review the tailored CV below.");
    recordUsage();
  } catch (err) {
    console.error(err);
    setStatus("Network error. Please check your connection and try again.", true);
  } finally {
    startCooldown(COOLDOWN_MS);
  }
});

// --- downloads ---------------------------------------------------------------

async function downloadFile(endpoint, mimeExt) {
  if (!currentTailoredCv) return;

  const btn = mimeExt === "docx" ? downloadDocxBtn : downloadPdfBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing…";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tailoredCv: currentTailoredCv }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setStatus(err.error || `Failed to generate ${mimeExt.toUpperCase()}.`, true);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (currentTailoredCv.name || "tailored-cv").replace(/[^a-z0-9]+/gi, "-");
    a.href = url;
    a.download = `${safeName}.${mimeExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    setStatus(`Network error while generating ${mimeExt.toUpperCase()}.`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

downloadDocxBtn.addEventListener("click", () => downloadFile("/api/generate-docx", "docx"));
downloadPdfBtn.addEventListener("click", () => downloadFile("/api/generate-pdf", "pdf"));
