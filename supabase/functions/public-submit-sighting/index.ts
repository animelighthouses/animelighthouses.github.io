// Supabase Edge Function: public-submit-sighting
// Anonymous public sighting submissions into sighting_submissions (service role insert).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-forwarded-for",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_SUBMISSIONS_PER_DAY = 50;
const IP_SALT = Deno.env.get("PUBLIC_SUBMIT_IP_SALT") ?? "animelighthouse-public-submit-v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parseAniListUrl(url: string) {
  const match = String(url ?? "")
    .trim()
    .match(/(?:https?:\/\/)?(?:www\.)?anilist\.co\/(anime|manga)\/(\d+)\/?/i);
  if (!match) return null;
  return { type: match[1].toLowerCase(), id: match[2] };
}

function canonicalAniListUrl(url: string) {
  const parsed = parseAniListUrl(url);
  if (!parsed) return null;
  return `https://anilist.co/${parsed.type}/${parsed.id}`;
}

async function fetchAniListById(id: string) {
  const query = `
    query ($id: Int) {
      Media(id: $id) {
        title { romaji english native }
        type
      }
    }
  `;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: Number(id) } }),
  });
  const data = await res.json();
  return data?.data?.Media ?? null;
}

async function sha256Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ipHashFromRequest(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return sha256Hex(`${IP_SALT}:${ip}`);
}

function trimOrNull(v: unknown, maxLen: number) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    const honeypot = String(body?.company_website ?? "").trim();
    if (honeypot) return json({ error: "Invalid submission" }, 400);

    const imageUrlRaw = String(body?.image_url ?? "").trim();
    const imageUrl =
      imageUrlRaw && isHttpUrl(imageUrlRaw) ? imageUrlRaw : null;

    const username = trimOrNull(body?.username, 80);
    const anilistRaw = trimOrNull(body?.anilist_link, 500);
    const anilistLink = anilistRaw ? canonicalAniListUrl(anilistRaw) : null;
    const notes = trimOrNull(body?.notes, 4000);

    if (anilistRaw && !anilistLink) {
      return json({
        error:
          "AniList URL must be anilist.co/anime/… or anilist.co/manga/…",
      }, 400);
    }

    if (!imageUrl && !anilistLink) {
      return json({
        error: "Please provide an image URL or AniList media URL.",
      }, 400);
    }

    if (imageUrlRaw && !imageUrl) {
      return json({ error: "Image URL must start with http:// or https://" }, 400);
    }

    const ipHash = await ipHashFromRequest(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return json({ error: "Server configuration error" }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from("sighting_submissions")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);

    if (countErr) {
      console.error(countErr);
      return json({ error: "Rate limit check failed" }, 500);
    }
    if ((count ?? 0) >= MAX_SUBMISSIONS_PER_DAY) {
      return json({ error: "Too many submissions. Please try again later." }, 429);
    }

    let enrichment: Record<string, unknown> = {};
    if (anilistLink) {
      const parsed = parseAniListUrl(anilistLink);
      if (parsed) {
        try {
          const media = await fetchAniListById(parsed.id);
          if (media) {
            enrichment = {
              anilist: {
                id: parsed.id,
                type: parsed.type,
                title_en: media.title?.english ?? media.title?.romaji ?? null,
                title_r: media.title?.romaji ?? null,
                title_jp: media.title?.native ?? null,
                media_type: media.type?.toLowerCase?.() ?? null,
              },
            };
          }
        } catch (e) {
          console.error("AniList enrichment failed", e);
        }
      }
    }

    const row: Record<string, unknown> = {
      form_mode: "basic",
      username,
      image_url: imageUrl,
      anilist_link: anilistLink,
      notes,
      ip_hash: ipHash,
      enrichment,
    };

    const { data, error } = await admin
      .from("sighting_submissions")
      .insert([row])
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return json({ error: "Failed to save submission" }, 500);
    }

    return json({ id: data.id });
  } catch (e) {
    console.error(e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
