/**
 * Maintainer admin hub (admin.html): OAuth login; tool links shown only when logged in.
 */

import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "./submitAuth.js";

function setHubListVisible(visible) {
  const hubList = document.getElementById("adminHubList");
  if (!hubList) return;
  hubList.hidden = !visible;
}

document.addEventListener("DOMContentLoaded", async () => {
  const loginBtn = document.getElementById("loginBtn");
  const noticeEl = document.getElementById("submitAdminNotice");

  async function refreshAuth() {
    const hasSession = await setFormEnabledFromSession({ form: null, loginBtn, noticeEl });
    setHubListVisible(hasSession);
  }

  loginBtn?.addEventListener("click", async () => {
    await handleSubmitAuthButtonClick({ form: null, loginBtn, noticeEl });
    await refreshAuth();
  });

  await refreshAuth();
});
