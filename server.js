/**
 * MediaFetch - Backend Server
 * npm install express cors axios cheerio
 * node server.js
 */

const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const cheerio = require("cheerio");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── HEALTH ───────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════
//  INSTAGRAM - يجرب عدة مواقع عارضة حتى ينجح
// ══════════════════════════════════════════════════════
const IG_SCRAPERS = [
  fetchIgImginn,
  fetchIgInflact,
];

async function fetchInstagram(username) {
  for (const fn of IG_SCRAPERS) {
    try {
      const result = await fn(username);
      if (result.media.length > 0) return result;
    } catch(e) {
      console.log(`IG scraper failed: ${e.message}`);
      await sleep(1000);
    }
  }
  throw new Error("Instagram: كل المصادر فشلت");
}

// المصدر 1: imginn.com
async function fetchIgImginn(username) {
  const res = await http.get(`https://imginn.com/${username}/`, {
    headers: {
      "Referer": "https://www.google.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
  });
  const $ = cheerio.load(res.data);

  const profile = {
    username,
    displayName: $(".name").first().text().trim() || username,
    bio:         $(".desc").first().text().trim(),
    followers:   $(".num").eq(1).text().trim() || "—",
    following:   $(".num").eq(2).text().trim() || "—",
    posts:       $(".num").eq(0).text().trim() || "—",
    avatar:      $(".profile-pic img, .pic img").first().attr("src") || "",
    verified:    $(".verified").length > 0,
    cover:       "",
  };

  const media = [];
  $(".item").each((_, el) => {
    const img   = $(el).find("img");
    const src   = img.attr("src") || img.attr("data-src") || "";
    const isVid = $(el).find(".icon-play, .play, video").length > 0;
    if (!src) return;
    media.push({
      id:      `ig_${media.length}`,
      type:    isVid ? "video" : "image",
      url:     src,
      thumb:   src,
      likes:   parseInt($(el).find(".like, .likes").text().replace(/\D/g,"")) || 0,
      comments:parseInt($(el).find(".comment, .comments").text().replace(/\D/g,"")) || 0,
      date:    $(el).find("time, .time, .date").text().trim(),
      caption: $(el).find(".caption, p").text().trim().slice(0,120),
    });
  });

  // محاولة ثانية بمحدد مختلف
  if (media.length === 0) {
    $("img[src*='cdninstagram'], img[src*='instagram']").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (!src || src.includes("profile")) return;
      media.push({
        id:`ig_${media.length}`, type:"image",
        url:src, thumb:src, likes:0, comments:0, date:"", caption:"",
      });
    });
  }

  return { profile, media };
}

// المصدر 2: inflact.com
async function fetchIgInflact(username) {
  const res = await http.get(`https://inflact.com/profiles/instagram/${username}/`, {
    headers: { "Referer": "https://www.google.com/" }
  });
  const $ = cheerio.load(res.data);

  const profile = {
    username,
    displayName: $("h1, .fullname, .profile-name").first().text().trim() || username,
    bio:         $(".biography, .bio").first().text().trim(),
    followers:   "—", following:"—", posts:"—",
    avatar:      $(".avatar img, .profile img").first().attr("src") || "",
    verified:    false, cover:"",
  };

  const media = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src || !src.includes("http") || src.includes("logo") || src.includes("icon") || src.includes("avatar")) return;
    if (src.includes("cdninstagram") || src.includes("fbcdn") || src.includes("inflact")) {
      media.push({
        id:`ig2_${media.length}`, type:"image",
        url:src, thumb:src, likes:0, comments:0, date:"", caption:"",
      });
    }
  });

  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  TWITTER via Nitter
// ══════════════════════════════════════════════════════
const NITTER = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.net",
  "https://nitter.1d4.us",
  "https://nitter.cz",
];

async function fetchTwitter(username) {
  for (const instance of NITTER) {
    try {
      const res = await http.get(`${instance}/${username}/media`, { timeout: 8000 });
      const $ = cheerio.load(res.data);
      const profile = {
        username,
        displayName: $(".profile-card-fullname").text().trim() || username,
        bio:         $(".profile-bio p").text().trim(),
        followers:   $(".followers .profile-stat-num").text().trim() || "—",
        following:   $(".following .profile-stat-num").text().trim() || "—",
        posts:       $(".tweets .profile-stat-num").text().trim() || "—",
        avatar:      instance + ($(".profile-card-avatar img").attr("src") || ""),
        verified:    $(".verified-icon").length > 0, cover:"",
      };
      const media = [];
      $(".attachment").each((_, el) => {
        const video = $(el).find("video source");
        const img   = $(el).find(".still-image, img").first();
        const src   = img.attr("src") || "";
        if (video.length) {
          media.push({ id:`tw_${media.length}`, type:"video",
            url:instance+video.attr("src"), thumb:src?instance+src:"",
            likes:0, comments:0, date:"", caption:"" });
        } else if (src) {
          media.push({ id:`tw_${media.length}`, type:"image",
            url:instance+src.replace("small","orig"), thumb:instance+src,
            likes:0, comments:0, date:"", caption:"" });
        }
      });
      return { profile, media };
    } catch (_) { continue; }
  }
  throw new Error("Twitter: all Nitter instances failed");
}

// ══════════════════════════════════════════════════════
//  SOTWE
// ══════════════════════════════════════════════════════
async function fetchSotwe(username) {
  const res = await http.get(`https://sotwe.com/${username}`);
  const $ = cheerio.load(res.data);
  const profile = {
    username,
    displayName: $("h1").first().text().trim() || username,
    bio:"", followers:"—", following:"—", posts:"—",
    avatar:$("img.profile-img, .avatar img").first().attr("src")||"",
    verified:false, cover:"",
  };
  const media = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (!src.includes("pbs.twimg") && !src.includes("/media/")) return;
    media.push({ id:`sotwe_${media.length}`, type:"image",
      url:src.replace(/name=\w+/,"name=orig"), thumb:src,
      likes:0, comments:0, date:"", caption:"" });
  });
  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  PIXNOY
// ══════════════════════════════════════════════════════
async function fetchPixnoy(username) {
  const res = await http.get(`https://pixnoy.com/${username}`);
  const $ = cheerio.load(res.data);
  const profile = {
    username,
    displayName:$("title").text().replace(/pixnoy/i,"").trim()||username,
    bio:"Pixnoy Gallery", followers:"—", following:"—", posts:"—",
    avatar:$(".avatar img").first().attr("src")||"",
    verified:false, cover:"",
  };
  const media = [];
  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src")||$(el).attr("data-src")||"";
    if (!src||src.includes("logo")||src.includes("icon")) return;
    media.push({ id:`px_${media.length}`, type:"image",
      url:src, thumb:src, likes:0, comments:0, date:"",
      caption:$(el).attr("alt")||"" });
  });
  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  TIKTOK
// ══════════════════════════════════════════════════════
async function fetchTiktok(username) {
  const res = await http.get(`https://www.tiktok.com/@${username}`);
  const $ = cheerio.load(res.data);
  let profile = { username, displayName:username, bio:"",
    followers:"—", following:"—", posts:"—",
    avatar:"", verified:false, cover:"" };
  try {
    const script = $("#SIGI_STATE").html();
    if (script) {
      const json = JSON.parse(script);
      const user = json?.UserModule?.users?.[username];
      if (user) {
        profile.displayName = user.nickname||username;
        profile.bio         = user.signature||"";
        profile.followers   = fmtN(user.stats?.followerCount);
        profile.following   = fmtN(user.stats?.followingCount);
        profile.posts       = fmtN(user.stats?.videoCount);
        profile.avatar      = user.avatarLarger||"";
        profile.verified    = user.verified||false;
      }
    }
  } catch(_) {}
  const media = [];
  $("img[src*='tiktokcdn']").each((_, el) => {
    const src = $(el).attr("src")||"";
    if (!src) return;
    media.push({ id:`tt_${media.length}`, type:"image",
      url:src, thumb:src, likes:0, comments:0, date:"", caption:"" });
  });
  return { profile, media };
}

// ══════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════
app.get("/api/search", async (req, res) => {
  const { platform, username } = req.query;
  if (!platform || !username)
    return res.status(400).json({ error: "platform and username required" });
  console.log(`[${platform}] Searching: ${username}`);
  try {
    let result;
    switch(platform) {
      case "instagram": result = await fetchInstagram(username); break;
      case "twitter":   result = await fetchTwitter(username);   break;
      case "sotwe":     result = await fetchSotwe(username);     break;
      case "pixnoy":    result = await fetchPixnoy(username);    break;
      case "tiktok":    result = await fetchTiktok(username);    break;
      default: return res.status(400).json({ error:"Unknown platform" });
    }
    console.log(`[${platform}] OK - ${result.media.length} items`);
    res.json(result);
  } catch(err) {
    console.error(`[${platform}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, filename="media" } = req.query;
  if (!url) return res.status(400).json({ error:"url required" });
  try {
    const response = await http.get(decodeURIComponent(url), { responseType:"stream" });
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", response.headers["content-type"]||"application/octet-stream");
    response.data.pipe(res);
  } catch(err) { res.status(500).json({ error:err.message }); }
});

app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));

function fmtN(n) {
  if (!n) return "—";
  if (n>=1e6) return (n/1e6).toFixed(1)+"M";
  if (n>=1e3) return (n/1e3).toFixed(1)+"K";
  return String(n);
}
