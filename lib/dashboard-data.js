const APP_ID = "1782120";
const STEAM_REVIEW_URL = `https://store.steampowered.com/appreviews/${APP_ID}`;
const STEAM_NEWS_URL = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/";
const ANNOUNCEMENTS_URL = `https://steamcommunity.com/games/${APP_ID}/announcements`;
const REVIEW_PURCHASE_TYPE = "steam";
const DAY = 24 * 60 * 60 * 1000;

let cache = { data: null, fetchedAt: 0 };

function clampText(value, max = 420) {
  if (!value) return "";
  const cleaned = String(value).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned;
}

function dateKey(timestampMs) {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function labelFor(positive, total) {
  if (!total) return { label: "No recent reviews", color: "muted", threshold: null };
  const ratio = positive / total;
  if (total >= 500 && ratio >= 0.95) return { label: "Overwhelmingly Positive", color: "great", threshold: 0.95 };
  if (total >= 50 && ratio >= 0.8) return { label: "Very Positive", color: "good", threshold: 0.8 };
  if (total >= 10 && ratio >= 0.8) return { label: "Positive", color: "good", threshold: 0.8 };
  if (total >= 10 && ratio >= 0.7) return { label: "Mostly Positive", color: "watch", threshold: 0.7 };
  if (total >= 10 && ratio >= 0.4) return { label: "Mixed", color: "risk", threshold: 0.4 };
  if (total >= 500) return { label: "Overwhelmingly Negative", color: "bad", threshold: 0.2 };
  if (total >= 50) return { label: "Very Negative", color: "bad", threshold: 0.2 };
  if (total >= 10) return { label: "Mostly Negative", color: "bad", threshold: 0.2 };
  return { label: "Too few recent reviews", color: "muted", threshold: null };
}

function nextPositiveTarget(positive, negative) {
  const total = positive + negative;
  const tiers = [
    { label: "Mostly Positive", ratio: 0.7, min: 10 },
    { label: "Very Positive", ratio: 0.8, min: 50 },
    { label: "Overwhelmingly Positive", ratio: 0.95, min: 500 },
  ];
  for (const tier of tiers) {
    if (total < tier.min || positive / Math.max(total, 1) < tier.ratio) {
      let needed = 0;
      while ((positive + needed) / (total + needed) < tier.ratio || total + needed < tier.min) needed += 1;
      return { ...tier, needed };
    }
  }
  return { label: "Maintain Overwhelmingly Positive", ratio: 0.95, min: 500, needed: 0 };
}

function negativeBudget(positive, negative) {
  const total = positive + negative;
  const current = labelFor(positive, total);
  const floor = current.label === "Overwhelmingly Positive" ? 0.95
    : current.label === "Very Positive" || current.label === "Positive" ? 0.8
    : current.label === "Mostly Positive" ? 0.7
    : current.label === "Mixed" ? 0.4
    : null;
  if (!floor) return null;
  let budget = 0;
  while (positive / (total + budget + 1) >= floor) budget += 1;
  return budget;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "user-agent": "ModernWolfReviewMonitor/0.1 (+dashboard)",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,*/*;q=0.8",
      "user-agent": "ModernWolfReviewMonitor/0.1 (+dashboard)",
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function normalizeReview(review) {
  const createdMs = Number(review.timestamp_created || 0) * 1000;
  const respondedMs = Number(review.timestamp_dev_responded || 0) * 1000;
  return {
    id: review.recommendationid,
    author: review.author?.personaname || "Steam user",
    language: review.language || "unknown",
    votedUp: Boolean(review.voted_up),
    review: clampText(review.review, 900),
    createdAt: new Date(createdMs).toISOString(),
    createdMs,
    day: dateKey(createdMs),
    hours: Math.round((review.author?.playtime_forever || 0) / 6) / 10,
    votesUp: review.votes_up || 0,
    funny: review.votes_funny || 0,
    commentCount: review.comment_count || 0,
    steamPurchase: Boolean(review.steam_purchase),
    developerResponse: clampText(review.developer_response, 600),
    developerRespondedAt: respondedMs ? new Date(respondedMs).toISOString() : null,
    url: `https://steamcommunity.com/profiles/${review.author?.steamid || ""}/recommended/${APP_ID}/`,
  };
}

async function fetchRecentReviews() {
  const cutoff = Date.now() - 30 * DAY;
  const reviews = [];
  let cursor = "*";
  let querySummary = null;

  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      json: "1",
      filter: "recent",
      language: "all",
      review_type: "all",
      purchase_type: REVIEW_PURCHASE_TYPE,
      num_per_page: "100",
      cursor,
    });
    const payload = await fetchJson(`${STEAM_REVIEW_URL}?${params.toString()}`);
    if (!querySummary && payload.query_summary) querySummary = payload.query_summary;
    const batch = Array.isArray(payload.reviews) ? payload.reviews : [];
    for (const review of batch) {
      const createdMs = Number(review.timestamp_created || 0) * 1000;
      if (createdMs >= cutoff) reviews.push(normalizeReview(review));
    }
    const oldest = Math.min(...batch.map((review) => Number(review.timestamp_created || 0) * 1000));
    if (!batch.length || !payload.cursor || oldest < cutoff) break;
    cursor = payload.cursor;
  }

  return { reviews, querySummary };
}

function buildReviewMetrics(reviews, querySummary) {
  const positive = reviews.filter((review) => review.votedUp).length;
  const negative = reviews.length - positive;
  const score = reviews.length ? positive / reviews.length : 0;
  const byDay = new Map();

  for (let offset = 29; offset >= 0; offset -= 1) {
    const key = dateKey(Date.now() - offset * DAY);
    byDay.set(key, { day: key, positive: 0, negative: 0, total: 0 });
  }
  for (const review of reviews) {
    if (!byDay.has(review.day)) byDay.set(review.day, { day: review.day, positive: 0, negative: 0, total: 0 });
    const bucket = byDay.get(review.day);
    bucket[review.votedUp ? "positive" : "negative"] += 1;
    bucket.total += 1;
  }

  const projections = [];
  for (let offset = 0; offset <= 30; offset += 1) {
    const cutoff = Date.now() + offset * DAY - 30 * DAY;
    const inWindow = reviews.filter((review) => review.createdMs >= cutoff);
    const pos = inWindow.filter((review) => review.votedUp).length;
    const total = inWindow.length;
    projections.push({
      dayOffset: offset,
      date: dateKey(Date.now() + offset * DAY),
      positive: pos,
      negative: total - pos,
      total,
      score: total ? pos / total : 0,
      label: labelFor(pos, total),
    });
  }

  const negativesWithoutResponse = reviews.filter((review) => !review.votedUp && !review.developerResponse);
  const positivesWithoutResponse = reviews.filter((review) => review.votedUp && !review.developerResponse);

  return {
    appId: APP_ID,
    updatedAt: new Date().toISOString(),
    sourceSummary: querySummary,
    purchaseType: REVIEW_PURCHASE_TYPE,
    positive,
    negative,
    total: reviews.length,
    score,
    label: labelFor(positive, reviews.length),
    target: nextPositiveTarget(positive, negative),
    negativeBudget: negativeBudget(positive, negative),
    response: {
      negativeOpen: negativesWithoutResponse.length,
      positiveOpen: positivesWithoutResponse.length,
      negativeResponseRate: negative ? (negative - negativesWithoutResponse.length) / negative : 1,
    },
    daily: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    projections,
  };
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function fetchStoreRecentSummary() {
  const html = await fetchText(`https://store.steampowered.com/app/${APP_ID}/ZERO_Sievert/`);
  const rowMatch = html.match(/<a class="user_reviews_summary_row"[\s\S]*?Recent Reviews:[\s\S]*?<\/a>/i);
  const source = rowMatch ? rowMatch[0] : html;
  const tooltip = source.match(/data-tooltip-html="([^"]*last 30 days[^"]*)"/i)?.[1];
  const label = source.match(/<span class="game_review_summary[^"]*">([^<]+)<\/span>/i)?.[1]?.trim();
  const countText = source.match(/\(([\d,]+)\)/)?.[1] || tooltip?.match(/of the ([\d,]+) user reviews/i)?.[1];
  const percentText = tooltip?.match(/([\d.]+)% of the/i)?.[1] || source.match(/-\s*([\d.]+)% of the/i)?.[1];
  if (!label || !countText || !percentText) return null;
  const total = Number(countText.replace(/,/g, ""));
  const percent = Number(percentText) / 100;
  const positive = Math.round(total * percent);
  return {
    label,
    total,
    positive,
    negative: Math.max(total - positive, 0),
    score: percent,
    tooltip: decodeHtml(tooltip || ""),
    source: "steam-store-page",
  };
}

function applyStoreSummary(metrics, storeSummary) {
  if (!storeSummary) return metrics;
  const computed = labelFor(storeSummary.positive, storeSummary.total);
  return {
    ...metrics,
    storeSummary,
    positive: storeSummary.positive,
    negative: storeSummary.negative,
    total: storeSummary.total,
    score: storeSummary.score,
    label: { ...computed, label: storeSummary.label },
    target: nextPositiveTarget(storeSummary.positive, storeSummary.negative),
    negativeBudget: negativeBudget(storeSummary.positive, storeSummary.negative),
  };
}

function stripSteamMarkup(value) {
  return String(value || "")
    .replace(/\[\/?(?:p|b|i|h\d|list|\*)[^\]]*\]/gi, " ")
    .replace(/\[url=[^\]]+\]([^\[]+)\[\/url\]/gi, "$1")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function summarizeTopics(text) {
  const dictionary = [
    ["crash", ["crash", "crashes", "stability"]],
    ["controller", ["controller", "gamepad", "aim assist", "steamdeck", "steam deck"]],
    ["fullscreen", ["fullscreen", "borderless", "alt-tab", "gpu"]],
    ["localization", ["localization", "translation", "spanish", "german", "portuguese"]],
    ["content", ["boss", "phantom", "quest", "radio", "skins", "container"]],
    ["bugs", ["bug", "fix", "hotfix", "patch"]],
  ];
  const source = text.toLowerCase();
  return dictionary
    .map(([label, terms]) => ({
      label,
      count: terms.reduce((sum, term) => sum + (source.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 0),
    }))
    .filter((topic) => topic.count > 0)
    .sort((a, b) => b.count - a.count);
}

async function scrapeAnnouncementMeta() {
  const html = await fetchText(ANNOUNCEMENTS_URL);
  const configMatch = html.match(/data-events="([^"]+)"/);
  if (!configMatch) return [];
  const events = JSON.parse(decodeHtml(configMatch[1]));
  return events.map((event) => ({
    title: event.event_name || event.announcement_body?.headline,
    commentCount: event.announcement_body?.commentcount ?? event.comment_count ?? 0,
    forumTopicId: event.forum_topic_id || event.announcement_body?.forum_topic_id,
    votesUp: event.votes_up ?? event.announcement_body?.voteupcount,
    votesDown: event.votes_down ?? event.announcement_body?.votedowncount,
  }));
}

async function fetchNews() {
  const newsUrl = new URL(STEAM_NEWS_URL);
  newsUrl.search = new URLSearchParams({
    appid: APP_ID,
    count: "8",
    maxlength: "900",
    feeds: "steam_community_announcements",
  }).toString();
  const [news, announcementMeta] = await Promise.all([
    fetchJson(newsUrl.toString()),
    scrapeAnnouncementMeta().catch(() => []),
  ]);
  const metaByTitle = new Map(announcementMeta.map((item) => [item.title, item]));
  const items = (news.appnews?.newsitems || []).map((item) => {
    const meta = metaByTitle.get(item.title) || {};
    return {
      gid: item.gid,
      title: item.title,
      author: item.author,
      contents: clampText(stripSteamMarkup(item.contents), 700),
      date: new Date(Number(item.date || 0) * 1000).toISOString(),
      url: item.url,
      tags: item.tags || [],
      commentCount: meta.commentCount ?? null,
      forumTopicId: meta.forumTopicId || null,
      votesUp: meta.votesUp ?? null,
      votesDown: meta.votesDown ?? null,
      commentStatus: meta.forumTopicId
        ? "Steam exposes counts publicly; comment text may require authenticated community thread access."
        : "No public comment thread metadata found.",
    };
  });
  return { items, topics: summarizeTopics(items.map((item) => item.contents).join(" ")) };
}

function summarizeReviewTopics(reviews) {
  const negativeText = reviews.filter((review) => !review.votedUp).map((review) => review.review).join(" ");
  return summarizeTopics(negativeText);
}

async function dashboardData(force = false) {
  if (!force && cache.data && Date.now() - cache.fetchedAt < 10 * 60 * 1000) return cache.data;
  const [{ reviews, querySummary }, news, storeSummary] = await Promise.all([
    fetchRecentReviews(),
    fetchNews(),
    fetchStoreRecentSummary().catch(() => null),
  ]);
  const metrics = applyStoreSummary(buildReviewMetrics(reviews, querySummary), storeSummary);
  const sorted = [...reviews].sort((a, b) => b.createdMs - a.createdMs);
  const data = {
    game: {
      name: "ZERO Sievert",
      publisher: "Modern Wolf",
      steamUrl: `https://store.steampowered.com/app/${APP_ID}/ZERO_Sievert/`,
    },
    research: {
      thresholds: [
        { label: "Mixed", ratio: "40-69%", minReviews: 10 },
        { label: "Mostly Positive", ratio: "70-79%", minReviews: 10 },
        { label: "Very Positive", ratio: "80-94%", minReviews: 50 },
        { label: "Overwhelmingly Positive", ratio: "95%+", minReviews: 500 },
      ],
      notes: [
        "Review data comes from Steam's public appreviews endpoint.",
        "The headline score uses Steam's public store-page Recent Reviews summary when available, with Steam-purchase reviews used for the detail feed.",
        "The 30-day forecast assumes no new reviews arrive, so it isolates the fall-out effect of existing reviews aging out.",
        "Community announcement comment counts are public in Steam event metadata; text scraping is best-effort and may require an authenticated community call.",
      ],
    },
    metrics,
    reviews: {
      latest: sorted.slice(0, 60),
      negative: sorted.filter((review) => !review.votedUp).slice(0, 30),
      positive: sorted.filter((review) => review.votedUp).slice(0, 30),
      topics: summarizeReviewTopics(reviews),
    },
    news,
  };
  cache = { data, fetchedAt: Date.now() };
  return data;
}

module.exports = { dashboardData };
