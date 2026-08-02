import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import { sources } from "./sources.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL || "@HaberXOfficial";
const intervalMs = Math.max(30, Number(process.env.CHECK_INTERVAL_SECONDS || 60)) * 1000;
const maxPosts = Math.max(1, Number(process.env.MAX_POSTS_PER_CYCLE || 10));
const statePath = path.resolve("data/seen.json");
const xml = new XMLParser({ ignoreAttributes: false, trimValues: true });

if (!token || token.includes("buraya")) {
  throw new Error("TELEGRAM_BOT_TOKEN ayarlanmadı. .env dosyasındaki tokeni kontrol edin.");
}

const normalize = value => (Array.isArray(value) ? value : value ? [value] : []);
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const canonical = value => {
  try {
    const url = new URL(value);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(k => url.searchParams.delete(k));
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
};

async function request(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "user-agent": "HaberXBot/1.0 (+Telegram news link aggregator)", accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.9" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { text: await response.text(), type: response.headers.get("content-type") || "" };
}

function rssItems(body, source) {
  const doc = xml.parse(body);
  const raw = normalize(doc?.rss?.channel?.item ?? doc?.feed?.entry);
  return raw.map(item => {
    const rawLink = typeof item.link === "object" ? (item.link?.["@_href"] || item.link?.[0]?.["@_href"]) : item.link;
    return { title: clean(item.title?.["#text"] ?? item.title), link: canonical(rawLink), date: item.pubDate || item.published || item.updated || "", source: source.name };
  }).filter(item => item.title && item.link && source.include.test(item.link));
}

function htmlItems(body, base, source) {
  const $ = cheerio.load(body);
  const found = new Map();
  $("a[href]").each((_, node) => {
    const title = clean($(node).attr("title") || $(node).find("h1,h2,h3,h4").first().text() || $(node).text());
    let link = "";
    try { link = canonical(new URL($(node).attr("href"), base).href); } catch { return; }
    if (title.length >= 15 && title.length <= 220 && source.include.test(link) && !found.has(link)) {
      found.set(link, { title, link, date: "", source: source.name });
    }
  });
  return [...found.values()].slice(0, 30);
}

async function fetchSource(source) {
  for (const feed of source.feeds) {
    try {
      const { text } = await request(feed);
      const items = rssItems(text, source);
      if (items.length) return items;
    } catch (error) {
      console.warn(`[${source.name}] RSS başarısız: ${error.message}`);
    }
  }
  const { text } = await request(source.home);
  return htmlItems(text, source.home, source);
}
async function fetchArticleImage(articleUrl) {
  try {
    const { text } = await request(articleUrl);
    const $ = cheerio.load(text);

    const candidates = [
      $('meta[property="og:image:secure_url"]').attr("content"),
      $('meta[property="og:image"]').attr("content"),
      $('meta[name="twitter:image"]').attr("content"),
      $('meta[property="twitter:image"]').attr("content"),
      $('link[rel="image_src"]').attr("href")
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;

      try {
        const imageUrl = new URL(candidate, articleUrl).href;

        if (/^https?:\/\//i.test(imageUrl)) {
          return imageUrl;
        }
      } catch {
        // Geçersiz görsel adresini geç.
      }
    }
  } catch (error) {
    console.warn(`Haber görseli alınamadı: ${error.message}`);
  }

  return "";
}
async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram API hatası");
  return result.result;
}

async function loadState() {
  try { return JSON.parse(await fs.readFile(statePath, "utf8")); }
  catch { return { initialized: false, seen: [] }; }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  state.seen = state.seen.slice(-5000);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}
function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function formatSummary(rawTitle) {
  const original = decodeEntities(clean(rawTitle));

  const breaking =
    /^\s*(?:#?\s*son\s+dakika(?:\s+haberi)?|flaş(?:\s+gelişme)?|acil\s+gelişme)\b/i.test(
      original
    );

  let summary = original
    .replace(
      /^\s*(?:#?\s*son\s+dakika(?:\s+haberi)?|flaş(?:\s+gelişme)?|acil\s+gelişme)\s*[:|!—–-]?\s*/i,
      ""
    )
    .replace(
      /\s+[|–—-]\s+(?:Sözcü|Habertürk|Anadolu Ajansı|AA|DHA|T24|TRT Haber|soL Haber|Cumhuriyet)\s*$/i,
      ""
    )
    .replace(/^\s*[,;:|!?\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (summary.length < 15) {
    return "";
  }

  if (summary.length > 240) {
    const shortened = summary.slice(0, 239);
    const lastSpace = shortened.lastIndexOf(" ");

    summary =
      shortened
        .slice(0, Math.max(lastSpace, 80))
        .replace(/[,:;\-–—\s]+$/, "") + "…";
  } else if (!/[.!?…]$/.test(summary)) {
    summary += ".";
  }

  return breaking
    ? `#SONDAKİKA\n\n${summary}`
    : summary;
}
async function cycle() {
  const state = await loadState();
  const seen = new Set(state.seen);
  const results = await Promise.allSettled(sources.map(fetchSource));
  const all = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") all.push(...result.value);
    else console.error(`[${sources[i].name}] ${result.reason?.message || result.reason}`);
  });
  const unique = [...new Map(all.map(item => [item.link, item])).values()];

  if (!state.initialized) {
    unique.forEach(item => seen.add(item.link));
    await saveState({ initialized: true, seen: [...seen] });
    console.log(`İlk tarama tamamlandı; ${unique.length} mevcut haber kaydedildi.`);
    return;
  }

  const fresh = unique.filter(item => !seen.has(item.link)).slice(0, maxPosts).reverse();
  for (const item of fresh) {
    const text = formatSummary(item.title);

if (!text) {
  seen.add(item.link);
  await saveState({
    initialized: true,
    seen: [...seen]
  });
  continue;
}

const imageUrl = await fetchArticleImage(item.link);

if (imageUrl) {
  try {
    await telegram("sendPhoto", {
      chat_id: channel,
      photo: imageUrl,
      caption: text
    });
  } catch (error) {
    console.warn(
      `Görsel gönderilemedi, metin gönderiliyor: ${error.message}`
    );

    await telegram("sendMessage", {
      chat_id: channel,
      text,
      disable_web_page_preview: true
    });
  }
} else {
  await telegram("sendMessage", {
    chat_id: channel,
    text,
    disable_web_page_preview: true
  });
}
    seen.add(item.link);
    await saveState({ initialized: true, seen: [...seen] });
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  console.log(`${new Date().toISOString()} — ${fresh.length} yeni haber gönderildi.`);
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function main() {
  const me = await telegram("getMe", {});
  console.log(`@${me.username} çalışıyor. Hedef kanal: ${channel}`);
  if (process.env.SEND_STARTUP_MESSAGE === "true") {
    await telegram("sendMessage", { chat_id: channel, text: "✅ HaberX otomatik haber sistemi aktif." });
  }
  await cycle();
  if (process.env.RUN_ONCE === "true") return;
  setInterval(() => cycle().catch(error => console.error("Tarama hatası:", error.message)), intervalMs);
}

main().catch(error => { console.error(error.message); process.exit(1); });
