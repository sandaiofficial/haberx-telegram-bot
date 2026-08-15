import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

import { sources } from "./sources.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const channel = process.env.TELEGRAM_CHANNEL || "@HaberXOfficial";
const geminiKey = process.env.GEMINI_API_KEY;

const geminiModel =
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const maxPosts = Math.min(
  10,
  Math.max(1, Number(process.env.MAX_POSTS_PER_CYCLE || 4))
);

const statePath = path.resolve("data/seen.json");

if (!token || token.includes("buraya")) {
  throw new Error("TELEGRAM_BOT_TOKEN ayarlanmadı.");
}

if (!geminiKey) {
  throw new Error("GEMINI_API_KEY ayarlanmadı.");
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; HaberX/1.0; +https://t.me/HaberXOfficial)"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return {
    html: await response.text(),
    finalUrl: response.url || url
  };
}

function absoluteUrl(value, baseUrl) {
  if (!value) return "";

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

/*
 * Haber sayfasındaki video adresini bulur.
 *
 * Öncelik:
 * 1. og:video
 * 2. Twitter video
 * 3. video/source etiketleri
 * 4. JSON-LD içerisindeki video
 */
function findVideo($, finalUrl) {
  const candidates = [];

  const metaSelectors = [
    'meta[property="og:video:secure_url"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video"]',
    'meta[name="twitter:player:stream"]'
  ];

  for (const selector of metaSelectors) {
    $(selector).each((_, element) => {
      const value = $(element).attr("content");

      if (value) {
        candidates.push(value);
      }
    });
  }

  $("video").each((_, element) => {
    const src =
      $(element).attr("src") ||
      $(element).attr("data-src") ||
      $(element).attr("data-video");

    if (src) {
      candidates.push(src);
    }
  });

  $("video source").each((_, element) => {
    const src =
      $(element).attr("src") ||
      $(element).attr("data-src");

    if (src) {
      candidates.push(src);
    }
  });

  $("source").each((_, element) => {
    const src =
      $(element).attr("src") ||
      $(element).attr("data-src");

    const type = $(element).attr("type") || "";

    if (
      src &&
      (
        /video\//i.test(type) ||
        /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(src)
      )
    ) {
      candidates.push(src);
    }
  });

  /*
   * JSON-LD video alanlarını kontrol et.
   */
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const raw = $(element).html();

      if (!raw) return;

      const data = JSON.parse(raw);

      const scan = (value) => {
        if (!value) return;

        if (Array.isArray(value)) {
          for (const item of value) {
            scan(item);
          }

          return;
        }

        if (typeof value !== "object") return;

        if (value.contentUrl) {
          candidates.push(value.contentUrl);
        }

        if (value.embedUrl) {
          candidates.push(value.embedUrl);
        }

        if (value.video) {
          scan(value.video);
        }

        if (value.videoObject) {
          scan(value.videoObject);
        }

        if (value["@graph"]) {
          scan(value["@graph"]);
        }
      };

      scan(data);
    } catch {
      // Geçersiz JSON-LD varsa devam et.
    }
  });

  for (const candidate of candidates) {
    const resolved = absoluteUrl(candidate, finalUrl);

    if (!resolved) continue;

    /*
     * Telegram doğrudan video URL'si beklediği için
     * açık video dosyalarını tercih ediyoruz.
     */
    if (
      /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(resolved)
    ) {
      return resolved;
    }

    /*
     * Bazı siteler uzantısız MP4 URL'si kullanabilir.
     * media/video gibi yolları da kabul ediyoruz.
     */
    if (
      /\/(video|videos|media)\/[^?#]+/i.test(resolved)
    ) {
      return resolved;
    }
  }

  return "";
}

function findImage($, finalUrl) {
  const candidates = [
    $('meta[property="og:image"]').attr("content"),
    $('meta[property="og:image:url"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('meta[name="twitter:image:src"]').attr("content")
  ];

  for (const candidate of candidates) {
    const resolved = absoluteUrl(candidate, finalUrl);

    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function chooseArticleText($) {
  const selectors = [
    "article",
    '[itemprop="articleBody"]',
    ".article-body",
    ".article-content",
    ".news-content",
    ".content-detail",
    "main"
  ];

  for (const selector of selectors) {
    const text = cleanText($(selector).text());

    if (text.length >= 100) {
      return text;
    }
  }

  return cleanText($("body").text());
}

async function fetchArticle(item) {
  const { html, finalUrl } = await fetchHtml(item.link);

  const $ = cheerio.load(html);

  $(
    "script, style, noscript, iframe, nav, footer, header, form"
  ).remove();

  const title =
    cleanText(
      $('meta[property="og:title"]').attr("content")
    ) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").text()) ||
    item.title;

  const description =
    cleanText(
      $('meta[property="og:description"]').attr("content")
    ) ||
    cleanText(
      $('meta[name="description"]').attr("content")
    ) ||
    item.description ||
    "";

  const body = chooseArticleText($);

  const image = findImage($, finalUrl);

  const video = findVideo($, finalUrl);

  return {
    ...item,
    link: finalUrl,
    title,
    description,
    body,
    image,
    video
  };
}

async function summarize(article) {
  const prompt = `
Sen HaberX için çalışan profesyonel bir haber editörüsün.

Aşağıdaki haberi kısa, tarafsız ve anlaşılır Türkçe ile özetle.

Kurallar:
- Yabancı haberleri Türkçeye çevir.
- Başlığı koru veya daha doğal Türkçe hale getir.
- 2 veya 3 kısa cümlelik haber özeti yaz.
- Sadece haberin önemli bilgilerini kullan.
- Link verme.
- Kaynak adı yazma.
- Hashtag kullanma.
- Emoji kullanma.
- Yorum veya kişisel görüş ekleme.
- "İşte detaylar" gibi gereksiz ifadeler kullanma.

Format:

BAŞLIK

Kısa haber özeti.

HABER BAŞLIĞI:
${article.title}

HABER AÇIKLAMASI:
${article.description}

HABER METNİ:
${article.body.slice(0, 14000)}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      geminiModel
    )}:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
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
    const errorText = await response.text();

    throw new Error(
      `Gemini ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();

  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

  if (!text) {
    throw new Error("Gemini boş cevap döndürdü.");
  }

  return text;
}

async function telegram(method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.description || "Bilinmeyen hata"}`
    );
  }

  return data;
}

async function sendArticle(article, text) {
  /*
   * Önce video denenir.
   */
  if (article.video) {
    try {
      await telegram("sendVideo", {
        chat_id: channel,
        video: article.video,
        caption: text,
        supports_streaming: true
      });

      console.log(
        `[${article.source}] Video Telegram'a gönderildi.`
      );

      return "video";
    } catch (error) {
      console.warn(
        `[${article.source}] Video gönderilemedi, fotoğrafa geçiliyor: ${error.message}`
      );
    }
  }

  /*
   * Video yoksa veya video gönderilemezse fotoğraf.
   */
  if (article.image) {
    try {
      await telegram("sendPhoto", {
        chat_id: channel,
        photo: article.image,
        caption: text
      });

      console.log(
        `[${article.source}] Fotoğraf Telegram'a gönderildi.`
      );

      return "photo";
    } catch (error) {
      console.warn(
        `[${article.source}] Fotoğraf gönderilemedi: ${error.message}`
      );
    }
  }

  /*
   * Video ve fotoğraf yoksa sadece metin.
   */
  await telegram("sendMessage", {
    chat_id: channel,
    text,
    disable_web_page_preview: true
  });

  console.log(
    `[${article.source}] Metin Telegram'a gönderildi.`
  );

  return "text";
}

async function loadState() {
  try {
    const raw = await fs.readFile(statePath, "utf8");

    return JSON.parse(raw);
  } catch {
    return {
      initialized: false,
      seenUrls: [],
      seenTexts: []
    };
  }
}

async function saveState(state) {
  await fs.mkdir(
    path.dirname(statePath),
    {
      recursive: true
    }
  );

  await fs.writeFile(
    statePath,
    JSON.stringify(state, null, 2) + "\n"
  );
}

function extractArticles(html, source) {
  const $ = cheerio.load(html);

  const urls = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    const url = absoluteUrl(
      href,
      source.home
    );

    if (!url) return;

    if (
      source.include &&
      source.include.test(url)
    ) {
      urls.push(url);
    }
  });

  return [
    ...new Set(urls)
  ].slice(
    0,
    source.limit || 30
  );
}

const state = await loadState();

const candidates = [];

for (const source of sources) {
  try {
    const { html } = await fetchHtml(
      source.home
    );

    const urls = extractArticles(
      html,
      source
    );

    console.log(
      `${source.name}: ${urls.length} aday bağlantı bulundu.`
    );

    for (const url of urls) {
      if (
        !state.seenUrls.includes(url)
      ) {
        candidates.push({
          link: url,
          source: source.name,
          language: source.language || "tr"
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
  if (published >= maxPosts) {
    break;
  }

  try {
    const article =
      await fetchArticle(item);

    if (
      !article.title ||
      article.body.length < 80
    ) {
      continue;
    }

    console.log(
      `[${item.source}] Haber bulundu: ${article.title}`
    );

    if (article.video) {
      console.log(
        `[${item.source}] Video bulundu: ${article.video}`
      );
    } else if (article.image) {
      console.log(
        `[${item.source}] Video yok, fotoğraf kullanılacak.`
      );
    } else {
      console.log(
        `[${item.source}] Video ve fotoğraf bulunamadı.`
      );
    }

    const text =
      await summarize(article);

    const mediaType =
      await sendArticle(
        article,
        text
      );

    console.log(
      `[${item.source}] Paylaşım tamamlandı: ${mediaType}`
    );

    state.seenUrls.push(
      item.link
    );

    published++;
  } catch (error) {
    console.warn(
      `${item.source} haber işlenemedi: ${error.message}`
    );
  }
}

state.seenUrls = [
  ...new Set(state.seenUrls)
].slice(-5000);

state.seenTexts = [
  ...new Set(state.seenTexts || [])
].slice(-5000);

state.initialized = true;

await saveState(state);

console.log(
  `${new Date().toISOString()} — ${published} yeni haber işlendi.`
);
