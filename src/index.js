import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { sources } from "./sources.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const MAX_POSTS = Number(process.env.MAX_POSTS_PER_CYCLE || 2);

const SEEN_FILE = path.resolve("data/seen.json");

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN eksik.");
}

if (!TELEGRAM_CHANNEL) {
  throw new Error("TELEGRAM_CHANNEL eksik.");
}

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY eksik.");
}

async function get(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; HaberX/1.0; +https://telegram.org)"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

function absoluteUrl(value, base) {
  if (!value) return null;

  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function findMedia(html, pageUrl) {
  const $ = cheerio.load(html);

  const videos = [];
  const images = [];

  $("video, video source, source").each((_, element) => {
    const src =
      $(element).attr("src") ||
      $(element).attr("data-src") ||
      $(element).attr("data-video");

    const url = absoluteUrl(src, pageUrl);

    if (
      url &&
      /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(url)
    ) {
      videos.push(url);
    }
  });

  $(
    "meta[property='og:video'], " +
      "meta[property='og:video:url'], " +
      "meta[property='og:video:secure_url']"
  ).each((_, element) => {
    const url = absoluteUrl(
      $(element).attr("content"),
      pageUrl
    );

    if (url) videos.push(url);
  });

  $(
    "meta[property='og:image'], " +
      "meta[name='twitter:image']"
  ).each((_, element) => {
    const url = absoluteUrl(
      $(element).attr("content"),
      pageUrl
    );

    if (url) images.push(url);
  });

  return {
    video: [...new Set(videos)][0] || null,
    image: [...new Set(images)][0] || null
  };
}

function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

async function readArticle(url) {
  const html = await get(url);
  const $ = cheerio.load(html);

  const media = findMedia(html, url);

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text() ||
    $("title").text();

  let articleText =
    $("article").text() ||
    $("main").text() ||
    $("body").text();

  articleText = cleanText(articleText);

  return {
    title: cleanText(title),
    text: articleText.slice(0, 14000),
    video: media.video,
    image: media.image
  };
}

async function summarize(title, text) {
  const prompt = `
Sen HaberX için profesyonel bir haber editörüsün.

Aşağıdaki haberi Türkçe olarak hazırla.

Kurallar:
- Yabancı haberleri Türkçeye çevir.
- Haber başlığını yaz.
- Ardından 2 veya 3 kısa cümlelik haber özeti yaz.
- Tarafsız ol.
- Haber metninde olmayan bilgi ekleme.
- Link verme.
- Kaynak adı yazma.
- Hashtag kullanma.
- Emoji kullanma.

BAŞLIK:
${title}

HABER:
${text}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_MODEL
    )}:generateContent?key=${encodeURIComponent(
      GEMINI_API_KEY
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(
      `Gemini ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();

  const result =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  if (!result) {
    throw new Error("Gemini boş cevap verdi.");
  }

  return result;
}

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.description}`
    );
  }

  return data;
}

async function sendToTelegram({
  caption,
  video,
  image
}) {
  /*
   * Öncelik:
   * 1. Video
   * 2. Fotoğraf
   * 3. Sadece metin
   */

  if (video) {
    try {
      await telegram("sendVideo", {
        chat_id: TELEGRAM_CHANNEL,
        video,
        caption,
        supports_streaming: true
      });

      console.log("Telegram'a video gönderildi.");
      return;
    } catch (error) {
      console.warn(
        `Video gönderilemedi, fotoğrafa geçiliyor: ${error.message}`
      );
    }
  }

  if (image) {
    try {
      await telegram("sendPhoto", {
        chat_id: TELEGRAM_CHANNEL,
        photo: image,
        caption
      });

      console.log("Telegram'a fotoğraf gönderildi.");
      return;
    } catch (error) {
      console.warn(
        `Fotoğraf gönderilemedi, metne geçiliyor: ${error.message}`
      );
    }
  }

  await telegram("sendMessage", {
    chat_id: TELEGRAM_CHANNEL,
    text: caption
  });

  console.log("Telegram'a metin gönderildi.");
}

async function loadSeen() {
  try {
    const data = await fs.readFile(SEEN_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return {
      initialized: false,
      seenUrls: []
    };
  }
}

async function saveSeen(state) {
  await fs.mkdir(path.dirname(SEEN_FILE), {
    recursive: true
  });

  await fs.writeFile(
    SEEN_FILE,
    JSON.stringify(state, null, 2) + "\n"
  );
}

function extractArticleLinks(html, source) {
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const url = absoluteUrl(href, source.home);

    if (!url) return;

    try {
      if (
        source.include &&
        source.include.test(url)
      ) {
        links.push(url);
      }
    } catch {
      // Geçersiz kaynak filtresi varsa atla.
    }
  });

  return [...new Set(links)].slice(
    0,
    source.limit || 20
  );
}

async function main() {
  const state = await loadSeen();

  const candidates = [];

  for (const source of sources) {
    try {
      const html = await get(source.home);

      const links = extractArticleLinks(
        html,
        source
      );

      console.log(
        `${source.name}: ${links.length} aday bağlantı bulundu.`
      );

      for (const url of links) {
        if (!state.seenUrls.includes(url)) {
          candidates.push({
            url,
            source
          });
        }
      }
    } catch (error) {
      console.warn(
        `${source.name} taranamadı: ${error.message}`
      );
    }
  }

  let published = 0;

  for (const item of candidates) {
    if (published >= MAX_POSTS) break;

    try {
      const article = await readArticle(item.url);

      if (
        !article.title ||
        article.text.length < 100
      ) {
        continue;
      }

      console.log(
        `İşleniyor: ${article.title}`
      );

      const caption = await summarize(
        article.title,
        article.text
      );

      await sendToTelegram({
        caption,
        video: article.video,
        image: article.image
      });

      state.seenUrls.push(item.url);

      published++;

      console.log(
        `Paylaşım tamamlandı: ${article.title}`
      );
    } catch (error) {
      console.warn(
        `${item.source.name} haber işlenemedi: ${error.message}`
      );
    }
  }

  state.seenUrls = [
    ...new Set(state.seenUrls)
  ].slice(-5000);

  state.initialized = true;

  await saveSeen(state);

  console.log(
    `${new Date().toISOString()} — ${published} yeni haber işlendi.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
