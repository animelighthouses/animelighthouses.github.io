/**
 * Shared GitHub OAuth + form gating for submit pages.
 *
 * PRD 2.10: GitHub via Supabase; forms only usable when a session exists.
 */

import supabaseClient from "../supabaseClient.js";

export async function exchangeCodeForSession() {
  try {
    await supabaseClient.auth.exchangeCodeForSession(window.location.href);
  } catch {
    // no-op: invalid/missing OAuth code is normal on fresh load
  }
}

export async function signInWithGithub() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: window.location.href }
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

export async function setFormEnabledFromSession({ form, loginBtn }) {
  await exchangeCodeForSession();
  const { data } = await supabaseClient.auth.getSession();
  const hasSession = Boolean(data?.session);

  if (!form || !loginBtn) return hasSession;

  if (hasSession) {
    form.style.opacity = 1;
    form.style.pointerEvents = "auto";
    setFormControlsDisabled(form, false);

    loginBtn.disabled = true;
    loginBtn.textContent = "Logged in";
    loginBtn.style.background = "#4caf50";
    loginBtn.style.color = "white";
    loginBtn.style.pointerEvents = "none";
  } else {
    form.style.opacity = 0.5;
    form.style.pointerEvents = "none";
    setFormControlsDisabled(form, true);

    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
    loginBtn.style.background = "";
    loginBtn.style.color = "";
    loginBtn.style.pointerEvents = "auto";
  }

  return hasSession;
}

