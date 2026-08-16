import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "../../js/pages/submitAuth.js";

const UPLOAD_ENDPOINT = "https://upload.toudai.moe/upload";
const TOKEN_STORAGE_KEY = "toudai-image-upload-token";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["gif", "jpg", "jpeg", "png", "webp", "heic", "heif"]);
const ALLOWED_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);
const UPLOAD_HOST_SIGN_IN_HELP =
  "Upload host sign-in opened in a new tab. Close it after login (405 is normal), then upload again.";
const MIME_TO_EXTENSION = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const DEFAULT_QUALITY_PERCENT = 90;
const DEFAULT_ENCODE_QUALITY = DEFAULT_QUALITY_PERCENT / 100;

const fileInput = document.getElementById("file-input");
const resizeSelect = document.getElementById("resize-select");
const formatSelect = document.getElementById("format-select");
const qualityField = document.getElementById("quality-field");
const qualitySlider = document.getElementById("quality-slider");
const qualityInput = document.getElementById("quality-input");
const tokenInput = document.getElementById("token-input");
const previewImage = document.getElementById("preview-image");
const previewEmpty = document.getElementById("preview-empty");
const uploadForm = document.getElementById("upload-form");
const previewButton = document.getElementById("preview-button");
const uploadButton = document.getElementById("upload-button");
const statusBox = document.getElementById("status-box");
const resultUrl = document.getElementById("result-url");
const resultMarkdown = document.getElementById("result-markdown");
const loginBtn = document.getElementById("loginBtn");
const noticeEl = document.getElementById("submitAdminNotice");

let previewObjectUrl = "";

tokenInput.value = localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
hideWebpOutputOnSafari();

document.addEventListener("DOMContentLoaded", async () => {
  async function refreshAuth() {
    await setFormEnabledFromSession({
      form: uploadForm,
      loginBtn,
      noticeEl
    });
  }

  loginBtn?.addEventListener("click", async () => {
    await handleSubmitAuthButtonClick({ form: uploadForm, loginBtn, noticeEl });
    await refreshAuth();
  });

  await refreshAuth();
  syncQualityVisibility();
});

formatSelect.addEventListener("change", () => {
  syncQualityVisibility();
});

qualitySlider.addEventListener("input", () => {
  qualityInput.value = qualitySlider.value;
});

qualityInput.addEventListener("input", () => {
  const raw = Number.parseInt(qualityInput.value, 10);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 100) {
    qualitySlider.value = String(raw);
  }
});

qualityInput.addEventListener("change", () => {
  const percent = readQualityPercent();
  qualityInput.value = String(percent);
  qualitySlider.value = String(percent);
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files ?? [];
  syncOriginalOutputForFile(file ?? null);
  updatePreview(file ?? null);
  if (file) {
    setStatus(`Selected ${file.name} (${formatBytes(file.size)}).`, "idle");
  }
});

tokenInput.addEventListener("input", () => {
  localStorage.setItem(TOKEN_STORAGE_KEY, tokenInput.value.trim());
});

uploadForm.addEventListener("submit", async event => {
  event.preventDefault();

  let selectedFile;
  try {
    selectedFile = getSelectedSourceFile();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    return;
  }

  const token = tokenInput.value.trim();
  if (!token) {
    setStatus("Enter the upload token before submitting.", "error");
    return;
  }

  try {
    setEncodeBusy(true);
    setStatus("Preparing image for upload...", "idle");

    const { file: preparedFile } = await prepareUploadFile(selectedFile, getEncodeOptions());

    setStatus(`Uploading ${preparedFile.name} (${formatBytes(preparedFile.size)})...`, "idle");

    const formData = new FormData();
    formData.append("file", preparedFile, preparedFile.name);

    let response;
    try {
      response = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      });
    } catch {
      openUploadHostSignIn();
      throw new Error(UPLOAD_HOST_SIGN_IN_HELP);
    }

    const payload = await readJson(response);
    if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
      throw new Error(getUploadErrorMessage(response, payload));
    }

    resultUrl.value = payload.url;
    resultMarkdown.value = `img420(${payload.url})`;
    const uploadedBytes = typeof payload.bytes === "number" ? payload.bytes : preparedFile.size;
    setStatus(`Uploaded successfully as ${payload.key} (${formatBytes(uploadedBytes)}).`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
  } finally {
    setEncodeBusy(false);
  }
});

previewButton.addEventListener("click", async () => {
  let selectedFile;
  try {
    selectedFile = getSelectedSourceFile();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    return;
  }

  try {
    setEncodeBusy(true);
    setStatus("Preparing preview...", "idle");

    const { file: preparedFile, width, height } = await prepareUploadFile(
      selectedFile,
      getEncodeOptions()
    );

    updatePreview(preparedFile);
    setStatus(formatPreviewStatus(preparedFile, width, height), "idle");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
  } finally {
    setEncodeBusy(false);
  }
});

document.addEventListener("click", async event => {
  const button = event.target instanceof HTMLElement ? event.target.closest("[data-copy-target]") : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const targetId = button.dataset.copyTarget;
  const target = targetId ? document.getElementById(targetId) : null;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (!target.value) {
    setStatus("Nothing to copy yet.", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(target.value);
    setStatus("Copied to clipboard.", "success");
  } catch {
    target.focus();
    target.select();
    setStatus("Clipboard write failed. The field has been selected for manual copy.", "error");
  }
});

function openUploadHostSignIn() {
  window.open(UPLOAD_ENDPOINT, "_blank", "noopener,noreferrer");
}

async function prepareUploadFile(file, { maxDimension, outputFormat, quality }) {
  if (file.type === "image/gif") {
    if (maxDimension !== "original" || outputFormat !== "original") {
      throw new Error("GIF uploads stay original. Leave resize and output as original.");
    }
    return { file, width: null, height: null };
  }

  const heic = isHeicFile(file);
  if (heic && outputFormat === "original") {
    outputFormat = "jpeg";
  }

  const targetMime = resolveTargetMime(file.type, outputFormat);
  const targetExtension = MIME_TO_EXTENSION[targetMime];
  if (!targetExtension) {
    throw new Error("Unsupported output format.");
  }

  const maxSide = maxDimension === "original" ? null : Number.parseInt(maxDimension, 10);
  if (!heic && !maxSide && outputFormat === "original") {
    return { file, width: null, height: null };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (heic) {
      throw new Error(
        "This browser cannot decode HEIC. Convert it to JPEG or PNG first, or open this page in Safari."
      );
    }
    throw new Error("This browser could not decode the selected image.");
  }

  const scale = maxSide ? Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: targetMime !== "image/jpeg" });
  if (!context) {
    throw new Error("Canvas is unavailable in this browser.");
  }

  context.drawImage(bitmap, 0, 0, width, height);

  const encodeQuality = targetMime === "image/png"
    ? undefined
    : (typeof quality === "number" ? quality : DEFAULT_ENCODE_QUALITY);
  const blob = await canvasToBlob(canvas, targetMime, encodeQuality);
  const outputName = replaceExtension(file.name, targetExtension);

  return {
    file: new File([blob], outputName, {
      lastModified: Date.now(),
      type: targetMime
    }),
    width,
    height
  };
}

function getSelectedSourceFile() {
  const [selectedFile] = fileInput.files ?? [];
  if (!selectedFile) {
    throw new Error("Select an image file first.");
  }

  if (!ALLOWED_TYPES.has(selectedFile.type) && !isHeicFile(selectedFile)) {
    throw new Error("Unsupported file type. Use GIF, JPEG, PNG, WebP, or HEIC.");
  }

  const sourceExtension = getFilenameExtension(selectedFile.name);
  if (!sourceExtension || !ALLOWED_EXTENSIONS.has(sourceExtension)) {
    throw new Error("Filename must end with .jpg, .jpeg, .png, .webp, .gif, .heic, or .heif.");
  }

  if (selectedFile.size <= 0 || selectedFile.size > MAX_SOURCE_BYTES) {
    throw new Error("Image must be between 1 byte and 25 MB.");
  }

  return selectedFile;
}

function isHeicFile(file) {
  const extension = getFilenameExtension(file.name);
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    extension === "heic" ||
    extension === "heif"
  );
}

function syncOriginalOutputForFile(file) {
  const originalOption = formatSelect.querySelector('option[value="original"]');
  if (!originalOption) {
    return;
  }

  const heic = Boolean(file && isHeicFile(file));
  originalOption.disabled = heic;
  if (heic && formatSelect.value === "original") {
    formatSelect.value = "jpeg";
  }

  syncQualityVisibility();
}

function isSafariBrowser() {
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);
}

function hideWebpOutputOnSafari() {
  if (!isSafariBrowser()) {
    return;
  }

  formatSelect.querySelector('option[value="webp"]')?.remove();
}

function isLossyOutput(format) {
  return format === "jpeg" || format === "webp";
}

function syncQualityVisibility() {
  qualityField.classList.toggle("hidden", !isLossyOutput(formatSelect.value));
}

function readQualityPercent() {
  const raw = Number.parseInt(qualityInput.value, 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_QUALITY_PERCENT;
  }

  return Math.min(100, Math.max(1, raw));
}

function getEncodeOptions() {
  const outputFormat = formatSelect.value;
  const options = {
    maxDimension: resizeSelect.value,
    outputFormat
  };

  if (isLossyOutput(outputFormat)) {
    options.quality = readQualityPercent() / 100;
  }

  return options;
}

function setEncodeBusy(busy) {
  previewButton.disabled = busy;
  uploadButton.disabled = busy;
}

function mimeLabel(mime) {
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  if (mime === "image/webp") return "WebP";
  if (mime === "image/gif") return "GIF";
  return mime;
}

function formatPreviewStatus(file, width, height) {
  const size = formatBytes(file.size);
  const formatName = mimeLabel(file.type);
  if (width && height) {
    return `Preview ${width}×${height} ${formatName}, ${size}.`;
  }

  return `Preview ${formatName}, ${size}.`;
}

function resolveTargetMime(sourceMime, outputFormat) {
  if (outputFormat === "original") {
    if (!MIME_TO_EXTENSION[sourceMime]) {
      throw new Error("The selected file type cannot be kept as original.");
    }
    return sourceMime;
  }

  if (outputFormat === "jpeg") return "image/jpeg";
  if (outputFormat === "png") return "image/png";
  if (outputFormat === "webp") return "image/webp";
  throw new Error("Unknown output format.");
}

function updatePreview(file) {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }

  if (!file) {
    previewImage.classList.add("hidden");
    previewImage.removeAttribute("src");
    previewEmpty.classList.remove("hidden");
    return;
  }

  previewObjectUrl = URL.createObjectURL(file);
  previewImage.src = previewObjectUrl;
  previewImage.classList.remove("hidden");
  previewEmpty.classList.add("hidden");
}

function setStatus(message, state) {
  statusBox.textContent = message;
  if (state === "success" || state === "error") {
    statusBox.dataset.state = state;
    return;
  }

  delete statusBox.dataset.state;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getFilenameExtension(filename) {
  const baseName = filename.split(/[/\\]/).pop() ?? "";
  const lastDot = baseName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === baseName.length - 1) {
    return null;
  }

  return baseName.slice(lastDot + 1).toLowerCase();
}

function getUploadErrorMessage(response, payload) {
  if (payload?.message && typeof payload.message === "string") {
    return payload.message;
  }

  if (response.status === 401 || response.status === 403) {
    openUploadHostSignIn();
    return UPLOAD_HOST_SIGN_IN_HELP;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    openUploadHostSignIn();
    return UPLOAD_HOST_SIGN_IN_HELP;
  }

  return "Upload failed.";
}

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  if (text.trimStart().startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  return { message: text };
}

function replaceExtension(filename, extension) {
  const baseName = filename.replace(/\.[^.]+$/, "") || "upload";
  return `${baseName}.${extension}`;
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error(`This browser could not encode ${mimeType}. Try another output format.`));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });
}
