/**
 * Edge Function: process-sighting-image
 *
 * Modes:
 * - Multipart: file + ymd + optional mediaId (maintainer JWT)
 * - JSON: { sourceUrl, ymd, mediaId? } (maintainer JWT)
 * - JSON: { reprocess: true, objectPath } + x-reprocess-secret (service role, upsert)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { MAINTAINER_UID, STORAGE_BUCKET } from "../_shared/constants.ts";
import {
  assertSafeImageUrl,
  assertYmd,
  buildSightingsObjectPath,
  bytesToWebp,
  fetchImageBytes,
  shortIdHex8,
  uploadWebp,
} from "../_shared/imagePipeline.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-reprocess-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function supabaseUrl(): string {
  const u = Deno.env.get("SUPABASE_URL") ?? "";
  if (!u) throw new Error("Server configuration error.");
  return u;
}

function anonKey(): string {
  const k = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!k) throw new Error("Server configuration error.");
  return k;
}

async function maintainerClientFromRequest(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new Error("Not authenticated.");
  }
  const client = createClient(supabaseUrl(), anonKey(), {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user?.id) throw new Error("Not authenticated.");
  if (user.id !== MAINTAINER_UID) throw new Error("Not authorized.");
  return client;
}

function serviceRoleClient() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!key) throw new Error("Server configuration error.");
  return createClient(supabaseUrl(), key);
}

function reprocessAuthorized(req: Request): boolean {
  const secret = Deno.env.get("REPROCESS_SECRET") ?? "";
  if (!secret) return false;
  return req.headers.get("x-reprocess-secret") === secret;
}

async function handleReprocess(body: { objectPath?: string }, req: Request) {
  if (!reprocessAuthorized(req)) {
    return json({ error: "Not authorized" }, 403);
  }
  const objectPath = String(body?.objectPath ?? "").trim().replace(/^\/+/, "");
  if (!objectPath.startsWith("sightings/") || !objectPath.endsWith(".webp")) {
    return json({ error: "Invalid objectPath" }, 400);
  }

  const admin = serviceRoleClient();
  const { data, error: dlErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(objectPath);
  if (dlErr || !data) {
    return json({ error: dlErr?.message ?? "Download failed" }, 400);
  }

  const input = new Uint8Array(await data.arrayBuffer());
  const { bytes, width, height } = await bytesToWebp(input, {
    preferPngQuality: true,
  });
  const { publicUrl } = await uploadWebp(admin, objectPath, bytes, { upsert: true });

  return json({ publicUrl, objectPath, width, height });
}

async function handleUrlJson(
  body: { sourceUrl?: string; ymd?: string; mediaId?: string },
  client: ReturnType<typeof createClient>,
) {
  const sourceUrl = String(body?.sourceUrl ?? "").trim();
  const ymd = assertYmd(String(body?.ymd ?? ""));
  const mediaId = String(body?.mediaId ?? "").trim() || undefined;
  if (!sourceUrl) return json({ error: "sourceUrl required" }, 400);

  const safe = await assertSafeImageUrl(sourceUrl);
  const input = await fetchImageBytes(safe);
  const { bytes, width, height } = await bytesToWebp(input);
  const objectPath = buildSightingsObjectPath({
    ymd,
    mediaId,
    shortId: shortIdHex8(),
  });
  const { publicUrl } = await uploadWebp(client, objectPath, bytes);
  return json({ publicUrl, objectPath, width, height });
}

async function handleMultipart(req: Request, client: ReturnType<typeof createClient>) {
  const form = await req.formData();
  const file = form.get("file");
  const ymd = assertYmd(String(form.get("ymd") ?? ""));
  const mediaId = String(form.get("mediaId") ?? "").trim() || undefined;

  if (!(file instanceof File)) {
    return json({ error: "file required" }, 400);
  }
  if (file.size > 12 * 1024 * 1024) {
    return json({ error: "Image is too large (max 12MB)." }, 400);
  }

  const input = new Uint8Array(await file.arrayBuffer());
  const preferPng =
    file.type === "image/png" ||
    (input.length >= 4 && input[0] === 0x89 && input[1] === 0x50);
  const { bytes, width, height } = await bytesToWebp(input, { preferPngQuality: preferPng });
  const objectPath = buildSightingsObjectPath({
    ymd,
    mediaId,
    shortId: shortIdHex8(),
  });
  const { publicUrl } = await uploadWebp(client, objectPath, bytes);
  return json({ publicUrl, objectPath, width, height });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));

      if (body?.reprocess === true) {
        return await handleReprocess(body, req);
      }

      const client = await maintainerClientFromRequest(req);
      return await handleUrlJson(body, client);
    }

    if (contentType.includes("multipart/form-data")) {
      const client = await maintainerClientFromRequest(req);
      return await handleMultipart(req, client);
    }

    return json({ error: "Expected multipart/form-data or application/json" }, 400);
  } catch (e) {
    console.error(e);
    const msg = String(e?.message ?? e);
    const status = msg.includes("Not authenticated") || msg.includes("Not authorized")
      ? 401
      : 400;
    return json({ error: msg }, status);
  }
});
