// Supabase Edge Function: notify-new-submission
// Invoked by Database Webhook on INSERT into sighting_submissions → Discord alert.

const SITE_BASE_URL =
  Deno.env.get("SITE_BASE_URL") ?? "https://animelighthouses.github.io";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function truncate(s: string, max: number) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/** @param {unknown} payload */
function extractInsertRecord(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const type = String(p.type ?? "").toUpperCase();
  if (type && type !== "INSERT") return null;
  const table = String(p.table ?? "");
  if (table && table !== "sighting_submissions") return null;
  const record = (p.record ?? p.new) as Record<string, unknown> | undefined;
  if (!record || record.id == null) return null;
  return record;
}

function buildDiscordContent(record: Record<string, unknown>) {
  const id = String(record.id);
  const username = String(record.username ?? "").trim();
  const anilist = String(record.anilist_link ?? "").trim();
  const hasImage = Boolean(String(record.image_url ?? "").trim());
  const enrichment = record.enrichment as Record<string, unknown> | undefined;
  const anilistEnrich = enrichment?.anilist as Record<string, unknown> | undefined;
  const titleEn = String(anilistEnrich?.title_en ?? "").trim();
  const notes = truncate(String(record.notes ?? ""), 120);

  const lines = [`**New submission #${id}**`];
  if (titleEn) lines.push(`Title: ${titleEn}`);
  if (username) lines.push(`User: ${username}`);
  if (anilist) lines.push(`AniList: ${anilist}`);
  lines.push(`Image URL: ${hasImage ? "yes" : "no"}`);
  if (notes) lines.push(`Notes: ${notes}`);
  lines.push(`[Open review](${SITE_BASE_URL}/review?id=${encodeURIComponent(id)})`);

  return lines.join("\n").slice(0, 1900);
}

/** Discord user id for @tdbn — required for webhook pings (plain @username does not notify). */
function mentionPrefix() {
  const userId = Deno.env.get("DISCORD_NOTIFY_USER_ID")?.trim();
  if (userId && /^\d{5,}$/.test(userId)) return `<@${userId}> `;
  return "@tdbn ";
}

function discordWebhookBody(content: string) {
  const userId = Deno.env.get("DISCORD_NOTIFY_USER_ID")?.trim();
  const body: { content: string; allowed_mentions?: { users: string[] } } = {
    content: mentionPrefix() + content,
  };
  if (userId && /^\d{5,}$/.test(userId)) {
    body.allowed_mentions = { users: [userId] };
  }
  return body;
}

async function postDiscord(content: string) {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL")?.trim();
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL not configured");
    return false;
  }
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordWebhookBody(content)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Discord webhook failed", res.status, text);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json().catch(() => null);
    const record = extractInsertRecord(payload);
    if (!record) {
      return json({ ok: true, skipped: true });
    }

    const content = buildDiscordContent(record);
    await postDiscord(content);
    return json({ ok: true, id: record.id });
  } catch (e) {
    console.error(e);
    return json({ ok: true, error: String((e as Error)?.message ?? e) });
  }
});
