/** Maintainer auth.uid() — must match migrations / RLS policies. */
export const MAINTAINER_UID = "27518d60-563d-427d-827e-74279a3b3ea5";

export const STORAGE_BUCKET = "sightings-images";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 1920;
export const MAX_IMAGE_HEIGHT = 1920;

export const FETCH_TIMEOUT_MS = 15_000;

export const WEBP_QUALITY_JPEG = 85;
export const WEBP_QUALITY_PNG = 89;
