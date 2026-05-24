/**
 * Edge Function: process-sighting-image
 *
 * Modes:
 * - Multipart: file + ymd + optional mediaId (maintainer JWT)
 * - JSON: { sourceUrl, ymd, mediaId? } (maintainer JWT)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { MAINTAINER_UID } from "./_shared/constants.ts";
import { normalizeImgurImageUrl } from "./_shared/imgurProxy.ts";
import {
  assertSafeImageUrl,
  assertYmd,
  buildSightingsObjectPath,
  bytesToWebp,
  fetchImageBytes,
  shortIdHex8,
  uploadWebp,
} from "./_shared/imagePipeline.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

async function handleUrlJson(
  body: { sourceUrl?: string; ymd?: string; mediaId?: string },
  client: ReturnType<typeof createClient>,
) {
  const sourceUrl = String(body?.sourceUrl ?? "").trim();
  const ymd = assertYmd(String(body?.ymd ?? ""));
  const mediaId = String(body?.mediaId ?? "").trim() || undefined;
  if (!sourceUrl) return json({ error: "sourceUrl required" }, 400);

  const normalizedSource = normalizeImgurImageUrl(sourceUrl);
  const safe = await assertSafeImageUrl(normalizedSource);
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
