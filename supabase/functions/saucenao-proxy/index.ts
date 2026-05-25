// Supabase Edge Function: saucenao-proxy
//
// Purpose: proxy SauceNAO requests to avoid browser CORS restrictions.
// Maintainer-only: browser callers must be authenticated.
//
// Body (JSON):
// - apiKey: string (required)
// - db: number (optional, default 21)
// - numres: number (optional, default 3)
// - dedupe: number (optional, default 2)
// - url: string (optional)
// - imageBase64: string (optional; data URL or raw base64)
//
// Exactly one of `url` or `imageBase64` must be provided.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const MAINTAINER_UID = "27518d60-563d-427d-827e-74279a3b3ea5";

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

async function assertMaintainer(req: Request) {
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
}

function decodeBase64Image(input: string): Uint8Array {
  const trimmed = input.trim();
  const b64 = trimmed.startsWith("data:")
    ? trimmed.split(",")[1] ?? ""
    : trimmed;
  if (!b64) throw new Error("Invalid imageBase64.");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await assertMaintainer(req);
    const body = await req.json().catch(() => ({}));
    const apiKey = String(body?.apiKey ?? "").trim();
    const db = Number(body?.db ?? 21);
    const numres = Number(body?.numres ?? 3);
    const dedupe = Number(body?.dedupe ?? 2);
    const url = String(body?.url ?? "").trim();
    const imageBase64 = String(body?.imageBase64 ?? "").trim();

    if (!apiKey) return json({ error: "Missing apiKey" }, 400);
    const hasUrl = Boolean(url);
    const hasImg = Boolean(imageBase64);
    if (Number(hasUrl) + Number(hasImg) !== 1) {
      return json({ error: "Provide exactly one of url or imageBase64" }, 400);
    }

    const params = new URLSearchParams();
    params.set("output_type", "2");
    params.set("api_key", apiKey);
    params.set("db", String(Number.isFinite(db) ? db : 21));
    params.set("numres", String(Number.isFinite(numres) ? numres : 3));
    params.set("dedupe", String(Number.isFinite(dedupe) ? dedupe : 2));

    let upstream: Response;
    if (hasUrl) {
      params.set("url", url);
      upstream = await fetch(`https://saucenao.com/search.php?${params.toString()}`);
    } else {
      const bytes = decodeBase64Image(imageBase64);
      const fd = new FormData();
      fd.append("file", new Blob([bytes]), "image.jpg");
      upstream = await fetch(`https://saucenao.com/search.php?${params.toString()}`, {
        method: "POST",
        body: fd,
      });
    }

    const text = await upstream.text();
    // SauceNAO always returns JSON when output_type=2, but preserve upstream
    // errors as a readable string if parsing fails.
    try {
      const parsed = JSON.parse(text);
      return json(parsed, upstream.ok ? 200 : upstream.status);
    } catch {
      return json(
        { error: "Upstream returned non-JSON", status: upstream.status, body: text },
        upstream.ok ? 200 : upstream.status,
      );
    }
  } catch (e) {
    const msg = String(e?.message ?? e);
    const status = msg.includes("Not authenticated") || msg.includes("Not authorized")
      ? 401
      : 500;
    return json({ error: msg }, status);
  }
});

