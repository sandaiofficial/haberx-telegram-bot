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

  // Open Graph video
  const metaSelectors = [
    'meta[property="og:video:secure_url"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video"]',
    'meta[name="twitter:player:stream"]',
    'meta[itemprop="contentUrl"]'
  ];

  for (const selector of metaSelectors) {
    $(selector).each((_, element) => {
      const value = $(element).attr("content");

      if (value) {
        candidates.push(value);
      }
    });
  }

  // Video etiketleri
  $("video").each((_, element) => {
    const attributes = [
      "src",
      "data-src",
      "data-video",
      "data-video-src",
      "data-url",
      "data-file",
      "data-video-url"
    ];

    for (const attribute of attributes) {
      const value = $(element).attr(attribute);

      if (value) {
        candidates.push(value);
      }
    }
  });

  // Video source etiketleri
  $("video source, source").each((_, element) => {
    const value =
      $(element).attr("src") ||
      $(element).attr("data-src") ||
      $(element).attr("data-url");

    if (value) {
      candidates.push(value);
    }
  });

  // iframe video kaynakları
  $("iframe").each((_, element) => {
    const src = $(element).attr("src");

    if (
      src &&
      /(video|player|media|embed)/i.test(src)
    ) {
      candidates.push(src);
    }
  });

  // Sayfadaki JSON-LD verilerini kontrol et
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const raw = $(element).html();

      if (!raw) return;

      const data = JSON.parse(raw);

      function scan(value) {
        if (!value) return;

        if (Array.isArray(value)) {
          for (const item of value) {
            scan(item);
          }

          return;
        }

        if (typeof value !== "object") return;

        const possibleVideoFields = [
          "contentUrl",
          "embedUrl",
          "videoUrl",
          "url"
        ];

        for (const field of possibleVideoFields) {
          const valueToAdd = value[field];

          if (
            typeof valueToAdd === "string" &&
            (
              /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(valueToAdd) ||
              /(video|media|player)/i.test(valueToAdd)
            )
          ) {
            candidates.push(valueToAdd);
          }
        }

        for (const key of Object.keys(value)) {
          if (
            key === "video" ||
            key === "videoObject" ||
            key === "@graph"
          ) {
            scan(value[key]);
          }
        }
      }

      scan(data);
    } catch {
      // Geçersiz JSON-LD varsa devam edilir.
    }
  });

  // Sayfanın HTML'i içinde açık MP4/WebM bağlantıları ara
  const html = $.html();

  const directVideoRegex =
    /https?:\/\/[^"'\\\s<>]+?\.(?:mp4|webm|mov)(?:\?[^"'\\\s<>]*)?/gi;

  const directVideos =
    html.match(directVideoRegex) || [];

  candidates.push(...directVideos);

  // Tekrarlanan adresleri kaldır
  const uniqueCandidates = [
    ...new Set(candidates)
  ];

  for (const candidate of uniqueCandidates) {
    const resolved = absoluteUrl(
      candidate,
      finalUrl
    );

    if (!resolved) continue;

    // MP4 / WebM / MOV
    if (
      /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(
        resolved
      )
    ) {
      return resolved;
    }

    // Bazı siteler uzantısız video URL'si kullanıyor
    if (
      /\/(video|videos|media)\/[^?#]+/i.test(
        resolved
      )
    ) {
      return resolved;
    }
  }

  return "";
}
