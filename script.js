// CV Tailor frontend logic
// Flow: auth -> (one-time) profile setup: upload/paste CV -> AI reads it into
// an editable profile -> user reviews/edits/reorders -> saved as base CV ->
// tailor against any job description using the saved base CV, with a
// recommended section order the user can still rearrange before downloading.

// --- element refs -----------------------------------------------------------

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

const profileSetupSection = document.getElementById("profile-setup-section");
const setupCvInput = document.getElementById("setup-cv-input");
const cvFileInput = document.getElementById("cv-file-input");
const uploadStatus = document.getElementById("upload-status");
const parseCvBtn = document.getElementById("parse-cv-btn");
const setupStatusMsg = document.getElementById("setup-status-msg");

const profileEditorSection = document.getElementById("profile-editor-section");
const profileEditorTitle = document.getElementById("profile-editor-title");
const profileEditor = document.getElementById("profile-editor");
const saveProfileBtn = document.getElementById("save-profile-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const editorStatusMsg = document.getElementById("editor-status-msg");

const tailorSection = document.getElementById("tailor-section");
const baseCvName = document.getElementById("base-cv-name");
const baseCvUpdated = document.getElementById("base-cv-updated");
const editProfileBtn = document.getElementById("edit-profile-btn");
const resetProfileBtn = document.getElementById("reset-profile-btn");
const jdInput = document.getElementById("jd-input");
const tailorBtn = document.getElementById("tailor-btn");
const statusMsg = document.getElementById("status-msg");

const resultSection = document.getElementById("result-section");
const resultOutput = document.getElementById("result-output");
const analysisSection = document.getElementById("analysis-section");
const changesList = document.getElementById("changes-list");
const missingSkillsList = document.getElementById("missing-skills-list");
const noMissingSkillsMsg = document.getElementById("no-missing-skills-msg");
const addSkillsBtn = document.getElementById("add-skills-btn");
const skillsReviewSection = document.getElementById("skills-review-section");
const currentSkillsList = document.getElementById("current-skills-list");
const removeSkillsBtn = document.getElementById("remove-skills-btn");
const orderNote = document.getElementById("order-note");
const orderReason = document.getElementById("order-reason");
const downloadDocxBtn = document.getElementById("download-docx-btn");
const downloadPdfBtn = document.getElementById("download-pdf-btn");
const matchScorePanel = document.getElementById("match-score");
const scoreBeforeEl = document.getElementById("score-before");
const scoreAfterEl = document.getElementById("score-after");
const atsBreakdownEl = document.getElementById("ats-breakdown");
const atsMatchedCountEl = document.getElementById("ats-matched-count");
const atsMissingCountEl = document.getElementById("ats-missing-count");
const atsMatchedListEl = document.getElementById("ats-matched-list");
const atsMissingListEl = document.getElementById("ats-missing-list");
const atsSelectAllBtn = document.getElementById("ats-select-all-btn");
const atsAddKeywordsBtn = document.getElementById("ats-add-keywords-btn");

// Missing keywords the user has clicked to select for adding to skills.
// Persists across live re-scores so selections survive other edits; cleared
// when a new tailoring run replaces the keyword set.
const selectedAtsKeywords = new Set();

// --- state ------------------------------------------------------------------

let supabaseClient = null;
let authMode = "login";
let currentUserStatus = null;

let baseCv = null; // the saved profile (source of truth for tailoring)
let baseCvUpdatedAt = null;
let profileDraft = null; // working copy while editing
let currentTailoredCv = null;
let currentIrrelevantSkills = [];

const SECTION_KEYS = ["summary", "experience", "projects", "education", "skills", "certifications", "interests"];
const SECTION_LABELS = {
  summary: "Professional Summary",
  experience: "Work Experience",
  projects: "Projects",
  education: "Education",
  skills: "Skills",
  certifications: "Certifications",
  interests: "Interests",
};

function normalizeSectionOrder(order) {
  const seen = new Set();
  const result = [];
  (Array.isArray(order) ? order : []).forEach((key) => {
    if (SECTION_KEYS.includes(key) && !seen.has(key)) {
      seen.add(key);
      result.push(key);
    }
  });
  SECTION_KEYS.forEach((key) => {
    if (!seen.has(key)) result.push(key);
  });
  return result;
}

function emptyCv() {
  return {
    name: "",
    contact: "",
    summary: "",
    sectionOrder: SECTION_KEYS.slice(),
    experience: [],
    projects: [],
    education: [],
    skills: [],
    certifications: [],
    interests: "",
  };
}

// Deep-copies and shape-normalizes a CV object into a safe editable draft.
function toDraft(cv) {
  const src = cv && typeof cv === "object" ? cv : {};
  const draft = emptyCv();
  draft.name = String(src.name || "");
  draft.contact = String(src.contact || "");
  draft.summary = String(src.summary || "");
  draft.interests = String(src.interests || "");
  draft.sectionOrder = normalizeSectionOrder(src.sectionOrder);
  draft.skills = Array.isArray(src.skills) ? src.skills.map(String) : [];
  draft.certifications = Array.isArray(src.certifications) ? src.certifications.map(String) : [];
  const role = (e) => ({
    title: String((e && e.title) || ""),
    company: String((e && e.company) || ""),
    dates: String((e && e.dates) || ""),
    link: String((e && e.link) || ""),
    bullets: Array.isArray(e && e.bullets) ? e.bullets.map(String) : [],
  });
  draft.experience = Array.isArray(src.experience) ? src.experience.map(role) : [];
  draft.projects = Array.isArray(src.projects) ? src.projects.map(role) : [];
  draft.education = Array.isArray(src.education)
    ? src.education.map((e) => ({
        degree: String((e && e.degree) || ""),
        institution: String((e && e.institution) || ""),
        dates: String((e && e.dates) || ""),
      }))
    : [];
  return draft;
}

// --- bootstrap: fetch public config, init Supabase client -------------------

async function init() {
  let config;
  try {
    const configResponse = await fetch("/api/config");
    config = await configResponse.json();
  } catch (err) {
    console.error("Failed to load /api/config:", err);
    document.body.innerHTML =
      '<p style="padding:40px;font-family:sans-serif;">Could not reach the server. Please check your connection and reload the page.</p>';
    return;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    document.body.innerHTML =
      '<p style="padding:40px;font-family:sans-serif;">This site is not configured yet (missing Supabase settings). Contact the site owner.</p>';
    return;
  }

  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const params = new URLSearchParams(window.location.search);
  if (params.get("checkout") === "success") {
    setStatus("Subscription active, thanks! Refreshing your account...");
    window.history.replaceState({}, "", window.location.pathname);
  } else if (params.get("checkout") === "cancelled") {
    window.history.replaceState({}, "", window.location.pathname);
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  try {
    const { data } = await supabaseClient.auth.getSession();
    handleSession(data.session);
  } catch (err) {
    console.error("Failed to load session:", err);
    setStatus("Could not restore your session. Please log in again.", true);
  }
}

let lastSessionUserId = null;

async function handleSession(session) {
  if (session && session.user) {
    authSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    accountBox.classList.remove("hidden");
    accountEmail.textContent = session.user.email;

    // Only reload profile data when the signed-in user actually changes
    // (onAuthStateChange also fires on token refreshes).
    if (lastSessionUserId !== session.user.id) {
      lastSessionUserId = session.user.id;
      await refreshUserStatus();
      await loadBaseCv();
      routeToStartView();
    }
  } else {
    lastSessionUserId = null;
    baseCv = null;
    baseCvUpdatedAt = null;
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

// --- view switching ---------------------------------------------------------

function showView(view) {
  profileSetupSection.classList.toggle("hidden", view !== "setup");
  profileEditorSection.classList.toggle("hidden", view !== "editor");
  tailorSection.classList.toggle("hidden", view !== "tailor");
  if (view !== "tailor") resultSection.classList.add("hidden");
}

function routeToStartView() {
  if (baseCv) {
    renderBaseCvCard();
    showView("tailor");
  } else {
    showView("setup");
  }
}

function renderBaseCvCard() {
  baseCvName.textContent = (baseCv && baseCv.name) || "Unnamed profile";
  if (baseCvUpdatedAt) {
    const date = new Date(baseCvUpdatedAt);
    baseCvUpdated.textContent = isNaN(date.getTime()) ? "" : `Updated ${date.toLocaleDateString()}`;
  } else {
    baseCvUpdated.textContent = "";
  }
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

// --- base CV: load / save / clear ------------------------------------------

async function loadBaseCv() {
  try {
    const response = await authedFetch("/api/base-cv");
    const data = await response.json();
    if (!response.ok) {
      console.error("Failed to load base CV:", data.error);
      return;
    }
    baseCv = data.baseCv || null;
    baseCvUpdatedAt = data.updatedAt || null;
  } catch (err) {
    console.error("Failed to load base CV:", err);
  }
}

async function saveProfileDraft() {
  if (!profileDraft) return;

  saveProfileBtn.disabled = true;
  setEditorStatus("Saving your profile…");

  try {
    const response = await authedFetch("/api/base-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCv: profileDraft }),
    });
    const data = await response.json();

    if (!response.ok) {
      setEditorStatus(data.error || "Could not save your profile.", true);
      return;
    }

    baseCv = data.baseCv;
    baseCvUpdatedAt = data.updatedAt;
    setEditorStatus("");
    renderBaseCvCard();
    showView("tailor");
    setStatus("Profile saved. Paste a job description and tailor away.");
  } catch (err) {
    console.error(err);
    setEditorStatus("Network error saving your profile. Please try again.", true);
  } finally {
    saveProfileBtn.disabled = false;
  }
}

saveProfileBtn.addEventListener("click", saveProfileDraft);

cancelEditBtn.addEventListener("click", () => {
  profileDraft = null;
  setEditorStatus("");
  routeToStartView();
});

editProfileBtn.addEventListener("click", () => {
  profileDraft = toDraft(baseCv);
  profileEditorTitle.textContent = "Edit your profile";
  cancelEditBtn.classList.remove("hidden");
  renderProfileEditor();
  showView("editor");
  window.scrollTo({ top: 0, behavior: "smooth" });
});

resetProfileBtn.addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Start over? This deletes your saved base CV so you can upload/paste a fresh one. Your account and usage are unaffected."
  );
  if (!confirmed) return;
  try {
    const response = await authedFetch("/api/base-cv", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setStatus(data.error || "Could not clear your profile.", true);
      return;
    }
    baseCv = null;
    baseCvUpdatedAt = null;
    setupCvInput.value = "";
    showView("setup");
  } catch (err) {
    console.error(err);
    setStatus("Network error clearing your profile.", true);
  }
});

// --- CV file upload (setup step) --------------------------------------------

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

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // matches the server's cap in api/extract-cv-text.js

cvFileInput.addEventListener("change", async () => {
  const file = cvFileInput.files[0];
  if (!file) return;

  if (file.size > MAX_UPLOAD_BYTES) {
    uploadStatus.textContent = "That file is too large (8MB limit). Please upload a smaller file or paste the CV text directly.";
    uploadStatus.classList.add("error");
    cvFileInput.value = "";
    return;
  }

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

    setupCvInput.value = data.text;
    uploadStatus.textContent = `Loaded "${file.name}". Now click "Read My CV & Fill Profile".`;
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Failed to read that file. Please try again or paste your CV text directly.";
    uploadStatus.classList.add("error");
  } finally {
    cvFileInput.value = "";
  }
});

// --- parse CV into profile draft --------------------------------------------

parseCvBtn.addEventListener("click", async () => {
  const cvText = setupCvInput.value.trim();
  if (!cvText) {
    setSetupStatus("Upload or paste your CV first.", true);
    return;
  }

  parseCvBtn.disabled = true;
  setSetupStatus("Reading your CV and filling your profile… this can take up to 20 seconds.");

  try {
    const response = await authedFetch("/api/parse-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cvText }),
    });
    const data = await response.json();

    if (!response.ok) {
      setSetupStatus(data.error || "Could not read your CV. Please try again.", true);
      return;
    }

    profileDraft = toDraft(data.cv);
    profileEditorTitle.textContent = "Review your profile";
    cancelEditBtn.classList.toggle("hidden", !baseCv);
    setSetupStatus("");
    renderProfileEditor();
    showView("editor");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    console.error(err);
    setSetupStatus("Network error. Please check your connection and try again.", true);
  } finally {
    parseCvBtn.disabled = false;
  }
});

// --- profile editor ---------------------------------------------------------

// Tiny DOM builder to keep the editor code readable and injection-safe.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only for trusted static markup
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child) node.appendChild(child);
  });
  return node;
}

function moveItem(arr, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= arr.length) return false;
  const [item] = arr.splice(index, 1);
  arr.splice(target, 0, item);
  return true;
}

function labeledInput(labelText, value, onInput, placeholder = "") {
  const input = el("input", {
    type: "text",
    value: value || "",
    placeholder,
    oninput: (e) => onInput(e.target.value),
  });
  input.value = value || "";
  return el("div", { class: "editor-field" }, [el("label", { text: labelText }), input]);
}

function labeledTextarea(labelText, value, onInput, placeholder = "", hint = "") {
  const textarea = el("textarea", {
    placeholder,
    oninput: (e) => onInput(e.target.value),
  });
  textarea.value = value || "";
  const children = [el("label", { text: labelText })];
  if (hint) children.push(el("p", { class: "editor-hint", text: hint }));
  children.push(textarea);
  return el("div", { class: "editor-field" }, children);
}

function entryToolbar(list, index, onChanged, itemName) {
  return el("div", { class: "entry-toolbar" }, [
    el("button", {
      type: "button",
      class: "icon-btn",
      title: `Move ${itemName} up`,
      text: "↑",
      onclick: () => {
        if (moveItem(list, index, -1)) onChanged();
      },
    }),
    el("button", {
      type: "button",
      class: "icon-btn",
      title: `Move ${itemName} down`,
      text: "↓",
      onclick: () => {
        if (moveItem(list, index, 1)) onChanged();
      },
    }),
    el("button", {
      type: "button",
      class: "icon-btn icon-btn-danger",
      title: `Remove ${itemName}`,
      text: "✕",
      onclick: () => {
        if (window.confirm(`Remove this ${itemName}?`)) {
          list.splice(index, 1);
          onChanged();
        }
      },
    }),
  ]);
}

function renderProfileEditor() {
  if (!profileDraft) return;
  const draft = profileDraft;
  profileEditor.innerHTML = "";
  const rerender = () => renderProfileEditor();

  // Basics -------------------------------------------------------------------
  profileEditor.appendChild(
    el("div", { class: "editor-section" }, [
      el("h3", { text: "Basics" }),
      labeledInput("Full name", draft.name, (v) => (draft.name = v), "e.g. Gagan S R"),
      labeledInput(
        "Contact line",
        draft.contact,
        (v) => (draft.contact = v),
        "email | phone | location | [LinkedIn](linkedin.com/in/you) | [GitHub](github.com/you)"
      ),
      el("p", {
        class: "editor-hint",
        text:
          "Separate items with | pipes. To show a label instead of a raw URL, write [Label](url) - e.g. [LinkedIn](https://linkedin.com/in/you). Links are kept exactly as written here, so double-check them.",
      }),
    ])
  );

  // Section order ------------------------------------------------------------
  draft.sectionOrder = normalizeSectionOrder(draft.sectionOrder);
  const orderList = el("ul", { class: "order-list" });
  draft.sectionOrder.forEach((key, index) => {
    orderList.appendChild(
      el("li", { class: "order-item" }, [
        el("span", { class: "order-item-label", text: `${index + 1}. ${SECTION_LABELS[key]}` }),
        el("span", { class: "order-item-controls" }, [
          el("button", {
            type: "button",
            class: "icon-btn",
            title: "Move section up",
            text: "↑",
            onclick: () => {
              if (moveItem(draft.sectionOrder, index, -1)) rerender();
            },
          }),
          el("button", {
            type: "button",
            class: "icon-btn",
            title: "Move section down",
            text: "↓",
            onclick: () => {
              if (moveItem(draft.sectionOrder, index, 1)) rerender();
            },
          }),
        ]),
      ])
    );
  });
  profileEditor.appendChild(
    el("div", { class: "editor-section" }, [
      el("h3", { text: "Section Order" }),
      el("p", {
        class: "editor-hint",
        text: "The order sections appear on your CV. Sections you leave empty simply won't show up. When you tailor to a job, you'll also get a recommended order for that specific role.",
      }),
      orderList,
    ])
  );

  // Content sections, in current order --------------------------------------
  draft.sectionOrder.forEach((key) => {
    switch (key) {
      case "summary":
        profileEditor.appendChild(
          el("div", { class: "editor-section" }, [
            el("h3", { text: SECTION_LABELS.summary }),
            labeledTextarea(
              "Summary",
              draft.summary,
              (v) => (draft.summary = v),
              "A short professional summary…"
            ),
          ])
        );
        break;
      case "experience":
        profileEditor.appendChild(renderRoleListEditor("experience", "role", rerender));
        break;
      case "projects":
        profileEditor.appendChild(renderRoleListEditor("projects", "project", rerender));
        break;
      case "education":
        profileEditor.appendChild(renderEducationEditor(rerender));
        break;
      case "skills":
        profileEditor.appendChild(
          el("div", { class: "editor-section" }, [
            el("h3", { text: SECTION_LABELS.skills }),
            labeledTextarea(
              "Skills (one per line, or comma-separated)",
              draft.skills.join("\n"),
              (v) => {
                draft.skills = v
                  .split(/[\n,]/)
                  .map((s) => s.trim())
                  .filter(Boolean);
              },
              "Python\nMachine Learning\nRAG / LLM systems"
            ),
          ])
        );
        break;
      case "certifications":
        profileEditor.appendChild(renderCertificationsEditor(rerender));
        break;
      case "interests":
        profileEditor.appendChild(
          el("div", { class: "editor-section" }, [
            el("h3", { text: SECTION_LABELS.interests }),
            labeledInput("Interests (comma-separated)", draft.interests, (v) => (draft.interests = v), "Travel, Music, Chess"),
          ])
        );
        break;
    }
  });
}

function renderRoleListEditor(listKey, itemName, rerender) {
  const draft = profileDraft;
  const list = draft[listKey];
  const section = el("div", { class: "editor-section" }, [el("h3", { text: SECTION_LABELS[listKey] })]);

  list.forEach((entry, index) => {
    const card = el("div", { class: "entry-card" }, [
      el("div", { class: "entry-card-header" }, [
        el("span", { class: "entry-card-title", text: entry.title || entry.company || `${itemName} ${index + 1}` }),
        entryToolbar(list, index, rerender, itemName),
      ]),
      labeledInput(listKey === "projects" ? "Project name" : "Job title", entry.title, (v) => (entry.title = v)),
      labeledInput(
        listKey === "projects" ? "Context (e.g. Personal Project, university)" : "Company",
        entry.company,
        (v) => (entry.company = v)
      ),
      labeledInput("Dates", entry.dates, (v) => (entry.dates = v), "e.g. Jan 2025 - Present"),
      labeledInput("Link (optional)", entry.link, (v) => (entry.link = v), "https://…"),
      labeledTextarea(
        "Bullet points (one per line)",
        entry.bullets.join("\n"),
        (v) => {
          entry.bullets = v.split("\n").map((s) => s.replace(/^[\-\u2022•\*]+\s*/, "").trim()).filter(Boolean);
        },
        "Built X using Y, achieving Z…"
      ),
    ]);
    section.appendChild(card);
  });

  section.appendChild(
    el("button", {
      type: "button",
      class: "btn btn-secondary btn-small",
      text: `+ Add ${itemName}`,
      onclick: () => {
        list.push({ title: "", company: "", dates: "", link: "", bullets: [] });
        rerender();
      },
    })
  );

  return section;
}

function renderEducationEditor(rerender) {
  const draft = profileDraft;
  const list = draft.education;
  const section = el("div", { class: "editor-section" }, [el("h3", { text: SECTION_LABELS.education })]);

  list.forEach((entry, index) => {
    const card = el("div", { class: "entry-card" }, [
      el("div", { class: "entry-card-header" }, [
        el("span", { class: "entry-card-title", text: entry.degree || entry.institution || `Education ${index + 1}` }),
        entryToolbar(list, index, rerender, "education entry"),
      ]),
      labeledInput("Degree / qualification", entry.degree, (v) => (entry.degree = v)),
      labeledInput("Institution", entry.institution, (v) => (entry.institution = v)),
      labeledInput("Dates", entry.dates, (v) => (entry.dates = v), "e.g. 2023 - 2024"),
    ]);
    section.appendChild(card);
  });

  section.appendChild(
    el("button", {
      type: "button",
      class: "btn btn-secondary btn-small",
      text: "+ Add education",
      onclick: () => {
        list.push({ degree: "", institution: "", dates: "" });
        rerender();
      },
    })
  );

  return section;
}

// --- certifications editor ---------------------------------------------------
// Certifications are stored as strings (which may embed a [Label](url) link),
// but edited as friendly Name + Link fields. These two helpers convert
// between the stored string and the editable {text, link} pair.

const GENERIC_LINK_LABELS = new Set(["link", "verify", "certificate", "credential", "view", "view credential"]);

function parseCertString(str) {
  const s = String(str || "");
  const match = s.match(/\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/);
  if (!match) return { text: s.trim(), link: "" };
  const label = match[1].trim();
  let text = s.replace(match[0], GENERIC_LINK_LABELS.has(label.toLowerCase()) ? "" : label);
  text = text.replace(/\s*[-–|:]\s*$/, "").replace(/^\s*[-–|:]\s*/, "").replace(/\s{2,}/g, " ").trim();
  return { text, link: match[2].trim() };
}

function certToString(cert) {
  const text = String(cert.text || "").trim();
  const link = String(cert.link || "").trim();
  if (!link) return text;
  if (!text) return `[Link](${link})`;
  return `${text} - [Link](${link})`;
}

function renderCertificationsEditor(rerender) {
  const draft = profileDraft;
  const section = el("div", { class: "editor-section" }, [
    el("h3", { text: SECTION_LABELS.certifications }),
    el("p", {
      class: "editor-hint",
      text: "The link is optional - if you add one (e.g. a Credly or Coursera verify URL), it becomes a clickable \"Link\" next to the certification in the preview and in your Word/PDF downloads.",
    }),
  ]);

  draft.certifications.forEach((certStr, index) => {
    const cert = parseCertString(certStr);
    const sync = () => {
      draft.certifications[index] = certToString(cert);
    };
    const card = el("div", { class: "entry-card" }, [
      el("div", { class: "entry-card-header" }, [
        el("span", { class: "entry-card-title", text: cert.text || `Certification ${index + 1}` }),
        entryToolbar(draft.certifications, index, rerender, "certification"),
      ]),
      labeledInput(
        "Certification",
        cert.text,
        (v) => {
          cert.text = v;
          sync();
        },
        "e.g. AWS Certified Cloud Practitioner (2025)"
      ),
      labeledInput(
        "Link (optional)",
        cert.link,
        (v) => {
          cert.link = v;
          sync();
        },
        "e.g. https://credly.com/badges/…"
      ),
    ]);
    section.appendChild(card);
  });

  section.appendChild(
    el("button", {
      type: "button",
      class: "btn btn-secondary btn-small",
      text: "+ Add certification",
      onclick: () => {
        draft.certifications.push("");
        rerender();
      },
    })
  );

  return section;
}

// --- rendering: analysis + skills (unchanged behavior) -----------------------

// --- ATS score (deterministic keyword coverage, mirrors api/_lib/atsScore.js)

let currentAtsKeywords = [];
let atsScoreBefore = null;

function normalizeForMatch(text) {
  return (
    " " +
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

function scoreCvTextAgainstKeywords(cvText, keywords) {
  const list = Array.isArray(keywords) ? keywords : [];
  if (list.length === 0) return { score: null, matched: [], missing: [] };
  const normalizedText = normalizeForMatch(cvText);
  const matched = [];
  const missing = [];
  let matchedWeight = 0;
  let totalWeight = 0;
  list.forEach((entry) => {
    const weight = entry.required ? 2 : 1;
    totalWeight += weight;
    const hit = [entry.keyword, ...(entry.aliases || [])].some((candidate) => {
      const normalized = normalizeForMatch(candidate).trim();
      return normalized && normalizedText.includes(" " + normalized + " ");
    });
    if (hit) {
      matched.push(entry);
      matchedWeight += weight;
    } else {
      missing.push(entry);
    }
  });
  return { score: totalWeight > 0 ? Math.round((100 * matchedWeight) / totalWeight) : null, matched, missing };
}

// Flattens the current tailored CV into plain text the same way an ATS
// indexes an uploaded CV - so the live score reflects every edit.
function tailoredCvToPlainText(cv) {
  const parts = [cv.name, cv.jobTitle, cv.contact, cv.summary, cv.interests];
  (cv.experience || []).concat(cv.projects || []).forEach((e) => {
    parts.push(e.title, e.company, e.dates, e.link, ...(e.bullets || []));
  });
  (cv.education || []).forEach((e) => parts.push(e.degree, e.institution, e.dates));
  parts.push(...(cv.skills || []), ...(cv.certifications || []));
  return parts.filter(Boolean).join("\n");
}

// Animates a score element from its last value to the new one (~450ms).
// Respects prefers-reduced-motion by jumping straight to the value.
function animateScoreValue(elm, target) {
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const from = parseInt(elm.dataset.value || "0", 10) || 0;
  elm.dataset.value = String(target);
  if (reduced || from === target) {
    elm.textContent = `${target}%`;
    return;
  }
  const start = performance.now();
  const duration = 450;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    elm.textContent = `${Math.round(from + (target - from) * eased)}%`;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function keywordChip(entry, matchedClass) {
  return el("span", {
    class: `keyword-chip ${matchedClass}`,
    text: (entry.required ? "★ " : "") + entry.keyword,
    title: entry.required ? "Required in the job description" : "Nice-to-have in the job description",
  });
}

// Recomputes and renders the live score for the CURRENT tailored CV. Called
// after tailoring and again whenever the user adds/removes skills.
function refreshAtsScore() {
  if (!currentAtsKeywords.length || !currentTailoredCv) {
    // Don't vanish silently - say why there's no score, so a missing panel
    // is diagnosable instead of invisible.
    if (currentTailoredCv) {
      scoreBeforeEl.textContent = "–";
      scoreAfterEl.textContent = "–";
      scoreBeforeEl.className = "score-value";
      scoreAfterEl.className = "score-value";
      atsMatchedCountEl.textContent = "0";
      atsMissingCountEl.textContent = "0";
      atsMatchedListEl.innerHTML = "";
      atsMissingListEl.innerHTML = "";
      atsMissingListEl.appendChild(
        el("span", {
          class: "check-detail",
          text: "Keyword extraction didn't come back for this run - tailor again to retry the score.",
        })
      );
      atsSelectAllBtn.classList.add("hidden");
      atsAddKeywordsBtn.classList.add("hidden");
      atsBreakdownEl.classList.remove("hidden");
      matchScorePanel.classList.remove("hidden");
    } else {
      matchScorePanel.classList.add("hidden");
    }
    return;
  }
  const result = scoreCvTextAgainstKeywords(tailoredCvToPlainText(currentTailoredCv), currentAtsKeywords);
  const scoreClass = (v) => (v === null ? "" : v >= 75 ? "score-good" : v >= 50 ? "score-mid" : "score-low");

  scoreBeforeEl.className = `score-value ${scoreClass(atsScoreBefore)}`;
  if (atsScoreBefore === null) scoreBeforeEl.textContent = "–";
  else animateScoreValue(scoreBeforeEl, atsScoreBefore);
  scoreAfterEl.className = `score-value ${scoreClass(result.score)}`;
  if (result.score === null) scoreAfterEl.textContent = "–";
  else animateScoreValue(scoreAfterEl, result.score);

  atsMatchedCountEl.textContent = String(result.matched.length);
  atsMissingCountEl.textContent = String(result.missing.length);
  atsMatchedListEl.innerHTML = "";
  result.matched.forEach((k) => atsMatchedListEl.appendChild(keywordChip(k, "chip-matched")));
  atsMissingListEl.innerHTML = "";
  const requiredFirst = result.missing.slice().sort((a, b) => Number(b.required) - Number(a.required));
  requiredFirst.forEach((k) => {
    const chip = el("button", {
      type: "button",
      class:
        "keyword-chip chip-missing chip-addable" + (selectedAtsKeywords.has(k.keyword) ? " chip-selected" : ""),
      text: (k.required ? "★ " : "") + k.keyword,
      title: "Click to select, then use \"Add selected to Skills\"",
      onclick: (e) => {
        if (selectedAtsKeywords.has(k.keyword)) {
          selectedAtsKeywords.delete(k.keyword);
          e.target.classList.remove("chip-selected");
        } else {
          selectedAtsKeywords.add(k.keyword);
          e.target.classList.add("chip-selected");
        }
      },
    });
    atsMissingListEl.appendChild(chip);
  });
  // Selections can only refer to keywords that are still missing.
  const stillMissing = new Set(result.missing.map((k) => k.keyword));
  Array.from(selectedAtsKeywords).forEach((kw) => {
    if (!stillMissing.has(kw)) selectedAtsKeywords.delete(kw);
  });
  atsSelectAllBtn.classList.toggle("hidden", result.missing.length === 0);
  atsAddKeywordsBtn.classList.toggle("hidden", result.missing.length === 0);
  atsBreakdownEl.classList.remove("hidden");
  matchScorePanel.classList.remove("hidden");
}

atsSelectAllBtn.addEventListener("click", () => {
  Array.from(atsMissingListEl.querySelectorAll(".chip-addable")).forEach((chip) => {
    chip.classList.add("chip-selected");
    selectedAtsKeywords.add(chip.textContent.replace(/^★ /, ""));
  });
});

atsAddKeywordsBtn.addEventListener("click", () => {
  const selected = Array.from(selectedAtsKeywords);
  if (selected.length === 0) {
    setStatus("Click the keywords you want to add first (or use Select all).", true);
    return;
  }
  // Same honesty gate as the missing-skills flow: keywords only go on the CV
  // with an explicit confirmation that the experience is real.
  const confirmed = window.confirm(
    `Confirm: do you genuinely have real experience with ${selected.length === 1 ? "this" : "all of these"}?\n\n${selected.join(", ")}\n\nOnly confirm what you can back up in an interview - adding keywords you don't have gets CVs past software and rejected by humans.`
  );
  if (!confirmed) {
    setStatus("No keywords added.");
    return;
  }
  if (!currentTailoredCv.skills) currentTailoredCv.skills = [];
  selected.forEach((kw) => {
    if (!currentTailoredCv.skills.includes(kw)) currentTailoredCv.skills.push(kw);
  });
  selectedAtsKeywords.clear();
  renderTailoredCv(currentTailoredCv);
  renderSkillsReview();
  refreshAtsScore();
  setStatus(`Added ${selected.length} keyword(s) to your skills. Score updated.`);
});

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

// --- rendering: tailored CV preview with reorderable sections ----------------

function sectionMoveToolbar(key) {
  const order = currentTailoredCv.sectionOrder;
  const index = order.indexOf(key);
  return el("span", { class: "preview-section-controls" }, [
    el("button", {
      type: "button",
      class: "icon-btn",
      title: "Move section up",
      text: "↑",
      onclick: () => {
        if (moveItem(order, index, -1)) renderTailoredCv(currentTailoredCv);
      },
    }),
    el("button", {
      type: "button",
      class: "icon-btn",
      title: "Move section down",
      text: "↓",
      onclick: () => {
        if (moveItem(order, index, 1)) renderTailoredCv(currentTailoredCv);
      },
    }),
  ]);
}

function previewSectionHeader(key, labelText) {
  return el("div", { class: "preview-section-header" }, [
    el("h3", { text: labelText }),
    sectionMoveToolbar(key),
  ]);
}

function roleBlockHtml(entry) {
  const parts = [];
  const titleLine = [entry.title, entry.company].filter(Boolean).join("  |  ");
  parts.push(`<p><strong>${escapeHtml(titleLine)}</strong>`);
  if (entry.dates) parts.push(`<br><span style="color:#666;">${escapeHtml(entry.dates)}</span>`);
  parts.push("</p>");
  const hasBullets = entry.bullets && entry.bullets.length > 0;
  if (hasBullets || entry.link) {
    parts.push("<ul>");
    (entry.bullets || []).forEach((b) => parts.push(`<li>${renderBoldText(b)}</li>`));
    if (entry.link) {
      parts.push(
        `<li>Link: <a href="${escapeHtml(entry.link)}" target="_blank" rel="noopener">${escapeHtml(entry.link)}</a></li>`
      );
    }
    parts.push("</ul>");
  }
  return parts.join("");
}

function renderTailoredCv(cv) {
  cv.sectionOrder = normalizeSectionOrder(cv.sectionOrder);
  resultOutput.innerHTML = "";

  if (cv.name) resultOutput.appendChild(el("div", { class: "cv-name", text: cv.name }));
  if (cv.jobTitle) resultOutput.appendChild(el("div", { class: "cv-jobtitle", text: cv.jobTitle }));
  if (cv.contact) resultOutput.appendChild(el("div", { class: "cv-contact", html: renderLinkedText(cv.contact) }));

  const sectionRenderers = {
    summary: () => {
      if (!cv.summary) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("summary", "Professional Summary")]);
      block.appendChild(el("p", { html: renderBoldText(cv.summary) }));
      return block;
    },
    experience: () => {
      if (!cv.experience || cv.experience.length === 0) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("experience", "Work Experience")]);
      const body = el("div", {});
      body.innerHTML = cv.experience.map(roleBlockHtml).join("");
      block.appendChild(body);
      return block;
    },
    projects: () => {
      if (!cv.projects || cv.projects.length === 0) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("projects", "Projects")]);
      const body = el("div", {});
      body.innerHTML = cv.projects.map(roleBlockHtml).join("");
      block.appendChild(body);
      return block;
    },
    education: () => {
      if (!cv.education || cv.education.length === 0) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("education", "Education")]);
      const body = el("div", {});
      body.innerHTML = cv.education
        .map((edu) => {
          const line = [edu.degree, edu.institution].filter(Boolean).join("  |  ");
          const dates = edu.dates ? `<br><span style="color:#666;">${escapeHtml(edu.dates)}</span>` : "";
          return `<p><strong>${escapeHtml(line)}</strong>${dates}</p>`;
        })
        .join("");
      block.appendChild(body);
      return block;
    },
    skills: () => {
      if (!cv.skills || cv.skills.length === 0) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("skills", "Skills")]);
      block.appendChild(el("p", { text: cv.skills.join("  •  ") }));
      return block;
    },
    certifications: () => {
      if (!cv.certifications || cv.certifications.length === 0) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("certifications", "Certifications")]);
      const ul = el("ul", {});
      cv.certifications.forEach((cert) => ul.appendChild(el("li", { html: renderLinkedText(cert) })));
      block.appendChild(ul);
      return block;
    },
    interests: () => {
      if (!cv.interests) return null;
      const block = el("div", { class: "preview-section" }, [previewSectionHeader("interests", "Interests")]);
      block.appendChild(el("p", { text: cv.interests }));
      return block;
    },
  };

  cv.sectionOrder.forEach((key) => {
    const renderer = sectionRenderers[key];
    if (!renderer) return;
    const block = renderer();
    if (block) resultOutput.appendChild(block);
  });
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
  const regex = /\*\*(.+?)\*\*/g;
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

// Mirrors parseLinkSegments in api/_lib/boldSegments.js - renders
// [Label](url) markdown-style links (in the contact line and certifications)
// as real clickable anchors in the browser preview, matching the DOCX/PDF
// downloads. Non-link text still gets **bold** highlighting.
function renderLinkedText(text) {
  if (!text) return "";
  const html = [];
  const regex = /\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/g;
  let lastIndex = 0;
  let match;
  const withScheme = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) html.push(renderBoldText(text.slice(lastIndex, match.index)));
    html.push(
      `<a href="${escapeHtml(withScheme(match[2]))}" target="_blank" rel="noopener">${escapeHtml(match[1])}</a>`
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) html.push(renderBoldText(text.slice(lastIndex)));
  return html.join("") || renderBoldText(text);
}

function setStatus(message, isError) {
  statusMsg.textContent = message;
  statusMsg.classList.toggle("error", Boolean(isError));
}

function setSetupStatus(message, isError) {
  setupStatusMsg.textContent = message;
  setupStatusMsg.classList.toggle("error", Boolean(isError));
}

function setEditorStatus(message, isError) {
  editorStatusMsg.textContent = message;
  editorStatusMsg.classList.toggle("error", Boolean(isError));
}

function renderSkillsReview() {
  if (!currentTailoredCv || !currentTailoredCv.skills || currentTailoredCv.skills.length === 0) {
    skillsReviewSection.classList.add("hidden");
    return;
  }
  skillsReviewSection.classList.remove("hidden");
  currentSkillsList.innerHTML = "";
  currentTailoredCv.skills.forEach((skill) => {
    const isFlagged = currentIrrelevantSkills.includes(skill);
    const li = document.createElement("li");
    if (isFlagged) li.className = "flagged-skill";
    const label = document.createElement("label");
    label.className = "skill-checkbox-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = skill;
    checkbox.className = "current-skill-checkbox";
    // Pre-check skills the AI flagged as likely irrelevant to this job, so
    // the user can review and confirm removal in one click - they can still
    // uncheck any of these if they disagree.
    checkbox.checked = isFlagged;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(" " + skill));
    if (isFlagged) {
      const badge = document.createElement("span");
      badge.className = "flagged-badge";
      badge.textContent = "not clearly relevant to this job";
      label.appendChild(badge);
    }
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

  // Honesty gate: never let a skill get added without an explicit
  // confirmation that the person actually has real experience with it -
  // the whole point of this tool is not fabricating skills, even at the
  // user's own initiative.
  const confirmed = window.confirm(
    `Confirm: have you actually worked with/used ${checked.length === 1 ? "this" : "these"}?\n\n${checked.join(", ")}\n\nOnly confirm if you have real, genuine experience with ${checked.length === 1 ? "it" : "them"} - don't add something just because the job asks for it.`
  );
  if (!confirmed) {
    setStatus("No skills added.");
    return;
  }

  if (!currentTailoredCv.skills) currentTailoredCv.skills = [];
  checked.forEach((skill) => {
    if (!currentTailoredCv.skills.includes(skill)) currentTailoredCv.skills.push(skill);
  });

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
  refreshAtsScore();
  setStatus(`Added ${checked.length} skill(s) to your CV. Score updated.`);
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
  currentIrrelevantSkills = currentIrrelevantSkills.filter((s) => !checked.includes(s));
  renderTailoredCv(currentTailoredCv);
  renderSkillsReview();
  refreshAtsScore();
  setStatus(`Removed ${checked.length} skill(s) from your CV. Score updated.`);
});

// --- ATS compatibility check -------------------------------------------------

const atsCheckBtn = document.getElementById("ats-check-btn");
const atsCheckResults = document.getElementById("ats-check-results");
const atsChecklistEl = document.getElementById("ats-checklist");
const atsExtractedTextEl = document.getElementById("ats-extracted-text");
const atsPlatformGroupsEl = document.getElementById("ats-platform-groups");

// The 50 major ATS platforms, grouped by how they actually screen. All of
// them share the same first layer (parse -> index -> keyword filter/search),
// which is what the compatibility checks and keyword score cover.
const ATS_PLATFORM_GROUPS = [
  {
    title: "Structured review: recruiters read parsed CVs and run keyword searches, no auto-ranking",
    platforms: ["Greenhouse", "Lever", "Ashby", "Teamtailor", "Workable", "Recruitee", "Pinpoint", "Breezy HR", "JazzHR", "BambooHR", "Personio Recruiting", "HiBob Recruiting", "Freshteam", "CareerPlug", "ApplicantPro", "Hireology", "ClearCompany", "NeoGov", "Rippling Recruiting", "Zoho Recruit"],
  },
  {
    title: "Enterprise suites: parsed into profile fields, recruiters filter with boolean/keyword search and knockout questions",
    platforms: ["Workday", "iCIMS", "Oracle Recruiting Cloud", "Oracle Taleo", "SAP SuccessFactors", "UKG Pro Recruiting", "Dayforce Recruiting", "IBM Kenexa BrassRing", "Cornerstone Recruiting", "PeopleFluent", "Oleeo", "Tribepad", "Avature", "SmartRecruiters", "Jobvite", "Darwinbox Recruiting"],
  },
  {
    title: "AI matching / high-volume screening: employer-configured models rank on skills extracted from the same parsed text",
    platforms: ["Eightfold AI", "Phenom", "Paradox", "Fountain", "Manatal", "CEIPAL ATS"],
  },
  {
    title: "Staffing & agency CRMs: recruiters source by keyword/boolean search across parsed CVs",
    platforms: ["Bullhorn ATS", "JobAdder", "JobDiva", "Crelate", "TrackerRMS", "Recruit CRM", "Recruiterflow", "Loxo"],
  },
];

function renderAtsPlatformGroups() {
  atsPlatformGroupsEl.innerHTML = "";
  ATS_PLATFORM_GROUPS.forEach((group) => {
    const block = el("div", { class: "ats-group" }, [el("h4", { text: group.title })]);
    const chips = el("div", { class: "keyword-chips" });
    group.platforms.forEach((name) => chips.appendChild(el("span", { class: "keyword-chip chip-platform", text: name })));
    block.appendChild(chips);
    atsPlatformGroupsEl.appendChild(block);
  });
}

atsCheckBtn.addEventListener("click", async () => {
  if (!currentTailoredCv) {
    setStatus("Tailor a CV first, then run the check.", true);
    return;
  }
  const originalText = atsCheckBtn.textContent;
  atsCheckBtn.disabled = true;
  atsCheckBtn.textContent = "Checking…";
  try {
    const response = await authedFetch("/api/ats-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tailoredCv: currentTailoredCv, atsKeywords: currentAtsKeywords }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Compatibility check failed.", true);
      return;
    }

    atsChecklistEl.innerHTML = "";
    data.checks.forEach((check) => {
      atsChecklistEl.appendChild(
        el("li", { class: check.pass ? "check-pass" : "check-fail" }, [
          el("span", { class: "check-icon", text: check.pass ? "✓" : "✗" }),
          el("span", {}, [
            el("strong", { text: check.label }),
            el("span", { class: "check-detail", text: ": " + check.detail }),
          ]),
        ])
      );
    });
    atsExtractedTextEl.textContent = data.extractedText;
    renderAtsPlatformGroups();
    atsCheckResults.classList.remove("hidden");
    setStatus(`ATS check: ${data.passed}/${data.total} checks passed.`, data.passed !== data.total);
  } catch (err) {
    console.error(err);
    setStatus("Network error while running the ATS check.", true);
  } finally {
    atsCheckBtn.disabled = false;
    atsCheckBtn.textContent = originalText;
  }
});

// --- CV templates -------------------------------------------------------------

const templateCardsEl = document.getElementById("template-cards");

const CV_TEMPLATES = [
  { id: "classic", label: "Classic", description: "Centered headings, timeless and neutral" },
  { id: "modern", label: "Modern", description: "Left-aligned with a blue accent and rules" },
  { id: "elegant", label: "Elegant", description: "Serif type, centered, understated rules" },
  { id: "compact", label: "Compact", description: "Tighter type to fit more on a page" },
  { id: "finance", label: "Finance / Academic", description: "Serif, all-caps name, ruled headings, banking and quant classic" },
  { id: "scholar", label: "Scholar", description: "Serif with left ruled headings, graduate school style" },
  { id: "executive", label: "Executive", description: "Large name, prominent role line, full-width rules" },
  { id: "cardinal", label: "Cardinal", description: "Centered name, navy left headings with rules" },
  { id: "onepage", label: "One-Page Tech", description: "Tight sans layout with ruled caps headings" },
  { id: "timeline", label: "Timeline", description: "Blue name and rules, black headings, moderncv feel" },
];

let selectedTemplate = "classic";

function renderTemplatePicker() {
  templateCardsEl.innerHTML = "";
  CV_TEMPLATES.forEach((tpl) => {
    const thumb = el("div", { class: `tpl-thumb thumb-${tpl.id}` }, [
      el("div", { class: "thumb-name", text: "Gagan S R" }),
      el("div", { class: "thumb-contact", text: "email | phone | LinkedIn" }),
      el("div", { class: "thumb-heading", text: "Experience" }),
      el("div", { class: "thumb-text", text: "AI Engineer, Acme Co" }),
      el("div", { class: "thumb-text dim", text: "Built RAG pipelines with Python" }),
      el("div", { class: "thumb-heading", text: "Skills" }),
      el("div", { class: "thumb-text dim", text: "Python, RAG, LangGraph" }),
    ]);
    const card = el(
      "button",
      {
        type: "button",
        class: "template-card" + (selectedTemplate === tpl.id ? " template-selected" : ""),
        onclick: () => {
          selectedTemplate = tpl.id;
          resultOutput.className = `result-output tpl-${tpl.id}`;
          renderTemplatePicker();
        },
      },
      [thumb, el("span", { class: "template-label", text: tpl.label }), el("span", { class: "template-desc", text: tpl.description })]
    );
    templateCardsEl.appendChild(card);
  });
}

// --- main tailor action -----------------------------------------------------

tailorBtn.addEventListener("click", async () => {
  const jobDescription = jdInput.value.trim();

  if (!baseCv) {
    setStatus("Set up your profile first - it becomes the base CV for tailoring.", true);
    showView("setup");
    return;
  }
  if (!jobDescription) {
    setStatus("Please paste the job description.", true);
    return;
  }

  tailorBtn.disabled = true;
  tailorBtn.classList.add("btn-loading");
  setStatus("Tailoring your CV… this can take up to 20 seconds.");
  resultSection.classList.add("hidden");

  try {
    const response = await authedFetch("/api/tailor-cv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseCv, jobDescription }),
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
    currentIrrelevantSkills = Array.isArray(data.irrelevantSkills) ? data.irrelevantSkills : [];

    // Apply the recommended section order by default; the user can still
    // rearrange with the arrows on each preview section.
    currentTailoredCv.sectionOrder = normalizeSectionOrder(
      Array.isArray(data.recommendedSectionOrder) && data.recommendedSectionOrder.length > 0
        ? data.recommendedSectionOrder
        : currentTailoredCv.sectionOrder
    );
    if (data.sectionOrderReason) {
      orderReason.textContent = " " + data.sectionOrderReason;
      orderNote.classList.remove("hidden");
    } else {
      orderNote.classList.add("hidden");
    }

    renderTailoredCv(currentTailoredCv);
    resultOutput.classList.add(`tpl-${selectedTemplate}`);
    renderTemplatePicker();
    atsCheckResults.classList.add("hidden"); // stale results from a previous tailoring
    currentAtsKeywords = data.ats && Array.isArray(data.ats.keywords) ? data.ats.keywords : [];
    selectedAtsKeywords.clear();
    atsScoreBefore = data.ats && Number.isFinite(data.ats.before) ? data.ats.before : null;
    refreshAtsScore();
    renderAnalysis(data.changes, data.missingSkills);
    renderSkillsReview();
    resultSection.classList.remove("hidden");
    resultSection.classList.remove("reveal");
    void resultSection.offsetWidth; // restart the animation on re-tailor
    resultSection.classList.add("reveal");
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Done! Review the tailored CV below.");
    await refreshUserStatus();
  } catch (err) {
    console.error(err);
    setStatus("Network error. Please check your connection and try again.", true);
  } finally {
    tailorBtn.classList.remove("btn-loading");
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
      body: JSON.stringify({ tailoredCv: currentTailoredCv, template: selectedTemplate }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setStatus(err.error || `Failed to generate ${mimeExt.toUpperCase()}.`, true);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName =
      [currentTailoredCv.name, currentTailoredCv.jobTitle, currentTailoredCv.companyName]
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        .join(" - ")
        .replace(/[^a-z0-9 \-]+/gi, "")
        .replace(/\s+/g, " ")
        .trim() || "tailored-cv";
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