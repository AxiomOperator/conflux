"""Weather tool using Open-Meteo (free, no API key required)."""
from __future__ import annotations

import aiohttp
import structlog

from conflux.tools.registry import ToolDefinition, ToolRegistry

logger = structlog.get_logger(__name__)

# WMO Weather Interpretation Codes → human-readable descriptions
_WMO_CODES: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
}

_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_WIND_DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _wind_direction_label(degrees: float) -> str:
    return _WIND_DIRS[round(degrees / 22.5) % 16]


async def _weather(args: dict, context) -> dict:
    location = str(args.get("location", "")).strip()
    if not location:
        return {"error": "location is required"}

    units = str(args.get("units", "imperial")).lower()
    if units not in {"imperial", "metric"}:
        units = "imperial"

    include_forecast = bool(args.get("include_forecast", False))

    timeout = aiohttp.ClientTimeout(total=10.0)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        # Step 1: geocode the location name.
        # Open-Meteo geocoding doesn't handle "City, State" format well;
        # try the full string first, then fall back to just the city part.
        geo = None
        search_terms = [location]
        if "," in location:
            search_terms.append(location.split(",")[0].strip())

        for term in search_terms:
            async with session.get(
                _GEOCODE_URL,
                params={"name": term, "count": 1, "language": "en", "format": "json"},
            ) as resp:
                resp.raise_for_status()
                geo = await resp.json()
            if geo.get("results"):
                break

        results = geo.get("results") if geo else None
        if not results:
            return {"error": f"Location not found: {location!r}"}

        place = results[0]
        lat = place["latitude"]
        lon = place["longitude"]
        place_name = place.get("name", location)
        country = place.get("country", "")
        admin1 = place.get("admin1", "")
        display_name = ", ".join(filter(None, [place_name, admin1, country]))

        # Step 2: fetch weather
        temp_unit = "fahrenheit" if units == "imperial" else "celsius"
        wind_unit = "mph" if units == "imperial" else "kmh"
        precip_unit = "inch" if units == "imperial" else "mm"
        forecast_days = 7 if include_forecast else 1

        forecast_params = dict(
            latitude=lat,
            longitude=lon,
            current=(
                "temperature_2m,relative_humidity_2m,apparent_temperature,"
                "weather_code,wind_speed_10m,wind_direction_10m,precipitation,"
                "cloud_cover,surface_pressure"
            ),
            temperature_unit=temp_unit,
            wind_speed_unit=wind_unit,
            precipitation_unit=precip_unit,
            forecast_days=forecast_days,
            timezone="auto",
        )
        if include_forecast:
            forecast_params["daily"] = (
                "weather_code,temperature_2m_max,temperature_2m_min,"
                "precipitation_sum,wind_speed_10m_max"
            )

        async with session.get(_FORECAST_URL, params=forecast_params) as resp:
            resp.raise_for_status()
            data = await resp.json()

    temp_sym = "°F" if units == "imperial" else "°C"
    wind_sym = "mph" if units == "imperial" else "km/h"
    precip_sym = "in" if units == "imperial" else "mm"
    current = data["current"]
    code = current.get("weather_code", 0)
    condition = _WMO_CODES.get(code, f"Code {code}")
    wind_dir = _wind_direction_label(current.get("wind_direction_10m", 0))

    result: dict = {
        "location": display_name,
        "coordinates": {"lat": lat, "lon": lon},
        "current": {
            "condition": condition,
            "temperature": f"{current['temperature_2m']}{temp_sym}",
            "feels_like": f"{current['apparent_temperature']}{temp_sym}",
            "humidity": f"{current['relative_humidity_2m']}%",
            "wind": f"{current['wind_speed_10m']} {wind_sym} {wind_dir}",
            "precipitation": f"{current['precipitation']} {precip_sym}",
            "cloud_cover": f"{current.get('cloud_cover', 0)}%",
            "pressure": f"{current.get('surface_pressure', 0)} hPa",
            "observed_at": current.get("time"),
        },
        "units": units,
    }

    if include_forecast and "daily" in data:
        daily = data["daily"]
        days = []
        for i, date in enumerate(daily.get("time", [])):
            days.append({
                "date": date,
                "condition": _WMO_CODES.get(daily["weather_code"][i], ""),
                "high": f"{daily['temperature_2m_max'][i]}{temp_sym}",
                "low": f"{daily['temperature_2m_min'][i]}{temp_sym}",
                "precipitation": f"{daily['precipitation_sum'][i]} {precip_sym}",
                "max_wind": f"{daily['wind_speed_10m_max'][i]} {wind_sym}",
            })
        result["forecast"] = days

    logger.info(
        "Weather fetched",
        location=display_name,
        condition=condition,
        run_id=context.run_id,
    )
    return result


def register(registry: ToolRegistry) -> None:
    registry.register(
        ToolDefinition(
            name="get_weather",
            description=(
                "Get current weather conditions and optionally a 7-day forecast for any "
                "location worldwide. Returns temperature, humidity, wind, precipitation, "
                "and sky conditions. Powered by Open-Meteo (no API key required)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City, region, or address (e.g. 'Houston, TX', 'London', 'Tokyo')",
                    },
                    "units": {
                        "type": "string",
                        "enum": ["imperial", "metric"],
                        "description": "imperial = °F / mph / inches; metric = °C / km/h / mm. Default: imperial",
                        "default": "imperial",
                    },
                    "include_forecast": {
                        "type": "boolean",
                        "description": "Set true to include a 7-day daily forecast. Default: false",
                        "default": False,
                    },
                },
                "required": ["location"],
            },
            risk_level="safe",
            fn=_weather,
        )
    )
