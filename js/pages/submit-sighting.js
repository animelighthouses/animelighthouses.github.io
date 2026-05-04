import supabaseClient from "../supabaseClient.js";
import { initSubmitNav } from "../ui/nav.js";
import { setFormEnabledFromSession, signInWithGithub } from "./submitAuth.js";

function nullifyEmptyStrings(formData) {
  Object.keys(formData).forEach(k => {
    if (formData[k] === "") formData[k] = null;
  });
}

function parseAniListUrl(url) {
  try {
    const match = url.match(/anilist\.co\/(anime|manga)\/(\d+)/);
    if (!match) return null;
    return { type: match[1], id: match[2] };
  } catch {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // #region agent log
  fetch('http://127.0.0.1:7410/ingest/c74d6243-8a68-4373-b13b-4c1a75b6873d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f7121d'},body:JSON.stringify({sessionId:'f7121d',runId:'pre-fix',hypothesisId:'H1',location:'js/pages/submit-sighting.js:DOMReady',message:'submit-sighting module started',data:{path:window.location.pathname},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  initSubmitNav();

  const form = document.getElementById("lighthouseForm");
  const loginBtn = document.getElementById("loginBtn");
  const resultDiv = document.getElementById("result");

  loginBtn?.addEventListener("click", signInWithGithub);
  const hasSession = await setFormEnabledFromSession({ form, loginBtn });
  // #region agent log
  fetch('http://127.0.0.1:7410/ingest/c74d6243-8a68-4373-b13b-4c1a75b6873d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f7121d'},body:JSON.stringify({sessionId:'f7121d',runId:'pre-fix',hypothesisId:'H2',location:'js/pages/submit-sighting.js:afterSession',message:'session gating applied',data:{hasSession,formFound:Boolean(form),loginBtnFound:Boolean(loginBtn)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const isReal = document.getElementById("isReal");
  const lighthouseSection = document.getElementById("lighthouseSection");
  const lighthouseSelect = document.getElementById("lighthouseSelect");

  function updateTypeUI() {
    if (!isReal || !lighthouseSection || !lighthouseSelect) return;
    if (isReal.checked) {
      lighthouseSection.style.display = "block";
    } else {
      lighthouseSection.style.display = "none";
      lighthouseSelect.value = "";
    }
  }

  isReal?.addEventListener("change", updateTypeUI);
  updateTypeUI();

  async function loadLighthouses() {
    if (!lighthouseSelect) return;

    const { data, error } = await supabaseClient
      .from("lighthouses")
      .select("id, name_en")
      .order("name_en");

    if (error) {
      console.error(error);
      return;
    }

    lighthouseSelect.innerHTML = `<option value="">-- Select lighthouse --</option>`;
    data.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name_en;
      lighthouseSelect.appendChild(opt);
    });
  }

  await loadLighthouses();

  const anilistInput = document.getElementById("anilistInput");
  const fetchBtn = document.getElementById("anilistFetchBtn");
  let cachedMediaId = null;
  let cachedMediaType = null;

  fetchBtn?.addEventListener("click", async () => {
    const url = (anilistInput?.value ?? "").trim();
    const parsed = parseAniListUrl(url);
    if (!parsed) {
      alert("Invalid AniList URL");
      return;
    }

    const { id, type } = parsed;
    cachedMediaId = id;
    cachedMediaType = type;

    const query = `
      query ($id: Int) {
        Media(id: $id) {
          title {
            romaji
            english
            native
          }
        }
      }
    `;

    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { id: Number(id) } })
      });

      const json = await res.json();
      const media = json?.data?.Media;

      if (!media) {
        alert("AniList entry not found");
        return;
      }

      const title_en = media.title.english || media.title.romaji;
      const title_r = media.title.romaji;
      const title_jp = media.title.native;

      const titleEnEl = form?.querySelector('[name="title_en"]');
      if (titleEnEl) titleEnEl.value = title_en || "";

      const titleREl = form?.querySelector('[name="title_r"]');
      if (titleREl) titleREl.value = title_r || "";

      const titleJpEl = form?.querySelector('[name="title_jp"]');
      if (titleJpEl) titleJpEl.value = title_jp || "";
    } catch (err) {
      console.error(err);
      alert("Failed to fetch AniList data");
    }
  });

  form?.addEventListener("submit", async e => {
    e.preventDefault();

    if (resultDiv) {
      resultDiv.style.display = "none";
      resultDiv.className = "result";
    }

    const formData = Object.fromEntries(new FormData(form));
    nullifyEmptyStrings(formData);

    if (isReal?.checked) {
      formData.lighthouse_type = "real";
    } else {
      formData.lighthouse_type = "fictional";
      formData.lighthouse_id = null;
    }

    if (formData.image_link) {
      const filename = String(formData.image_link).trim();
      formData.image_link = filename ? [`images/${filename}`] : null;
    } else {
      formData.image_link = null;
    }

    if (cachedMediaId) formData.media_id = cachedMediaId;
    if (cachedMediaType) formData.media_type = cachedMediaType;

    const { data, error } = await supabaseClient
      .from("sightings")
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

    if (resultDiv) {
      resultDiv.textContent = `Sighting added successfully. ID: ${data.id}`;
      resultDiv.classList.add("success");
      resultDiv.style.display = "block";
    }

    form.reset();
    cachedMediaId = null;
    cachedMediaType = null;
    updateTypeUI();
  });
});

