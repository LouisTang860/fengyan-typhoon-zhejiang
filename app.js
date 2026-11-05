const DATA_URL = "data/current.json";
const MAP_BOUNDS = {
  minLongitude: 112,
  maxLongitude: 145,
  minLatitude: 5,
  maxLatitude: 38,
};
const SVG_NS = "http://www.w3.org/2000/svg";
const STALE_AFTER_MS = 45 * 60 * 1000;

const refreshButton = document.querySelector("#refresh-button");
const lastSyncTime = document.querySelector("#last-sync-time");
const syncStatusLabel = document.querySelector("#sync-status-label");
const syncStatusLight = document.querySelector("#sync-status-light");
const announcement = document.querySelector("#live-announcement");
const dataError = document.querySelector("#data-error");
const mapSvg = document.querySelector("#track-map");
const mapShell = document.querySelector(".map-shell");
const mapTooltip = document.querySelector("#map-tooltip");
const trackLayer = document.querySelector("#dynamic-track-layer");
const radiusLayer = document.querySelector("#dynamic-warning-radius");
const stormPicker = document.querySelector("#storm-picker");
const stormPickerWrap = document.querySelector("#storm-picker-wrap");

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const shortTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

let appData = null;
let selectedTyphoonId = null;
let tooltipSource = null;
let zoomLevel = 1;
let focusCenter = { x: 450, y: 260 };

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function present(value, fallback = "未提供") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function parseTime(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
  const date = parseTime(value);
  return date ? dateTimeFormatter.format(date).replaceAll("/", "-") : "未提供";
}

function formatShortTime(value) {
  const date = parseTime(value);
  return date ? shortTimeFormatter.format(date).replaceAll("/", "-") : "未提供";
}

function gradeLabel(value) {
  const grade = present(value);
  return grade === "未提供" || grade.endsWith("级") ? grade : `${grade}级`;
}

function coordinateLabel(position) {
  if (!position) {
    return "坐标未提供";
  }
  return `${Number(position.latitude).toFixed(1)}°N · ${Number(position.longitude).toFixed(1)}°E`;
}

function projectPoint(point) {
  const longitudeSpan = MAP_BOUNDS.maxLongitude - MAP_BOUNDS.minLongitude;
  const latitudeSpan = MAP_BOUNDS.maxLatitude - MAP_BOUNDS.minLatitude;
  const x = ((point.longitude - MAP_BOUNDS.minLongitude) / longitudeSpan) * 900;
  const y = ((MAP_BOUNDS.maxLatitude - point.latitude) / latitudeSpan) * 520;
  return {
    x: Math.min(892, Math.max(8, x)),
    y: Math.min(502, Math.max(8, y)),
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function announce(message) {
  announcement.textContent = "";
  window.setTimeout(() => {
    announcement.textContent = message;
  }, 20);
}

function setLoading(isLoading) {
  refreshButton.disabled = isLoading;
  refreshButton.classList.toggle("is-loading", isLoading);
  refreshButton.querySelector("span").textContent = isLoading ? "同步中" : "刷新";
  if (isLoading) {
    refreshButton.setAttribute("aria-busy", "true");
  } else {
    refreshButton.removeAttribute("aria-busy");
  }
}

function setBanner(title, text, mode = "active") {
  setText("#data-banner-title", title);
  setText("#data-banner-text", text);
  document.body.dataset.mode = mode;
}

function selectedTyphoon() {
  if (!appData?.typhoons?.length) {
    return null;
  }
  return (
    appData.typhoons.find((typhoon) => typhoon.id === selectedTyphoonId) ||
    appData.typhoons[0]
  );
}

function renderTyphoonPicker() {
  if (!stormPicker || !stormPickerWrap) {
    return;
  }
  stormPicker.replaceChildren();
  const typhoons = appData?.typhoons || [];
  stormPickerWrap.hidden = typhoons.length < 2;
  typhoons.forEach((typhoon) => {
    const option = document.createElement("option");
    option.value = typhoon.id;
    option.textContent = `${typhoon.name} · ${typhoon.nameEn}`;
    option.selected = typhoon.id === selectedTyphoonId;
    stormPicker.append(option);
  });
}

function renderSummary(typhoon) {
  const position = typhoon.position || {};
  const movement = typhoon.movement || {};
  const intensity = typhoon.intensity || {};
  const wind = Number.isFinite(intensity.maxWindMs) ? intensity.maxWindMs : null;
  const force = Number.isFinite(intensity.windForce) ? intensity.windForce : null;
  const pressure = Number.isFinite(intensity.minPressureHpa)
    ? intensity.minPressureHpa
    : null;
  const movementText =
    movement.direction && movement.direction !== "数据源未提供"
      ? `向${movement.direction}方向移动`
      : "移动方向暂未提供";

  setText("#page-title", typhoon.name);
  document.title = `${typhoon.name} · 风眼台风实况`;
  setText("#storm-number", `NO.${typhoon.id || "--"}`);
  setText("#storm-name-en", `${typhoon.nameEn} · ZJ OFFICIAL`);
  setText("#storm-description", `${appData.message} ${movementText}；最新位置坐标为 ${coordinateLabel(position)}。`);
  setText("#hero-location", coordinateLabel(position));
  setText("#hero-observed", `观测于 ${formatShortTime(typhoon.observedAt)}`);
  setText("#storm-vector", `${present(movement.direction)} · ${present(movement.speedKph, "--")} km/h`);
  setText(
    "#data-state-chip",
    typhoon.isActive ? "活跃台风" : "最近结束",
  );
  setText(
    "#data-mode-note",
    typhoon.isActive
      ? `浙江省官方数据 · ${appData.activeCount} 个活跃台风`
      : "浙江省官方数据 · 当前无活跃台风",
  );

  setText("#metric-location-primary", `${Number(position.latitude).toFixed(1)}°N`);
  setText("#metric-location-secondary", `${Number(position.longitude).toFixed(1)}°E`);
  setText("#metric-coordinate", coordinateLabel(position));
  setText("#metric-direction", present(movement.direction));
  setText("#metric-direction-note", typhoon.isActive ? "官方移动方向" : "结束时移动方向");
  setText("#metric-move-speed", present(movement.speedKph, "--"));
  setText("#metric-grade", gradeLabel(intensity.grade));
  setText("#metric-grade-note", force === null ? "数据源等级" : `中心风力 ${force} 级`);
  setText("#metric-wind", present(wind, "--"));
  setText("#metric-force", present(force, "--"));
  setText("#metric-force-note", wind === null ? "数据源风力等级" : `最大风速 ${wind} m/s`);
  setText("#metric-pressure", pressure === null ? "未提供" : `${pressure} hPa`);

  const intensityFill = wind === null ? 0 : Math.min(100, Math.max(6, (wind / 65) * 100));
  document.querySelector("#intensity-bar")?.style.setProperty(
    "--fill",
    `${intensityFill}%`,
  );
  document.querySelector("#wind-meter")?.style.setProperty("--fill", `${intensityFill}%`);
}

function renderStatus() {
  const generatedAt = parseTime(appData.generatedAt);
  const typhoon = selectedTyphoon();
  const age = generatedAt ? Date.now() - generatedAt.getTime() : Number.POSITIVE_INFINITY;
  const isStale = age > STALE_AFTER_MS;

  if (generatedAt) {
    lastSyncTime.textContent = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(generatedAt);
    lastSyncTime.dateTime = generatedAt.toISOString();
  }

  syncStatusLabel.textContent = isStale ? "数据可能延迟" : "最后同步";
  syncStatusLight.classList.toggle("is-stale", isStale);
  setText("#status-data-nature", "浙江省官方公开数据");
  setText("#status-observed", formatDateTime(typhoon?.observedAt));
  setText("#status-synced", formatDateTime(appData.generatedAt));
  setText("#status-source", appData.source?.publisher || "浙江省水利厅");
}

function setAlertState(kind) {
  const overview = document.querySelector("#alert-overview");
  if (!overview) {
    return;
  }
  overview.classList.toggle("is-clear", kind === "history");
  overview.classList.toggle("is-active", kind === "active");
}

function createAlertItem({ symbol, className, meta, time, title, description, area }) {
  const article = document.createElement("article");
  article.className = `alert-item ${className}`;

  const level = document.createElement("div");
  level.className = "alert-level";
  level.setAttribute("aria-hidden", "true");
  level.textContent = symbol;

  const content = document.createElement("div");
  content.className = "alert-content";

  const metaRow = document.createElement("div");
  metaRow.className = "alert-meta";
  const metaType = document.createElement("span");
  metaType.textContent = meta;
  const timeElement = document.createElement("time");
  timeElement.textContent = time;
  metaRow.append(metaType, timeElement);

  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = description;

  content.append(metaRow, heading, paragraph);

  if (area) {
    const areaElement = document.createElement("div");
    areaElement.className = "alert-area";
    areaElement.textContent = area;
    content.append(areaElement);
  }

  article.append(level, content);
  return article;
}

function renderAlerts(typhoon) {
  const list = document.querySelector("#alert-list");
  if (!list) {
    return;
  }
  list.replaceChildren();

  const stateTitle = typhoon.isActive
    ? `官方确认有 ${appData.activeCount} 个活跃台风`
    : "当前无活跃台风";
  const stateDescription = typhoon.isActive
    ? "浙江省台风路径实时发布系统当前返回活跃记录，请以官方页面最新公告为准。"
    : "浙江省官方活跃台风接口当前返回空列表。下方仍展示最近记录中的官方事件。";

  list.append(
    createAlertItem({
      symbol: "状",
      className: typhoon.isActive ? "alert-yellow" : "alert-blue",
      meta: "官方状态",
      time: formatShortTime(appData.generatedAt),
      title: stateTitle,
      description: stateDescription,
      area: "来源：浙江省台风路径实时发布系统",
    }),
  );

  const events = Array.isArray(typhoon.events) ? typhoon.events.slice(0, 2) : [];
  events.forEach((event) => {
    const isLandfall = event.type === "登陆信息";
    list.append(
      createAlertItem({
        symbol: isLandfall ? "登" : "级",
        className: isLandfall ? "alert-orange" : "alert-blue",
        meta: present(event.type, "官方事件"),
        time: formatShortTime(event.time),
        title: present(event.name),
        description: present(event.description, "浙江省官方系统记录。"),
        area: `关联台风：${typhoon.name}`,
      }),
    );
  });

  setText("#alert-count", `${events.length} 条官方记录`);
  setText("#alert-state-label", "浙江省官方数据状态");
  setText(
    "#alert-state-value",
    typhoon.isActive ? "有活跃台风" : "当前无活跃台风",
  );
  setAlertState(typhoon.isActive ? "active" : "history");
}

function makeMapPointClasses() {
  return "track-point";
}

function renderTrackPoint(point, className = "track-point") {
  const { x, y } = projectPoint(point);
  const group = svgElement("g", {
    class: className,
    tabindex: "0",
    role: "button",
    "data-time": formatShortTime(point.time),
    "data-grade": gradeLabel(point.grade),
    "data-wind": Number.isFinite(point.maxWindMs) ? `${point.maxWindMs} m/s` : "风速未提供",
    "data-coord": coordinateLabel(point),
    "aria-label": `${formatShortTime(point.time)}，${gradeLabel(point.grade)}，${present(point.maxWindMs, "风速未提供")}${Number.isFinite(point.maxWindMs) ? "米每秒" : ""}`,
  });

  if (className === "forecast-point") {
    group.append(svgElement("circle", { cx: x, cy: y, r: 5 }));
    const text = svgElement("text", {
      x: x + 9,
      y: y - 7,
    });
    text.textContent = formatShortTime(point.time).slice(-5);
    group.append(text);
  } else {
    group.append(
      svgElement("circle", { class: "point-halo", cx: x, cy: y, r: 10 }),
      svgElement("circle", { class: "point-dot", cx: x, cy: y, r: 4.5 }),
    );
  }
  return group;
}

function renderMap(typhoon) {
  if (!trackLayer || !radiusLayer) {
    return;
  }
  trackLayer.replaceChildren();
  radiusLayer.replaceChildren();

  const track = Array.isArray(typhoon.track) ? typhoon.track : [];
  const forecast = Array.isArray(typhoon.forecast) ? typhoon.forecast : [];
  if (!track.length) {
    const empty = svgElement("text", {
      x: 450,
      y: 260,
      "text-anchor": "middle",
      class: "map-loading",
    });
    empty.textContent = "暂无可用路径数据";
    trackLayer.append(empty);
    return;
  }

  const projected = track.map((point) => ({ point, ...projectPoint(point) }));
  const current = projected[projected.length - 1];
  focusCenter = { x: current.x, y: current.y };

  radiusLayer.append(
    svgElement("circle", {
      cx: current.x,
      cy: current.y,
      r: 94,
      fill: "url(#warningRadius)",
      "aria-hidden": "true",
    }),
  );

  if (projected.length > 1) {
    const history = svgElement("path", {
      class: "history-line",
      pathLength: "1",
      d: projected
        .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
        .join(" "),
    });
    trackLayer.append(history);
  }

  projected.slice(0, -1).forEach(({ point }) => {
    trackLayer.append(renderTrackPoint(point));
  });

  const future = forecast.filter((point) => {
    const pointTime = parseTime(point.time);
    const currentTime = parseTime(typhoon.observedAt);
    return pointTime && currentTime && pointTime.getTime() > currentTime.getTime();
  });

  if (future.length) {
    const futurePoints = future.map((point) => ({ point, ...projectPoint(point) }));
    const forecastPath = svgElement("path", {
      class: "forecast-line",
      d: [
        `M${current.x} ${current.y}`,
        ...futurePoints.map(({ x, y }) => `L${x} ${y}`),
      ].join(" "),
      "marker-end": "url(#routeArrow)",
    });
    trackLayer.append(forecastPath);
    futurePoints.forEach(({ point }) => {
      trackLayer.append(renderTrackPoint(point, "forecast-point"));
    });
  }

  const currentGroup = svgElement("g", {
    class: "current-storm",
    transform: `translate(${current.x} ${current.y})`,
    filter: "url(#markerShadow)",
    "aria-hidden": "true",
  });
  currentGroup.append(
    svgElement("circle", { class: "current-pulse", r: 26 }),
    svgElement("circle", { class: "current-ring", r: 18 }),
    svgElement("circle", { class: "current-core", r: 10 }),
    svgElement("circle", { class: "current-eye", r: 3.5 }),
  );
  trackLayer.append(currentGroup);

  const currentPoint = current.point;
  const currentHit = svgElement("g", {
    class: "current-hit-area track-point",
    tabindex: "0",
    role: "button",
    transform: `translate(${current.x} ${current.y})`,
    "data-time": `${formatShortTime(currentPoint.time)} · 最新位置`,
    "data-grade": gradeLabel(currentPoint.grade),
    "data-wind": Number.isFinite(currentPoint.maxWindMs)
      ? `${currentPoint.maxWindMs} m/s`
      : "风速未提供",
    "data-coord": coordinateLabel(currentPoint),
    "aria-label": `最新官方位置，${formatShortTime(currentPoint.time)}，${gradeLabel(currentPoint.grade)}`,
  });
  currentHit.append(
    svgElement("circle", { class: "current-focus-ring", r: 25 }),
    svgElement("circle", { r: 30, fill: "transparent" }),
  );
  trackLayer.append(currentHit);

  const title = document.querySelector("#map-title");
  const description = document.querySelector("#map-description");
  if (title) {
    title.textContent = `${typhoon.name}官方台风路径`;
  }
  if (description) {
    description.textContent = `浙江省台风路径实时发布系统提供的最新位置与中国预报路径。观测时间 ${formatDateTime(typhoon.observedAt)}。`;
  }

  setText("#track-window", `${formatShortTime(track[0].time)} 至 ${formatShortTime(currentPoint.time)}`);
  setText("#track-span", `${track.length} 个官方实况点`);
  setText(
    "#track-direction",
    `${present(typhoon.movement?.direction)} · ${present(typhoon.movement?.speedKph, "--")} km/h`,
  );
  setText("#track-forecast", future.length ? `${future.length} 个预报时次` : "源未提供预报");
  applyZoom(1, false);
}

function renderTrackDetails(typhoon) {
  const list = document.querySelector("#track-node-list");
  if (!list) {
    return;
  }
  list.replaceChildren();

  const track = Array.isArray(typhoon.track) ? typhoon.track : [];
  const forecast = Array.isArray(typhoon.forecast) ? typhoon.forecast : [];
  const entries = [...track];
  const currentTime = parseTime(typhoon.observedAt);
  forecast.forEach((point) => {
    const pointTime = parseTime(point.time);
    if (pointTime && currentTime && pointTime.getTime() > currentTime.getTime()) {
      entries.push({ ...point, forecast: true });
    }
  });

  entries.forEach((point, index) => {
    const item = document.createElement("li");
    if (point.forecast) {
      item.className = "forecast-node";
    } else if (index === track.length - 1) {
      item.className = "current-node";
    }
    const time = document.createElement("time");
    time.dateTime = point.time || "";
    time.textContent = `${formatShortTime(point.time)}${point.forecast ? " · 预报" : index === track.length - 1 ? " · 最新" : ""}`;
    const weather = document.createElement("span");
    weather.textContent = `${gradeLabel(point.grade)} · ${present(point.maxWindMs, "--")} m/s`;
    const coord = document.createElement("span");
    coord.textContent = coordinateLabel(point);
    item.append(time, weather, coord);
    list.append(item);
  });
}

function renderTrend(typhoon) {
  const windPoints = (typhoon.track || [])
    .filter((point) => Number.isFinite(point.maxWindMs))
    .slice(-8);
  const line = document.querySelector("#trend-line");
  const area = document.querySelector("#trend-area");
  const endpoint = document.querySelector("#trend-endpoint");
  const chart = document.querySelector("#trend-chart");

  if (windPoints.length < 2) {
    line?.setAttribute("d", "");
    area?.setAttribute("d", "");
    if (endpoint) {
      endpoint.setAttribute("cx", "-20");
    }
    setText("#trend-delta", "--");
    setText("#trend-description", "官方路径点不足，暂无法绘制趋势。");
    setText("#trend-label-start", "暂无");
    setText("#trend-label-middle", "暂无");
    setText("#trend-label-end", "暂无");
    return;
  }

  const values = windPoints.map((point) => point.maxWindMs);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = Math.max(1, maximum - minimum);
  const coordinates = windPoints.map((point, index) => ({
    x: 8 + (index / (windPoints.length - 1)) * 344,
    y: 88 - ((point.maxWindMs - minimum) / spread) * 72,
  }));
  const path = coordinates
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L352 110 L8 110 Z`;
  line?.setAttribute("d", path);
  area?.setAttribute("d", areaPath);

  const last = coordinates[coordinates.length - 1];
  endpoint?.setAttribute("cx", last.x);
  endpoint?.setAttribute("cy", last.y);

  const delta = values[values.length - 1] - values[0];
  setText("#trend-delta", delta > 0 ? `+${delta}` : String(delta));
  setText(
    "#trend-description",
    `最近 ${windPoints.length} 个路径点最大风速由 ${values[0]} m/s 变为 ${values.at(-1)} m/s。`,
  );
  setText("#trend-label-start", formatShortTime(windPoints[0].time).slice(-5));
  setText(
    "#trend-label-middle",
    formatShortTime(windPoints[Math.floor(windPoints.length / 2)].time).slice(-5),
  );
  setText("#trend-label-end", formatShortTime(windPoints.at(-1).time).slice(-5));
  chart?.setAttribute(
    "aria-label",
    `近期最大风速由每秒 ${values[0]} 米变为每秒 ${values.at(-1)} 米`,
  );
}

function renderEmptyState(message) {
  storeSelection(null);
  setBanner("官方状态", message, "history");
  setText("#page-title", "暂无活跃台风");
  setText("#storm-number", "ZJ · --");
  setText("#storm-name-en", "ZHEJIANG OFFICIAL FEED");
  setText("#storm-description", message);
  setText("#hero-location", "浙江省台风路径实时发布系统");
  setText("#hero-observed", formatShortTime(appData?.generatedAt));
  setText("#data-state-chip", "无活跃台风");
  setText("#metric-location-primary", "暂无");
  setText("#metric-location-secondary", "数据源未返回活跃台风");
  setText("#metric-coordinate", "浙江省台风路径实时发布系统");
  setText("#metric-direction", "暂无");
  setText("#metric-move-speed", "--");
  setText("#metric-grade", "暂无");
  setText("#metric-wind", "--");
  setText("#metric-force", "--");
  setText("#metric-pressure", "未提供");
  setText("#track-window", "无活跃路径");
  setText("#track-span", "当前无路径");
  setText("#track-direction", "当前无路径");
  setText("#track-forecast", "当前无路径");
  setText("#alert-count", "0 条记录");
  setText("#alert-state-label", "浙江省官方数据状态");
  setText("#alert-state-value", "当前无活跃台风");
  setText("#status-data-nature", "浙江省官方公开数据");
  setText("#status-observed", "无活跃台风");
  setText("#status-synced", formatDateTime(appData?.generatedAt));
  setText("#status-source", appData?.source?.publisher || "浙江省水利厅");
  setText("#trend-delta", "--");
  setText("#trend-description", "当前没有活跃台风路径。");
  document.title = "暂无活跃台风 · 风眼台风实况";
  trackLayer?.replaceChildren();
  radiusLayer?.replaceChildren();
  const empty = svgElement("text", {
    x: 450,
    y: 260,
    "text-anchor": "middle",
    class: "map-loading",
  });
  empty.textContent = "当前暂无活跃台风";
  trackLayer?.append(empty);
  document.querySelector("#track-node-list")?.replaceChildren();
  document.querySelector("#alert-list")?.replaceChildren();
  setAlertState("history");
}

function storeSelection(id) {
  selectedTyphoonId = id;
  try {
    sessionStorage.setItem("selected-typhoon", id || "");
  } catch {
    // Session storage can be disabled without affecting the data display.
  }
}

function renderApp() {
  if (!appData) {
    return;
  }
  if (!appData.typhoons?.length) {
    renderEmptyState(appData.message || "当前暂无活跃台风。");
    return;
  }

  if (!appData.typhoons.some((typhoon) => typhoon.id === selectedTyphoonId)) {
    storeSelection(appData.typhoons[0].id);
  }

  const typhoon = selectedTyphoon();
  const bannerTitle = typhoon.isActive ? "官方实况" : "当前无活跃台风";
  const bannerText = typhoon.isActive
    ? "数据来自浙江省台风路径实时发布系统"
    : `展示最近结束记录 · ${typhoon.name}`;
  setBanner(bannerTitle, bannerText, typhoon.isActive ? "active" : "history");
  renderTyphoonPicker();
  renderSummary(typhoon);
  renderMap(typhoon);
  renderTrackDetails(typhoon);
  renderAlerts(typhoon);
  renderTrend(typhoon);
  renderStatus();
  applyZoom(1, false);
}

async function loadData({ announceAfter = false } = {}) {
  setLoading(true);
  dataError.hidden = true;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.typhoons)) {
      throw new Error("Invalid typhoon payload");
    }
    appData = payload;
    renderApp();
    if (announceAfter) {
      announce("官方台风数据已刷新。");
    }
  } catch (error) {
    dataError.hidden = false;
    setBanner("连接异常", "无法读取本地同步数据，请稍后重试", "error");
    if (!appData) {
      setText("#page-title", "数据暂不可用");
      setText("#storm-description", "暂时无法读取浙江省官方台风数据，请稍后刷新。");
    }
    if (announceAfter) {
      announce("数据刷新失败，请稍后重试。");
    }
    console.error("Unable to load typhoon data", error);
  } finally {
    window.clearTimeout(timer);
    setLoading(false);
  }
}

function positionTooltip(target) {
  if (!mapShell || !mapTooltip) {
    return;
  }
  const point = target.getBoundingClientRect();
  const shell = mapShell.getBoundingClientRect();
  const tooltipWidth = mapTooltip.offsetWidth;
  const halfWidth = tooltipWidth / 2;
  const left = Math.min(
    Math.max(point.left + point.width / 2 - shell.left, halfWidth + 8),
    shell.width - halfWidth - 8,
  );
  const top = Math.max(point.top - shell.top, 72);
  mapTooltip.style.left = `${left}px`;
  mapTooltip.style.top = `${top}px`;
}

function showTooltip(target) {
  if (!mapTooltip) {
    return;
  }
  const { time, grade, wind, coord } = target.dataset;
  if (!time || !grade || !wind || !coord) {
    return;
  }
  tooltipSource = target;
  const heading = document.createElement("strong");
  heading.textContent = time;
  const conditions = document.createElement("span");
  conditions.textContent = `${grade} · 最大风速 ${wind}`;
  const coordinates = document.createElement("span");
  coordinates.textContent = coord;
  mapTooltip.replaceChildren(heading, conditions, coordinates);
  mapTooltip.hidden = false;
  positionTooltip(target);
}

function hideTooltip(target) {
  if (target && document.activeElement === target) {
    return;
  }
  tooltipSource = null;
  mapTooltip.hidden = true;
}

function interactivePoint(target) {
  return target instanceof Element
    ? target.closest(".track-point, .forecast-point, .current-hit-area")
    : null;
}

mapShell?.addEventListener("pointerover", (event) => {
  const target = interactivePoint(event.target);
  if (target) {
    showTooltip(target);
  }
});

mapShell?.addEventListener("pointerout", (event) => {
  const target = interactivePoint(event.target);
  if (target && !target.contains(event.relatedTarget)) {
    hideTooltip(target);
  }
});

mapShell?.addEventListener("focusin", (event) => {
  const target = interactivePoint(event.target);
  if (target) {
    showTooltip(target);
  }
});

mapShell?.addEventListener("focusout", (event) => {
  const target = interactivePoint(event.target);
  if (target) {
    hideTooltip();
  }
});

mapShell?.addEventListener("click", (event) => {
  const target = interactivePoint(event.target);
  if (target) {
    showTooltip(target);
  }
});

mapShell?.addEventListener("keydown", (event) => {
  const target = interactivePoint(event.target);
  if (!target) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    showTooltip(target);
  }
  if (event.key === "Escape") {
    hideTooltip();
  }
});

mapShell?.addEventListener("pointerleave", () => {
  if (
    document.activeElement instanceof Element &&
    document.activeElement.closest("#track-map")
  ) {
    return;
  }
  hideTooltip();
});

const baseViewBox = { x: 0, y: 0, width: 900, height: 520 };

function applyZoom(nextZoom, notify = true) {
  zoomLevel = Math.min(2.4, Math.max(1, nextZoom));
  const width = baseViewBox.width / zoomLevel;
  const height = baseViewBox.height / zoomLevel;
  const x = Math.min(
    Math.max(focusCenter.x - width / 2, 0),
    baseViewBox.width - width,
  );
  const y = Math.min(
    Math.max(focusCenter.y - height / 2, 0),
    baseViewBox.height - height,
  );
  mapSvg?.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  if (notify) {
    announce(`地图缩放比例 ${Math.round(zoomLevel * 100)}%`);
  }
}

document.querySelector("#zoom-in")?.addEventListener("click", () => {
  applyZoom(zoomLevel + 0.3);
});

document.querySelector("#zoom-out")?.addEventListener("click", () => {
  applyZoom(zoomLevel - 0.3);
});

document.querySelector("#zoom-reset")?.addEventListener("click", () => {
  applyZoom(1);
});

stormPicker?.addEventListener("change", () => {
  storeSelection(stormPicker.value);
  renderApp();
  announce("已切换台风。");
});

window.addEventListener("resize", () => {
  if (tooltipSource) {
    positionTooltip(tooltipSource);
  }
});

refreshButton?.addEventListener("click", () => {
  loadData({ announceAfter: true });
});

loadData();
