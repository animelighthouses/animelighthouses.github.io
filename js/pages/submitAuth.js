/**
 * Shared GitHub OAuth and form gating for submit, admin, and edit pages.
 *
 * Uses Supabase Auth (signInWithOAuth, exchangeCodeForSession, getSession, signOut).
 * Forms stay disabled until a session exists; RLS on the database is still authoritative.
 *
 * Pages under /tools/ are not in the Supabase redirect allowlist, so OAuth starts from
 * those URLs are routed through /admin (which is allowlisted) and then back via
 * sessionStorage.
 */

import supabaseClient from "../supabaseClient.js";

const OAUTH_RETURN_PATH_KEY = "toudai-oauth-return-path";

/** Paths that Supabase already accepts as redirectTo targets. */
const OAUTH_CALLBACK_PATHS = new Set([
  "/admin",
  "/admin.html",
  "/submit-admin",
  "/submit-admin.html",
  "/submitl",
  "/submitl.html",
  "/submiti",
  "/submiti.html",
  "/edit",
  "/edit.html",
  "/review",
  "/review.html"
]);

function currentDocumentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function isOAuthCallbackPath(pathname) {
  return OAUTH_CALLBACK_PATHS.has(pathname);
}

function hasAuthCallbackParams() {
  const search = new URLSearchParams(window.location.search);
  if (search.has("code") || search.has("error")) {
    return true;
  }

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) {
    return false;
  }

  const hashParams = new URLSearchParams(hash);
  return (
    hashParams.has("access_token") ||
    hashParams.has("code") ||
    hashParams.has("error")
  );
}

function saveOAuthReturnPath() {
  sessionStorage.setItem(OAUTH_RETURN_PATH_KEY, currentDocumentPath());
}

function consumeOAuthReturnPath() {
  const returnPath = sessionStorage.getItem(OAUTH_RETURN_PATH_KEY);
  if (!returnPath) {
    return;
  }

  sessionStorage.removeItem(OAUTH_RETURN_PATH_KEY);
  if (returnPath === currentDocumentPath()) {
    return;
  }

  window.location.replace(returnPath);
}

function getOAuthRedirectUrl() {
  if (isOAuthCallbackPath(window.location.pathname)) {
    return window.location.href;
  }

  return `${window.location.origin}/admin`;
}

export async function exchangeCodeForSession() {
  if (!hasAuthCallbackParams()) {
    return false;
  }

  try {
    await supabaseClient.auth.exchangeCodeForSession(window.location.href);
    return true;
  } catch {
    return false;
  }
}

/**
 * Handles OAuth callbacks that land on the site root when Supabase falls back to Site URL.
 * Import from index/main entry only.
 */
export async function completeOAuthReturnIfNeeded() {
  if (!hasAuthCallbackParams()) {
    return;
  }

  const exchanged = await exchangeCodeForSession();
  if (!exchanged) {
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (data?.session) {
    consumeOAuthReturnPath();
  }
}

export async function signInWithGithub() {
  saveOAuthReturnPath();
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: getOAuthRedirectUrl() }
  });
  if (error) console.error(error);
}

/** Disables every control inside the form (stronger than pointer-events alone). */
function setFormControlsDisabled(form, disabled) {
  if (!form?.elements) return;
  Array.from(form.elements).forEach(el => {
    if ("disabled" in el) el.disabled = disabled;
  });
}

function setNoticeVisible(noticeEl, visible) {
  if (!noticeEl) return;
  if (visible) noticeEl.removeAttribute("hidden");
  else noticeEl.setAttribute("hidden", "");
}

function applyLoginButtonState(loginBtn, hasSession) {
  if (!loginBtn) return;
  loginBtn.disabled = false;
  loginBtn.textContent = hasSession ? "Log out" : "Login";
  if (hasSession) {
    loginBtn.style.background = "#4caf50";
    loginBtn.style.color = "white";
  } else {
    loginBtn.style.background = "";
    loginBtn.style.color = "";
  }
  loginBtn.style.pointerEvents = "auto";
}

export async function setFormEnabledFromSession({ form, loginBtn, noticeEl }) {
  const exchanged = await exchangeCodeForSession();
  const { data } = await supabaseClient.auth.getSession();
  const hasSession = Boolean(data?.session);

  if (hasSession && exchanged) {
    consumeOAuthReturnPath();
  }

  if (!loginBtn) return hasSession;

  if (form) {
    if (hasSession) {
      form.style.opacity = 1;
      form.style.pointerEvents = "auto";
      setFormControlsDisabled(form, false);
      setNoticeVisible(noticeEl, false);
    } else {
      form.style.opacity = 0.5;
      form.style.pointerEvents = "none";
      setFormControlsDisabled(form, true);
      setNoticeVisible(noticeEl, true);
    }
  } else {
    setNoticeVisible(noticeEl, !hasSession);
  }

  applyLoginButtonState(loginBtn, hasSession);
  return hasSession;
}

export async function handleSubmitAuthButtonClick({ form, loginBtn, noticeEl }) {
  const { data } = await supabaseClient.auth.getSession();
  if (data?.session) {
    await supabaseClient.auth.signOut();
    await setFormEnabledFromSession({ form, loginBtn, noticeEl });
  } else {
    await signInWithGithub();
  }
}
