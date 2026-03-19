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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const http = axios.create({
  timeout: 12000,
  headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.9" }
});

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// INSTAGRAM via Picuki
async function fetchInstagram(username) {
  const res = await http.get(`https://www.picuki.com/profile/${username}`, {
    headers: { "Referer": "https://www.google.com/" }
  });
  const $ = cheerio.load(res.data);
  const profile = {
    username,
    displayName: $(".profile-name-bottom h1").first().text().trim() || username,
    bio:         $(".profile-description").first().text().trim(),
    followers:   $(".counter-block").eq(1).find(".number").text().trim() || "—",
    following:   $(".counter-block").eq(2).find(".number").text().trim() || "—",
    posts:       $(".counter-block").eq(0).find(".number").text().trim() || "—",
    avatar:      $(".profile-avatar img").attr("src") || "",
    verified:    false, cover: "",
  };
  const media = [];
  $(".box-photo").each((_, el) => {
    const img  = $(el).find("img");
    const src  = img.attr("src") || img.attr("data-src") || "";
    if(!src) return;
    media.push({
      id: `ig_${media.length}`,
      type: $(el).find(".video-mask").length > 0 ? "video" : "image",
      url: src, thumb: src,
      likes: parseInt($(el).find(".likes").text().replace(/\D/g,"")) || 0,
      comments: 0,
      date: $(el).find(".time").text().trim(),
      caption: $(el).find(".photo-description").text().trim().slice(0,120),
    });
  });
  return { profile, media };
}

// TWITTER via Nitter
const NITTER = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.net",
  "https://nitter.1d4.us",
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
        verified:    $(".verified-icon").length > 0, cover: "",
      };
      const media = [];
      $(".attachment").each((_, el) => {
        const video = $(el).find("video source");
        const img   = $(el).find(".still-image, img").first();
        const src   = img.attr("src") || "";
        if (video.length) {
          media.push({ id:`tw_${media.length}`, type:"video",
            url: instance+video.attr("src"), thumb: src ? instance+src : "",
            likes:0, comments:0, date:"", caption:"" });
        } else if (src) {
          media.push({ id:`tw_${media.length}`, type:"image",
            url: instance+src.replace("small","orig"), thumb: instance+src,
            likes:0, comments:0, date:"", caption:"" });
        }
      });
      return { profile, media };
    } catch (_) { continue; }
  }
  throw new Error("Twitter: all Nitter instances failed");
}

// SOTWE
async function fetchSotwe(username) {
  const res = await http.get(`https://sotwe.com/${username}`);
  const $ = cheerio.load(res.data);
  const profile = {
    username,
    displayName: $("h1").first().text().trim() || username,
    bio: "", followers:"—", following:"—", posts:"—",
    avatar: $("img.profile-img, .avatar img").first().attr("src") || "",
    verified: false, cover: "",
  };
  const media = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (!src.includes("pbs.twimg") && !src.includes("/media/")) return;
    media.push({ id:`sotwe_${media.length}`, type:"image",
      url: src.replace(/name=\w+/,"name=orig"), thumb: src,
      likes:0, comments:0, date:"", caption:"" });
  });
  return { profile, media };
}

// PIXNOY
async function fetchPixnoy(username) {
  const res = await http.get(`https://pixnoy.com/${username}`);
  const $ = cheerio.load(res.data);
  const profile = {
    username,
    displayName: $("title").text().replace(/pixnoy/i,"").trim() || username,
    bio:"Pixnoy Gallery", followers:"—", following:"—", posts:"—",
    avatar: $(".avatar img").first().attr("src") || "",
    verified: false, cover: "",
  };
  const media = [];
  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src || src.includes("logo") || src.includes("icon")) return;
    media.push({ id:`px_${media.length}`, type:"image",
      url: src, thumb: src, likes:0, comments:0, date:"",
      caption: $(el).attr("alt") || "" });
  });
  return { profile, media };
}

// TIKTOK
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
        profile.displayName = user.nickname || username;
        profile.bio         = user.signature || "";
        profile.followers   = fmtN(user.stats?.followerCount);
        profile.following   = fmtN(user.stats?.followingCount);
        profile.posts       = fmtN(user.stats?.videoCount);
        profile.avatar      = user.avatarLarger || "";
        profile.verified    = user.verified || false;
      }
    }
  } catch(_) {}
  const media = [];
  $("img[src*='tiktokcdn']").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (!src) return;
    media.push({ id:`tt_${media.length}`, type:"image",
      url:src, thumb:src, likes:0, comments:0, date:"", caption:"" });
  });
  return { profile, media };
}

// ROUTES
app.get("/api/search", async (req, res) => {
  const { platform, username } = req.query;
  if (!platform || !username)
    return res.status(400).json({ error: "platform and username are required" });
  console.log(`[${platform}] ${username}`);
  try {
    let result;
    switch(platform) {
      case "instagram": result = await fetchInstagram(username); break;
      case "twitter":   result = await fetchTwitter(username);   break;
      case "sotwe":     result = await fetchSotwe(username);     break;
      case "pixnoy":    result = await fetchPixnoy(username);    break;
      case "tiktok":    result = await fetchTiktok(username);    break;
      default: return res.status(400).json({ error: "Unknown platform" });
    }
    console.log(`[${platform}] ${result.media.length} items`);
    res.json(result);
  } catch(err) {
    console.error(`[${platform}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/download", async (req, res) => {
  const { url, filename="media" } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const response = await http.get(decodeURIComponent(url), { responseType:"stream" });
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", response.headers["content-type"] || "application/octet-stream");
    response.data.pipe(res);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));

function fmtN(n) {
  if (!n) return "—";
  if (n>=1e6) return (n/1e6).toFixed(1)+"M";
  if (n>=1e3) return (n/1e3).toFixed(1)+"K";
  return String(n);
}
