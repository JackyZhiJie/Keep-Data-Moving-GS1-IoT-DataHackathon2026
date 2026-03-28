const HKO_API =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";

/** Nearest HKO automatic weather stations to Cyberport (Southern District). */
const TEMP_PLACE_PRIORITY = [
  "Wong Chuk Hang",
  "Hong Kong Park",
  "Stanley",
  "Happy Valley",
  "Hong Kong Observatory",
];

function degToCompass(deg) {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round(Number(deg) / 22.5) % 16];
}

function visibilityKmAndQuality(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m) || m <= 0) {
    return { kmText: "—", quality: "" };
  }
  const km = m / 1000;
  const kmText = km >= 10 ? `${Math.round(km)}` : km.toFixed(1);
  let quality = "Poor";
  if (m >= 10_000) quality = "Good";
  else if (m >= 4000) quality = "Moderate";
  else if (m >= 1000) quality = "Low";
  return { kmText, quality };
}

function pickTemperature(rhrread) {
  const list = rhrread?.temperature?.data;
  if (!Array.isArray(list) || list.length === 0) return null;
  for (const name of TEMP_PLACE_PRIORITY) {
    const row = list.find((d) => d.place === name);
    if (row) {
      return {
        celsius: row.value,
        station: row.place,
        recordTime: rhrread.temperature?.recordTime ?? rhrread.updateTime,
      };
    }
  }
  const row = list[0];
  return {
    celsius: row.value,
    station: row.place,
    recordTime: rhrread.temperature?.recordTime ?? rhrread.updateTime,
  };
}

function pickHumidity(rhrread) {
  const row = rhrread?.humidity?.data?.[0];
  if (!row) return null;
  return {
    percent: row.value,
    place: row.place,
    recordTime: rhrread.humidity?.recordTime ?? rhrread.updateTime,
  };
}

/**
 * Live environment for Cyberport: HKO (temp/humidity) + Open-Meteo (wind/visibility at coords).
 */
export async function fetchCyberportEnvironment() {
  const hkoRhrUrl = `${HKO_API}?dataType=rhrread&lang=en`;
  const hkoFlwUrl = `${HKO_API}?dataType=flw&lang=en`;
  const omUrl =
    "https://api.open-meteo.com/v1/forecast?latitude=22.2614&longitude=114.0006&current=wind_speed_10m,wind_direction_10m,visibility&wind_speed_unit=kmh&timezone=Asia%2FHong_Kong";

  const [hkoRes, flwRes, omRes] = await Promise.allSettled([
    fetch(hkoRhrUrl).then((r) => {
      if (!r.ok) throw new Error(`HKO ${r.status}`);
      return r.json();
    }),
    fetch(hkoFlwUrl).then((r) => {
      if (!r.ok) throw new Error(`HKO flw ${r.status}`);
      return r.json();
    }),
    fetch(omUrl).then((r) => {
      if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
      return r.json();
    }),
  ]);

  const out = {
    locationLabel: "Cyberport, HK",
    tempC: null,
    tempStation: null,
    tempTime: null,
    humidityPct: null,
    humidityPlace: null,
    windText: null,
    visibilityText: null,
    openMeteoTime: null,
    hkoUpdateTime: null,
    hkoForecastPeriod: null,
    hkoForecastDesc: null,
    hkoForecastUpdateTime: null,
    errors: [],
  };

  if (flwRes.status === "fulfilled") {
    const f = flwRes.value;
    out.hkoForecastPeriod = f.forecastPeriod ?? null;
    out.hkoForecastDesc = f.forecastDesc ?? null;
    out.hkoForecastUpdateTime = f.updateTime ?? null;
  }

  if (hkoRes.status === "fulfilled") {
    const data = hkoRes.value;
    out.hkoUpdateTime = data.updateTime ?? null;
    const t = pickTemperature(data);
    if (t) {
      out.tempC = t.celsius;
      out.tempStation = t.station;
      out.tempTime = t.recordTime;
    }
    const h = pickHumidity(data);
    if (h) {
      out.humidityPct = h.percent;
      out.humidityPlace = h.place;
    }
  } else {
    out.errors.push("HKO temperature/humidity unavailable.");
  }

  if (omRes.status === "fulfilled") {
    const cur = omRes.value?.current;
    out.openMeteoTime = cur?.time ?? null;
    if (cur) {
      const spd = cur.wind_speed_10m;
      const dir = degToCompass(cur.wind_direction_10m);
      if (Number.isFinite(spd)) {
        out.windText = `${Math.round(spd)} km/h ${dir}`;
      }
      const { kmText, quality } = visibilityKmAndQuality(cur.visibility);
      if (kmText !== "—") {
        out.visibilityText = quality
          ? `${kmText} km (${quality})`
          : `${kmText} km`;
      }
    }
    if (!out.windText && !out.visibilityText) {
      out.errors.push("Open-Meteo wind/visibility unavailable.");
    }
  } else {
    out.errors.push("Open-Meteo wind/visibility unavailable.");
  }

  return out;
}
