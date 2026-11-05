const refreshButton = document.querySelector("#refresh-button");
const lastSyncTime = document.querySelector("#last-sync-time");
const announcement = document.querySelector("#live-announcement");
const mapSvg = document.querySelector("#track-map");
const mapShell = document.querySelector(".map-shell");
const mapTooltip = document.querySelector("#map-tooltip");

const mapPoints = document.querySelectorAll(
  ".track-point, .forecast-point, .current-hit-area",
);

let tooltipSource = null;

const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function announce(message) {
  announcement.textContent = "";
  window.setTimeout(() => {
    announcement.textContent = message;
  }, 20);
}

function refreshDemoData() {
  refreshButton.disabled = true;
  refreshButton.classList.add("is-loading");
  refreshButton.querySelector("span").textContent = "同步中";
  refreshButton.setAttribute("aria-busy", "true");

  window.setTimeout(() => {
    const now = new Date();
    lastSyncTime.textContent = formatter.format(now);
    lastSyncTime.dateTime = now.toISOString();
    refreshButton.disabled = false;
    refreshButton.classList.remove("is-loading");
    refreshButton.removeAttribute("aria-busy");
    refreshButton.querySelector("span").textContent = "刷新";
    announce("演示刷新完成。页面仍展示同一组虚构样本数据。");
  }, 850);
}

function positionTooltip(target) {
  if (!mapShell || !mapTooltip || !mapSvg) {
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
  mapTooltip.innerHTML = `
    <strong>${time}</strong>
    <span>${grade} · 最大风速 ${wind}</span>
    <span>${coord}</span>
  `;
  mapTooltip.hidden = false;
  positionTooltip(target);
}

function hideTooltip(target) {
  if (target && document.activeElement === target) {
    return;
  }
  if (tooltipSource) {
    tooltipSource = null;
  }
  mapTooltip.hidden = true;
}

mapPoints.forEach((point) => {
  point.addEventListener("pointerenter", () => showTooltip(point));
  point.addEventListener("pointerleave", () => hideTooltip(point));
  point.addEventListener("focus", () => showTooltip(point));
  point.addEventListener("blur", () => hideTooltip(point));
  point.addEventListener("click", () => showTooltip(point));
  point.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      showTooltip(point);
    }
    if (event.key === "Escape") {
      hideTooltip();
    }
  });
});

mapShell?.addEventListener("pointerleave", () => {
  if (document.activeElement instanceof Element && document.activeElement.closest("#track-map")) {
    return;
  }
  hideTooltip();
});

window.addEventListener("resize", () => {
  if (tooltipSource) {
    positionTooltip(tooltipSource);
  }
});

const baseViewBox = { x: 0, y: 0, width: 900, height: 520 };
const focusCenter = { x: 530, y: 270 };
let zoomLevel = 1;

function applyZoom(nextZoom) {
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
  const percent = Math.round(zoomLevel * 100);
  announce(`地图缩放比例 ${percent}%`);
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

refreshButton?.addEventListener("click", refreshDemoData);
