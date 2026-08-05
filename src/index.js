import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { sources } from "./sources.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL || "@HaberXOfficial";
const geminiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const intervalMs = Math.max(60, Number(process.env.CHECK_INTERVAL_SECONDS || 300)) * 1000;
const maxPosts = Math.min(10, Math.max(1, Number(process.env.MAX_POSTS_PER_CYCLE || 4)));
const statePath = path.resolve("data/seen.json");
const stateVersion = 2;

if (!token || token.includes("buraya")) {
  throw new Error("TELEGRAM_BOT_TOKEN ayarlanmadı.");
}

if (!geminiKey) {
  throw new Error("GEMINI_API_KEY ayarlanmadı.");
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

function clean(value) {
  return decodeEntities(String(value || ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value) {
  try {
    const url = new URL(value);
    [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "fbclid", "gclid", "output"
    ].forEach(key => url.searchParams.delete(key));
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeTitle(value) {
  return clean(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(son dakika|flas|breaking news|live|canli)\b/g, " ")
    .replace(/[^a-z0-9çğıöşü]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function isBreakingTitle(title) {
  return /^\s*(?:#?\s*son\s+dakika(?:\s+haberi)?|flaş(?:\s+gelişme)?|acil\s+gelişme|breaking(?:\s+news)?|just\s+in)\b/i.test(clean(title));
}

function stripBreakingPrefix(title) {
  return clean(title)
    .replace(/^\s*(?:#?\s*son\s+dakika(?:\s+haberi)?|flaş(?:\s+gelişme)?|acil\s+gelişme|breaking(?:\s+news)?|just\s+in)\s*[:|!—–-]?\s*/i, "")
    .trim();
}

async function request(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; HaberXBot/2.0; +https://t.me/HaberXOfficial)",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "accept-language": "tr-TR,tr;q=0.9,en;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return {
    text: await response.text(),
    finalUrl: response.url || url
  };
}

function htmlItems(body, base, source) {
  const $ = cheerio.load(body);
  const found = new Map();

  $("a[href]").each((_, node) => {
    const linkText = $(node).find("h1,h2,h3,h4").first().text() || $(node).attr("title") || $(node).text();
    const title = clean(linkText);
    let link = "";

    try {
      link = canonical(new URL($(node).attr("href"), base).href);
    } catch {
      return;
    }

    if (
      title.length >= 18 &&
      title.length <= 240 &&
      source.include.test(link) &&
      !found.has(link)
    ) {
      found.set(link, {
        title,
        link,
        source: source.name,
        language: source.language || "tr"
      });
    }
  });

  return [...found.values()].slice(0, source.limit || 25);
}

async function fetchSource(source) {
  const { text, finalUrl } = await request(source.home);
  const items = htmlItems(text, finalUrl, source);
  console.log(`[${source.name}] ${items.length} aday bağlantı bulundu.`);
  return items;
}

function chooseArticleText($) {
  const selectors = [
    "article p",
    "[itemprop='articleBody'] p",
    ".article-content p",
    ".article__content p",
    ".news-content p",
    ".story-body p",
    ".post-content p",
    ".content-body p",
    "main p"
  ];

  for (const selector of selectors) {
    const paragraphs = [];

    $(selector).each((_, node) => {
      const text = clean($(node).text());
      if (
        text.length >= 45 &&
        text.length <= 1400 &&
        !/(çerez|cookie|reklam|abonelik|bildirimleri aç|bizi takip edin|tüm hakları saklıdır)/i.test(text)
      ) {
        paragraphs.push(text);
      }
    });

    const unique = [...new Set(paragraphs)];
    if (unique.join(" ").length >= 250) {
      return unique.join(" ").slice(0, 9000);
    }
  }

  return "";
}

async function fetchArticle(item) {
  const { text, finalUrl } = await request(item.link);
  const $ = cheerio.load(text);

  const title = clean(
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("h1").first().text() ||
    item.title
  );

  const description = clean(
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content")
  );

  const imageCandidates = [
    $('meta[property="og:image:secure_url"]').attr("content"),
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('meta[property="twitter:image"]').attr("content"),
    $('link[rel="image_src"]').attr("href")
  ];

  let image = "";
  for (const candidate of imageCandidates) {
    if (!candidate) continue;
    try {
      const resolved = new URL(candidate, finalUrl).href;
      if (/^https?:\/\//i.test(resolved)) {
        image = resolved;
        break;
      }
    } catch {
      // Geçersiz görsel adresini atla.
    }
  }

  return {
    ...item,
    link: canonical(finalUrl),
    title: title || item.title,
    description,
    body: chooseArticleText($),
    image
  };
}

function fallbackSummary(article) {
  let text = stripBreakingPrefix(article.description || article.title)
    .replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/i, "")
    .replace(/^\s*[,;:|!?\-–—]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 650) {
    text = `${text.slice(0, 647).replace(/[,:;\-–—\s]+$/, "")}…`;
  } else if (text && !/[.!?…]$/.test(text)) {
    text += ".";
  }

  return text;
}

async function summarizeWithGemini(article) {
  const input = [article.title, article.description, article.body]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12000);

  if (input.length < 80) {
    return fallbackSummary(article);
  }

  const prompt = `Aşağıdaki haber metnini Türkçe olarak özetle.

Kurallar:
- Çıktı yalnızca 2 veya 3 kısa cümleden oluşsun.
- Toplam uzunluk 260-650 karakter arasında olsun.
- Haber yabancı dildeyse doğal ve doğru Türkçeye çevir.
- Yalnızca verilen metindeki doğrulanabilir bilgileri kullan; tahmin veya yorum ekleme.
- Kişi, kurum, ülke, sayı, tarih ve yer adlarını doğru koru.
- Başlık, madde işareti, kaynak, bağlantı, emoji, hashtag ve "özet" kelimesi yazma.
- Tarafsız haber dili kullan.

HABER:
${input}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiKey
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 320
        }
      })
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`Gemini API: ${message}`);
  }

  let summary = clean(
    result?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || "")
      .join(" ")
  )
    .replace(/^[-*•\s]+/, "")
    .replace(/^(?:haber\s+özeti|özet)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (summary.length < 60) {
    summary = fallbackSummary(article);
  }

  if (summary.length > 750) {
    summary = `${summary.slice(0, 747).replace(/[,:;\-–—\s]+$/, "")}…`;
  }

  return summary;
}

function formatPost(article, summary) {
  const text = clean(summary);
  if (!text) return "";
  return isBreakingTitle(article.title)
    ? `#SONDAKİKA\n\n${text}`
    : text;
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });

  const result = await response.json().catch(() => ({}));
  if (!result.ok) {
    throw new Error(result.description || `Telegram API ${response.status}`);
  }
  return result.result;
}

async function sendArticle(article, text) {
  if (article.image) {
    try {
      await telegram("sendPhoto", {
        chat_id: channel,
        photo: article.image,
        caption: text,
        show_caption_above_media: false
      });
      return;
    } catch (error) {
      console.warn(`[${article.source}] Görsel gönderilemedi: ${error.message}`);
    }
  }

  await telegram("sendMessage", {
    chat_id: channel,
    text,
    disable_web_page_preview: true
  });
}

async function loadState() {
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    return {
      version: Number(state.version || 0),
      initialized: Boolean(state.initialized),
      seen: Array.isArray(state.seen) ? state.seen : [],
      titles: Array.isArray(state.titles) ? state.titles : []
    };
  } catch {
    return { version: 0, initialized: false, seen: [], titles: [] };
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  state.seen = state.seen.slice(-8000);
  state.titles = state.titles.slice(-4000);
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function cycle() {
  const state = await loadState();
  const seen = new Set(state.seen);
  const seenTitles = new Set(state.titles);
  const results = await Promise.allSettled(sources.map(fetchSource));
  const all = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    } else {
      console.error(`[${sources[index].name}] ${result.reason?.message || result.reason}`);
    }
  });

  const unique = [...new Map(all.map(item => [item.link, item])).values()];

  if (!state.initialized || state.version !== stateVersion) {
    for (const item of unique) {
      seen.add(item.link);
      const titleKey = normalizeTitle(item.title);
      if (titleKey) seenTitles.add(titleKey);
    }

    await saveState({
      version: stateVersion,
      initialized: true,
      seen: [...seen],
      titles: [...seenTitles]
    });

    console.log(`Yeni sistem başlangıcı tamamlandı; ${unique.length} mevcut haber kaydedildi.`);
    return;
  }

  const fresh = unique.filter(item => {
    const titleKey = normalizeTitle(item.title);
    return !seen.has(item.link) && (!titleKey || !seenTitles.has(titleKey));
  });

  let sent = 0;

  for (const item of fresh) {
    if (sent >= maxPosts) break;

    try {
      const article = await fetchArticle(item);
      const summary = await summarizeWithGemini(article);
      const text = formatPost(article, summary);

      if (!text) {
        console.warn(`[${item.source}] Boş özet atlandı: ${item.title}`);
        seen.add(item.link);
        continue;
      }

      await sendArticle(article, text);
      sent += 1;
      seen.add(item.link);
      if (article.link) seen.add(article.link);

      const titleKey = normalizeTitle(article.title);
      if (titleKey) seenTitles.add(titleKey);

      await saveState({
        version: stateVersion,
        initialized: true,
        seen: [...seen],
        titles: [...seenTitles]
      });

      console.log(`[${item.source}] Haber gönderildi: ${article.title}`);
      await sleep(1800);
    } catch (error) {
      console.error(`[${item.source}] Haber işlenemedi: ${error.message}`);
      seen.add(item.link);
    }
  }

  await saveState({
    version: stateVersion,
    initialized: true,
    seen: [...seen],
    titles: [...seenTitles]
  });

  console.log(`${new Date().toISOString()} — ${sent} yeni haber gönderildi.`);
}

async function main() {
  const me = await telegram("getMe", {});
  console.log(`@${me.username} çalışıyor. Hedef kanal: ${channel}`);
  console.log(`Gemini modeli: ${geminiModel}`);

  if (process.env.SEND_STARTUP_MESSAGE === "true") {
    await telegram("sendMessage", {
      chat_id: channel,
      text: "✅ HaberX fotoğraflı Türkçe haber özeti sistemi aktif."
    });
  }

  await cycle();

  if (process.env.RUN_ONCE === "true") return;
  setInterval(() => cycle().catch(error => console.error("Tarama hatası:", error.message)), intervalMs);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
