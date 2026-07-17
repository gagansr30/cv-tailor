// CV Tailor frontend logic — auth + tailoring + downloads + subscription paywall

const cvInput = document.getElementById("cv-input");
const jdInput = document.getElementById("jd-input");
const tailorBtn = document.getElementById("tailor-btn");
const statusMsg = document.getElementById("status-msg");
const resultSection = document.getElementById("result-section");
const resultOutput = document.getElementById("result-output");
const analysisSection = document.getElementById("analysis-section");
const changesList = document.getElementById("changes-list");
const missingSkillsList = document.getElementById("missing-skills-list");
const noMissingSkillsMsg = document.getElementById("no-missing-skills-msg");
const downloadDocxBtn = document.getElementById("download-docx-btn");
const downloadPdfBtn = document.getElementById("download-pdf-btn");
const cvFileInput = document.getElementById("cv-file-input");
const uploadStatus = document.getElementById("upload-status");
const addSkillsBtn = document.getElementById("add-skills-btn");
const skillsReviewSection = document.getElementById("skills-review-section");
const currentSkillsList = document.getElementById("current-skills-list");
const removeSkillsBtn = document.getElementById("remove-skills-btn");

const authSection = document.getElementById("auth-section");
const appSection = document.getElementById("app-section");
const accountBox = document.getElementById("account-box");
const accountEmail = document.getElementById("account-email");
const accountStatus = document.getElementById("account-status");
const logoutBtn = document.getElementById("logout-btn");

const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const authForm = document.getElementById("auth-form");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authMsg = document.getElementById("auth-msg");

const paywallBanner = document.getElementById("paywall-banner");
const paywallText = document.getElementById("paywall-text");
const subscribeBtn = document.getElementById("subscribe-btn");

let currentTailoredCv = null;
let supabaseClient = null;
let authMode = "login"; // "login" | "signup"
let currentUserStatus = null; // { usageCount, freeLimit, isSubscribed, ... }

// --- bootstrap: fetch public config, init Supabase client -------------------

async function init() {
  const configResponse = await fetch("/api/config");
  const config = await configResponse.json();

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:sans-serif;">This site is not configured yet (missing Supabase settings). Contact the site owner.</p>';
    return;
  }

  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  // Handle Stripe checkout redirect back to us.
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "success") {
    setStatus("Subscription active — thanks! Refreshing your account...");
    window.history.replaceState({}, "", window.location.pathname);
  } else if (params.get("checkout") === "cancelled") {
    window.history.replaceState({}, "", window.location.pathname);
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  const { data } = await supabaseClient.auth.getSession();
  handleSession(data.session);
}

async function handleSession(session) {
  if (session && session.user) {
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    accountBox.classList.remove("hidden");
    accountEmail.textContent = session.user.email;
    await refreshUserStatus();
  } else {
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    accountBox.classList.add("hidden");
  }
}

async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session ? data.session.access_token : null;
}

async function authedFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...options, headers });
}

// --- account status / paywall -----------------------------------------------

async function refreshUserStatus() {
  try {
    const response = await authedFetch("/api/user-status");
    const data = await response.json();
    if (!response.ok) return;

    currentUserStatus = data;
    accountStatus.textContent = data.isSubscribed
      ? `${data.remaining}/${data.monthlyLimit} this month`
      : `${data.remainingFree}/${data.freeLimit} free left`;

    const shouldShowPaywall = data.remaining <= 0;
    paywallBanner.classList.toggle("hidden", !shouldShowPaywall);
    tailorBtn.disabled = shouldShowPaywall;

    if (shouldShowPaywall) {
      if (data.isSubscribed) {
        paywallText.textContent = `You've used all ${data.monthlyLimit} tailored CVs for this month. Your limit resets on the 1st.`;
        subscribeBtn.classList.add("hidden");
      } else {
        paywallText.textContent = "You've used all your free tailored CVs. Subscribe for more.";
        subscribeBtn.classList.remove("hidden");
      }
    }
  } catch (err) {
    console.error("Failed to load account status:", err);
  }
}

async function startCheckout() {
  const btn = subscribeBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Redirecting...";
  try {
    const response = await authedFetch("/api/create-checkout-session", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.url) {
      setStatus(data.error || "Could not start checkout.", true);
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    setStatus("Network error starting checkout.", true);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

subscribeBtn.addEventListener("click", startCheckout);

// --- auth: login / signup / logout ------------------------------------------

function setAuthMode(mode) {
  authMode = mode;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  authSubmitBtn.textContent = mode === "login" ? "Log in" : "Sign up";
  authMsg.textContent = "";
}

tabLogin.addEventListener("click", () => setAuthMode("login"));
tabSignup.addEventListener("click", () => setAuthMode("signup"));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;

  authSubmitBtn.disabled = true;
  authMsg.textContent = "";
  authMsg.classList.remove("error");

  try {
    if (authMode === "signup") {
      const { error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      authMsg.textContent = "Account created! If email confirmation is required, check your inbox, then log in.";
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authMsg.textContent = err.message || "Something went wrong.";
    authMsg.classList.add("error");
  } finally {
    authSubmitBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
});

// --- rendering ---------------------------------------------------------------

function renderAnalysis(changes, missingSkills) {
  const hasChanges = Array.isArray(changes) && changes.length > 0;
  const hasMissingSkills = Array.isArray(missingSkills) && missingSkills.length > 0;

  if (!hasChanges && !hasMissingSkills) {
    analysisSection.classList.add("hidden");
    return;
  }

  analysisSection.classList.remove("hidden");

  changesList.innerHTML = "";
  if (hasChanges) {
    changes.forEach((c) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(c.summary || "")}</strong><span class="change-reason">${escapeHtml(c.reason || "")}</span>`;
      changesList.appendChild(li);
    });
  }

  missingSkillsList.innerHTML = "";
  if (hasMissingSkills) {
    noMissingSkillsMsg.classList.add("hidden");
    missingSkillsList.classList.remove("hidden");
    addSkillsBtn.classList.remove("hidden");
    missingSkills.forEach((skill) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "skill-checkbox-label";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = skill;
      checkbox.className = "missing-skill-checkbox";
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + skill));
      li.appendChild(label);
      missingSkillsList.appendChild(li);
    });
  } else {
    missingSkillsList.classList.add("hidden");
    addSkillsBtn.classList.add("hidden");
    noMissingSkillsMsg.classList.remove("hidden");
  }
}

function renderTailoredCv(cv) {
  const parts = [];

  if (cv.name) parts.push(`<div class="cv-name">${escapeHtml(cv.name)}</div>`);
  if (cv.contact) parts.push(`<div class="cv-contact">${escapeHtml(cv.contact)}</div>`);

  if (cv.summary) {
    parts.push(`<h3>Professional Summary</h3><p>${renderBoldText(cv.summary)}</p>`);
  }

  if (cv.experience && cv.experience.length > 0) {
    parts.push("<h3>Work Experience</h3>");
    cv.experience.forEach((job) => {
      const titleLine = [job.title, job.company].filter(Boolean).join("  |  ");
      parts.push(`<p><strong>${escapeHtml(titleLine)}</strong>`);
      if (job.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(job.dates)}</span>`);
      parts.push("</p>");
      if (job.bullets && job.bullets.length > 0) {
        parts.push("<ul>");
        job.bullets.forEach((b) => parts.push(`<li>${renderBoldText(b)}</li>`));
        parts.push("</ul>");
      }
    });
  }

  if (cv.projects && cv.projects.length > 0) {
    parts.push("<h3>Projects</h3>");
    cv.projects.forEach((proj) => {
      const titleLine = [proj.title, proj.company].filter(Boolean).join("  |  ");
      parts.push(`<p><strong>${escapeHtml(titleLine)}</strong>`);
      if (proj.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(proj.dates)}</span>`);
      parts.push("</p>");
      if (proj.bullets && proj.bullets.length > 0) {
        parts.push("<ul>");
        proj.bullets.forEach((b) => parts.push(`<li>${renderBoldText(b)}</li>`));
        if (proj.link) {
          parts.push(
            `<li>Live demo: <a href="${escapeHtml(proj.link)}" target="_blank" rel="noopener">${escapeHtml(proj.link)}</a></li>`
          );
        }
        parts.push("</ul>");
      }
    });
  }

  if (cv.education && cv.education.length > 0) {
    parts.push("<h3>Education</h3>");
    cv.education.forEach((edu) => {
      const line = [edu.degree, edu.institution].filter(Boolean).join("  |  ");
      parts.push(`<p><strong>${escapeHtml(line)}</strong>`);
      if (edu.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(edu.dates)}</span>`);
      parts.push("</p>");
    });
  }

  if (cv.skills && cv.skills.length > 0) {
    parts.push("<h3>Skills</h3>");
    parts.push(`<p>${escapeHtml(cv.skills.join("  •  "))}</p>`);
  }

  if (cv.certifications && cv.certifications.length > 0) {
    parts.push("<h3>Certifications</h3><ul>");
    cv.certifications.forEach((cert) => parts.push(`<li>${escapeHtml(cert)}</li>`));
    parts.push("</ul>");
  }

  if (cv.interests) {
    parts.push("<h3>Interests</h3>");
    parts.push(`<p>${escapeHtml(cv.interests)}</p>`);
  }

  resultOutput.innerHTML = parts.join("\n");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Mirrors api/_lib/boldSegments.js - parses **bold** markers so the browser
// preview shows the same recruiter-facing emphasis as the DOCX/PDF downloads.
function renderBoldText(text) {
  if (!text) return "";
  const segments = [];
  const regex = /\*\*([\s\S]*?)\*\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  if (segments.length === 0) segments.push({ text, bold: false });

  return segments
    .map((seg) => (seg.bold ? `<strong class="hl-term">${escapeHtml(seg.text)}</strong>` : escapeHtml(seg.text)))
    .join("");
}

function setStatus(message, isError) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", Boolean(isError));
}

function renderSkillsReview() {
  if (!currentTailoredCv || !currentTailoredCv.skills || currentTailoredCv.skills.length === 0) {
    skillsReviewSection.classList.add("hidden");
    return;
  }
  skillsReviewSection.classList.remove("hidden");
  currentSkillsList.innerHTML = "";
  currentTailoredCv.skills.forEach((skill) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "skill-checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = skill;
    checkbox.className = "current-skill-checkbox";
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(" " + skill));
    li.appendChild(label);
    currentSkillsList.appendChild(li);
  });
}

addSkillsBtn.addEventListener("click", () => {
  const checked = Array.from(document.querySelectorAll(".missing-skill-checkbox:checked")).map((c) => c.value);
  if (checked.length === 0) {
    setStatus("Select at least one skill to add first.", true);
    return;
  }
  if (!currentTailoredCv.skills) currentTailoredCv.skills = [];
  checked.forEach((skill) => {
    if (!currentTailoredCv.skills.includes(skill)) currentTailoredCv.skills.push(skill);
  });

  // Remove added skills from the missing-skills list so they can't be re-added.
  const remainingMissing = Array.from(missingSkillsList.querySelectorAll("li"))
    .filter((li) => !checked.includes(li.querySelector("input").value));
  missingSkillsList.innerHTML = "";
  remainingMissing.forEach((li) => missingSkillsList.appendChild(li));
  if (remainingMissing.length === 0) {
    missingSkillsList.classList.add("hidden");
    addSkillsBtn.classList.add("hidden");
    noMissingSkillsMsg.classList.remove("hidden");
    noMissingSkillsMsg.textContent = "All suggested skills added.";
  }

  renderTailoredCv(currentTailoredCv);
  renderSkillsReview();
  setStatus(`Added ${checked.length} skill(s) to your CV.`);
});

removeSkillsBtn.addEventListener("click", () => {
  const checked = Array.from(document.querySelectorAll(".current-skill-checkbox:checked")).map((c) => c.value);
  if (checked.length === 0) {
    setStatus("Select at least one skill to remove first.", true);
    return;
  }
  const confirmed = window.confirm(
    `Remove ${checked.length} skill(s) from your CV?\n\n${checked.join(", ")}`
  );
  if (!confirmed) return;

  currentTailoredCv.skills = currentTailoredCv.skills.filter((s) => !checked.includes(s));
  renderTailoredCv(currentTailoredCv);
  renderSkillsReview();
  setStatus(`Removed ${checked.length} skill(s) from your CV.`);
});

// --- CV file upload ------------------------------------------------------

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

cvFileInput.addEventListener("change", async () => {
  const file = cvFileInput.files[0];
  if (!file) return;

  uploadStatus.textContent = "Reading file…";
  uploadStatus.classList.remove("error");

  try {
    const base64Data = await readFileAsBase64(file);
    const response = await authedFetch("/api/extract-cv-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, base64Data }),
    });
    const data = await response.json();

    if (!response.ok) {
      uploadStatus.textContent = data.error || "Could not read that file.";
      uploadStatus.classList.add("error");
      return;
    }

    cvInput.value = data.text;
    uploadStatus.textContent = `Loaded "${file.name}"`;
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Failed to read that file. Please try again or paste your CV text directly.";
    uploadStatus.classList.add("error");
  } finally {
    cvFileInput.value = ""; // allow re-uploading the same file name later
  }
});

// --- main tailor action -----------------------------------------------------

tailorBtn.addEventListener("click", async () => {
  const cv = cvInput.value.trim();
  const jobDescription = jdInput.value.trim();

  if (!cv || !jobDescription) {
    setStatus("Please paste both your CV and the job description.", true);
    return;
  }

  tailorBtn.disabled = true;
  setStatus("Tailoring your CV… this can take up to 20 seconds.");
  resultSection.classList.add("hidden");

  try {
    const response = await authedFetch("/api/tailor-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cv, jobDescription }),
    });

    const data = await response.json();

    if (!response.ok) {
      setStatus(data.error || "Something went wrong. Please try again.", true);
      if (data.requiresSubscription || data.monthlyLimitReached) {
        await refreshUserStatus();
      }
      return;
    }

    currentTailoredCv = data.tailoredCv;
    renderTailoredCv(currentTailoredCv);
    renderAnalysis(data.changes, data.missingSkills);
    renderSkillsReview();
    resultSection.classList.remove("hidden");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Done! Review the tailored CV below.");
    await refreshUserStatus();
  } catch (err) {
    console.error(err);
    setStatus("Network error. Please check your connection and try again.", true);
  } finally {
    if (!currentUserStatus || currentUserStatus.isSubscribed || currentUserStatus.remainingFree > 0) {
      tailorBtn.disabled = false;
    }
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
    const response = await authedFetch(endpoint, {
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

init();
