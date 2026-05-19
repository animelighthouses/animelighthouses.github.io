/**
 * Build sighting insert/update payload from a metadata form.
 */

import { nullifyEmptyStrings } from "./formUtils.js";

/**
 * @param {HTMLFormElement} form
 * @param {{ isReal: HTMLInputElement | null, mediaCache: { id: string | null, type: string | null } }} opts
 */
export function buildSightingPayloadFromForm(form, { isReal, mediaCache }) {
  const fd = new FormData(form);
  const formData = Object.fromEntries(fd);
  nullifyEmptyStrings(formData);

  delete formData.sighting_id;
  delete formData.submission_id;
  delete formData.image_file;

  if (isReal?.checked) {
    formData.lighthouse_type = "real";
  } else {
    formData.lighthouse_type = "fictional";
    formData.lighthouse_id = null;
  }

  if (mediaCache.id) formData.media_id = mediaCache.id;
  if (mediaCache.type) formData.media_type = mediaCache.type;

  return formData;
}
