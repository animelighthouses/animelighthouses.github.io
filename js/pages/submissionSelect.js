/**
 * Submission queue dropdown for review.html.
 */

import supabaseClient from "../supabaseClient.js";

export function formatSubmissionOption(row) {
  const created = String(row.created_at ?? "").slice(0, 10);
  const mode = row.form_mode === "advanced" ? "advanced" : "basic";
  const user = String(row.username ?? "").trim();
  const userPart = user ? ` — ${user}` : "";
  return `${created} — #${row.id} (${mode})${userPart}`;
}

/**
 * @param {{ selectEl: HTMLSelectElement }} opts
 */
export async function loadSubmissionsForSelect({ selectEl }) {
  selectEl.innerHTML = `<option value="">Loading…</option>`;

  const { data, error } = await supabaseClient
    .from("sighting_submissions")
    .select(
      "id, created_at, form_mode, username, image_url, anilist_link, notes, date_spotted, title_en, title_r, title_jp, episode, timestamp, lighthouse_type, lighthouse_id, media_id, media_type, enrichment"
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error(error);
    selectEl.innerHTML = `<option value="">Failed to load</option>`;
    return { rows: [], rowById: new Map(), error };
  }

  const rows = data ?? [];
  const rowById = new Map();
  rows.forEach(r => rowById.set(String(r.id), r));

  selectEl.innerHTML = `<option value="">-- Select submission --</option>`;
  rows.forEach(r => {
    const opt = document.createElement("option");
    opt.value = String(r.id);
    opt.textContent = formatSubmissionOption(r);
    selectEl.appendChild(opt);
  });

  return { rows, rowById, error: null };
}
