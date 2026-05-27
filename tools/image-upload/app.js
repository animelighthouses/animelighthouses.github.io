import {
  handleSubmitAuthButtonClick,
  setFormEnabledFromSession
} from "../../js/pages/submitAuth.js";

const UPLOAD_ENDPOINT = "https://upload.toudai.moe/upload";
const TOKEN_STORAGE_KEY = "toudai-image-upload-token";
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["gif", "jpg", "jpeg", "png", "webp"]);
const ALLOWED_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const UPLOAD_HOST_SIGN_IN_HELP =
  "Upload host sign-in required. Finish login in the opened tab, then try again.";
const MIME_TO_EXTENSION = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const fileInput = document.getElementById("file-input");
const resizeSelect = document.getElementById("resize-select");
const formatSelect = document.getElementById("format-select");
const tokenInput = document.getElementById("token-input");
const previewImage = document.getElementById("preview-image");
const previewEmpty = document.getElementById("preview-empty");
const uploadForm = document.getElementById("upload-form");
const uploadButton = document.getElementById("upload-button");
const statusBox = document.getElementById("status-box");
const resultUrl = document.getElementById("result-url");
const resultMarkdown = document.getElementById("result-markdown");
const loginBtn = document.getElementById("loginBtn");
const noticeEl = document.getElementById("submitAdminNotice");

let previewObjectUrl = "";
let uploadHostSignInOpened = false;

tokenInput.value = localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";

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
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files ?? [];
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

  const [selectedFile] = fileInput.files ?? [];
  if (!selectedFile) {
    setStatus("Select an image file first.", "error");
    return;
  }

  if (!ALLOWED_TYPES.has(selectedFile.type)) {
    setStatus("Unsupported file type. Use GIF, JPEG, PNG, or WebP.", "error");
    return;
  }

  const sourceExtension = getFilenameExtension(selectedFile.name);
  if (!sourceExtension || !ALLOWED_EXTENSIONS.has(sourceExtension)) {
    setStatus("Filename must end with .jpg, .jpeg, .png, .webp, or .gif.", "error");
    return;
  }

  if (selectedFile.size <= 0 || selectedFile.size > MAX_SOURCE_BYTES) {
    setStatus("Image must be between 1 byte and 25 MB.", "error");
    return;
  }

  const token = tokenInput.value.trim();
  if (!token) {
    setStatus("Enter the upload token before submitting.", "error");
    return;
  }

  try {
    uploadButton.disabled = true;
    setStatus("Preparing image for upload...", "idle");

    const preparedFile = await prepareUploadFile(selectedFile, {
      maxDimension: resizeSelect.value,
      outputFormat: formatSelect.value
    });

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
      throw new Error(promptUploadHostSignIn());
    }

    const payload = await readJson(response);
    if (!response.ok || !payload?.ok || typeof payload.url !== "string") {
      throw new Error(getUploadErrorMessage(response, payload));
    }

    resultUrl.value = payload.url;
    resultMarkdown.value = `img420(${payload.url})`;
    setStatus(`Uploaded successfully as ${payload.key}.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message, "error");
  } finally {
    uploadButton.disabled = false;
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

function promptUploadHostSignIn() {
  if (!uploadHostSignInOpened) {
    uploadHostSignInOpened = true;
    window.open(UPLOAD_ENDPOINT, "_blank", "noopener,noreferrer");
  }

  return UPLOAD_HOST_SIGN_IN_HELP;
}

async function prepareUploadFile(file, { maxDimension, outputFormat }) {
  if (file.type === "image/gif") {
    if (maxDimension !== "original" || outputFormat !== "original") {
      throw new Error("GIF uploads stay original. Leave resize and output as original.");
    }
    return file;
  }

  const targetMime = resolveTargetMime(file.type, outputFormat);
  const targetExtension = MIME_TO_EXTENSION[targetMime];
  if (!targetExtension) {
    throw new Error("Unsupported output format.");
  }

  const maxSide = maxDimension === "original" ? null : Number.parseInt(maxDimension, 10);
  if (!maxSide && outputFormat === "original") {
    return file;
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
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

  const quality = targetMime === "image/png" ? undefined : 0.92;
  const blob = await canvasToBlob(canvas, targetMime, quality);
  const outputName = replaceExtension(file.name, targetExtension);

  return new File([blob], outputName, {
    lastModified: Date.now(),
    type: targetMime
  });
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
    return promptUploadHostSignIn();
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return promptUploadHostSignIn();
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
