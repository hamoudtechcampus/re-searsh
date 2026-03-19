/**
 * ======================================================
 *  محرك بحث الوسائط - الخادم الخلفي
 *  Social Media Scraper Backend - Node.js + Express
 * ======================================================
 *
 *  التثبيت:
 *    npm install express cors axios cheerio p-limit
 *
 *  التشغيل:
 *    node server.js
 *
 *  يعمل على: http://localhost:3001
 * ======================================================
 */

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const cheerio = require("cheerio");
const https   = require("https");
const http    = require("http");

const app  = express();
const PORT = 3001;

// ── Middleware ────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Headers مشتركة تحاكي المتصفح ────────────────────
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ar,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control":   "no-cache",
  "Pragma":          "no-cache",
};

const axiosInst = axios.create({
  timeout: 12000,
  headers: BROWSER_HEADERS,
});

// ══════════════════════════════════════════════════════
//  1. INSTAGRAM  (Unofficial JSON endpoint)
// ══════════════════════════════════════════════════════
async function fetchInstagram(username) {
  // نقطة نهاية غير رسمية للملفات العامة
  const profileUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
  const mediaUrl   = `https://www.instagram.com/${username}/?__a=1&__d=dis`;

  const headers = {
    ...BROWSER_HEADERS,
    "X-IG-App-ID":        "936619743392459",
    "X-Requested-With":   "XMLHttpRequest",
    "Referer":            `https://www.instagram.com/${username}/`,
  };

  // -- الملف الشخصي
  const profileRes = await axiosInst.get(profileUrl, { headers });
  const user = profileRes.data?.data?.user;
  if (!user) throw new Error("Instagram: user not found");

  const profile = {
    username:    user.username,
    displayName: user.full_name,
    bio:         user.biography,
    followers:   formatNumber(user.edge_followed_by?.count),
    avatar:      user.profile_pic_url_hd || user.profile_pic_url,
    verified:    user.is_verified,
  };

  // -- الوسائط
  const mediaRes = await axiosInst.get(mediaUrl, { headers });
  const edges    = mediaRes.data?.graphql?.user?.edge_owner_to_timeline_media?.edges || [];

  const media = edges.map(({ node }) => {
    const isVideo  = node.is_video;
    const children = node.edge_sidecar_to_children?.edges;
    const items    = children
      ? children.map(({ node: c }) => mapIGNode(c))
      : [mapIGNode(node)];
    return items;
  }).flat();

  return { profile, media };
}

function mapIGNode(node) {
  return {
    id:        node.shortcode,
    type:      node.is_video ? "video" : "image",
    url:       node.is_video ? node.video_url : node.display_url,
    thumbnail: node.display_url,
    likes:     node.edge_liked_by?.count || 0,
    comments:  node.edge_media_to_comment?.count || 0,
    date:      new Date(node.taken_at_timestamp * 1000).toLocaleDateString("ar-SA"),
    caption:   node.edge_media_to_caption?.edges?.[0]?.node?.text || "",
  };
}

// ══════════════════════════════════════════════════════
//  2. TWITTER/X  (عبر Nitter - open source frontend)
//     يحتاج مثيل Nitter يعمل
// ══════════════════════════════════════════════════════

// مثيلات Nitter المتاحة مجاناً (قد تتغير)
const NITTER_INSTANCES = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.kavin.rocks",
];

async function fetchTwitter(username) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}/${username}/media`;
      const res  = await axiosInst.get(url, { headers: BROWSER_HEADERS });
      const $    = cheerio.load(res.data);

      // -- الملف الشخصي
      const profile = {
        username,
        displayName: $(".profile-card-fullname").text().trim() || username,
        bio:         $(".profile-bio").text().trim(),
        followers:   $(".followers .profile-stat-num").text().trim() || "0",
        avatar:      instance + $(".profile-card-avatar img").attr("src"),
        verified:    $(".verified-icon").length > 0,
      };

      // -- الوسائط
      const media = [];
      $(".attachment").each((_, el) => {
        const img   = $(el).find("img");
        const video = $(el).find("video source");
        if (video.length) {
          media.push({
            id:        `tw_${media.length}`,
            type:      "video",
            url:       instance + video.attr("src"),
            thumbnail: instance + (img.attr("src") || ""),
            likes:     0, comments: 0,
            date: new Date().toLocaleDateString("ar-SA"),
            caption: $(el).closest(".tweet-content").text().trim().slice(0, 100),
          });
        } else if (img.length) {
          const src = img.attr("src") || "";
          media.push({
            id:        `tw_${media.length}`,
            type:      "image",
            url:       instance + src.replace("/thumbnail/", "/orig/"),
            thumbnail: instance + src,
            likes: 0, comments: 0,
            date: new Date().toLocaleDateString("ar-SA"),
            caption: $(el).closest(".tweet-content").text().trim().slice(0, 100),
          });
        }
      });

      return { profile, media };
    } catch (_) {
      continue; // جرّب المثيل التالي
    }
  }
  throw new Error("Twitter: all Nitter instances failed");
}

// ══════════════════════════════════════════════════════
//  3. SOTWE  (موقع عرض تغريدات تويتر - sotwe.com)
// ══════════════════════════════════════════════════════
async function fetchSotwe(username) {
  const url = `https://sotwe.com/${username}`;
  const res  = await axiosInst.get(url, { headers: BROWSER_HEADERS });
  const $    = cheerio.load(res.data);

  const profile = {
    username,
    displayName: $(".user-name, .profile-name, h1").first().text().trim() || username,
    bio:         $(".user-bio, .profile-bio").first().text().trim(),
    followers:   $(".followers-count").first().text().trim() || "—",
    avatar:      $(".avatar img, .profile-avatar img").first().attr("src") || "",
    verified:    false,
  };

  const media = [];
  $("img[src*='/media/'], img[src*='pbs.twimg']").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    media.push({
      id:        `sotwe_${media.length}`,
      type:      "image",
      url:       src.replace("name=small", "name=orig"),
      thumbnail: src,
      likes: 0, comments: 0,
      date: new Date().toLocaleDateString("ar-SA"),
      caption: "",
    });
  });

  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  4. PIXNOY  (pixnoy.com - عارض صور)
// ══════════════════════════════════════════════════════
async function fetchPixnoy(username) {
  const url = `https://pixnoy.com/${username}`;
  const res  = await axiosInst.get(url, { headers: BROWSER_HEADERS });
  const $    = cheerio.load(res.data);

  const profile = {
    username,
    displayName: $("title").text().replace("Pixnoy", "").trim() || username,
    bio:         $(".user-bio").text().trim() || "Pixnoy Gallery",
    followers:   "—",
    avatar:      $(".avatar img").attr("src") || "",
    verified:    false,
  };

  const media = [];
  $("a[href*='/p/'] img, .media-item img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (!src) return;
    media.push({
      id:        `px_${media.length}`,
      type:      "image",
      url:       src,
      thumbnail: src,
      likes: 0, comments: 0,
      date: new Date().toLocaleDateString("ar-SA"),
      caption: $(el).attr("alt") || "",
    });
  });

  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  ROUTER - نقاط النهاية
// ══════════════════════════════════════════════════════

/**
 * GET /api/search?platform=instagram&username=najwakaram
 */
app.get("/api/search", async (req, res) => {
  const { platform, username } = req.query;
  if (!platform || !username) {
    return res.status(400).json({ error: "platform and username are required" });
  }

  try {
    let result;
    switch (platform) {
      case "instagram": result = await fetchInstagram(username); break;
      case "twitter":   result = await fetchTwitter(username);   break;
      case "sotwe":     result = await fetchSotwe(username);     break;
      case "pixnoy":    result = await fetchPixnoy(username);    break;
      default: return res.status(400).json({ error: `Unknown platform: ${platform}` });
    }
    res.json(result);
  } catch (err) {
    console.error(`[${platform}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/download?url=...&filename=...
 * وسيط للتحميل - يتجاوز CORS ويعيد الملف مباشرة
 */
app.get("/api/download", async (req, res) => {
  const { url, filename = "media" } = req.query;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    const response = await axiosInst.get(decodeURIComponent(url), {
      responseType: "stream",
      headers: BROWSER_HEADERS,
    });

    const contentType = response.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", contentType);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /health - فحص الخادم
 */
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على http://localhost:${PORT}`);
  console.log(`   /api/search?platform=instagram&username=najwakaram`);
  console.log(`   /api/download?url=...&filename=photo.jpg`);
});

// ── Helpers ──────────────────────────────────────────
function formatNumber(n) {
  if (!n) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
