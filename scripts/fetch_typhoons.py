#!/usr/bin/env python3
"""Fetch and normalize public typhoon data from Zhejiang's official service."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE_URL = "https://typhoon.slt.zj.gov.cn"
SOURCE_NAME = "浙江省台风路径实时发布系统"
SOURCE_PUBLISHER = "浙江省水利厅"
USER_AGENT = (
    "FengyanTyphoonDashboard/1.0 "
    "(public-information-display; contact: repository-owner)"
)
CHINA_TZ = timezone(timedelta(hours=8))


class SourceError(RuntimeError):
    """Raised when the upstream source cannot be read safely."""


def fetch_json(path: str, attempts: int = 3) -> Any:
    url = f"{BASE_URL}{path}"
    last_error: Exception | None = None

    for attempt in range(attempts):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9",
                "User-Agent": USER_AGENT,
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                content_type = response.headers.get("Content-Type", "")
                body = response.read()
                if "json" not in content_type.lower() and body.lstrip()[:1] not in (b"[", b"{"):
                    raise SourceError(f"Upstream returned a non-JSON response for {path}")
                return json.loads(body.decode("utf-8-sig"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)

    raise SourceError(f"Unable to fetch {url}: {last_error}")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def finite_float(value: Any) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def finite_int(value: Any) -> int | None:
    number = finite_float(value)
    return int(number) if number is not None else None


def iso_time(value: Any) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return parsed.replace(tzinfo=CHINA_TZ).isoformat()


def normalize_point(raw: dict[str, Any]) -> dict[str, Any] | None:
    latitude = finite_float(raw.get("lat"))
    longitude = finite_float(raw.get("lng"))
    if latitude is None or longitude is None:
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None

    return {
        "time": iso_time(raw.get("time")),
        "latitude": latitude,
        "longitude": longitude,
        "grade": clean_text(raw.get("strong")) or None,
        "windForce": finite_int(raw.get("power")),
        "maxWindMs": finite_int(raw.get("speed")),
        "minPressureHpa": finite_int(raw.get("pressure")),
        "movementDirection": clean_text(raw.get("movedirection")) or None,
        "movementSpeedKph": finite_int(raw.get("movespeed")),
        "sevenLevelRadius": clean_text(raw.get("radius7")) or None,
        "tenLevelRadius": clean_text(raw.get("radius10")) or None,
        "twelveLevelRadius": clean_text(raw.get("radius12")) or None,
    }


def normalize_forecast(point: dict[str, Any]) -> list[dict[str, Any]]:
    forecasts = point.get("forecast")
    if not isinstance(forecasts, list):
        return []

    china = next(
        (
            item
            for item in forecasts
            if isinstance(item, dict) and clean_text(item.get("tm")) == "中国"
        ),
        None,
    )
    if not china and forecasts and isinstance(forecasts[0], dict):
        china = forecasts[0]
    if not china:
        return []

    normalized: list[dict[str, Any]] = []
    for item in china.get("forecastpoints", []):
        if not isinstance(item, dict):
            continue
        point = normalize_point(item)
        if point:
            point["issuedAt"] = clean_text(item.get("ybsj")) or None
            normalized.append(point)
    return normalized


def normalize_events(raw_events: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_events, list):
        return []

    normalized = []
    for item in raw_events:
        if not isinstance(item, dict):
            continue
        event_time = iso_time(item.get("time"))
        if not event_time:
            continue
        normalized.append(
            {
                "time": event_time,
                "type": clean_text(item.get("etype")) or "台风事件",
                "name": clean_text(item.get("ename")) or "未命名事件",
                "description": clean_text(item.get("description")) or None,
                "url": clean_text(item.get("url")) or None,
            }
        )
    normalized.sort(key=lambda item: item["time"], reverse=True)
    return normalized[:6]


def normalize_landfalls(raw_landfalls: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_landfalls, list):
        return []

    normalized = []
    for item in raw_landfalls:
        if not isinstance(item, dict):
            continue
        event_time = iso_time(item.get("landtime"))
        if not event_time:
            continue
        normalized.append(
            {
                "time": event_time,
                "type": "登陆信息",
                "name": clean_text(item.get("landaddress")) or "登陆记录",
                "description": clean_text(item.get("info")) or None,
                "url": None,
            }
        )
    return normalized


def latest_point(points: list[dict[str, Any]]) -> dict[str, Any] | None:
    valid = [point for point in points if point.get("time")]
    return max(valid, key=lambda point: point["time"], default=None)


def normalize_typhoon(detail: dict[str, Any], is_active: bool) -> dict[str, Any]:
    raw_points = detail.get("points")
    points = []
    if isinstance(raw_points, list):
        for raw_point in raw_points:
            if isinstance(raw_point, dict):
                point = normalize_point(raw_point)
                if point and point.get("time"):
                    points.append(point)
    points.sort(key=lambda point: point["time"])

    current = latest_point(points)
    if not current:
        raise SourceError(f"Typhoon {detail.get('tfid')} has no usable track points")

    current_raw = next(
        (
            item
            for item in reversed(raw_points or [])
            if isinstance(item, dict) and iso_time(item.get("time")) == current["time"]
        ),
        {},
    )
    forecast = normalize_forecast(current_raw)
    history = points[-24:]

    typhoon_id = clean_text(detail.get("tfid"))
    events = normalize_events(fetch_json(f"/Api/TyphoonEvent/{quote(typhoon_id)}/False"))
    landfalls = normalize_landfalls(detail.get("land"))
    combined_events = sorted(
        events + landfalls,
        key=lambda item: item["time"],
        reverse=True,
    )[:6]

    return {
        "id": typhoon_id,
        "name": clean_text(detail.get("name")) or "未命名台风",
        "nameEn": clean_text(detail.get("enname")) or "NAMELESS",
        "isActive": is_active,
        "startTime": iso_time(detail.get("starttime")),
        "endTime": iso_time(detail.get("endtime")),
        "observedAt": current["time"],
        "position": {
            "latitude": current["latitude"],
            "longitude": current["longitude"],
        },
        "movement": {
            "direction": current.get("movementDirection") or "数据源未提供",
            "speedKph": current.get("movementSpeedKph"),
        },
        "intensity": {
            "grade": current.get("grade") or "数据源未提供",
            "windForce": current.get("windForce"),
            "maxWindMs": current.get("maxWindMs"),
            "minPressureHpa": current.get("minPressureHpa"),
        },
        "track": history,
        "forecast": forecast[:8],
        "events": combined_events,
    }


def most_recent_completed_year_item(year_items: list[dict[str, Any]]) -> dict[str, Any] | None:
    completed = [
        item
        for item in year_items
        if isinstance(item, dict)
        and clean_text(item.get("isactive")) != "1"
        and iso_time(item.get("endtime"))
    ]
    return max(completed, key=lambda item: item["endtime"], default=None)


def build_payload() -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0)
    active_items = fetch_json("/Api/TyhoonActivity")
    if not isinstance(active_items, list):
        raise SourceError("The active-typhoon response was not a list")

    typhoons = []
    for item in active_items[:8]:
        if not isinstance(item, dict):
            continue
        typhoon_id = clean_text(item.get("tfid"))
        if not typhoon_id:
            continue
        detail = fetch_json(f"/Api/TyphoonInfo/{quote(typhoon_id)}")
        if isinstance(detail, dict):
            typhoons.append(normalize_typhoon(detail, True))

    mode = "active" if typhoons else "history"
    message = (
        "浙江省台风路径实时发布系统当前有活跃台风。"
        if mode == "active"
        else "当前暂无活跃台风，以下展示本年度最近一条已结束的官方记录。"
    )

    if mode == "history":
        current_year = generated_at.astimezone(CHINA_TZ).year
        year_items = fetch_json(f"/Api/TyphoonList/{current_year}")
        if not isinstance(year_items, list):
            raise SourceError("The yearly typhoon response was not a list")
        latest_item = most_recent_completed_year_item(year_items)
        if latest_item:
            latest_id = clean_text(latest_item.get("tfid"))
            detail = fetch_json(f"/Api/TyphoonInfo/{quote(latest_id)}")
            if isinstance(detail, dict):
                typhoons.append(normalize_typhoon(detail, False))

    return {
        "schemaVersion": 1,
        "mode": mode,
        "message": message,
        "generatedAt": generated_at.isoformat().replace("+00:00", "Z"),
        "activeCount": sum(1 for item in typhoons if item["isActive"]),
        "source": {
            "name": SOURCE_NAME,
            "publisher": SOURCE_PUBLISHER,
            "url": f"{BASE_URL}/",
            "activityApi": f"{BASE_URL}/Api/TyhoonActivity",
            "infoApi": f"{BASE_URL}/Api/TyphoonInfo/{{id}}",
        },
        "typhoons": typhoons,
    }


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/current.json"),
        help="Output JSON path",
    )
    args = parser.parse_args()

    try:
        payload = build_payload()
    except SourceError as error:
        print(f"Fetch failed: {error}", file=sys.stderr)
        return 1

    write_atomic(args.output, payload)
    print(
        f"Wrote {args.output}: mode={payload['mode']}, "
        f"active={payload['activeCount']}, records={len(payload['typhoons'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
