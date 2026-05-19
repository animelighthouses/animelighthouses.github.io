/**
 * Shared sighting dropdown loader for submiti.html and edit.html.
 */

import supabaseClient from "../supabaseClient.js";

export function titleForRow(row) {
  return row?.title_en || row?.title_r || row?.title_jp || "";
}

export function normalizeYmd(dateSpotted) {
  const raw = String(dateSpotted ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return raw.slice(0, 10);
}

export function formatSightingOption(row) {
  const ymd = normalizeYmd(row.date_spotted);
  const title = titleForRow(row);
  return `${ymd} — #${row.id}${title ? ` — ${title}` : ""}`;
}

/**
 * Load sightings into a <select> and return rows + id map.
 *
 * @param {{
 *   selectEl: HTMLSelectElement,
 *   columns?: string,
 *   order?: { ascending?: boolean }
 * }} opts
 * @returns {Promise<{ rows: Array<any>, rowById: Map<string, any>, error: Error | null }>}
 */
export async function loadSightingsForSelect({
  selectEl,
  columns = "id, date_spotted, title_en, title_r, title_jp",
  order = { ascending: false }
}) {
  selectEl.innerHTML = `<option value="">Loading…</option>`;

  const { data, error } = await supabaseClient
    .from("sightings")
    .select(columns)
    .order("date_spotted", order)
    .order("id", order);

  if (error) {
    console.error(error);
    selectEl.innerHTML = `<option value="">Failed to load</option>`;
    return { rows: [], rowById: new Map(), error };
  }

  const rows = data ?? [];
  const rowById = new Map();
  rows.forEach(r => rowById.set(String(r.id), r));

  selectEl.innerHTML = `<option value="">-- Select sighting --</option>`;
  rows.forEach(r => {
    const opt = document.createElement("option");
    opt.value = String(r.id);
    opt.textContent = formatSightingOption(r);
    selectEl.appendChild(opt);
  });

  return { rows, rowById, error: null };
}
