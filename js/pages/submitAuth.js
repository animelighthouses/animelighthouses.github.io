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

export async function setFormEnabledFromSession({ form, loginBtn }) {
  await exchangeCodeForSession();
  const { data } = await supabaseClient.auth.getSession();
  const hasSession = Boolean(data?.session);

  if (!form || !loginBtn) return hasSession;

  if (hasSession) {
    form.style.opacity = 1;
    form.style.pointerEvents = "auto";

    loginBtn.disabled = true;
    loginBtn.textContent = "Logged in";
    loginBtn.style.background = "#4caf50";
    loginBtn.style.color = "white";
    loginBtn.style.pointerEvents = "none";
  } else {
    form.style.opacity = 0.5;
    form.style.pointerEvents = "none";

    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
    loginBtn.style.background = "";
    loginBtn.style.color = "";
    loginBtn.style.pointerEvents = "auto";
  }

  return hasSession;
}

