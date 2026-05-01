const state = { data: null, filter: "negative" };

const $ = (selector) => document.querySelector(selector);
const pct = (value) => `${Math.round(value * 1000) / 10}%`;
const fmt = (iso) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(iso));
const fmtShortDate = (dateLike) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(`${dateLike}T00:00:00Z`));
const labelClass = (label) => {
  if (/overwhelming/i.test(label)) return "great";
  if (/mixed|negative/i.test(label)) return "risk";
  if (/mostly positive/i.test(label)) return "watch";
  if (/very positive/i.test(label)) return "good";
  return "muted";
};

const dateNode = $("#currentDate");
if (dateNode) {
  dateNode.textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

async function load(refresh = false) {
  setText("#label", "Loading Steam data...");
  const response = await fetch(`/api/dashboard${refresh ? "?refresh=1" : ""}`);
  if (!response.ok) throw new Error(await response.text());
  state.data = await response.json();
  render();
}

function render() {
  const { metrics, reviews, news, research, game } = state.data;
  setText("#label", metrics.label.label);
  $("#label").className = labelClass(metrics.label.label);
  $("#steamLink").href = game.steamUrl;
  setText("#score", pct(metrics.score));
  $("#score").className = labelClass(metrics.label.label);
  const purchaseScope = metrics.purchaseType === "steam" ? "Steam-purchase" : "all";
  const scopeText = metrics.storeSummary ? "official Steam recent score" : `${purchaseScope} reviews`;
  setText("#counts", `${metrics.positive} positive / ${metrics.negative} negative from ${metrics.total} recent ${scopeText}`);
  setText("#target", metrics.target.needed === 0 ? "Hold" : `+${metrics.target.needed}`);
  setText("#targetLabel", metrics.target.needed === 0 ? metrics.target.label : `Positive reviews needed for ${metrics.target.label}`);
  setText("#budget", metrics.negativeBudget == null ? "--" : metrics.negativeBudget);
  setText("#openNegatives", metrics.response.negativeOpen);
  renderMeter(metrics);
  renderBurningKpi(metrics);
  renderProjection(metrics.projections);
  renderDaily(metrics.daily);
  renderTopics("#reviewTopics", reviews.topics);
  renderReviews();
  renderTopics("#newsTopics", news.topics);
  renderNews(news.items);
  renderResearch(research);
}

function positivesNeededForThreshold(positive, total, threshold, buffer = 0) {
  let needed = 0;
  while ((positive + needed) / (total + needed) < threshold || needed < buffer) {
    needed += 1;
  }
  return needed;
}

function currentFloor(label) {
  if (/overwhelming/i.test(label)) return 0.95;
  if (/very positive|positive/i.test(label) && !/mostly/i.test(label)) return 0.8;
  if (/mostly positive/i.test(label)) return 0.7;
  if (/mixed/i.test(label)) return 0.4;
  return null;
}

function renderBurningKpi(metrics) {
  const kpi = $("#burnKpi");
  const floor = currentFloor(metrics.label.label);
  const firstDrop = metrics.projections.find((point) => point.label.label !== metrics.label.label);
  if (!floor || !firstDrop) {
    kpi.className = "burnKpi calm";
    setText("#burnKpiTitle", "No immediate downgrade");
    setText("#burnKpiText", "No category drop is visible in the current fall-out model.");
    return;
  }

  const minimum = positivesNeededForThreshold(firstDrop.positive, firstDrop.total, floor);
  const recommended = Math.max(minimum + 1, 1);
  const date = fmtShortDate(firstDrop.date);
  const urgent = firstDrop.dayOffset <= 2;
  kpi.className = `burnKpi ${urgent ? "urgent" : "watch"}`;
  setText("#burnKpiTitle", `+${recommended} positive reviews by ${date}`);
  setText("#burnKpiText", `Otherwise the 30-day label is projected to become ${firstDrop.label.label}.`);
}

function renderMeter(metrics) {
  const positionFor = (value) => {
    const score = Math.max(0.4, Math.min(value, 1));
    return ((score - 0.4) / 0.6) * 100;
  };
  const position = positionFor(metrics.score);
  const tomorrow = metrics.projections?.[1] || metrics.projections?.[0];
  const tomorrowPosition = positionFor(tomorrow?.score ?? metrics.score);
  $("#meterFill").style.width = `${position}%`;
  $("#meterMarker").style.left = `${position}%`;
  $("#meterMarkerTomorrow").style.left = `${tomorrowPosition}%`;
  $("#meterFill").className = `meterFill ${labelClass(metrics.label.label)}`;
  $("#meterMarker").className = `meterMarker ${labelClass(metrics.label.label)}`;
  $("#meterMarkerTomorrow").className = `meterMarker ghost ${labelClass(tomorrow?.label?.label || metrics.label.label)}`;
  $("#meterScore").className = labelClass(metrics.label.label);
  setText("#meterScore", pct(metrics.score));
  $("#meterTodayLabel").style.left = `${position}%`;
  $("#meterTomorrowLabel").style.left = `${tomorrowPosition}%`;
  setText("#meterTodayLabel", `Today ${pct(metrics.score)}`);
  setText("#meterTomorrowLabel", `Tomorrow ${pct(tomorrow?.score ?? metrics.score)}`);
  const budget = metrics.negativeBudget == null
    ? "No downgrade floor"
    : `${metrics.negativeBudget} negative review buffer`;
  const target = metrics.target.needed === 0 ? metrics.target.label : `${metrics.target.needed} positives to ${metrics.target.label}`;
  setText("#meterStatus", `${budget} · ${target}`);
}

function renderProjection(projections) {
  const chart = $("#projectionChart");
  chart.innerHTML = projections.map((point, index) => {
    const height = Math.max(8, point.score * 220);
    const cls = labelClass(point.label.label);
    const showValue = index === 0 || index % 5 === 0 || point.label.label !== projections[index - 1]?.label.label;
    const showDate = index === 0 || index % 5 === 0 || index === projections.length - 1;
    const next = projections[index + 1];
    const reviewDelta = next ? next.total - point.total : 0;
    const lostPositive = next ? Math.max(0, point.positive - next.positive) : 0;
    const lostNegative = next ? Math.max(0, point.negative - next.negative) : 0;
    const scoreDelta = next ? next.score - point.score : 0;
    const deltaClass = scoreDelta > 0.002 ? "up" : scoreDelta < -0.002 ? "down" : "flat";
    const deltaLabel = fallawayLabel(lostPositive, lostNegative);
    const deltaTitle = next
      ? `Before next day: ${Math.abs(reviewDelta)} reviews leave (${lostPositive} positive, ${lostNegative} negative). Score impact ${scoreDelta >= 0 ? "+" : ""}${pct(scoreDelta)}.`
      : "";
    const tip = `${point.date}: ${pct(point.score)} (${point.positive}/${point.total}) ${point.label.label}`;
    return `
      <div class="projectionColumn" data-tip="${escapeAttr(tip)}">
        <span class="barValue">${showValue ? pct(point.score) : ""}</span>
        <div class="projectionBar ${cls}" style="height:${height}px"></div>
        <span class="axisDate">${showDate ? fmtShortDate(point.date) : ""}</span>
        <span class="fallawayLabel ${deltaClass}" title="${escapeAttr(deltaTitle)}">${deltaLabel}</span>
      </div>`;
  }).join("");
  chart.innerHTML = `<div class="chartGrid">${chart.innerHTML}</div>`;
  const first = projections[0]?.label.label;
  const change = projections.find((point) => point.label.label !== first);
  setText("#forecastWarning", change ? `Changes to ${change.label.label} on ${change.date}` : "No label change projected");
  const alert = $("#forecastAlert");
  if (!change) {
    alert.className = "forecastAlert calm";
    alert.textContent = "No automatic label downgrade is visible in the 30-day fall-out model.";
    return;
  }
  const days = change.dayOffset;
  const urgent = days <= 2;
  alert.className = `forecastAlert ${urgent ? "urgent" : "watch"}`;
  alert.textContent = urgent
    ? `Urgent: projected to drop to ${change.label.label} in ${days} day${days === 1 ? "" : "s"} if no offsetting positive reviews arrive.`
    : `Watch: projected to change to ${change.label.label} in ${days} days without new reviews.`;
}

function fallawayLabel(lostPositive, lostNegative) {
  const total = lostPositive + lostNegative;
  if (!total) return "";
  if (lostPositive && lostNegative) return `-${lostPositive}P/-${lostNegative}N`;
  if (lostPositive) return `-${lostPositive}P`;
  return `-${lostNegative}N`;
}

function renderDaily(days) {
  const visible = days.slice(-14).reverse();
  $("#dailyBars").innerHTML = visible.map((day, index) => {
    const previous = visible[index + 1];
    const delta = previous ? day.total - previous.total : 0;
    const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const arrow = delta > 0 ? "+" : delta < 0 ? "-" : "=";
    const posWidth = day.total ? (day.positive / day.total) * 100 : 0;
    const negWidth = day.total ? (day.negative / day.total) * 100 : 0;
    return `
      <div class="dayRow">
        <span>${fmtShortDate(day.day)}</span>
        <span class="stack">
          <i class="pos" style="width:${posWidth}%"></i>
          <i class="neg" style="width:${negWidth}%"></i>
        </span>
        <span class="dayTotal ${deltaClass}">${day.total} ${arrow}</span>
      </div>`;
  }).join("");
}

function renderTopics(selector, topics) {
  const node = $(selector);
  if (!topics?.length) {
    node.innerHTML = `<span class="topic">No recurring terms yet</span>`;
    return;
  }
  node.innerHTML = topics.slice(0, 8).map((topic) => `<span class="topic">${topic.label} (${topic.count})</span>`).join("");
}

function renderReviews() {
  const group = state.data.reviews[state.filter] || [];
  $("#reviewList").innerHTML = group.map((review) => `
    <article class="review">
      <div class="reviewMeta">
        <span class="badge ${review.votedUp ? "positive" : "negative"}">${review.votedUp ? "Positive" : "Negative"}</span>
        <span>${fmt(review.createdAt)}</span>
        <span>${escapeHtml(review.language)}</span>
        <span>${review.hours}h played</span>
        <span>${review.developerResponse ? "Developer responded" : "No developer response"}</span>
      </div>
      <div>${escapeHtml(review.review)}</div>
      ${review.developerResponse ? `<div class="response">${escapeHtml(review.developerResponse)}</div>` : ""}
      <a class="inlineLink" href="${escapeAttr(review.url)}" target="_blank" rel="noreferrer">Open Steam review ↗</a>
    </article>
  `).join("");
}

function renderNews(items) {
  $("#newsList").innerHTML = items.map((item) => `
    <article class="newsItem">
      <div class="newsMeta">
        <span>${fmt(item.date)}</span>
        <span>${escapeHtml(item.author || "Steam")}</span>
        <span>${item.commentCount == null ? "Comments unavailable" : `${item.commentCount} comments`}</span>
        ${item.votesUp == null ? "" : `<span>${item.votesUp} up / ${item.votesDown} down</span>`}
      </div>
      <strong>${escapeHtml(item.title)}</strong>
      <div class="subtle">${escapeHtml(item.contents)}</div>
      <div class="itemActions">
        <a class="inlineLink" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">Open Steam post ↗</a>
        <small>${escapeHtml(item.commentStatus)}</small>
      </div>
    </article>
  `).join("");
}

function renderResearch(research) {
  $("#research").innerHTML = `
    <div class="thresholdGrid">
      ${research.thresholds.map((tier) => `
        <div>
          <strong>${escapeHtml(tier.label)}</strong><br>
          <span>${tier.ratio}, min ${tier.minReviews}</span>
        </div>`).join("")}
    </div>
    ${research.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#039;");
}

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-filter]");
  if (tab) {
    state.filter = tab.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("active", button === tab));
    renderReviews();
  }
});

$("#refresh").addEventListener("click", () => load(true).catch(showError));

function showError(error) {
  setText("#label", "Steam fetch failed");
  console.error(error);
}

load().catch(showError);
