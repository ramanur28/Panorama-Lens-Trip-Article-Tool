/* ═══════════════════════════════════════════════════════════════
   ArticleForge AI — Main Application Logic
   ═══════════════════════════════════════════════════════════════ */

import "./style.css";
import { marked } from "marked";

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ── Subpath & API Routing Helpers ─────────────────────────────────
const BASE_PATH = window.location.pathname.includes("/Panorama-Lens-Trip-Article-Tool")
  ? "/Panorama-Lens-Trip-Article-Tool"
  : "";

function apiPath(endpoint) {
  const clean = endpoint.startsWith("/") ? endpoint : "/" + endpoint;
  return `${BASE_PATH}${clean}`;
}

function normalizeImageUrl(url) {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return url;
  const clean = url.startsWith("/") ? url : "/" + url;
  return `${BASE_PATH}${clean}`;
}

// ── State ────────────────────────────────────────────────────────
const state = {
  apiKey: localStorage.getItem("af-api-key") || "",
  openaiApiKey: localStorage.getItem("af-openai-key") || "",
  model: localStorage.getItem("af-model") || "gemini-2.5-flash",
  theme: localStorage.getItem("af-theme") || "light",
  targetAudience: localStorage.getItem("af-audience") || "",
  brand: localStorage.getItem("af-brand") || "",
  currentMode: "compose", // "compose" | "update"
  currentView: "writer", // "writer" | "manager" | "schedule"
  queue: [],
  articles: [],
  activeItemId: null,
  editingQueueId: null,
  isGenerating: false,
  managerFilter: "all",
  managerSearch: "",
  currentCalendarDate: new Date(),
  isAdmin: false, // Default to non-admin until authenticated
  editingArticleItem: null
};

let nextId = 1;

// ── DOM References ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {};

function initDom() {
  // Settings modal
  dom.settingsModal = $("#settingsModal");
  dom.openSettings = $("#openSettings");
  dom.closeSettings = $("#closeSettings");
  dom.saveSettings = $("#saveSettings");
  dom.apiKeyInput = $("#apiKeyInput");
  dom.openaiKeyInput = $("#openaiKeyInput");
  dom.modelSelect = $("#modelSelect");
  dom.customModelGroup = $("#customModelGroup");
  dom.customModelInput = $("#customModelInput");
  dom.wpSiteUrlInput = $("#wpSiteUrlInput");
  dom.wpUsernameInput = $("#wpUsernameInput");
  dom.wpAppPasswordInput = $("#wpAppPasswordInput");
  dom.toggleKeyVisibility = $("#toggleKeyVisibility");
  dom.toggleOpenaiKeyVisibility = $("#toggleOpenaiKeyVisibility");
  dom.apiStatus = $("#apiStatus");
  dom.themeToggleBtn = $("#themeToggleBtn");

  // Admin Login Elements
  dom.adminLoginHeaderBtn = $("#adminLoginHeaderBtn");
  dom.adminLoginModal = $("#adminLoginModal");
  dom.closeAdminLogin = $("#closeAdminLogin");
  dom.adminPasswordInput = $("#adminPasswordInput");
  dom.submitAdminLogin = $("#submitAdminLogin");

  // Views & Navigation
  dom.btnShowWriter = $("#btnShowWriter");
  dom.btnShowManager = $("#btnShowManager");
  dom.btnShowSchedule = $("#btnShowSchedule");
  dom.writerMain = $(".app-main");
  dom.managerMain = $("#managerMain");
  dom.scheduleView = $("#scheduleMain");

  // Form
  dom.articleForm = $("#articleForm");
  dom.modeComposeBtn = $("#modeComposeBtn");
  dom.modeUpdateBtn = $("#modeUpdateBtn");
  dom.modeImageSeoBtn = $("#modeImageSeoBtn");
  dom.modeInsertLinkBtn = $("#modeInsertLinkBtn");
  dom.composeFields = $("#composeFields");
  dom.updateFields = $("#updateFields");
  dom.titleInput = $("#titleInput");
  dom.wpUrlInput = $("#wpUrlInput");
  dom.targetSubtitleInput = $("#targetSubtitleInput");
  dom.topicInput = $("#topicInput");
  dom.keyphraseInput = $("#keyphraseInput");
  dom.toneSelect = $("#toneSelect");
  dom.styleInput = $("#styleInput");
  dom.customPromptInput = $("#customPromptInput");
  dom.targetAudienceInput = $("#targetAudienceInput");
  dom.brandInput = $("#brandInput");
  dom.ctaLinkInput = $("#ctaLinkInput");
  dom.wordCountModeSelect = $("#wordCountModeSelect");
  dom.wordCountDivisorInput = $("#wordCountDivisorInput");
  dom.targetWordCountInput = $("#targetWordCountInput");
  dom.targetLanguageSelect = $("#targetLanguageSelect");
  dom.saveAdminSettingsBtn = $("#saveAdminSettingsBtn");
  dom.starterInput = $("#starterInput");
  dom.starterWritingsInput = $("#starterWritingsInput");
  dom.quotationsContainer = $("#quotationsContainer");
  dom.addQuotationBtn = $("#addQuotationBtn");
  dom.articleImagesContainer = $("#articleImagesContainer");
  dom.addArticleImageBtn = $("#addArticleImageBtn");
  dom.internalLinksContainer = $("#internalLinksContainer");
  dom.addInternalLinkBtn = $("#addInternalLinkBtn");
  dom.insertLinkTargetSelect = $("#insertLinkTargetSelect");
  dom.insertLinksListContainer = $("#insertLinksListContainer");
  dom.addInsertLinkRowBtn = $("#addInsertLinkBtn");
  dom.autoInsertLinksBtn = $("#autoInsertLinksBtn");
  dom.imageFileInput = $("#imageFileInput");
  dom.imageUploadBtn = $("#imageUploadBtn");
  dom.imageFileName = $("#imageFileName");
  dom.imagePreviewContainer = $("#imagePreviewContainer");
  dom.imagePreview = $("#imagePreview");
  dom.imageLocationInput = $("#imageLocationInput");
  dom.imageSceneInput = $("#imageSceneInput");
  dom.addToQueueBtn = $("#addToQueueBtn");
  dom.generateSingleBtn = $("#generateSingleBtn");

  // Queue
  dom.queueList = $("#queueList");
  dom.queueCount = $("#queueCount");
  dom.clearQueueBtn = $("#clearQueueBtn");
  dom.generateAllBtn = $("#generateAllBtn");
  dom.emptyQueue = $("#emptyQueue");

  // Preview
  dom.previewActions = $("#previewActions");
  dom.previewRendered = $("#previewRendered");
  dom.previewRaw = $("#previewRaw");
  dom.previewStats = $("#previewStats");
  dom.emptyPreview = $("#emptyPreview");
  dom.tabRendered = $("#tabRendered");
  dom.tabRaw = $("#tabRaw");
  dom.copyBtn = $("#copyBtn");
  dom.downloadBtn = $("#downloadBtn");
  dom.btnEditPreviewContent = $("#btnEditPreviewContent");
  dom.statWords = $("#statWords");
  dom.statReadTime = $("#statReadTime");
  dom.statKeyphrase = $("#statKeyphrase");
  dom.statSections = $("#statSections");
  dom.previewImagesGallery = $("#previewImagesGallery");
  dom.galleryContainer = $("#galleryContainer");

  // Manager View
  dom.articlesTableBody = $("#articlesTableBody");
  dom.emptyManager = $("#emptyManager");
  dom.txtSearchManager = $("#txtSearchManager");
  dom.managerFilterTabs = $$("#managerFilters .filter-btn");
  dom.btnOpenAddModal = $("#btnOpenAddModal");

  // Manager Filter Count Badges
  dom.badgeAll = $("#badgeAll");
  dom.badgeAntrean = $("#badgeAntrean");
  dom.badgeBelum = $("#badgeBelum");
  dom.badgeTelah = $("#badgeTelah");
  dom.badgeDijadwalkan = $("#badgeDijadwalkan");
  dom.badgeDraft = $("#badgeDraft");

  // Calendar View
  dom.calendarMonthTitle = $("#calendarMonthTitle");
  dom.calendarGridBody = $("#calendarGridBody");
  dom.btnPrevMonth = $("#btnPrevMonth");
  dom.btnNextMonth = $("#btnNextMonth");
  dom.btnTodayMonth = $("#btnTodayMonth");
  dom.btnSyncWPSchedule = $("#btnSyncWPSchedule");
  dom.btnSyncWP = $("#btnSyncWP");
  dom.btnTestWpConn = $("#btnTestWpConn");
  dom.btnOpenScheduleModal = $("#btnOpenScheduleModal");

  // Schedule Modal
  dom.scheduleModal = $("#scheduleModal");
  dom.closeScheduleModal = $("#closeScheduleModal");
  dom.btnCancelScheduleModal = $("#btnCancelScheduleModal");
  dom.btnSaveScheduleModal = $("#btnSaveScheduleModal");
  dom.schArticleId = $("#schArticleId");
  dom.schQueueId = $("#schQueueId");
  dom.schArticleSelect = $("#schArticleSelect");
  dom.schActionSelect = $("#schActionSelect");
  dom.schDateInput = $("#schDateInput");
  dom.schTimeInput = $("#schTimeInput");
  dom.schLinkInput = $("#schLinkInput");
  dom.schFeaturedImageInput = $("#schFeaturedImageInput");

  // Publishing / Scheduling Progress Overlay Modal
  dom.publishingProgressModal = $("#publishingProgressModal");
  dom.publishingProgressTitle = $("#publishingProgressTitle");
  dom.publishingProgressSubtitle = $("#publishingProgressSubtitle");
  dom.publishingProgressBar = $("#publishingProgressBar");

  // Day Details Modal
  dom.dayDetailsModal = $("#dayDetailsModal");
  dom.dayDetailsModalTitle = $("#dayDetailsModalTitle");
  dom.dayDetailsModalSubtitle = $("#dayDetailsModalSubtitle");
  dom.dayDetailsModalBody = $("#dayDetailsModalBody");
  dom.closeDayDetailsModal = $("#closeDayDetailsModal");
  dom.btnCloseDayDetails = $("#btnCloseDayDetails");
  dom.btnScheduleForThisDay = $("#btnScheduleForThisDay");

  // Edit Content Modal
  dom.editContentModal = $("#editContentModal");
  dom.closeEditContentModal = $("#closeEditContentModal");
  dom.btnCancelEditContent = $("#btnCancelEditContent");
  dom.btnSaveEditContent = $("#btnSaveEditContent");
  dom.editContentTextarea = $("#editFullContentArea");

  dom.regenerateCurrentBtn = $("#regenerateCurrentBtn");
  dom.btnRemovePreviewContent = $("#btnRemovePreviewContent");

  dom.metaKeyphraseInput = $("#metaKeyphraseInput");
  dom.metaTitleInput = $("#metaTitleInput");
  dom.metaSlugInput = $("#metaSlugInput");
  dom.metaPageRoleInput = $("#metaPageRoleInput");
  dom.metaCategoriesInput = $("#metaCategoriesInput");
  dom.metaTagsInput = $("#metaTagsInput");
  dom.metaDescriptionInput = $("#metaDescriptionInput");
  dom.metaExcerptInput = $("#metaExcerptInput");

  // Toast
  dom.toastContainer = $("#toastContainer");
}

// ── Admin UI & Session Management ────────────────────────────────
function updateAdminUI() {
  if (dom.adminLoginHeaderBtn) {
    dom.adminLoginHeaderBtn.textContent = state.isAdmin ? "🔓 Logout (Admin)" : "🔒 Admin Login";
    dom.adminLoginHeaderBtn.className = state.isAdmin ? "btn btn-sm btn-ghost text-warning" : "btn btn-sm btn-secondary";
  }

  const adminOnlySections = document.querySelectorAll(".admin-only-section");
  adminOnlySections.forEach(el => {
    el.style.display = state.isAdmin ? "block" : "none";
  });

  const adminActions = $("#adminActionsContainer");
  if (adminActions) {
    adminActions.style.display = state.isAdmin ? "block" : "none";
  }

  renderQueue();
  renderArticles();
}

async function checkAdminSession() {
  const token = localStorage.getItem("af-admin-token");
  if (!token) {
    state.isAdmin = false;
    updateAdminUI();
    return;
  }

  try {
    const res = await fetch(apiPath("/api/admin/check-session"), {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.isAdmin = !!data.loggedIn;
    } else {
      state.isAdmin = false;
      localStorage.removeItem("af-admin-token");
    }
  } catch (err) {
    state.isAdmin = false;
  }
  updateAdminUI();
}

function openAdminLoginModal() {
  if (!dom.adminLoginModal) return;
  if (dom.adminPasswordInput) dom.adminPasswordInput.value = "";
  dom.adminLoginModal.classList.add("active");
  setTimeout(() => {
    if (dom.adminPasswordInput) dom.adminPasswordInput.focus();
  }, 100);
}

function closeAdminLoginModal() {
  if (dom.adminLoginModal) dom.adminLoginModal.classList.remove("active");
}

async function handleAdminLogin() {
  const password = dom.adminPasswordInput ? dom.adminPasswordInput.value : "";
  if (!password) {
    showToast("Please enter the admin password.", "error");
    return;
  }

  try {
    const res = await fetch(apiPath("/api/admin/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("af-admin-token", data.token);
        state.isAdmin = true;
        closeAdminLoginModal();
        updateAdminUI();
        showToast("Successfully logged in as Admin!", "success");
      }
    } else {
      showToast("Invalid admin password.", "error");
    }
  } catch (err) {
    showToast("Login request failed.", "error");
  }
}

async function handleAdminLogout() {
  const token = localStorage.getItem("af-admin-token");
  try {
    await fetch(apiPath("/api/admin/logout"), {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
  } catch (e) {}

  localStorage.removeItem("af-admin-token");
  state.isAdmin = false;
  updateAdminUI();
  showToast("Logged out of Admin mode.", "info");
}

// ── View Management ──────────────────────────────────────────────
function switchView(viewName) {
  state.currentView = viewName;
  
  if (dom.writerMain) dom.writerMain.style.display = viewName === "writer" ? "grid" : "none";
  if (dom.managerMain) dom.managerMain.style.display = viewName === "manager" ? "block" : "none";
  if (dom.scheduleView) dom.scheduleView.style.display = viewName === "schedule" ? "block" : "none";

  if (dom.btnShowWriter) dom.btnShowWriter.classList.toggle("active", viewName === "writer");
  if (dom.btnShowManager) dom.btnShowManager.classList.toggle("active", viewName === "manager");
  if (dom.btnShowSchedule) dom.btnShowSchedule.classList.toggle("active", viewName === "schedule");

  if (viewName === "manager") {
    loadArticles();
  } else if (viewName === "schedule") {
    loadArticles();
    renderCalendar();
  }
}

// ── Initialization ───────────────────────────────────────────────
function init() {
  initDom();

  if (dom.apiKeyInput) dom.apiKeyInput.value = state.apiKey;
  if (dom.openaiKeyInput) dom.openaiKeyInput.value = state.openaiApiKey;
  if (dom.modelSelect) dom.modelSelect.value = state.model;
  
  updateApiStatus();
  applyTheme();
  loadGlobalSettings();
  checkAdminSession();

  // Settings modal handlers
  if (dom.openSettings) dom.openSettings.addEventListener("click", () => openModal());
  if (dom.closeSettings) dom.closeSettings.addEventListener("click", () => closeModal());
  if (dom.settingsModal) {
    dom.settingsModal.addEventListener("click", (e) => {
      if (e.target === dom.settingsModal) closeModal();
    });
  }
  if (dom.saveSettings) dom.saveSettings.addEventListener("click", saveSettings);
  if (dom.toggleKeyVisibility) dom.toggleKeyVisibility.addEventListener("click", toggleKeyVisibility);
  if (dom.toggleOpenaiKeyVisibility) dom.toggleOpenaiKeyVisibility.addEventListener("click", toggleOpenaiKeyVisibility);
  if (dom.themeToggleBtn) dom.themeToggleBtn.addEventListener("click", toggleTheme);

  // Admin Login handlers
  if (dom.adminLoginHeaderBtn) {
    dom.adminLoginHeaderBtn.addEventListener("click", () => {
      if (state.isAdmin) handleAdminLogout();
      else openAdminLoginModal();
    });
  }
  if (dom.closeAdminLogin) dom.closeAdminLogin.addEventListener("click", closeAdminLoginModal);
  if (dom.submitAdminLogin) dom.submitAdminLogin.addEventListener("click", handleAdminLogin);
  if (dom.adminPasswordInput) {
    dom.adminPasswordInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAdminLogin();
    });
  }
  if (dom.adminLoginModal) {
    dom.adminLoginModal.addEventListener("click", (e) => {
      if (e.target === dom.adminLoginModal) closeAdminLoginModal();
    });
  }

  // Form mode handlers
  if (dom.modeComposeBtn) dom.modeComposeBtn.addEventListener("click", () => switchMode("compose"));
  if (dom.modeUpdateBtn) dom.modeUpdateBtn.addEventListener("click", () => switchMode("update"));
  if (dom.modeImageSeoBtn) dom.modeImageSeoBtn.addEventListener("click", () => switchMode("image-seo"));
  if (dom.modeInsertLinkBtn) dom.modeInsertLinkBtn.addEventListener("click", () => switchMode("insert-link"));

  // Dynamic row buttons
  if (dom.addQuotationBtn) dom.addQuotationBtn.addEventListener("click", () => addQuotation());
  if (dom.addArticleImageBtn) dom.addArticleImageBtn.addEventListener("click", () => addArticleImage());
  if (dom.addInternalLinkBtn) dom.addInternalLinkBtn.addEventListener("click", () => addInternalLink());
  if (dom.addInsertLinkRowBtn) dom.addInsertLinkRowBtn.addEventListener("click", () => addInsertLinkRow());
  if (dom.autoInsertLinksBtn) dom.autoInsertLinksBtn.addEventListener("click", () => autoInsertLinks());

  // Image SEO upload button
  if (dom.imageUploadBtn && dom.imageFileInput) {
    dom.imageUploadBtn.addEventListener("click", () => dom.imageFileInput.click());
    dom.imageFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (dom.imageFileName) dom.imageFileName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target.result;
        const compressed = await compressImage(base64);
        if (dom.imagePreview) {
          dom.imagePreview.src = compressed;
          dom.imagePreview.style.display = "block";
        }
        if (dom.imagePreviewContainer) dom.imagePreviewContainer.style.display = "block";
        const serverUrl = await uploadImageToServer(compressed);
        if (serverUrl && dom.imagePreview) {
          dom.imagePreview.dataset.url = serverUrl;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Admin Settings save button
  if (dom.saveAdminSettingsBtn) dom.saveAdminSettingsBtn.addEventListener("click", saveAdminSettingsFromForm);

  // Form Actions
  if (dom.addToQueueBtn) dom.addToQueueBtn.addEventListener("click", addToQueue);
  if (dom.generateSingleBtn) dom.generateSingleBtn.addEventListener("click", generateSingle);
  if (dom.clearQueueBtn) dom.clearQueueBtn.addEventListener("click", clearQueue);
  if (dom.generateAllBtn) dom.generateAllBtn.addEventListener("click", generateAll);

  // View Navigation Tabs
  if (dom.btnShowWriter) dom.btnShowWriter.addEventListener("click", () => switchView("writer"));
  if (dom.btnShowManager) dom.btnShowManager.addEventListener("click", () => switchView("manager"));
  if (dom.btnShowSchedule) dom.btnShowSchedule.addEventListener("click", () => switchView("schedule"));

  // Preview tabs & actions
  if (dom.tabRendered) dom.tabRendered.addEventListener("click", () => switchTab("rendered"));
  if (dom.tabRaw) dom.tabRaw.addEventListener("click", () => switchTab("raw"));
  if (dom.copyBtn) dom.copyBtn.addEventListener("click", copyToClipboard);
  if (dom.downloadBtn) dom.downloadBtn.addEventListener("click", downloadAsTxt);
  if (dom.btnEditPreviewContent) dom.btnEditPreviewContent.addEventListener("click", () => {
    const activeItem = state.queue.find(q => q.id === state.activeItemId);
    if (activeItem) openEditContentModal(activeItem);
    else showToast("Please select a queue item to edit first.", "error");
  });

  // Article Manager Search & Filter
  if (dom.txtSearchManager) {
    dom.txtSearchManager.addEventListener("input", (e) => {
      state.managerSearch = e.target.value;
      renderArticles();
    });
  }
  if (dom.managerFilterTabs && dom.managerFilterTabs.length > 0) {
    dom.managerFilterTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        dom.managerFilterTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        state.managerFilter = tab.dataset.status || tab.dataset.filter || "all";
        renderArticles();
      });
    });
  }
  if (dom.btnOpenAddModal) dom.btnOpenAddModal.addEventListener("click", openAddArticleModal);

  // Calendar Controls
  if (dom.btnPrevMonth) dom.btnPrevMonth.addEventListener("click", () => {
    state.currentCalendarDate.setMonth(state.currentCalendarDate.getMonth() - 1);
    renderCalendar();
  });
  if (dom.btnNextMonth) dom.btnNextMonth.addEventListener("click", () => {
    state.currentCalendarDate.setMonth(state.currentCalendarDate.getMonth() + 1);
    renderCalendar();
  });
  if (dom.btnTodayMonth) dom.btnTodayMonth.addEventListener("click", () => {
    state.currentCalendarDate = new Date();
    renderCalendar();
  });
  if (dom.btnSyncWPSchedule) dom.btnSyncWPSchedule.addEventListener("click", () => syncWordPressData());
  if (dom.btnSyncWP) dom.btnSyncWP.addEventListener("click", () => syncWordPressData());
  if (dom.btnTestWpConn) dom.btnTestWpConn.addEventListener("click", () => testWpConnection());
  if (dom.btnOpenScheduleModal) dom.btnOpenScheduleModal.addEventListener("click", () => openScheduleModal());

  // Modal Close Handlers
  if (dom.closeScheduleModal) dom.closeScheduleModal.addEventListener("click", closeScheduleModal);
  if (dom.btnCancelScheduleModal) dom.btnCancelScheduleModal.addEventListener("click", closeScheduleModal);
  if (dom.btnSaveScheduleModal) dom.btnSaveScheduleModal.addEventListener("click", saveScheduleModal);

  if (dom.closeDayDetailsModal) dom.closeDayDetailsModal.addEventListener("click", closeDayDetailsModal);
  if (dom.btnCloseDayDetails) dom.btnCloseDayDetails.addEventListener("click", closeDayDetailsModal);

  if (dom.closeEditContentModal) dom.closeEditContentModal.addEventListener("click", closeEditContentModal);
  if (dom.btnCancelEditContent) dom.btnCancelEditContent.addEventListener("click", closeEditContentModal);
  if (dom.btnSaveEditContent) dom.btnSaveEditContent.addEventListener("click", saveEditContentModal);
  if (dom.regenerateCurrentBtn) dom.regenerateCurrentBtn.addEventListener("click", () => regenerateQueueItem(state.activeItemId));
  if (dom.btnRemovePreviewContent) dom.btnRemovePreviewContent.addEventListener("click", () => {
    if (state.activeItemId) removeFromQueue(state.activeItemId);
  });

  // Initial Form Setup
  addArticleImage();
  loadQueue();
  loadArticles();

  if (!state.apiKey) {
    setTimeout(() => openModal(), 500);
  }
}
// ── Form Mode Switcher ───────────────────────────────────────────
function switchMode(mode) {
  state.currentMode = mode;
  const form = dom.articleForm || $("#articleForm");
  if (form) {
    form.className = `mode-${mode}`;
  }

  const btnMap = {
    "compose": dom.modeComposeBtn,
    "update": dom.modeUpdateBtn,
    "image-seo": dom.modeImageSeoBtn,
    "insert-link": dom.modeInsertLinkBtn
  };

  Object.keys(btnMap).forEach(m => {
    if (btnMap[m]) {
      if (m === mode) btnMap[m].classList.add("active");
      else btnMap[m].classList.remove("active");
    }
  });

  if (mode === "insert-link") {
    populateInsertLinkTargetSelect();
  }
}

// ── Form Data Collection & Validation ───────────────────────────
function getFormData() {
  const quotations = Array.from(dom.quotationsContainer ? dom.quotationsContainer.querySelectorAll(".quotation-item") : [])
    .map(item => ({
      name: item.querySelector(".quote-name") ? item.querySelector(".quote-name").value.trim() : "",
      url: item.querySelector(".quote-url") ? item.querySelector(".quote-url").value.trim() : "",
      quote: item.querySelector(".quote-text") ? item.querySelector(".quote-text").value.trim() : ""
    }))
    .filter(q => q.name || q.quote);

  const articleImages = Array.from(dom.articleImagesContainer ? dom.articleImagesContainer.querySelectorAll(".article-image-item") : [])
    .map((item, index) => {
      const imgEl = item.querySelector(".preview-img");
      const isUploaded = imgEl && imgEl.style.display !== "none";
      const url = isUploaded ? (imgEl.dataset.url || "") : "";
      const base64 = isUploaded ? (imgEl.src || "") : "";
      return {
        id: index + 1,
        imageUrl: url,
        imageBase64: url ? undefined : (isUploaded ? base64 : ""),
        location: item.querySelector(".image-location-input") ? item.querySelector(".image-location-input").value.trim() : "",
        scene: item.querySelector(".image-scene-input") ? item.querySelector(".image-scene-input").value.trim() : ""
      };
    })
    .filter(img => img.imageUrl || img.imageBase64);

  const internalLinks = Array.from(dom.internalLinksContainer ? dom.internalLinksContainer.querySelectorAll(".internal-link-item") : [])
    .map(item => ({
      title: item.querySelector(".link-title-input") ? item.querySelector(".link-title-input").value.trim() : "",
      url: item.querySelector(".link-url-input") ? item.querySelector(".link-url-input").value.trim() : "",
      count: item.querySelector(".link-count-input") ? parseInt(item.querySelector(".link-count-input").value, 10) || 1 : 1
    }))
    .filter(link => link.title && link.url);

  const insertLinkTargetId = dom.insertLinkTargetSelect && dom.insertLinkTargetSelect.value ? dom.insertLinkTargetSelect.value : null;
  const insertLinks = Array.from(dom.insertLinksListContainer ? dom.insertLinksListContainer.querySelectorAll(".insert-link-item") : [])
    .map(item => ({
      title: item.querySelector(".insert-link-title-input") ? item.querySelector(".insert-link-title-input").value.trim() : "",
      url: item.querySelector(".insert-link-url-input") ? item.querySelector(".insert-link-url-input").value.trim() : "",
      count: item.querySelector(".insert-link-count-input") ? parseInt(item.querySelector(".insert-link-count-input").value, 10) || 1 : 1
    }))
    .filter(link => link.title && link.url);

  const common = {
    customPrompt: dom.customPromptInput ? dom.customPromptInput.value.trim() : "",
    targetAudience: dom.targetAudienceInput ? dom.targetAudienceInput.value.trim() : "",
    brand: dom.brandInput ? dom.brandInput.value.trim() : "",
    expertQuotations: quotations.length > 0 ? quotations : undefined,
    articleImages: articleImages.length > 0 ? articleImages : undefined,
    images: articleImages.length > 0 ? articleImages : undefined,
    internalLinks: internalLinks.length > 0 ? internalLinks : undefined,
  };

  if (state.currentMode === "compose") {
    return {
      ...common,
      mode: "compose",
      title: dom.titleInput ? dom.titleInput.value.trim() : "",
      topic: dom.topicInput ? dom.topicInput.value.trim() : "",
      keyphrase: dom.keyphraseInput ? dom.keyphraseInput.value.trim() : "",
      tone: dom.toneSelect ? dom.toneSelect.value : "Professional",
      styleInstructions: dom.styleInput ? dom.styleInput.value.trim() : "",
      starterArticle: dom.starterInput ? dom.starterInput.value.trim() : "",
    };
  } else if (state.currentMode === "update") {
    return {
      ...common,
      mode: "update",
      title: dom.titleInput ? dom.titleInput.value.trim() : "",
      wpUrl: dom.wpUrlInput ? dom.wpUrlInput.value.trim() : "",
      targetSubtitle: dom.targetSubtitleInput ? dom.targetSubtitleInput.value.trim() : "",
      starterWritings: dom.starterWritingsInput ? dom.starterWritingsInput.value.trim() : "",
    };
  } else if (state.currentMode === "image-seo") {
    const imgEl = dom.imagePreview;
    const isUploaded = imgEl && imgEl.style.display !== "none";
    const url = isUploaded ? (imgEl.dataset.url || "") : "";
    const base64 = isUploaded ? (imgEl.src || "") : "";
    const fileName = dom.imageFileName ? dom.imageFileName.textContent : "";
    return {
      ...common,
      mode: "image-seo",
      title: `Image SEO: ${fileName && fileName !== "No file chosen" ? fileName : "Uploaded Image"}`,
      imageUrl: url,
      imageBase64: base64,
      location: dom.imageLocationInput ? dom.imageLocationInput.value.trim() : "",
      scene: dom.imageSceneInput ? dom.imageSceneInput.value.trim() : "",
    };
  } else if (state.currentMode === "insert-link") {
    const targetItem = insertLinkTargetId ? findArticleById(insertLinkTargetId) : null;
    return {
      ...common,
      mode: "insert-link",
      title: targetItem ? `Insert Links into: ${targetItem.title || targetItem.keyphrase}` : "Insert Internal Links",
      insertLinkTargetId: insertLinkTargetId || undefined,
      articleText: targetItem ? (targetItem.article || targetItem.content || "") : "",
      links: insertLinks,
    };
  }
}

function validateForm() {
  if (!state.apiKey && !state.openaiApiKey) {
    showToast("Please set your Gemini or OpenAI API key in Settings first.", "error");
    openModal();
    return null;
  }
  const data = getFormData();
  if (!data) return null;

  if (data.mode === "compose") {
    if (!data.title) {
      showToast("Please enter an article title.", "error");
      if (dom.titleInput) dom.titleInput.focus();
      return null;
    }
    if (!data.topic) {
      showToast("Please enter a topic or core question.", "error");
      if (dom.topicInput) dom.topicInput.focus();
      return null;
    }
    if (!data.keyphrase) {
      showToast("Please enter a focus keyphrase.", "error");
      if (dom.keyphraseInput) dom.keyphraseInput.focus();
      return null;
    }
  } else if (data.mode === "update") {
    if (!data.title) {
      showToast("Please enter an article title.", "error");
      if (dom.titleInput) dom.titleInput.focus();
      return null;
    }
    if (!data.wpUrl) {
      showToast("Please enter the WordPress Post URL.", "error");
      if (dom.wpUrlInput) dom.wpUrlInput.focus();
      return null;
    }
    if (!data.targetSubtitle) {
      showToast("Please enter the Target Subtitle (H2).", "error");
      if (dom.targetSubtitleInput) dom.targetSubtitleInput.focus();
      return null;
    }
  } else if (data.mode === "image-seo") {
    if (!data.imageBase64 && !data.imageUrl) {
      showToast("Please choose an image file first.", "error");
      if (dom.imageUploadBtn) dom.imageUploadBtn.click();
      return null;
    }
  } else if (data.mode === "insert-link") {
    if (!data.insertLinkTargetId) {
      showToast("Please select a target completed article.", "error");
      if (dom.insertLinkTargetSelect) dom.insertLinkTargetSelect.focus();
      return null;
    }
    if (!data.articleText) {
      showToast("Target article has no content to insert links into.", "error");
      return null;
    }
    if (!data.links || data.links.length === 0) {
      showToast("Please add at least one internal link to insert.", "error");
      return null;
    }
  }

  return data;
}

function clearForm() {
  if (dom.titleInput) dom.titleInput.value = "";
  if (dom.wpUrlInput) dom.wpUrlInput.value = "";
  if (dom.targetSubtitleInput) dom.targetSubtitleInput.value = "";
  if (dom.topicInput) dom.topicInput.value = "";
  if (dom.keyphraseInput) dom.keyphraseInput.value = "";
  if (dom.styleInput) dom.styleInput.value = "";
  if (dom.starterInput) dom.starterInput.value = "";
  if (dom.starterWritingsInput) dom.starterWritingsInput.value = "";
  if (dom.imageFileName) dom.imageFileName.textContent = "No file chosen";
  if (dom.imagePreview) {
    dom.imagePreview.src = "";
    delete dom.imagePreview.dataset.url;
  }
  if (dom.imagePreviewContainer) dom.imagePreviewContainer.style.display = "none";
  if (dom.imageLocationInput) dom.imageLocationInput.value = "";
  if (dom.imageSceneInput) dom.imageSceneInput.value = "";
  if (dom.insertLinksListContainer) dom.insertLinksListContainer.innerHTML = "";
  if (dom.quotationsContainer) dom.quotationsContainer.innerHTML = "";
  if (dom.internalLinksContainer) dom.internalLinksContainer.innerHTML = "";
  if (dom.articleImagesContainer) {
    dom.articleImagesContainer.innerHTML = "";
    addArticleImage();
  }
  state.editingQueueId = null;
}

// ── Queue Management ─────────────────────────────────────────────
function createQueueItem(data) {
  const matchManager = state.articles ? state.articles.find(a => {
    const aTitle = (a.title || "").toLowerCase().trim();
    const aKp = (a.keyphrase || "").toLowerCase().trim();
    const dTitle = (data.title || "").toLowerCase().trim();
    const dKp = (data.keyphrase || "").toLowerCase().trim();
    return (dTitle && (aTitle === dTitle || aKp === dTitle)) || (dKp && (aKp === dKp || aTitle === dKp));
  }) : null;

  return {
    id: nextId++,
    managerId: data.managerId || (matchManager ? matchManager.id : null),
    ...data,
    status: "pending",
    progress: 0,
    progressMessage: "",
    article: "",
    wordCount: 0,
    error: "",
  };
}

function addToQueue() {
  const data = validateForm();
  if (!data) return null;

  let item = null;
  if (state.editingQueueId) {
    const idx = state.queue.findIndex(q => q.id === state.editingQueueId);
    if (idx !== -1) {
      state.queue[idx] = {
        ...state.queue[idx],
        ...data,
      };
      item = state.queue[idx];
      showToast(`"${data.title}" updated in queue.`, "success");
    } else {
      item = createQueueItem(data);
      state.queue.push(item);
      showToast(`"${item.title}" added to queue.`, "success");
    }
    state.editingQueueId = null;
  } else {
    item = createQueueItem(data);
    state.queue.push(item);
    showToast(`"${item.title}" added to queue.`, "success");
  }

  if (data.targetAudience) localStorage.setItem("af-audience", data.targetAudience);
  if (data.brand) localStorage.setItem("af-brand", data.brand);

  clearForm();
  saveQueue();
  renderQueue();
  return item;
}

function removeFromQueue(id) {
  const idx = state.queue.findIndex((q) => q.id === id);
  if (idx === -1) return;
  const item = state.queue[idx];
  if (item.status === "generating") {
    showToast("Cannot remove an article that is currently generating.", "error");
    return;
  }
  state.queue.splice(idx, 1);
  
  fetch(apiPath(`/api/queue/${id}`), { method: "DELETE" }).catch(err => console.error(err));
  
  if (state.activeItemId === id) {
    state.activeItemId = state.queue.length > 0 ? state.queue[0].id : null;
  }
  renderQueue();
  renderPreview();
  showToast("Item removed from queue.", "info");
}

window.__removeFromQueue = (id) => removeFromQueue(id);

function clearQueue() {
  if (state.isGenerating) {
    showToast("Cannot clear queue while generating.", "error");
    return;
  }
  state.queue = [];
  state.activeItemId = null;
  
  fetch(apiPath("/api/queue"), { method: "DELETE" }).catch(err => console.error(err));
  
  renderQueue();
  renderPreview();
  showToast("Queue cleared.", "info");
}

async function loadQueue() {
  try {
    const res = await fetch(apiPath("/api/queue"));
    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items)) {
        state.queue = items;
        if (items.length > 0) {
          nextId = Math.max(...items.map(q => q.id || 0), 0) + 1;
          state.activeItemId = items[0].id;
        }
      }
      renderQueue();
      renderPreview();
    }
  } catch (err) {
    console.error("Failed to load queue from server:", err);
  }
}

async function saveQueue() {
  try {
    for (const item of state.queue) {
      await fetch(apiPath("/api/queue"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
      });
    }
  } catch (err) {
    console.error("Failed to save queue to server:", err);
  }
}

function selectQueueItem(id) {
  state.activeItemId = id;
  renderQueue();
  renderPreview();
}

function findArticleById(id) {
  if (id === undefined || id === null || id === "") return null;
  const strId = String(id);
  const fromQueue = (state.queue || []).find(q => String(q.id) === strId);
  if (fromQueue) return fromQueue;
  return (state.articles || []).find(a => String(a.id) === strId) || null;
}

function populateInsertLinkTargetSelect() {
  const selectEl = dom.insertLinkTargetSelect;
  if (!selectEl) return;
  const currentVal = selectEl.value;
  selectEl.innerHTML = '<option value="">-- Choose Completed Article to Edit --</option>';

  const queueArticles = (state.queue || []).filter(item => item.status === "complete" || (item.article && item.article.trim().length > 0) || (item.content && item.content.trim().length > 0));
  const managerArticles = (state.articles || []).filter(item => item.status === "telah_dibuat" || item.status === "complete" || (item.article && item.article.trim().length > 0) || (item.content && item.content.trim().length > 0));

  const allArticles = [...queueArticles, ...managerArticles];

  const seenIds = new Set();
  allArticles.forEach(item => {
    if (!item || item.id === undefined || item.id === null) return;
    const strId = String(item.id);
    if (seenIds.has(strId)) return;
    seenIds.add(strId);
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.title || item.keyphrase || `Article #${item.id}`;
    selectEl.appendChild(option);
  });

  if (currentVal && Array.from(selectEl.options).some(opt => String(opt.value) === String(currentVal))) {
    selectEl.value = currentVal;
  }
}

function renderQueue() {
  if (dom.queueCount) dom.queueCount.textContent = state.queue.length;
  populateInsertLinkTargetSelect();

  if (!dom.queueList) return;

  if (state.queue.length === 0) {
    if (dom.emptyQueue) dom.emptyQueue.style.display = "flex";
    const items = dom.queueList.querySelectorAll(".queue-item");
    items.forEach((el) => el.remove());
    return;
  }

  if (dom.emptyQueue) dom.emptyQueue.style.display = "none";

  const existingItems = Array.from(dom.queueList.querySelectorAll(".queue-item"));
  const existingMap = new Map(existingItems.map((el) => [parseInt(el.dataset.id), el]));

  state.queue.forEach((item) => {
    let el = existingMap.get(item.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "queue-item";
      el.dataset.id = item.id;
      dom.queueList.appendChild(el);
    }
    existingMap.delete(item.id);

    el.className = `queue-item ${item.status} ${item.id === state.activeItemId ? "active" : ""}`;

    const isDone = item.status === "complete";
    const isErr = item.status === "error";

    const imagesList = item.images || item.articleImages || [];
    const hasImages = imagesList.length > 0;
    const featBadge = hasImages ? `<span class="badge badge-secondary" style="font-size:0.65rem; margin-left:4px;">🖼️ ${imagesList.length} Imgs</span>` : "";

    // Action buttons for queue list items: Regenerate, Publish, Schedule, Remove (Admin only)
    const regenBtn = item.status !== "generating" ? `<button class="btn btn-xs btn-secondary" onclick="event.stopPropagation(); window.__regenerateQueueItem(${item.id})" title="Regenerate this article">🔄 Regenerate</button>` : "";
    const pubBtn = isDone ? `<button class="btn btn-xs btn-success" onclick="event.stopPropagation(); window.__publishQueueItem(${item.id})" title="Publish directly to WordPress">🚀 Publish</button>` : "";
    const schBtn = isDone ? `<button class="btn btn-xs btn-warning" onclick="event.stopPropagation(); window.__scheduleQueueItem(${item.id})" title="Schedule WordPress publication">📅 Schedule</button>` : "";
    const removeQueueBtn = (state.isAdmin && item.status !== "generating") ? `<button class="btn btn-xs btn-ghost text-danger" onclick="event.stopPropagation(); window.__removeFromQueue(${item.id})" title="Remove item from queue">🗑️ Remove</button>` : "";

    el.innerHTML = `
      <div class="queue-item-header">
        <span class="queue-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}${featBadge}</span>
        <span class="queue-item-status status-${item.status}">${item.status === "complete" ? "✅" : item.status}</span>
      </div>
      <div class="queue-item-meta">
        <span>${item.mode === "compose" ? "📝 Compose" : item.mode === "update" ? "🔄 Update" : item.mode === "image-seo" ? "🖼️ Image SEO" : item.mode === "insert-link" ? "🔗 Insert Link" : "📝 Mode"}</span>
        ${item.keyphrase ? `<span>🔑 ${escapeHtml(item.keyphrase)}</span>` : ""}
      </div>
      ${item.status === "generating" ? `
        <div class="queue-item-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${item.progress}%"></div>
          </div>
          <div class="progress-text">
            <span>${escapeHtml(item.progressMessage)}</span>
            <span>${item.progress}%</span>
          </div>
        </div>
      ` : ""}
      ${isErr ? `<div class="queue-item-error">❌ ${escapeHtml(item.error)}</div>` : ""}
      <div class="queue-item-actions">
        ${regenBtn}
        ${pubBtn}
        ${schBtn}
        ${removeQueueBtn}
      </div>
    `;

    el.onclick = () => selectQueueItem(item.id);
  });

  existingMap.forEach((el) => el.remove());
}

// ── Dynamic Form Rows ────────────────────────────────────────────
function addQuotation(name = "", url = "", text = "") {
  if (!dom.quotationsContainer) return;
  const div = document.createElement("div");
  div.className = "quotation-item";
  div.style.cssText = "display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem;";
  div.innerHTML = `
    <input type="text" class="input quote-name" placeholder="Expert / Source Name" value="${escapeHtml(name)}" style="flex:1;">
    <input type="url" class="input quote-url" placeholder="Source URL (https://...)" value="${escapeHtml(url)}" style="flex:1.5;">
    <input type="text" class="input quote-text" placeholder="Quote excerpt..." value="${escapeHtml(text)}" style="flex:2;">
    <button type="button" class="btn btn-icon btn-ghost text-danger btn-remove-row">✕</button>
  `;
  div.querySelector(".btn-remove-row").addEventListener("click", () => div.remove());
  dom.quotationsContainer.appendChild(div);
}

function addArticleImage(imgData = {}) {
  if (!dom.articleImagesContainer) return;
  const index = dom.articleImagesContainer.querySelectorAll(".article-image-item").length + 1;
  const isFirst = index === 1;

  const div = document.createElement("div");
  div.className = "article-image-item card";
  div.style.cssText = "padding: 0.75rem; margin-bottom: 0.75rem; border: 1px dashed var(--border-subtle);";
  
  const titleLabel = isFirst 
    ? `📷 Image #1 (Featured Image — Top Banner & Main Header)`
    : `📷 Body Image #${index}`;

  div.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
      <strong style="font-size:0.85rem; color:${isFirst ? "var(--accent-text)" : "var(--text-primary)"};">${titleLabel}</strong>
      ${!isFirst ? `<button type="button" class="btn btn-sm btn-ghost text-danger btn-remove-img">Remove</button>` : ""}
    </div>
    <div style="display:flex; gap:0.75rem; align-items:flex-start; flex-wrap:wrap;">
      <div class="img-preview-box" style="width:90px; height:60px; background:rgba(0,0,0,0.1); border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--border-subtle);">
        <img class="preview-img" src="${normalizeImageUrl(imgData.imageUrl || imgData.imageBase64 || "")}" data-url="${imgData.imageUrl || ""}" style="max-width:100%; max-height:100%; object-fit:cover; display:${(imgData.imageUrl || imgData.imageBase64) ? "block" : "none"};">
        <span class="preview-placeholder" style="font-size:0.7rem; color:var(--text-secondary); display:${(imgData.imageUrl || imgData.imageBase64) ? "none" : "block"};">No Image</span>
      </div>
      <div style="flex:1; min-width:200px; display:flex; flex-direction:column; gap:0.35rem;">
        <input type="file" class="file-input-el" accept="image/*" style="display:none;">
        <button type="button" class="btn btn-sm btn-secondary btn-upload-img">Upload Image File</button>
        <input type="text" class="input input-sm image-location-input" placeholder="Location (e.g. Pasir Berbisik, Bromo)" value="${escapeHtml(imgData.location || "")}">
        <input type="text" class="input input-sm image-scene-input" placeholder="Scene Description (e.g. Jeep under Milky Way)" value="${escapeHtml(imgData.scene || "")}">
      </div>
    </div>
  `;

  const fileInput = div.querySelector(".file-input-el");
  const uploadBtn = div.querySelector(".btn-upload-img");
  const imgEl = div.querySelector(".preview-img");
  const placeholder = div.querySelector(".preview-placeholder");

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadBtn.textContent = "Uploading...";
    uploadBtn.disabled = true;

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target.result;
        const compressed = await compressImage(base64);
        imgEl.src = compressed;
        imgEl.style.display = "block";
        if (placeholder) placeholder.style.display = "none";

        const serverUrl = await uploadImageToServer(compressed);
        if (serverUrl) {
          imgEl.dataset.url = serverUrl;
        }
        uploadBtn.textContent = "Change Image";
        uploadBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      uploadBtn.textContent = "Upload Failed";
      uploadBtn.disabled = false;
    }
  });

  const removeBtn = div.querySelector(".btn-remove-img");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => div.remove());
  }

  dom.articleImagesContainer.appendChild(div);
}

function addInternalLink(title = "", url = "", count = 1, isPillar = false) {
  if (!dom.internalLinksContainer) return;
  const div = document.createElement("div");
  div.className = "internal-link-item";
  div.style.cssText = "background: var(--surface-2, #f8fafc); padding: 0.75rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #cbd5e1); margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);";

  const badgeBg = (count >= 3 || isPillar) ? "#fef3c7" : "#dbeafe";
  const badgeColor = (count >= 3 || isPillar) ? "#92400e" : "#1e40af";
  const badgeBorder = (count >= 3 || isPillar) ? "#fde68a" : "#bfdbfe";
  const badgeText = (count >= 3 || isPillar) ? `📌 Pillar (${count}x)` : `🔗 Cluster (${count}x)`;

  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px dashed var(--border, #e2e8f0);">
      <span class="link-role-badge" style="font-size:0.75rem; font-weight:600; padding:0.2rem 0.55rem; background:${badgeBg}; color:${badgeColor}; border-radius:4px; border:1px solid ${badgeBorder};">
        ${badgeText}
      </span>
      <button type="button" class="btn-remove-row" title="Remove link" style="background:none; border:none; color:var(--text-muted, #94a3b8); font-size:1.1rem; font-weight:bold; cursor:pointer; padding:0 0.3rem; line-height:1; transition:color 0.15s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted, #94a3b8)'">✕</button>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <div>
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; display: block; margin-bottom: 0.2rem;">Anchor Title / Keyword</label>
        <input type="text" class="input link-title-input" placeholder="e.g. Mount Bromo Sunrise Viewpoints" value="${escapeHtml(title)}" style="width: 100%;">
      </div>
      <div>
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; display: block; margin-bottom: 0.2rem;">Target URL</label>
        <input type="url" class="input link-url-input" placeholder="https://panoramalenstrip.com/..." value="${escapeHtml(url)}" style="width: 100%;">
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.1rem;">
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; margin-bottom: 0;">Repeat Count (Occurrences in Article)</label>
        <input type="number" class="input link-count-input" value="${count}" min="1" max="5" style="width: 70px; text-align: center;">
      </div>
    </div>
  `;
  div.querySelector(".btn-remove-row").addEventListener("click", () => div.remove());

  const countInput = div.querySelector(".link-count-input");
  if (countInput) {
    countInput.addEventListener("input", () => {
      const val = parseInt(countInput.value, 10) || 1;
      const badge = div.querySelector(".link-role-badge");
      if (badge) {
        if (val >= 3) {
          badge.style.background = "#fef3c7";
          badge.style.color = "#92400e";
          badge.style.borderColor = "#fde68a";
          badge.textContent = `📌 Pillar (${val}x)`;
        } else {
          badge.style.background = "#dbeafe";
          badge.style.color = "#1e40af";
          badge.style.borderColor = "#bfdbfe";
          badge.textContent = `🔗 Cluster (${val}x)`;
        }
      }
    });
  }

  dom.internalLinksContainer.appendChild(div);
}

function addInsertLinkRow(title = "", url = "", count = 1, isPillar = false) {
  if (!dom.insertLinksListContainer) return;
  const div = document.createElement("div");
  div.className = "insert-link-item";
  div.style.cssText = "background: var(--surface-2, #f8fafc); padding: 0.75rem 0.85rem; border-radius: 8px; border: 1px solid var(--border, #cbd5e1); margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.03);";

  const badgeBg = (count >= 3 || isPillar) ? "#fef3c7" : "#dbeafe";
  const badgeColor = (count >= 3 || isPillar) ? "#92400e" : "#1e40af";
  const badgeBorder = (count >= 3 || isPillar) ? "#fde68a" : "#bfdbfe";
  const badgeText = (count >= 3 || isPillar) ? `📌 Pillar (${count}x)` : `🔗 Cluster (${count}x)`;

  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px dashed var(--border, #e2e8f0);">
      <span class="link-role-badge" style="font-size:0.75rem; font-weight:600; padding:0.2rem 0.55rem; background:${badgeBg}; color:${badgeColor}; border-radius:4px; border:1px solid ${badgeBorder};">
        ${badgeText}
      </span>
      <button type="button" class="btn-remove-row" title="Remove link" style="background:none; border:none; color:var(--text-muted, #94a3b8); font-size:1.1rem; font-weight:bold; cursor:pointer; padding:0 0.3rem; line-height:1; transition:color 0.15s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='var(--text-muted, #94a3b8)'">✕</button>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <div>
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; display: block; margin-bottom: 0.2rem;">Anchor Title / Keyword</label>
        <input type="text" class="input insert-link-title-input" placeholder="Anchor Title to Insert" value="${escapeHtml(title)}" style="width: 100%;">
      </div>
      <div>
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; display: block; margin-bottom: 0.2rem;">Target URL</label>
        <input type="url" class="input insert-link-url-input" placeholder="https://panoramalenstrip.com/..." value="${escapeHtml(url)}" style="width: 100%;">
      </div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.1rem;">
        <label style="font-size: 0.72rem; color: var(--text-secondary, #64748b); font-weight: 600; margin-bottom: 0;">Repeat Count (Occurrences in Article)</label>
        <input type="number" class="input insert-link-count-input" value="${count}" min="1" max="5" style="width: 70px; text-align: center;">
      </div>
    </div>
  `;
  div.querySelector(".btn-remove-row").addEventListener("click", () => div.remove());

  const countInput = div.querySelector(".insert-link-count-input");
  if (countInput) {
    countInput.addEventListener("input", () => {
      const val = parseInt(countInput.value, 10) || 1;
      const badge = div.querySelector(".link-role-badge");
      if (badge) {
        if (val >= 3) {
          badge.style.background = "#fef3c7";
          badge.style.color = "#92400e";
          badge.style.borderColor = "#fde68a";
          badge.textContent = `📌 Pillar (${val}x)`;
        } else {
          badge.style.background = "#dbeafe";
          badge.style.color = "#1e40af";
          badge.style.borderColor = "#bfdbfe";
          badge.textContent = `🔗 Cluster (${val}x)`;
        }
      }
    });
  }

  dom.insertLinksListContainer.appendChild(div);
}

function autoInsertLinks() {
  if (!dom.insertLinksListContainer) return;
  const targetId = dom.insertLinkTargetSelect ? dom.insertLinkTargetSelect.value : "";
  const queueArticles = (state.queue || []).filter(i => (i.status === "complete" || (i.article && i.article.trim().length > 0) || (i.content && i.content.trim().length > 0)) && String(i.id) !== String(targetId));
  const managerArticles = (state.articles || []).filter(i => (i.status === "telah_dibuat" || i.status === "complete" || (i.article && i.article.trim().length > 0) || (i.content && i.content.trim().length > 0)) && String(i.id) !== String(targetId));

  const allAvailable = [...queueArticles, ...managerArticles];
  const seenIds = new Set();
  const availableArticles = allAvailable.filter(art => {
    if (!art || art.id === undefined || art.id === null) return false;
    const strId = String(art.id);
    if (seenIds.has(strId)) return false;
    seenIds.add(strId);
    return true;
  });

  if (availableArticles.length === 0) {
    showToast("No related articles found to auto-fill.", "info");
    return;
  }

  dom.insertLinksListContainer.innerHTML = "";
  const addedUrls = new Set();
  availableArticles.slice(0, 5).forEach(art => {
    const title = art.title || art.keyphrase || "Related Guide";
    let url = art.link || art.wpUrl || "";
    if (!url) {
      const artText = art.article || art.content || "";
      const seo = parseArticleSeoFromMarkdown(artText, art);
      if (seo.urlSlug) {
        url = `https://panoramalenstrip.com/${seo.urlSlug.replace(/^\/+|\/+$/g, '')}/`;
      } else if (art.slug) {
        url = `https://panoramalenstrip.com/${art.slug.replace(/^\/+|\/+$/g, '')}/`;
      } else {
        const cleanStr = (art.keyphrase || art.title || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');
        url = cleanStr ? `https://panoramalenstrip.com/${cleanStr}/` : `https://panoramalenstrip.com/article-${art.id}/`;
      }
    }
    if (addedUrls.has(url)) return;
    addedUrls.add(url);
    addInsertLinkRow(title, url, 1);
  });

  showToast(`Auto-filled ${addedUrls.size} related link(s).`, "success");
}

function getRelatedArticlesForCompose(item) {
  if (!state.articles || state.articles.length === 0) return [];
  
  const related = [];
  const addedUrls = new Set();

  const getItemUrl = (art) => {
    if (art.link && art.link.startsWith("http")) return art.link;
    if (art.slug) return `https://panoramalenstrip.com/${art.slug.replace(/^\//, '')}/`;
    const cleanStr = (art.keyphrase || art.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (cleanStr) return `https://panoramalenstrip.com/${cleanStr}/`;
    return "";
  };

  const itemIdx = state.articles.findIndex(a => String(a.id) === String(item.id));
  const isCluster = /cluster|sub-page|child/i.test(item.pageRole || "");

  // 1. If Cluster, find parent Pillar article (Repeated 3 to 5 times)
  let pillarItem = null;
  if (isCluster && itemIdx !== -1) {
    for (let i = itemIdx - 1; i >= 0; i--) {
      if (/pillar/i.test(state.articles[i].pageRole || "")) {
        pillarItem = state.articles[i];
        break;
      }
    }
    if (!pillarItem) {
      pillarItem = state.articles.find(a => /pillar/i.test(a.pageRole || "") && String(a.id) !== String(item.id));
    }
  }

  if (pillarItem) {
    const pillarUrl = getItemUrl(pillarItem);
    if (pillarUrl && !addedUrls.has(pillarUrl)) {
      addedUrls.add(pillarUrl);
      related.push({
        title: pillarItem.title || pillarItem.keyphrase || "Pillar Guide",
        url: pillarUrl,
        count: 4, // Repeated 3-5 times (default 4)
        isPillar: true
      });
    }
  }

  // 2. Find Cluster Related Articles (Collect 3 to 5 cluster links)
  if (itemIdx !== -1) {
    let siloStart = 0;
    let siloEnd = state.articles.length;

    for (let i = itemIdx; i >= 0; i--) {
      if (/pillar/i.test(state.articles[i].pageRole || "")) {
        siloStart = i;
        break;
      }
    }

    for (let i = itemIdx + 1; i < state.articles.length; i++) {
      if (/pillar/i.test(state.articles[i].pageRole || "")) {
        siloEnd = i;
        break;
      }
    }

    const siloArticles = state.articles.slice(siloStart, siloEnd);
    for (const art of siloArticles) {
      if (String(art.id) === String(item.id)) continue;
      if (pillarItem && String(art.id) === String(pillarItem.id)) continue;

      const url = getItemUrl(art);
      if (url && !addedUrls.has(url)) {
        addedUrls.add(url);
        related.push({
          title: art.title || art.keyphrase || "Related Article",
          url: url,
          count: 1,
          isPillar: false
        });
        const clusterCount = related.filter(r => !r.isPillar).length;
        if (clusterCount >= 4) break; // Collect up to 4 cluster links (3-5 range)
      }
    }
  }

  // 3. Keyword matching fallback to ensure 3 to 5 cluster links
  const currentClusters = related.filter(r => !r.isPillar).length;
  if (currentClusters < 3) {
    const itemWords = ((item.title || "") + " " + (item.keyphrase || ""))
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !['guide', 'best', '2026', 'tour', 'what', 'with', 'from', 'your', 'about'].includes(w));

    for (const art of state.articles) {
      if (String(art.id) === String(item.id)) continue;
      if (pillarItem && String(art.id) === String(pillarItem.id)) continue;

      const url = getItemUrl(art);
      if (!url || addedUrls.has(url)) continue;

      const artText = ((art.title || "") + " " + (art.keyphrase || "")).toLowerCase();
      const hasMatch = itemWords.some(w => artText.includes(w));
      if (hasMatch) {
        addedUrls.add(url);
        related.push({
          title: art.title || art.keyphrase || "Related Article",
          url: url,
          count: 1,
          isPillar: false
        });
        const countClusters = related.filter(r => !r.isPillar).length;
        if (countClusters >= 4) break;
      }
    }
  }

  return related;
}

async function saveAdminSettingsFromForm() {
  const settings = {
    customPrompt: dom.customPromptInput ? dom.customPromptInput.value.trim() : "",
    targetAudience: dom.targetAudienceInput ? dom.targetAudienceInput.value.trim() : "",
    brand: dom.brandInput ? dom.brandInput.value.trim() : "",
    ctaLink: dom.ctaLinkInput ? dom.ctaLinkInput.value.trim() : "",
    targetLanguage: dom.targetLanguageSelect ? dom.targetLanguageSelect.value : "English",
    tone: dom.toneSelect ? dom.toneSelect.value : "Professional",
    wordCountMode: dom.wordCountModeSelect ? dom.wordCountModeSelect.value : "total",
    wordCountDivisor: dom.wordCountDivisorInput ? parseInt(dom.wordCountDivisorInput.value, 10) || 10 : 10,
    targetWordCount: dom.targetWordCountInput ? parseInt(dom.targetWordCountInput.value, 10) || 3000 : 3000,
  };

  try {
    const res = await fetch(apiPath("/api/admin/settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    if (res.ok) {
      showToast("Admin settings saved globally!", "success");
      if (settings.targetAudience) localStorage.setItem("af-audience", settings.targetAudience);
      if (settings.brand) localStorage.setItem("af-brand", settings.brand);
    } else {
      showToast("Failed to save admin settings.", "error");
    }
  } catch (err) {
    console.error("Error saving admin settings:", err);
    showToast("Error saving admin settings.", "error");
  }
}

// ── Generation Logic ─────────────────────────────────────────────
async function regenerateQueueItem(id) {
  const item = state.queue.find((q) => q.id === id);
  if (!item) {
    showToast("Selected article not found in queue.", "error");
    return;
  }

  if (item.status === "generating") {
    showToast("Article is currently generating.", "warning");
    return;
  }

  if (!state.apiKey && !state.openaiApiKey) {
    showToast("Please set your Gemini or OpenAI API key in Settings first.", "error");
    openModal();
    return;
  }

  item.status = "pending";
  item.progress = 0;
  item.progressMessage = "Queued for regeneration...";
  item.error = "";
  item.article = "";
  item.wordCount = 0;

  saveQueue();
  renderQueue();
  if (state.activeItemId === item.id) {
    renderPreview();
  }
  showToast(`Regenerating "${item.title}"...`, "info");

  await generateArticle(item);
}

window.__regenerateQueueItem = (id) => regenerateQueueItem(id);

async function generateSingle() {
  let item = state.queue.find((q) => q.status === "pending" || q.status === "error");
  if (!item) {
    const data = validateForm();
    if (data) {
      item = createQueueItem(data);
      state.queue.push(item);
      saveQueue();
      renderQueue();
    }
  }

  if (!item) {
    showToast("Please fill in required fields or add an item to the queue.", "error");
    return;
  }

  await generateArticle(item);
}

async function generateSingleById(id) {
  const item = state.queue.find((q) => q.id === id);
  if (!item) return;
  await generateArticle(item);
}

async function generateAll() {
  if (state.isGenerating) return;
  const pendingItems = state.queue.filter((q) => q.status === "pending" || q.status === "error");
  if (pendingItems.length === 0) {
    showToast("No pending items in queue to generate.", "info");
    return;
  }
  for (const item of pendingItems) {
    await generateArticle(item);
  }
}

async function generateArticle(item) {
  state.isGenerating = true;
  item.status = "generating";
  item.progress = 0;
  item.progressMessage = "Initializing generation...";
  state.activeItemId = item.id;

  renderQueue();
  renderPreview();
  setGeneratingUI(true);

  try {
    let endpoint = apiPath("/api/generate");
    let bodyData = {
      apiKey: state.apiKey,
      openaiApiKey: state.openaiApiKey,
      model: state.model,
      customPrompt: item.customPrompt || undefined,
      targetAudience: item.targetAudience || undefined,
      brand: item.brand || undefined,
    };

    if (item.mode === "compose") {
      endpoint = apiPath("/api/generate");
      bodyData = {
        ...bodyData,
        title: item.title,
        topic: item.topic,
        keyphrase: item.keyphrase,
        tone: item.tone,
        styleInstructions: item.styleInstructions,
        starterArticle: item.starterArticle,
        expertQuotations: item.expertQuotations,
        articleImages: item.articleImages || item.images,
        images: item.articleImages || item.images,
        featuredImage: (item.articleImages && item.articleImages.length > 0) ? item.articleImages[0] : (item.images && item.images.length > 0 ? item.images[0] : undefined),
        internalLinks: item.internalLinks,
      };
    } else if (item.mode === "update") {
      endpoint = apiPath("/api/update-section");
      bodyData = {
        ...bodyData,
        title: item.title,
        wpUrl: item.wpUrl,
        targetSubtitle: item.targetSubtitle,
        starterWritings: item.starterWritings,
        expertQuotations: item.expertQuotations,
        articleImages: item.articleImages || item.images,
        images: item.articleImages || item.images,
        internalLinks: item.internalLinks,
      };
    } else if (item.mode === "image-seo") {
      endpoint = apiPath("/api/generate-image-meta");
      bodyData = {
        ...bodyData,
        imageBase64: item.imageBase64,
        imageUrl: item.imageUrl,
        location: item.location,
        scene: item.scene,
      };
    } else if (item.mode === "insert-link") {
      endpoint = apiPath("/api/insert-link");
      const targetItem = item.insertLinkTargetId ? findArticleById(item.insertLinkTargetId) : null;
      bodyData = {
        ...bodyData,
        articleText: item.articleText || (targetItem ? (targetItem.article || targetItem.content || "") : ""),
        links: item.links,
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            handleSSEEvent(item, data);
          } catch (e) {
            console.error("SSE parse error:", e);
          }
        }
      }
    }
  } catch (err) {
    item.status = "error";
    item.error = err.message;
    showToast(`Error generating "${item.title}": ${err.message}`, "error");
  } finally {
    state.isGenerating = false;
    setGeneratingUI(false);
    saveQueue();
    renderQueue();
    renderPreview();
    renderArticles();
    renderCalendar();
  }
}

function handleSSEEvent(item, data) {
  switch (data.type) {
    case "status":
    case "progress":
      item.status = "generating";
      item.progress = data.progress || data.percent || item.progress;
      item.progressMessage = data.message || item.progressMessage;
      break;
    case "delta":
      item.article = (item.article || "") + data.text;
      item.wordCount = countWords(item.article);
      break;
    case "image-seo":
      if (data.seoMeta && Array.isArray(item.images)) {
        const matchImg = item.images.find(img => img.id === data.imageId);
        if (matchImg) Object.assign(matchImg, data.seoMeta);
      }
      break;
    case "complete":
      item.status = "complete";
      item.progress = 100;
      item.progressMessage = "Complete!";
      if (data.article) item.article = data.article;
      if (data.images && Array.isArray(data.images)) item.images = data.images;
      item.wordCount = countWords(item.article);

      if (item.mode === "insert-link" && item.insertLinkTargetId) {
        const targetItem = findArticleById(item.insertLinkTargetId);
        if (targetItem) {
          targetItem.article = item.article;
          targetItem.wordCount = item.wordCount;
        }
        const mgrItem = (state.articles || []).find(a => String(a.id) === String(item.insertLinkTargetId));
        if (mgrItem) {
          mgrItem.article = item.article;
          mgrItem.wordCount = item.wordCount;
          if (typeof saveArticleItem === "function") {
            saveArticleItem(mgrItem);
          }
        }
      }

      showToast(`Successfully generated "${item.title}"!`, "success");
      break;
    case "error":
      item.status = "error";
      item.error = data.message || data.error || "Generation error";
      showToast(`Error: ${item.error}`, "error");
      break;
  }
  renderQueue();
  if (state.activeItemId === item.id) {
    renderPreview();
  }
}

function setGeneratingUI(generating) {
  if (dom.generateAllBtn) dom.generateAllBtn.disabled = generating;
  if (dom.generateSingleBtn) dom.generateSingleBtn.disabled = generating;
  if (dom.addToQueueBtn) dom.addToQueueBtn.disabled = generating;
}

// ── Preview Rendering ────────────────────────────────────────────
function renderPreview() {
  const item = state.queue.find((q) => q.id === state.activeItemId);

  if (!item || (!item.article && item.status !== "generating" && item.status !== "error")) {
    if (dom.emptyPreview) dom.emptyPreview.style.display = "flex";
    if (dom.previewActions) dom.previewActions.style.display = "none";
    if (dom.previewRendered) dom.previewRendered.style.display = "none";
    if (dom.previewRaw) dom.previewRaw.style.display = "none";
    if (dom.previewStats) dom.previewStats.style.display = "none";
    if (dom.previewImagesGallery) dom.previewImagesGallery.style.display = "none";
    return;
  }

  if (dom.emptyPreview) dom.emptyPreview.style.display = "none";
  if (dom.previewActions) dom.previewActions.style.display = "flex";
  if (dom.previewStats) dom.previewStats.style.display = "grid";

  const rawArticle = item.article || "";
  const wordCount = item.wordCount || countWords(rawArticle);

  if (dom.statWords) dom.statWords.textContent = wordCount.toLocaleString();
  if (dom.statReadTime) dom.statReadTime.textContent = `${Math.ceil(wordCount / 200)} min`;
  if (dom.statKeyphrase) {
    const kCount = item.keyphrase ? countKeyphraseOccurrences(rawArticle, item.keyphrase) : 0;
    dom.statKeyphrase.textContent = `${kCount}x (${((kCount / (wordCount || 1)) * 100).toFixed(1)}%)`;
  }
  if (dom.statSections) {
    const secCount = (rawArticle.match(/^#{1,3}\s+/gm) || []).length;
    dom.statSections.textContent = secCount;
  }

  // Get Images array
  const images = item.images || item.articleImages || [];
  const featuredImg = images.length > 0 ? images[0] : null;

  // Render Top Featured Image Card
  let featuredBannerHtml = "";
  if (featuredImg && (featuredImg.imageUrl || featuredImg.imageBase64 || featuredImg.url)) {
    const imgUrl = normalizeImageUrl(featuredImg.imageUrl || featuredImg.imageBase64 || featuredImg.url);
    featuredBannerHtml = `
      <div class="featured-image-preview-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); padding:1.25rem; margin-bottom:1.5rem; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <div style="font-size:0.75rem; font-weight:700; color:var(--accent-text); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.4rem;">
          ⭐ Dedicated Featured Image (Set on WordPress Media)
        </div>
        <div style="display:flex; gap:1.25rem; align-items:center; flex-wrap:wrap;">
          <img src="${imgUrl}" style="max-width:240px; max-height:150px; object-fit:cover; border-radius:8px; border:1px solid var(--border-subtle);">
          <div style="flex:1; min-width:220px; font-size:0.85rem; color:var(--text-secondary); display:flex; flex-direction:column; gap:0.35rem;">
            <div><strong>Location:</strong> ${escapeHtml(featuredImg.location || "-")}</div>
            <div><strong>Scene:</strong> ${escapeHtml(featuredImg.scene || "-")}</div>
            ${featuredImg.altText ? `<div><strong>Alt Text:</strong> ${escapeHtml(featuredImg.altText)}</div>` : ""}
            ${featuredImg.fileName ? `<div><strong>File Name:</strong> <code>${escapeHtml(featuredImg.fileName)}</code></div>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  // Parse markdown into HTML first
  let renderedHtml = marked.parse(rawArticle);

  // Replace each [IMAGE_N] placeholder in the rendered HTML with real <figure><img ...></figure>
  images.forEach((img, idx) => {
    const num = idx + 1;
    const imgUrl = normalizeImageUrl(img.imageUrl || img.imageBase64 || img.url);
    if (!imgUrl) return;

    const altText = img.altText || img.scene || img.location || `Article Image ${num}`;
    const captionText = img.caption || img.scene || "";

    const figHtml = `
      <figure class="article-body-image" style="margin: 2rem 0; text-align: center;">
        <img src="${imgUrl}" alt="${escapeHtml(altText)}" style="max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--border-subtle); box-shadow: 0 4px 16px rgba(0,0,0,0.12);" />
        ${captionText ? `<figcaption style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.6rem; font-style: italic; display: flex; align-items: center; justify-content: center; gap: 0.35rem;">📷 ${escapeHtml(captionText)}</figcaption>` : ""}
      </figure>
    `;

    const pPattern = new RegExp(`<p>\\s*\\[IMAGE[\\s_#]*${num}\\]\\s*<\\/p>`, "gi");
    const plainPattern = new RegExp(`\\[IMAGE[\\s_#]*${num}\\]`, "gi");

    renderedHtml = renderedHtml.replace(pPattern, figHtml).replace(plainPattern, figHtml);
  });

  if (dom.previewRendered) dom.previewRendered.innerHTML = featuredBannerHtml + renderedHtml;
  if (dom.previewRaw) dom.previewRaw.textContent = rawArticle;

  const isRawActive = dom.tabRaw && dom.tabRaw.classList.contains("active");
  if (dom.previewRendered) dom.previewRendered.style.display = isRawActive ? "none" : "block";
  if (dom.previewRaw) dom.previewRaw.style.display = isRawActive ? "block" : "none";

  // Render Image SEO & Gallery at Bottom of Article Preview
  renderImageGallery(item);
}

function renderImageGallery(item) {
  if (!dom.previewImagesGallery || !dom.galleryContainer) return;

  const images = item.images || item.articleImages || [];

  if (images.length === 0) {
    dom.previewImagesGallery.style.display = "none";
    dom.galleryContainer.innerHTML = "";
    return;
  }

  dom.previewImagesGallery.style.display = "block";
  dom.galleryContainer.innerHTML = "";

  images.forEach((img, idx) => {
    const isFeatured = idx === 0;
    const imgUrl = normalizeImageUrl(img.imageUrl || img.imageBase64 || img.url);
    const fileName = img.fileName || `image-${idx + 1}.jpg`;

    const card = document.createElement("div");
    card.className = "gallery-item-card card";
    card.style.cssText = "border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 1rem; background: var(--bg-surface); display: flex; flex-direction: column; gap: 0.75rem; box-shadow: 0 2px 8px rgba(0,0,0,0.04);";

    card.innerHTML = `
      <div style="position: relative; width: 100%; height: 170px; background: rgba(0,0,0,0.05); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-subtle);">
        <img src="${imgUrl}" style="width: 100%; height: 100%; object-fit: cover;">
        <span class="badge ${isFeatured ? "badge-primary" : "badge-secondary"}" style="position: absolute; top: 8px; left: 8px; font-size: 0.7rem;">
          ${isFeatured ? "⭐ Image #1 (Featured)" : `📷 Image #${idx + 1}`}
        </span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-direction: column; gap: 0.35rem; flex: 1;">
        <div><strong>Location:</strong> ${escapeHtml(img.location || "-")}</div>
        <div><strong>Scene:</strong> ${escapeHtml(img.scene || "-")}</div>
        ${img.fileName ? `<div><strong>File Name:</strong> <code>${escapeHtml(img.fileName)}</code></div>` : ""}
        ${img.altText ? `<div><strong>Alt Text:</strong> ${escapeHtml(img.altText)}</div>` : ""}
        ${img.title ? `<div><strong>Title:</strong> ${escapeHtml(img.title)}</div>` : ""}
        ${img.caption ? `<div><strong>Caption:</strong> ${escapeHtml(img.caption)}</div>` : ""}
        ${img.description ? `<div><strong>Description:</strong> ${escapeHtml(img.description)}</div>` : ""}
      </div>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: auto; padding-top: 0.5rem; border-top: 1px dashed var(--border-subtle);">
        ${imgUrl ? `<a href="${imgUrl}" download="${escapeHtml(fileName)}" target="_blank" class="btn btn-sm btn-primary" style="flex:1; text-align:center;">📥 Download Image</a>` : ""}
        <button type="button" class="btn btn-sm btn-secondary" onclick="window.__downloadImageMeta(${item.id}, ${idx})">📄 Download Meta</button>
        ${img.altText ? `<button type="button" class="btn btn-sm btn-ghost" onclick="window.__copyImageAlt(${item.id}, ${idx})">📋 Copy Alt</button>` : ""}
      </div>
    `;

    dom.galleryContainer.appendChild(card);
  });
}

function switchTab(tab) {
  if (tab === "rendered") {
    if (dom.tabRendered) dom.tabRendered.classList.add("active");
    if (dom.tabRaw) dom.tabRaw.classList.remove("active");
    if (dom.previewRendered) dom.previewRendered.style.display = "block";
    if (dom.previewRaw) dom.previewRaw.style.display = "none";
  } else {
    if (dom.tabRaw) dom.tabRaw.classList.add("active");
    if (dom.tabRendered) dom.tabRendered.classList.remove("active");
    if (dom.previewRendered) dom.previewRendered.style.display = "none";
    if (dom.previewRaw) dom.previewRaw.style.display = "block";
  }
}

// ── Article Manager ──────────────────────────────────────────────
async function loadArticles() {
  try {
    const res = await fetch(apiPath("/api/articles"));
    if (res.ok) {
      state.articles = await res.json();
      renderArticles();
    }
  } catch (err) {
    console.error("Failed to load articles:", err);
  }
}

function isItemInQueue(item, queue) {
  if (!queue || queue.length === 0 || !item) return null;
  const mId = item.id !== undefined && item.id !== null ? String(item.id) : null;
  const itemTitle = (item.title || "").toLowerCase().trim();
  const itemKp = (item.keyphrase || "").toLowerCase().trim();

  return queue.find(q => {
    if (mId && q.managerId !== undefined && q.managerId !== null && String(q.managerId) === mId) return true;
    const qTitle = (q.title || "").toLowerCase().trim();
    const qKp = (q.keyphrase || "").toLowerCase().trim();
    if (itemTitle && (qTitle === itemTitle || qKp === itemTitle)) return true;
    if (itemKp && (qKp === itemKp || qTitle === itemKp)) return true;
    return false;
  });
}

function updateManagerBadges() {
  if (!state.articles || !Array.isArray(state.articles)) return;

  const totalCount = state.articles.length;
  let antreanCount = 0;
  let belumCount = 0;
  let telahCount = 0;
  let dijadwalkanCount = 0;
  let draftCount = 0;

  state.articles.forEach(item => {
    const inQueue = isItemInQueue(item, state.queue);
    if (inQueue) antreanCount++;

    const status = item.status || "belum_dibuat";
    if (status === "telah_dibuat") telahCount++;
    else if (status === "dijadwalkan") dijadwalkanCount++;
    else if (status === "draft") draftCount++;
    else belumCount++;
  });

  if (!dom.badgeAll) dom.badgeAll = $("#badgeAll");
  if (!dom.badgeAntrean) dom.badgeAntrean = $("#badgeAntrean");
  if (!dom.badgeBelum) dom.badgeBelum = $("#badgeBelum");
  if (!dom.badgeTelah) dom.badgeTelah = $("#badgeTelah");
  if (!dom.badgeDijadwalkan) dom.badgeDijadwalkan = $("#badgeDijadwalkan");
  if (!dom.badgeDraft) dom.badgeDraft = $("#badgeDraft");

  if (dom.badgeAll) dom.badgeAll.textContent = totalCount;
  if (dom.badgeAntrean) dom.badgeAntrean.textContent = antreanCount;
  if (dom.badgeBelum) dom.badgeBelum.textContent = belumCount;
  if (dom.badgeTelah) dom.badgeTelah.textContent = telahCount;
  if (dom.badgeDijadwalkan) dom.badgeDijadwalkan.textContent = dijadwalkanCount;
  if (dom.badgeDraft) dom.badgeDraft.textContent = draftCount;
}

function renderArticles() {
  updateManagerBadges();
  populateInsertLinkTargetSelect();

  const container = dom.articlesTableBody;
  if (!container) return;

  container.innerHTML = "";

  const filter = state.managerFilter || "all";
  const search = (state.managerSearch || "").toLowerCase().trim();

  const filtered = state.articles.filter(item => {
    const queueItem = isItemInQueue(item, state.queue);

    if (filter === "di_antrean" && !queueItem) return false;
    if (filter !== "all" && filter !== "di_antrean" && item.status !== filter) return false;

    if (search) {
      const matchTitle = (item.title || "").toLowerCase().includes(search);
      const matchKeyphrase = (item.keyphrase || "").toLowerCase().includes(search);
      const matchTopic = (item.topic || "").toLowerCase().includes(search);
      const matchRole = (item.pageRole || "").toLowerCase().includes(search);
      const matchIntent = (item.intent || "").toLowerCase().includes(search);
      const matchQueue = queueItem ? "in queue antrean".includes(search) : false;
      return matchTitle || matchKeyphrase || matchTopic || matchRole || matchIntent || matchQueue;
    }

    return true;
  });

  if (filtered.length === 0) {
    if (dom.emptyManager) dom.emptyManager.style.display = "block";
    return;
  }

  if (dom.emptyManager) dom.emptyManager.style.display = "none";

  filtered.forEach(item => {
    const tr = document.createElement("tr");

    const queueItem = isItemInQueue(item, state.queue);

    let queueBadgeHtml = "";
    let queueTagHtml = "";
    if (queueItem) {
      tr.classList.add("row-in-queue");

      let badgeClass = "queue-badge-pending";
      let badgeText = "⏳ Dalam Antrean";

      if (queueItem.status === "generating") {
        badgeClass = "queue-badge-generating";
        badgeText = "⚙️ Sedang Generate";
      } else if (queueItem.status === "complete") {
        badgeClass = "queue-badge-complete";
        badgeText = "✅ Selesai di Antrean";
      } else if (queueItem.status === "error") {
        badgeClass = "queue-badge-error";
        badgeText = "❌ Error di Antrean";
      }

      queueBadgeHtml = `<div class="queue-badge ${badgeClass}">${badgeText}</div>`;
      queueTagHtml = `<span class="queue-tag" title="Artikel ini sudah ada di antrean generate (${queueItem.status})">📥 In Queue</span>`;
    }

    let statusText = "Belum Dibuat";
    if (item.status === "telah_dibuat") statusText = "Telah Dibuat";
    else if (item.status === "dijadwalkan") statusText = "Dijadwalkan";
    else if (item.status === "draft") statusText = "Draft";

    const statusHtml = `<div><span class="status-badge status-${item.status}">${statusText}</span>${queueBadgeHtml}</div>`;

    const titleHtml = (item.link
      ? `<a href="${item.link}" target="_blank" class="table-link" title="Open WordPress Article">${escapeHtml(item.title)}</a>`
      : escapeHtml(item.title)) + queueTagHtml;

    const adminButtons = state.isAdmin ? `
      <button class="btn btn-sm btn-ghost btn-edit-article" data-id="${item.id}" title="Edit article">✏️</button>
      <button class="btn btn-sm btn-ghost btn-delete-article text-danger" data-id="${item.id}" title="Delete article">🗑️</button>
    ` : "";

    const actionsHtml = `
      <div class="action-buttons">
        <button class="btn-table-compose" data-id="${item.id}">📝 Compose</button>
        ${adminButtons}
      </div>
    `;

    tr.innerHTML = `
      <td data-label="Page Role"><strong>${escapeHtml(item.pageRole || "-")}</strong></td>
      <td data-label="Focus Keyphrase"><code>${escapeHtml(item.keyphrase || "-")}</code></td>
      <td data-label="H1 Title (SEO)">${titleHtml}</td>
      <td data-label="Topic / Question"><span style="font-size: 0.8rem; opacity: 0.85;">${escapeHtml(item.topic || "-")}</span></td>
      <td data-label="Intent"><span class="badge badge-secondary" style="font-size: 0.75rem; text-transform: capitalize;">${escapeHtml(item.intent || "-")}</span></td>
      <td data-label="Status">${statusHtml}</td>
      <td data-label="Actions">${actionsHtml}</td>
    `;

    tr.querySelector(".btn-table-compose").addEventListener("click", () => composeArticleFromItem(item));
    if (state.isAdmin) {
      tr.querySelector(".btn-edit-article").addEventListener("click", () => openEditArticleModal(item));
      tr.querySelector(".btn-delete-article").addEventListener("click", () => deleteArticleItem(item.id));
    }

    container.appendChild(tr);
  });
}

function composeArticleFromItem(item) {
  switchView("writer");
  switchMode("compose");

  const itemTitle = (item.title || "").toLowerCase().trim();
  const itemKp = (item.keyphrase || "").toLowerCase().trim();

  const existingQueue = state.queue.find(q => 
    (q.managerId && String(q.managerId) === String(item.id)) ||
    (itemTitle && q.title && q.title.toLowerCase().trim() === itemTitle) ||
    (itemKp && q.keyphrase && q.keyphrase.toLowerCase().trim() === itemKp) ||
    (itemTitle && q.keyphrase && q.keyphrase.toLowerCase().trim() === itemTitle) ||
    (itemKp && q.title && q.title.toLowerCase().trim() === itemKp)
  );

  if (existingQueue) {
    state.editingQueueId = existingQueue.id;
  } else {
    state.editingQueueId = null;
  }

  if (dom.titleInput) dom.titleInput.value = item.title || item.topic || "";
  if (dom.topicInput) dom.topicInput.value = item.topic || item.title || "";
  if (dom.keyphraseInput) dom.keyphraseInput.value = item.keyphrase || "";
  if (dom.customPromptInput) dom.customPromptInput.value = item.customPrompt || "";
  if (dom.targetAudienceInput) dom.targetAudienceInput.value = item.targetAudience || state.targetAudience || "";
  if (dom.brandInput) dom.brandInput.value = item.brand || state.brand || "";

  if (dom.articleImagesContainer) {
    dom.articleImagesContainer.innerHTML = "";
    if (item.images && Array.isArray(item.images) && item.images.length > 0) {
      item.images.forEach(img => addArticleImage(img));
    } else {
      addArticleImage();
    }
  }

  // --- Auto Insert Related Article Backlinks ---
  if (dom.internalLinksContainer) {
    dom.internalLinksContainer.innerHTML = "";
    if (item.internalLinks && Array.isArray(item.internalLinks) && item.internalLinks.length > 0) {
      item.internalLinks.forEach(link => {
        addInternalLink(link.title || link.name || "", link.url || link.link || "", link.count || 1, link.isPillar || false);
      });
    } else if (existingQueue && existingQueue.internalLinks && Array.isArray(existingQueue.internalLinks) && existingQueue.internalLinks.length > 0) {
      existingQueue.internalLinks.forEach(link => {
        addInternalLink(link.title || link.name || "", link.url || link.link || "", link.count || 1, link.isPillar || false);
      });
    } else {
      const autoLinks = getRelatedArticlesForCompose(item);
      autoLinks.forEach(rel => {
        addInternalLink(rel.title, rel.url, rel.count || 1, rel.isPillar || false);
      });
    }
  }

  showToast(`Loaded "${item.title || item.keyphrase}" into Compose Writer.`, "info");
}

function openAddArticleModal() {
  openEditArticleModal({
    id: null,
    title: "",
    keyphrase: "",
    topic: "",
    pageRole: "Sub-page",
    intent: "Informational",
    status: "belum_dibuat",
    link: ""
  });
}

function openEditArticleModal(item) {
  state.editingArticleItem = item;
  const newTitle = prompt("Enter Article Title:", item.title || "");
  if (newTitle === null) return;
  const newKeyphrase = prompt("Enter Focus Keyphrase:", item.keyphrase || "");
  if (newKeyphrase === null) return;
  
  item.title = newTitle.trim();
  item.keyphrase = newKeyphrase.trim();
  saveArticleItem(item);
}

async function saveArticleItem(item) {
  try {
    const res = await fetch(apiPath("/api/articles"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item)
    });
    if (res.ok) {
      showToast("Article saved successfully.", "success");
      loadArticles();
    }
  } catch (err) {
    console.error("Failed to save article:", err);
  }
}

async function deleteArticleItem(id) {
  if (!confirm("Are you sure you want to delete this article entry?")) return;
  try {
    const res = await fetch(apiPath(`/api/articles/${id}`), { method: "DELETE" });
    if (res.ok) {
      showToast("Article deleted.", "info");
      loadArticles();
    }
  } catch (err) {
    console.error("Failed to delete article:", err);
  }
}

// ── Schedule Calendar ────────────────────────────────────────────
function renderCalendar() {
  if (!dom.calendarGridBody) return;

  const date = state.currentCalendarDate;
  const year = date.getFullYear();
  const month = date.getMonth();

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (dom.calendarMonthTitle) dom.calendarMonthTitle.textContent = `${monthNames[month]} ${year}`;

  dom.calendarGridBody.innerHTML = "";

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const todayStr = new Date().toISOString().split("T")[0];

  // Gather all scheduled / published events
  const eventsByDate = {};
  const processedKeys = new Set();

  const allItems = [...state.queue, ...state.articles];
  allItems.forEach(item => {
    // Only include items that are explicitly published or valid future scheduled
    const isPub = item.status === "telah_dibuat" || item.status === "published" || (!!item.publishedDate && item.status !== "pending" && item.status !== "generating" && item.status !== "complete");

    let isSch = false;
    if (!isPub && (item.status === "dijadwalkan" || item.status === "scheduled")) {
      const schDate = item.scheduledDate ? item.scheduledDate.split("T")[0].split(" ")[0] : null;
      if (schDate && schDate >= todayStr) {
        isSch = true;
      }
    }

    if (isPub || isSch) {
      const rawDate = isPub
        ? (item.publishedDate || item.scheduledDate || item.date)
        : (item.scheduledDate || item.publishedDate || item.date);

      if (rawDate && typeof rawDate === "string") {
        const dStr = rawDate.split("T")[0].split(" ")[0];
        const titleKey = (item.title || item.keyphrase || "").toLowerCase().trim();
        const uniqueKey = `${dStr}_${titleKey}`;

        if (titleKey && !processedKeys.has(uniqueKey)) {
          processedKeys.add(uniqueKey);
          if (!eventsByDate[dStr]) eventsByDate[dStr] = [];
          eventsByDate[dStr].push({
            ...item,
            _isPub: isPub,
            _isSch: isSch
          });
        }
      }
    }
  });

  // Render grid cells
  let cellCount = 0;

  // Previous Month Days
  for (let i = firstDay - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const cell = document.createElement("div");
    cell.className = "calendar-day-cell other-month";
    cell.innerHTML = `<div class="calendar-day-number">${dayNum}</div>`;
    dom.calendarGridBody.appendChild(cell);
    cellCount++;
  }

  // Current Month Days
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    const isToday = isCurrentMonth && today.getDate() === day;
    cell.className = `calendar-day-cell ${isToday ? "today" : ""}`;

    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayEvents = eventsByDate[dateStr] || [];

    let badgesHtml = "";
    if (dayEvents.length > 0) {
      const pubCount = dayEvents.filter(e => e._isPub).length;
      const schCount = dayEvents.filter(e => e._isSch && !e._isPub).length;

      if (pubCount > 0) {
        badgesHtml += `<div class="activity-badge activity-badge-published">🟢 ${pubCount} Published</div>`;
      }
      if (schCount > 0) {
        badgesHtml += `<div class="activity-badge activity-badge-scheduled">🟡 ${schCount} Scheduled</div>`;
      }
    }

    cell.innerHTML = `
      <div class="calendar-day-header">
        <span class="calendar-day-number">${day}</span>
      </div>
      <div class="calendar-activity-indicators">
        ${badgesHtml}
      </div>
    `;

    cell.addEventListener("click", () => openDayDetailsModal(dateStr, dayEvents));
    dom.calendarGridBody.appendChild(cell);
    cellCount++;
  }

  // Next Month Days padding
  const remaining = 35 - cellCount > 0 ? 35 - cellCount : 42 - cellCount;
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement("div");
    cell.className = "calendar-day-cell other-month";
    cell.innerHTML = `<div class="calendar-day-number">${i}</div>`;
    dom.calendarGridBody.appendChild(cell);
  }
}

function openDayDetailsModal(dateStr, dayEvents = []) {
  if (!dom.dayDetailsModal) return;
  if (dom.dayDetailsModalTitle) dom.dayDetailsModalTitle.textContent = `📅 Activities for ${dateStr}`;
  if (dom.dayDetailsModalSubtitle) dom.dayDetailsModalSubtitle.textContent = `${dayEvents.length} items scheduled or published on this date.`;

  if (dom.dayDetailsModalBody) {
    if (dayEvents.length === 0) {
      dom.dayDetailsModalBody.innerHTML = `<p style="color:var(--text-secondary); text-align:center; padding:1.5rem;">No articles published or scheduled for this date.</p>`;
    } else {
      let html = `<div class="day-activities-list">`;
      dayEvents.forEach(item => {
        const isPub = item._isPub !== undefined ? item._isPub : !!(item.publishedDate || item.status === "telah_dibuat" || item.status === "published");
        const statusBadge = isPub 
          ? `<span class="badge badge-success">Published</span>` 
          : `<span class="badge badge-warning">Scheduled</span>`;

        html += `
          <div class="day-activity-card">
            <div class="day-activity-header">
              <div class="day-activity-title">${escapeHtml(item.title)}</div>
              ${statusBadge}
            </div>
            <div class="day-activity-meta">
              <span>🔑 ${escapeHtml(item.keyphrase || "-")}</span>
              ${item.link ? `<span>🔗 <a href="${item.link}" target="_blank">View Post</a></span>` : ""}
            </div>
            <div class="day-activity-actions">
              <button class="btn btn-sm btn-secondary" onclick="window.__composeFromCalendar('${escapeHtml(item.title)}')">📝 Edit / Compose</button>
              <button class="btn btn-sm btn-primary" onclick="window.__rescheduleFromCalendar('${escapeHtml(item.title)}', '${dateStr}')">🚀 Reschedule / Publish</button>
            </div>
          </div>
        `;
      });
      html += `</div>`;
      dom.dayDetailsModalBody.innerHTML = html;
    }
  }

  if (dom.btnScheduleForThisDay) {
    dom.btnScheduleForThisDay.onclick = () => {
      closeDayDetailsModal();
      openScheduleModal({ date: dateStr });
    };
  }

  dom.dayDetailsModal.classList.add("active");
}

function closeDayDetailsModal() {
  if (dom.dayDetailsModal) dom.dayDetailsModal.classList.remove("active");
}

// ── Schedule Modal ───────────────────────────────────────────────
function showPublishingProgressModal(action = "publish", titleText = "") {
  if (!dom.publishingProgressModal) dom.publishingProgressModal = $("#publishingProgressModal");
  if (!dom.publishingProgressTitle) dom.publishingProgressTitle = $("#publishingProgressTitle");
  if (!dom.publishingProgressSubtitle) dom.publishingProgressSubtitle = $("#publishingProgressSubtitle");
  
  if (dom.publishingProgressTitle) {
    dom.publishingProgressTitle.textContent = action === "publish"
      ? `🚀 Publishing "${titleText || 'Article'}" to WordPress...`
      : `📅 Scheduling "${titleText || 'Article'}" for upload...`;
  }
  if (dom.publishingProgressSubtitle) {
    dom.publishingProgressSubtitle.textContent = action === "publish"
      ? "Uploading image media with SEO metadata & syncing article body with WordPress..."
      : "Setting schedule date & syncing status with WordPress...";
  }
  if (dom.publishingProgressModal) {
    dom.publishingProgressModal.classList.add("active");
  }
}

function hidePublishingProgressModal() {
  if (!dom.publishingProgressModal) dom.publishingProgressModal = $("#publishingProgressModal");
  if (dom.publishingProgressModal) {
    dom.publishingProgressModal.classList.remove("active");
  }
}

function openScheduleModal({ articleId, queueId, date, title, keyphrase, action = "publish" } = {}) {
  if (!dom.scheduleModal) return;

  if (dom.schArticleId) dom.schArticleId.value = articleId || "";
  if (dom.schQueueId) dom.schQueueId.value = queueId || "";
  if (dom.schDateInput) dom.schDateInput.value = date || new Date().toISOString().split("T")[0];
  if (dom.schTimeInput) dom.schTimeInput.value = "09:00";
  if (dom.schActionSelect) dom.schActionSelect.value = action;

  // Populate Article Select with distinct prefixed IDs
  if (dom.schArticleSelect) {
    dom.schArticleSelect.innerHTML = '<option value="">-- Select Article to Publish/Schedule --</option>';
    
    // Add Queue items first
    state.queue.forEach(i => {
      const opt = document.createElement("option");
      opt.value = `queue_${i.id}`;
      let statusLabel = "Unscheduled Queue Item";
      if (i.status === "dijadwalkan" || i.scheduledDate) {
        statusLabel = `📅 Scheduled (${i.scheduledDate || "WP"})`;
      } else if (i.status === "telah_dibuat" || i.publishedDate) {
        statusLabel = `🟢 Published (${i.publishedDate || "WP"})`;
      } else if (i.status === "generating") {
        statusLabel = "⚙️ Generating";
      } else if (i.status === "complete") {
        statusLabel = "Draft in Queue (Not Scheduled)";
      }
      opt.textContent = `[Queue] ${i.title || i.keyphrase} (${statusLabel})`;
      if ((queueId && String(i.id) === String(queueId)) || (articleId && String(i.id) === String(articleId)) || (title && i.title === title)) {
        opt.selected = true;
      }
      dom.schArticleSelect.appendChild(opt);
    });

    // Add Manager items
    if (state.articles) {
      state.articles.forEach(i => {
        const opt = document.createElement("option");
        opt.value = `manager_${i.id}`;
        opt.textContent = `[Manager] ${i.title || i.keyphrase} (${i.status || "draft"})`;
        // Only select manager item if no queue item was matched
        if (!dom.schArticleSelect.value && ((articleId && String(i.id) === String(articleId)) || (title && i.title === title))) {
          opt.selected = true;
        }
        dom.schArticleSelect.appendChild(opt);
      });
    }
  }

  dom.scheduleModal.classList.add("active");
}

function closeScheduleModal() {
  if (dom.scheduleModal) dom.scheduleModal.classList.remove("active");
}

async function saveScheduleModal() {
  const selectedValue = dom.schArticleSelect ? dom.schArticleSelect.value : "";
  const action = dom.schActionSelect ? dom.schActionSelect.value : "publish";
  const dateStr = dom.schDateInput ? dom.schDateInput.value : "";
  const timeStr = dom.schTimeInput ? dom.schTimeInput.value : "09:00";

  let targetItem = null;
  if (selectedValue.startsWith("queue_")) {
    const qId = selectedValue.replace("queue_", "");
    targetItem = state.queue.find(i => String(i.id) === qId);
  } else if (selectedValue.startsWith("manager_")) {
    const mId = selectedValue.replace("manager_", "");
    targetItem = state.articles ? state.articles.find(i => String(i.id) === mId) : null;
  } else if (selectedValue) {
    targetItem = state.queue.find(i => String(i.id) === String(selectedValue)) ||
                 (state.articles ? state.articles.find(i => String(i.id) === String(selectedValue)) : null);
  }

  if (!targetItem) {
    const queueId = dom.schQueueId ? dom.schQueueId.value : null;
    if (queueId) {
      targetItem = state.queue.find(i => String(i.id) === String(queueId));
    }
  }

  if (!targetItem) {
    showToast("Please select an article to publish or schedule.", "error");
    return;
  }

  // Ensure full article content is passed
  const articleContent = targetItem.article || targetItem.content || "";
  const imagesList = targetItem.images || targetItem.articleImages || [];

  showPublishingProgressModal(action, targetItem.title || targetItem.keyphrase);
  if (dom.btnSaveScheduleModal) dom.btnSaveScheduleModal.disabled = true;

  try {
    const res = await fetch(apiPath("/api/articles/schedule-publish"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        articleId: targetItem.id,
        title: targetItem.title || targetItem.keyphrase,
        keyphrase: targetItem.keyphrase || targetItem.title,
        action,
        date: `${dateStr} ${timeStr}`,
        content: articleContent,
        images: imagesList
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Article successfully ${action === "publish" ? "published" : "scheduled"}!`, "success");
      closeScheduleModal();
      loadQueue();
      if (typeof loadArticles === "function") loadArticles();
      if (typeof renderCalendar === "function") renderCalendar();
    } else {
      showToast(`Failed to ${action}: ${data.wpError || data.error || "Server error"}`, "error");
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, "error");
  } finally {
    hidePublishingProgressModal();
    if (dom.btnSaveScheduleModal) dom.btnSaveScheduleModal.disabled = false;
  }
}

function scheduleQueueItem(id) {
  const item = state.queue.find(q => q.id === id);
  openScheduleModal({ queueId: id, title: item ? item.title : "", action: "schedule" });
}

function publishQueueItem(id) {
  const item = state.queue.find(q => q.id === id);
  openScheduleModal({ queueId: id, title: item ? item.title : "", action: "publish" });
}

function editQueueItem(id) {
  const item = state.queue.find(q => q.id === id);
  if (item) openEditContentModal(item);
}

// ── Edit Content Modal & SEO Parser ──────────────────────────────
function parseArticleSeoFromMarkdown(rawMarkdown, fallbackItem = {}) {
  if (!rawMarkdown && !fallbackItem) return {};
  const result = {
    metaTitle: fallbackItem.metaTitle || fallbackItem.title || '',
    focusKeyphrase: fallbackItem.focusKeyphrase || fallbackItem.keyphrase || '',
    metaDescription: fallbackItem.metaDescription || fallbackItem.description || '',
    urlSlug: fallbackItem.urlSlug || fallbackItem.slug || '',
    pageRole: fallbackItem.pageRole || '',
    categories: fallbackItem.categories || fallbackItem.category || '',
    tags: fallbackItem.tags || '',
    excerpt: fallbackItem.excerpt || ''
  };

  if (rawMarkdown) {
    const match = rawMarkdown.match(/(?:^|\n)>\s*\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i) ||
                  rawMarkdown.match(/(?:^|\n)#{1,4}\s*SEO Metadata([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i) ||
                  rawMarkdown.match(/(?:^|\n)\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i);

    if (match) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        const titleM = line.match(/\*\*Meta Title:\*\*\s*(.+)/i);
        if (titleM) result.metaTitle = titleM[1].trim();

        const kpM = line.match(/\*\*Focus Keyphrase:\*\*\s*(.+)/i);
        if (kpM) result.focusKeyphrase = kpM[1].trim();

        const descM = line.match(/\*\*Meta Description:\*\*\s*(.+)/i);
        if (descM) result.metaDescription = descM[1].trim();

        const slugM = line.match(/\*\*URL Slug:\*\*\s*(.+)/i);
        if (slugM) result.urlSlug = slugM[1].trim().toLowerCase().replace(/^\/+|\/+$/g, '');

        const roleM = line.match(/\*\*Page Role:\*\*\s*(.+)/i);
        if (roleM && roleM[1].trim() !== 'undefined') result.pageRole = roleM[1].trim();

        const catM = line.match(/\*\*Categories:\*\*\s*(.+)/i);
        if (catM && catM[1].trim() !== '[Your Categories]' && catM[1].trim() !== 'undefined') result.categories = catM[1].trim();

        const tagsM = line.match(/\*\*Tags:\*\*\s*(.+)/i);
        if (tagsM && tagsM[1].trim() !== '[Your Tags]' && tagsM[1].trim() !== 'undefined') result.tags = tagsM[1].trim();

        const excerptM = line.match(/\*\*Excerpt:\*\*\s*(.+)/i);
        if (excerptM && excerptM[1].trim() !== '[Your Excerpt]' && excerptM[1].trim() !== 'undefined') result.excerpt = excerptM[1].trim();
      }
    }
  }

  return result;
}

function openEditContentModal(itemToEdit = null) {
  if (!dom.editContentModal) return;
  const item = itemToEdit || state.queue.find(q => q.id === state.activeItemId) || (state.articles ? state.articles.find(a => a.id === state.activeItemId) : null);
  if (!item) return;

  state.activeItemId = item.id;
  const rawArticle = item.article || "";
  const parsedSeo = parseArticleSeoFromMarkdown(rawArticle, item);

  if (dom.metaKeyphraseInput) dom.metaKeyphraseInput.value = item.keyphrase || item.focusKeyphrase || parsedSeo.focusKeyphrase || "";
  if (dom.metaTitleInput) dom.metaTitleInput.value = item.metaTitle || item.title || parsedSeo.metaTitle || "";
  if (dom.metaSlugInput) dom.metaSlugInput.value = item.urlSlug || item.slug || parsedSeo.urlSlug || "";
  if (dom.metaPageRoleInput) dom.metaPageRoleInput.value = item.pageRole || parsedSeo.pageRole || "";
  if (dom.metaCategoriesInput) dom.metaCategoriesInput.value = item.categories || item.category || parsedSeo.categories || "";
  if (dom.metaTagsInput) dom.metaTagsInput.value = item.tags || parsedSeo.tags || "";
  if (dom.metaDescriptionInput) dom.metaDescriptionInput.value = item.metaDescription || item.description || parsedSeo.metaDescription || "";
  if (dom.metaExcerptInput) dom.metaExcerptInput.value = item.excerpt || parsedSeo.excerpt || "";

  if (dom.editContentTextarea) dom.editContentTextarea.value = rawArticle;
  dom.editContentModal.classList.add("active");
}

function closeEditContentModal() {
  if (dom.editContentModal) dom.editContentModal.classList.remove("active");
}

async function saveEditContentModal() {
  let item = state.queue.find(q => q.id === state.activeItemId);
  if (!item && state.articles) {
    item = state.articles.find(a => a.id === state.activeItemId);
  }
  if (!item) return;

  const focusKeyphrase = dom.metaKeyphraseInput ? dom.metaKeyphraseInput.value.trim() : (item.keyphrase || item.focusKeyphrase || "");
  const metaTitle = dom.metaTitleInput ? dom.metaTitleInput.value.trim() : (item.metaTitle || item.title || "");
  const urlSlug = dom.metaSlugInput ? dom.metaSlugInput.value.trim() : (item.urlSlug || item.slug || "");
  const pageRole = dom.metaPageRoleInput ? dom.metaPageRoleInput.value.trim() : (item.pageRole || "");
  const categories = dom.metaCategoriesInput ? dom.metaCategoriesInput.value.trim() : (item.categories || item.category || "");
  const tags = dom.metaTagsInput ? dom.metaTagsInput.value.trim() : (item.tags || "");
  const metaDescription = dom.metaDescriptionInput ? dom.metaDescriptionInput.value.trim() : (item.metaDescription || item.description || "");
  const excerpt = dom.metaExcerptInput ? dom.metaExcerptInput.value.trim() : (item.excerpt || "");
  let rawContent = dom.editContentTextarea ? dom.editContentTextarea.value : (item.article || "");

  item.keyphrase = focusKeyphrase;
  item.focusKeyphrase = focusKeyphrase;
  item.title = metaTitle || item.title;
  item.metaTitle = metaTitle;
  item.slug = urlSlug;
  item.urlSlug = urlSlug;
  item.pageRole = pageRole;
  item.categories = categories;
  item.category = categories;
  item.tags = tags;
  item.metaDescription = metaDescription;
  item.description = metaDescription;
  item.excerpt = excerpt;

  const newSeoBlock = `> **SEO Metadata:**
> - **Meta Title:** ${metaTitle}
> - **Focus Keyphrase:** ${focusKeyphrase}
> - **Meta Description:** ${metaDescription}
> - **URL Slug:** ${urlSlug}
> - **Page Role:** ${pageRole}
> - **Categories:** ${categories}
> - **Tags:** ${tags}
> - **Excerpt:** ${excerpt}`;

  const seoBlockRegex = /(?:^|\n)>\s*\*\*SEO Metadata:\*\*([\s\S]*?)(?=\n\s*\n|\n---|#|$)/i;
  if (seoBlockRegex.test(rawContent)) {
    rawContent = rawContent.replace(seoBlockRegex, `
${newSeoBlock}
`);
  } else {
    if (metaTitle || focusKeyphrase || metaDescription || urlSlug) {
      rawContent = `${newSeoBlock}

---

${rawContent.trim()}`;
    }
  }

  item.article = rawContent;
  item.wordCount = countWords(item.article);

  const qItem = state.queue.find(q => q.id === item.id);
  if (qItem) {
    Object.assign(qItem, item);
  }

  if (state.articles) {
    const mIndex = state.articles.findIndex(a => a.id === item.id || (a.keyphrase && a.keyphrase === item.keyphrase) || (a.title && a.title === item.title));
    if (mIndex !== -1) {
      Object.assign(state.articles[mIndex], item);
      saveArticleItem(state.articles[mIndex]);
    }
  }

  saveQueue();
  renderQueue();
  if (state.articles) renderArticles();
  renderPreview();
  closeEditContentModal();
  showToast("Article content & SEO metadata updated successfully!", "success");

  try {
    await fetch(apiPath("/api/queue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.queue)
    });
  } catch (e) {
    console.error("Failed to sync queue to backend:", e);
  }
}

// ── Settings Modal & Theme ───────────────────────────────────────
async function loadGlobalSettings() {
  try {
    const res = await fetch(apiPath("/api/admin/settings"));
    if (res.ok) {
      const settings = await res.json();
      if (settings.wpUrl && dom.wpSiteUrlInput) dom.wpSiteUrlInput.value = settings.wpUrl;
      if (settings.wpUsername && dom.wpUsernameInput) dom.wpUsernameInput.value = settings.wpUsername;
      if (settings.wpAppPassword && dom.wpAppPasswordInput) dom.wpAppPasswordInput.value = settings.wpAppPassword;
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

function openModal() {
  if (dom.settingsModal) dom.settingsModal.classList.add("active");
}

function closeModal() {
  if (dom.settingsModal) dom.settingsModal.classList.remove("active");
}

async function syncWordPressData() {
  showToast("Syncing articles with WordPress REST API...", "info");
  try {
    const res = await fetch(apiPath("/api/articles/sync-wp"), { method: "POST" });
    const data = await res.json();
    if (res.ok && data.success) {
      let toastMsg = data.message || "WordPress sync complete!";
      if (data.purgedCount > 0) {
        toastMsg += ` (${data.purgedCount} deleted WP posts cleaned up)`;
      }
      showToast(toastMsg, "success");
    } else {
      showToast(`WordPress Sync Warning: ${data.error || "Failed to sync WordPress data."}`, "error");
    }
    await loadArticles();
    await loadQueue();
    if (typeof renderCalendar === "function") renderCalendar();
  } catch (err) {
    showToast(`Sync Error: ${err.message}`, "error");
  }
}

async function testWpConnection() {
  const wpUrl = dom.wpSiteUrlInput ? dom.wpSiteUrlInput.value.trim() : "";
  const wpUsername = dom.wpUsernameInput ? dom.wpUsernameInput.value.trim() : "";
  const wpAppPassword = dom.wpAppPasswordInput ? dom.wpAppPasswordInput.value.trim() : "";

  showToast("Testing WordPress API connection...", "info");
  try {
    const res = await fetch(apiPath("/api/admin/test-wp-connection"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpUrl, wpUsername, wpAppPassword })
    });
    const data = await res.json();
    if (data.success && data.authenticated) {
      showToast(`✅ ${data.message}`, "success");
    } else if (data.success) {
      showToast(`ℹ️ ${data.message}`, "info");
    } else {
      showToast(`❌ ${data.error || "WordPress connection test failed."}`, "error");
    }
    return data;
  } catch (err) {
    showToast(`❌ Connection Test Error: ${err.message}`, "error");
    return { success: false, error: err.message };
  }
}

async function saveSettings() {
  state.apiKey = dom.apiKeyInput ? dom.apiKeyInput.value.trim() : "";
  state.openaiApiKey = dom.openaiKeyInput ? dom.openaiKeyInput.value.trim() : "";
  state.model = dom.modelSelect ? dom.modelSelect.value : "gemini-2.5-flash";

  localStorage.setItem("af-api-key", state.apiKey);
  localStorage.setItem("af-openai-key", state.openaiApiKey);
  localStorage.setItem("af-model", state.model);

  const wpUrl = dom.wpSiteUrlInput ? dom.wpSiteUrlInput.value.trim() : "";
  const wpUsername = dom.wpUsernameInput ? dom.wpUsernameInput.value.trim() : "";
  const wpAppPassword = dom.wpAppPasswordInput ? dom.wpAppPasswordInput.value.trim() : "";

  showToast("Saving settings & validating WordPress API...", "info");

  try {
    const token = localStorage.getItem("af-admin-token");
    const res = await fetch(apiPath("/api/admin/settings"), {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        wpUrl,
        wpUsername,
        wpAppPassword,
        testConnection: true
      })
    });

    if (res.ok) {
      const data = await res.json();
      const wpV = data.wpVerification;
      if (wpV) {
        if (wpV.success && wpV.authenticated) {
          showToast(`✅ Settings saved! Connected to WordPress as "${wpV.user}".`, "success");
        } else if (wpV.success) {
          showToast(`ℹ️ Settings saved! Connected to WordPress REST API (Public Access).`, "info");
        } else {
          showToast(`⚠️ Settings saved, but WP API Check Failed: ${wpV.error}`, "error");
        }
      } else {
        showToast("Settings saved successfully.", "success");
      }
    } else {
      showToast("Failed to save settings to server.", "error");
    }
  } catch (e) {
    console.error("Failed to save WP settings:", e);
    showToast(`Error: ${e.message}`, "error");
  }

  updateApiStatus();
  closeModal();
}

function toggleKeyVisibility() {
  if (!dom.apiKeyInput) return;
  dom.apiKeyInput.type = dom.apiKeyInput.type === "password" ? "text" : "password";
}

function toggleOpenaiKeyVisibility() {
  if (!dom.openaiKeyInput) return;
  dom.openaiKeyInput.type = dom.openaiKeyInput.type === "password" ? "text" : "password";
}

function updateApiStatus() {
  if (!dom.apiStatus) return;
  const statusTxt = dom.apiStatus.querySelector(".status-text");
  if (statusTxt) {
    statusTxt.textContent = state.apiKey ? "API Configured" : "API Key Required";
  }
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("af-theme", state.theme);
  applyTheme();
}

// ── Image Handling ───────────────────────────────────────────────
function compressImage(base64, maxWidth = 1000, maxHeight = 1000, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    img.onerror = () => resolve(base64);
  });
}

async function uploadImageToServer(base64Data) {
  try {
    const res = await fetch(apiPath("/api/upload"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64Data, base64: base64Data })
    });
    if (res.ok) {
      const data = await res.json();
      return data.url;
    }
  } catch (err) {
    console.error("Failed to upload image to server:", err);
  }
  return null;
}

// ── Utility Helpers ──────────────────────────────────────────────
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function countKeyphraseOccurrences(text, keyphrase) {
  if (!text || !keyphrase) return 0;
  const escaped = escapeRegExp(keyphrase);
  const regex = new RegExp(escaped, "gi");
  return (text.match(regex) || []).length;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function copyToClipboard() {
  const item = state.queue.find((q) => q.id === state.activeItemId);
  if (!item || !item.article) return;

  navigator.clipboard.writeText(item.article).then(() => {
    showToast("Copied article to clipboard!", "success");
  }).catch(() => {
    fallbackCopyText(item.article);
  });
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand("copy");
    showToast("Copied article to clipboard!", "success");
  } catch (err) {
    showToast("Failed to copy text.", "error");
  }
  document.body.removeChild(textArea);
}

function downloadAsTxt() {
  const item = state.queue.find((q) => q.id === state.activeItemId);
  if (!item || !item.article) return;

  const blob = new Blob([item.article], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(item.title || "article").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showToast(message, type = "info") {
  if (!dom.toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icons = {
    success: "✓",
    error: "✕",
    info: "ℹ",
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ"}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;

  dom.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── Global Window Bindings ───────────────────────────────────────
window.__selectItem = selectQueueItem;
window.__removeItem = removeFromQueue;
window.__generateOne = (id) => generateSingleById(id);
window.__regenerate = async (id) => {
  const item = state.queue.find(q => q.id === id);
  if (item) {
    item.article = "";
    item.status = "pending";
    item.progress = 0;
    await generateArticle(item);
  }
};
window.__publishQueueItem = (id) => publishQueueItem(id);
window.__scheduleQueueItem = (id) => scheduleQueueItem(id);
window.__editQueueItem = (id) => editQueueItem(id);

window.__composeFromCalendar = (title) => {
  closeDayDetailsModal();
  const item = [...state.queue, ...state.articles].find(i => i.title === title) || { title };
  composeArticleFromItem(item);
};

window.__rescheduleFromCalendar = (title, dateStr) => {
  closeDayDetailsModal();
  const item = [...state.queue, ...state.articles].find(i => i.title === title) || { title };
  openScheduleModal({ articleId: item.id, title: item.title, date: dateStr });
};

window.__downloadImageMeta = (itemId, imgIdx) => {
  const item = state.queue.find(q => q.id === itemId);
  if (!item) return;
  const images = item.images || item.articleImages || [];
  const img = images[imgIdx];
  if (!img) return;

  const content = `IMAGE SEO METADATA
========================================
Article Title: ${item.title || '-'}
Image Index  : #${imgIdx + 1} ${imgIdx === 0 ? '(Featured Image)' : ''}
File Name    : ${img.fileName || ('image-' + (imgIdx + 1) + '.jpg')}
Location     : ${img.location || '-'}
Scene        : ${img.scene || '-'}
Alt Text     : ${img.altText || '-'}
Title        : ${img.title || '-'}
Caption      : ${img.caption || '-'}
Description  : ${img.description || '-'}
URL          : ${normalizeImageUrl(img.imageUrl || img.imageBase64 || img.url || '')}
`;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${img.fileName || ('image-' + (imgIdx + 1) + '.jpg')}.meta.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Downloaded Image SEO metadata.", "success");
};

window.__copyImageAlt = (itemId, imgIdx) => {
  const item = state.queue.find(q => q.id === itemId);
  if (!item) return;
  const images = item.images || item.articleImages || [];
  const img = images[imgIdx];
  if (!img || !img.altText) return;

  navigator.clipboard.writeText(img.altText).then(() => {
    showToast("Copied Alt Text to clipboard!", "success");
  }).catch(() => {
    fallbackCopyText(img.altText);
  });
};

// ── Start Application ────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
