import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../ui/nav.js";
import { setFormEnabledFromSession, signInWithGithub } from "./submitAuth.js";

function nullifyEmptyStrings(formData) {
  Object.keys(formData).forEach(k => {
    if (formData[k] === "") formData[k] = null;
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  initSubmitNav();

  const form = document.getElementById("lighthouseForm");
  const loginBtn = document.getElementById("loginBtn");
  const resultDiv = document.getElementById("result");

  loginBtn?.addEventListener("click", signInWithGithub);
  await setFormEnabledFromSession({ form, loginBtn });

  form?.addEventListener("submit", async e => {
    e.preventDefault();

    if (resultDiv) {
      resultDiv.style.display = "none";
      resultDiv.className = "result";
    }

    const formData = Object.fromEntries(new FormData(form));
    nullifyEmptyStrings(formData);

    const { data, error } = await supabaseClient
      .from("lighthouses")
      .insert([formData])
      .select("id")
      .single();

    if (error) {
      if (resultDiv) {
        resultDiv.textContent = "Error: " + error.message;
        resultDiv.classList.add("error");
        resultDiv.style.display = "block";
      }
      return;
    }

    const id = data.id;
    if (resultDiv) {
      resultDiv.textContent = `Lighthouse added successfully. ID: ${id}`;
      resultDiv.classList.add("success");
      resultDiv.style.display = "block";
    }

    form.reset();
  });
});

