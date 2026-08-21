// PFS Scanner - Node.js / GitHub Actions
// Converted from V59_PFS_MIN_62_FAST_SCREENING.gs
// Core screening logic preserved; Google Sheets UI/SpreadsheetApp features are removed.
//
// Default:
// - Market: IDX
// - Timeframe: Daily 1D
// - Lookback: 500 calendar days
// - Minimum PFS: 62
// - Maximum displayed results: 50
// - Source: Yahoo Finance chart endpoint
//
// Input:
//   symbols.json  -> ["BBRI","BBCA",...]
// Or environment:
//   PFS_SYMBOLS=BBRI,BBCA,ANTM
//
// Output:
//   output/screening.json
//   output/screening.csv
//   output/errors.json

import fs from "node:fs/promises";
import path from "node:path";

const CFG = {
  LOOKBACK_DAYS: 500,
  MIN_BARS: 80,
  MIN_SCORE: 62,
  MAX_RESULTS: 50,
  DISPLAY_DAYS: 20,
  VOLATILITY_TOP_ATR_PCT: 5.50,
  VOLATILITY_STRONG_ATR_PCT: 2.00,
  VOLATILITY_MIN_ATR_PCT: 1.00,
  VOLATILITY10_STRONG_PCT: 2.50,
  VOLATILITY10_MIN_PCT: 1.50,
  CONCURRENCY: 8,
  RETRIES: 2,
  RETRY_DELAY_MS: 700,
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + Number(b), 0) / arr.length;
}

function dateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(x);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function formatPrice(v) {
  if (!Number.isFinite(Number(v))) return "-";
  return Number(v).toLocaleString("id-ID", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

function getVolatilityCategory(atrPct) {
  const v = Number(atrPct);
  if (!Number.isFinite(v)) return "LEMAH";
  if (v >= CFG.VOLATILITY_TOP_ATR_PCT) return "TOP VOLATILITAS";
  if (v >= CFG.VOLATILITY_STRONG_ATR_PCT) return "KUAT";
  if (v >= CFG.VOLATILITY_MIN_ATR_PCT) return "SEDANG";
  return "LEMAH";
}

function calcATR(stock, i, period) {
  if (i < 1) return 0;
  const start = Math.max(1, i - period + 1);
  const trs = [];
  for (let j = start; j <= i; j++) {
    const prevClose = stock[j - 1].close;
    const high = stock[j].high;
    const low = stock[j].low;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }
  return trs.length ? average(trs) : 0;
}

function calcRSI(stock, i, period) {
  if (i < period) return 50;
  let gains = 0;
  let losses = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const d = stock[j].close - stock[j - 1].close;
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calcEMAAt(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMomentumScore(close, ema8, ema14, ema20, macdHist, r20, r60) {
  let score = 0;
  if (close > ema20) score += 25;
  if (close > ema8) score += 20;
  if (ema8 > ema14) score += 20;
  if (ema14 > ema20) score += 15;
  if (macdHist > 0) score += 10;
  if (r20 !== null && r20 > 0) score += 5;
  if (r60 !== null && r60 > 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

function calcMFI(stock, i, period) {
  const start = Math.max(1, i - period + 1);
  let positive = 0;
  let negative = 0;
  for (let j = start; j <= i; j++) {
    const tp = (stock[j].high + stock[j].low + stock[j].close) / 3;
    const prevTp =
      (stock[j - 1].high + stock[j - 1].low + stock[j - 1].close) / 3;
    const flow = tp * stock[j].volume;
    if (tp > prevTp) positive += flow;
    else if (tp < prevTp) negative += flow;
  }
  if (negative === 0) return 100;
  const ratio = positive / negative;
  return 100 - 100 / (1 + ratio);
}

function calcOBVAt(stock, index) {
  let obv = 0;
  for (let i = 1; i <= index; i++) {
    if (stock[i].close > stock[i - 1].close) obv += stock[i].volume;
    else if (stock[i].close < stock[i - 1].close) obv -= stock[i].volume;
  }
  return obv;
}

function calcAccumulationPeriod(stock, days) {
  const n = stock.length;
  if (n < days + 1) return { label: "LEMAH", score: 0 };

  const start = n - days;
  const firstClose = Number(stock[start - 1].close) || 0;
  const lastClose = Number(stock[n - 1].close) || 0;
  if (!firstClose || !lastClose) return { label: "LEMAH", score: 0 };

  const returnPct = ((lastClose / firstClose) - 1) * 100;
  let upVol = 0;
  let downVol = 0;
  let locationSum = 0;
  let count = 0;

  for (let j = start; j < n; j++) {
    const prev = stock[j - 1];
    const cur = stock[j];
    const prevC = Number(prev.close) || 0;
    const curC = Number(cur.close) || 0;
    const vol = Number(cur.volume) || 0;
    if (curC >= prevC) upVol += vol;
    else downVol += vol;

    const range = Number(cur.high) - Number(cur.low);
    locationSum += range > 0
      ? (curC - Number(cur.low)) / range
      : 0.5;
    count++;
  }

  const volPressure =
    upVol + downVol > 0 ? upVol / (upVol + downVol) : 0.5;
  const avgLocation = count ? locationSum / count : 0.5;

  let score = 0;
  if (returnPct >= 3) score += 40;
  else if (returnPct >= 1) score += 32;
  else if (returnPct >= 0) score += 25;
  else if (returnPct >= -1) score += 15;
  else if (returnPct >= -3) score += 8;

  if (volPressure >= 0.65) score += 30;
  else if (volPressure >= 0.55) score += 22;
  else if (volPressure >= 0.50) score += 12;

  if (avgLocation >= 0.65) score += 30;
  else if (avgLocation >= 0.55) score += 22;
  else if (avgLocation >= 0.45) score += 12;

  score = Math.min(100, Math.round(score));
  return {
    label: score >= 75 ? "KUAT" : score >= 50 ? "SEDANG" : "LEMAH",
    score,
  };
}

function accumulationAverage(stock, days) {
  const n = stock.length;
  if (n < 1) return null;
  const start = Math.max(0, n - days);
  let totalPV = 0;
  let totalV = 0;
  for (let i = start; i < n; i++) {
    const d = stock[i];
    const high = Number(d.high);
    const low = Number(d.low);
    const close = Number(d.close);
    const volume = Number(d.volume || 0);
    if (!Number.isFinite(close) || volume <= 0) continue;
    const typicalPrice = (high + low + close) / 3;
    totalPV += typicalPrice * volume;
    totalV += volume;
  }
  return totalV > 0 ? totalPV / totalV : null;
}

function scorePFS(x) {
  const rsr20 =
    x.rsr20 === null ? 0 :
    x.rsr20 >= 70 ? 10 :
    x.rsr20 >= 60 ? 8 :
    x.rsr20 >= 50 ? 5 : 0;

  const rsr60 =
    x.rsr60 === null ? 0 :
    x.rsr60 >= 70 ? 10 :
    x.rsr60 >= 60 ? 8 :
    x.rsr60 >= 50 ? 5 : 0;

  const ema =
    x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20 ? 15 :
    x.close > x.ema20 && x.ema8 > x.ema14 ? 10 :
    x.close > x.ema20 ? 5 : 0;

  const willr =
    x.willr > -80 && x.willr <= -50 ? 15 :
    x.willr > -90 && x.willr <= -40 ? 10 :
    x.willr > -100 ? 5 : 0;

  const momentum =
    x.momentum >= 80 ? 15 :
    x.momentum >= 70 ? 12 :
    x.momentum >= 60 ? 9 :
    x.momentum >= 50 ? 5 : 0;

  const obv = x.obvTrend ? 15 : 5;

  const mfi =
    x.mfi >= 50 && x.mfi <= 80 ? 10 :
    x.mfi >= 40 ? 5 : 0;

  const macd = x.macdHist > 0 ? 10 : x.macdHist === 0 ? 5 : 0;

  const pfs = Math.max(
    0,
    Math.min(100, rsr20 + rsr60 + ema + willr + momentum + obv + mfi + macd)
  );

  const timingWillr =
    x.willr > -80 && x.willr <= -50 ? 15 :
    x.willr > -90 && x.willr <= -40 ? 10 :
    x.willr > -100 ? 5 : 0;

  const timingEMA =
    x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20 ? 15 :
    x.close > x.ema20 && x.ema8 > x.ema14 ? 10 :
    x.close > x.ema20 ? 5 : 0;

  const timing = timingWillr + timingEMA;

  let signal = "HINDARI";
  if (pfs >= 90 && timing >= 24) signal = "ENTRY A+";
  else if (pfs >= 85 && timing >= 20) signal = "ENTRY A";
  else if (pfs >= 75 && timing >= 15) signal = "CICIL ENTRY";
  else if (pfs >= 70) signal = "WATCHLIST";
  else if (pfs >= 60) signal = "TUNGGU";

  return {
    rsr20, rsr60, ema, willr, momentum, obv, mfi, macd,
    pfs, timing, signal,
    entry1: pfs >= 85 ? "30% modal" : pfs >= 75 ? "20% modal" : "TUNGGU",
    entry2:
      pfs >= 75
        ? (x.close <= x.ema20 * 1.02
          ? "30% modal - dekat EMA20"
          : "TUNGGU PULLBACK ke EMA20")
        : "TUNGGU",
    entry3:
      pfs >= 80 && x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20
        ? "40% modal - konfirmasi trend"
        : "TUNGGU KONFIRMASI",
  };
}

function calculateIndicators(stock, ihsg) {
  const ihsgMap = new Map();
  for (const x of ihsg) ihsgMap.set(dateKey(x.date), x.close);

  const rows = [];
  let obv = 0;
  let ema8 = null;
  let ema14 = null;
  let ema20 = null;
  let macdSignal = null;

  const k8 = 2 / 9;
  const k14 = 2 / 15;
  const k20 = 2 / 21;
  const k9 = 2 / 10;

  for (let i = 0; i < stock.length; i++) {
    const s = stock[i];
    const ih = ihsgMap.get(dateKey(s.date));
    const ihClose =
      ih !== undefined ? ih : nearestPriorIHSG(ihsg, s.date);

    ema8 = ema8 === null ? s.close : s.close * k8 + ema8 * (1 - k8);
    ema14 = ema14 === null ? s.close : s.close * k14 + ema14 * (1 - k14);
    ema20 = ema20 === null ? s.close : s.close * k20 + ema20 * (1 - k20);

    if (i > 0) {
      if (s.close > stock[i - 1].close) obv += s.volume;
      else if (s.close < stock[i - 1].close) obv -= s.volume;
    }

    const macd = ema8 - ema14;
    macdSignal =
      macdSignal === null ? macd : macd * k9 + macdSignal * (1 - k9);
    const macdHist = macd - macdSignal;

    const return20 = i >= 20 ? s.close / stock[i - 20].close - 1 : null;
    const return60 = i >= 60 ? s.close / stock[i - 60].close - 1 : null;

    let ihReturn20 = null;
    let ihReturn60 = null;
    if (i >= 20 && ihClose != null) {
      const oldIH = nearestPriorIHSG(ihsg, stock[i - 20].date);
      if (oldIH != null && oldIH !== 0) ihReturn20 = ihClose / oldIH - 1;
    }
    if (i >= 60 && ihClose != null) {
      const oldIH = nearestPriorIHSG(ihsg, stock[i - 60].date);
      if (oldIH != null && oldIH !== 0) ihReturn60 = ihClose / oldIH - 1;
    }

    const excess20 =
      return20 !== null && ihReturn20 !== null
        ? return20 - ihReturn20
        : null;
    const excess60 =
      return60 !== null && ihReturn60 !== null
        ? return60 - ihReturn60
        : null;

    const rsr20 =
      excess20 === null
        ? null
        : Math.max(0, Math.min(100, Math.round(50 + excess20 * 200)));
    const rsr60 =
      excess60 === null
        ? null
        : Math.max(0, Math.min(100, Math.round(50 + excess60 * 200)));

    const start14 = Math.max(0, i - 13);
    const hh = Math.max(...stock.slice(start14, i + 1).map((z) => z.high));
    const ll = Math.min(...stock.slice(start14, i + 1).map((z) => z.low));
    const willr = hh === ll ? -50 : -100 * ((hh - s.close) / (hh - ll));

    const mfi = calcMFI(stock, i, 14);
    const momentum = calcMomentumScore(
      s.close, ema8, ema14, ema20, macdHist, return20, return60
    );
    const obv5 = i >= 5 ? calcOBVAt(stock, i - 5) : null;
    const obvTrend = obv5 === null ? false : obv > obv5;

    rows.push({
      date: s.date, open: s.open, high: s.high, low: s.low,
      close: s.close, volume: s.volume, ihsgClose: ihClose,
      ema8, ema14, ema20, return20, return60, rsr20, rsr60,
      willr, obv, mfi, macdHist, momentum, obvTrend,
    });
  }

  const latest = rows.at(-1);
  const scores = scorePFS(latest);
  Object.assign(latest, {
    rsr20Score: scores.rsr20, rsr60Score: scores.rsr60,
    emaScore: scores.ema, willrScore: scores.willr,
    momentumScore: scores.momentum, obvScore: scores.obv,
    mfiScore: scores.mfi, macdScore: scores.macd,
    pfs: scores.pfs, timing: scores.timing, signal: scores.signal,
    entry1: scores.entry1, entry2: scores.entry2, entry3: scores.entry3,
  });

  return { rows, latest };
}

function nearestPriorIHSG(ihsg, date) {
  let best = null;
  for (const x of ihsg) {
    if (x.date <= date) best = x.close;
    else break;
  }
  return best;
}

function screenScore(stock, calc) {
  const x = calc.latest;
  const n = stock.length;
  const i = n - 1;

  const rsi = calcRSI(stock, i, 14);
  const ema50 = calcEMAAt(stock.map((s) => s.close), 50);
  const avg20Vol = average(stock.slice(-20).map((s) => s.volume));
  const volRatio = avg20Vol ? x.volume / avg20Vol : 0;

  const atr10 = calcATR(stock, i, 10);
  const volatility10Pct = x.close ? (atr10 / x.close) * 100 : 0;
  const atr14 = calcATR(stock, i, 14);
  const atrPct = x.close ? (atr14 / x.close) * 100 : 0;

  const trendQuality =
    x.close > ema50 && x.close > x.ema20 && x.ema20 > ema50
      ? "UPTREND"
      : x.close > x.ema20
        ? "MIXED BULLISH"
        : "LEMAH";

  const high20 = Math.max(
    ...stock.slice(-CFG.DISPLAY_DAYS).map((s) => s.high)
  );
  const distHigh = high20 ? ((high20 - x.close) / high20) * 100 : 100;

  const last = stock.at(-1);
  const prev = stock.at(-2);

  const dailyChangePct =
    prev && prev.close ? ((last.close / prev.close) - 1) * 100 : 0;

  const candleRange = last.high - last.low;
  const closeLocation =
    candleRange > 0 ? (last.close - last.low) / candleRange : 0.5;

  let accumulationScore = 0;
  if (dailyChangePct > 0) accumulationScore += 35;
  else if (dailyChangePct >= -0.25) accumulationScore += 20;
  else if (dailyChangePct >= -1.0) accumulationScore += 10;

  if (closeLocation >= 0.70) accumulationScore += 30;
  else if (closeLocation >= 0.50) accumulationScore += 20;
  else if (closeLocation >= 0.35) accumulationScore += 10;

  if (volRatio >= 1.50) accumulationScore += 35;
  else if (volRatio >= 1.20) accumulationScore += 25;
  else if (volRatio >= 1.00) accumulationScore += 15;
  else if (volRatio >= 0.80) accumulationScore += 8;

  const accumulation =
    accumulationScore >= 75
      ? "KUAT"
      : accumulationScore >= 50
        ? "SEDANG"
        : "LEMAH";

  const accumulation5d = calcAccumulationPeriod(stock, 5);
  const accumulation10d = calcAccumulationPeriod(stock, 10);

  const bullishCandle = last.close > last.open && last.close > prev.close;
  const candle =
    bullishCandle ? "BULLISH" : last.close < last.open ? "BEARISH" : "NETRAL";

  const trend =
    x.close > ema50 && x.close > x.ema20 && x.ema20 > ema50
      ? "UPTREND"
      : x.close > x.ema20
        ? "MIXED BULLISH"
        : "LEMAH";

  let score = 0;
  const reasons = [];

  if (x.close > x.ema20) { score += 7; reasons.push("Close>EMA20"); }
  if (x.ema20 > ema50) { score += 7; reasons.push("EMA20>EMA50"); }
  if (x.close > ema50) { score += 6; reasons.push("Close>EMA50"); }

  if (rsi >= 50 && rsi <= 70) { score += 15; reasons.push("RSI sehat"); }
  else if (rsi >= 45 && rsi < 50) score += 8;
  else if (rsi > 70 && rsi <= 75) score += 7;

  if (x.macdHist > 0) { score += 15; reasons.push("MACD positif"); }

  if (volRatio >= 1.5) { score += 15; reasons.push("Volume kuat"); }
  else if (volRatio >= 1.2) { score += 12; reasons.push("Volume naik"); }
  else if (volRatio >= 1.0) score += 7;

  if (x.close >= high20 * 0.99) { score += 15; reasons.push("Breakout/near 20D high"); }
  else if (x.close >= high20 * 0.97) { score += 10; reasons.push("Dekat 20D high"); }
  else if (x.close >= high20 * 0.93) score += 5;

  if (x.rsr20 >= 70) { score += 6; reasons.push("RSR20 kuat"); }
  else if (x.rsr20 >= 60) score += 4;
  if (x.rsr60 >= 70) { score += 4; reasons.push("RSR60 kuat"); }
  else if (x.rsr60 >= 60) score += 3;

  if (bullishCandle) { score += 10; reasons.push("Candle bullish"); }
  else if (last.close > last.open) score += 5;

  let volatility10Score = 0;
  let volatility10Label = "LEMAH";
  if (volatility10Pct >= CFG.VOLATILITY10_STRONG_PCT) {
    volatility10Label = "KUAT";
    if (trendQuality === "UPTREND") volatility10Score = 10;
    else if (trendQuality === "MIXED BULLISH") volatility10Score = 7;
    if (volatility10Score > 0)
      reasons.push(`Volatilitas 10D KUAT + trend ${trendQuality}`);
  } else if (volatility10Pct >= CFG.VOLATILITY10_MIN_PCT) {
    volatility10Label = "SEDANG";
    if (trendQuality === "UPTREND") volatility10Score = 5;
    else if (trendQuality === "MIXED BULLISH") volatility10Score = 3;
    if (volatility10Score > 0)
      reasons.push(`Volatilitas 10D SEDANG + trend ${trendQuality}`);
  }

  score += volatility10Score;
  score = Math.round(Math.min(100, score));

  const signal =
    score > 90 ? "🔥 PRIORITAS+" :
    score > 80 ? "🔥 PRIORITAS" :
    score > 70 ? "🟢 POTENSIAL" :
    score > 60 ? "🟡 WATCHLIST" : "🔴 LEMAH";

  if (!reasons.length) reasons.push("Belum memenuhi filter utama");

  return {
    score, signal, rsi, ema50,
    prevClose: prev?.close ?? null,
    changePct: dailyChangePct,
    volRatio, atrPct,
    atrScore: volatility10Score,
    volatility10Pct, volatility10Score, volatility10Label,
    trendQuality,
    accumulation, accumulationScore,
    accumulation5d: accumulation5d.label,
    accumulation5dScore: accumulation5d.score,
    accumulation10d: accumulation10d.label,
    accumulation10dScore: accumulation10d.score,
    high20, distHigh,
    candle, trend,
    reason: reasons.join(" | "),
  };
}

function parseYahooHistoryBody(json, symbol) {
  if (!json.chart?.result?.length) {
    const err = json.chart?.error
      ? JSON.stringify(json.chart.error)
      : "Tidak ada result";
    throw new Error(`Data Yahoo tidak tersedia untuk ${symbol}: ${err}`);
  }

  const result = json.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0];

  if (!quote) throw new Error(`Quote Yahoo tidak tersedia untuk ${symbol}.`);

  const rows = [];
  let prevClose = null;

  for (let i = 0; i < timestamps.length; i++) {
    const closeRaw =
      quote.close?.[i] != null
        ? Number(quote.close[i])
        : adj?.adjclose?.[i] != null
          ? Number(adj.adjclose[i])
          : NaN;
    if (!Number.isFinite(closeRaw)) continue;

    const open = quote.open?.[i] != null ? Number(quote.open[i]) : closeRaw;
    const high = quote.high?.[i] != null ? Number(quote.high[i]) : closeRaw;
    const low = quote.low?.[i] != null ? Number(quote.low[i]) : closeRaw;
    const volume = quote.volume?.[i] != null ? Number(quote.volume[i]) : 0;

    rows.push({
      date: new Date(Number(timestamps[i]) * 1000),
      open, high, low, close: closeRaw,
      prevClose,
      changePct:
        prevClose != null && prevClose !== 0
          ? ((closeRaw - prevClose) / prevClose) * 100
          : null,
      volume,
    });
    prevClose = closeRaw;
  }
  return rows;
}

async function fetchYahooHistory(symbol, lookbackDays = CFG.LOOKBACK_DAYS) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor(
    (Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000
  );

  const hosts = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com"
];

let lastError = null;

for (let hostIndex = 0; hostIndex < hosts.length; hostIndex++) {
  const host = hosts[hostIndex];

  for (let attempt = 0; attempt <= CFG.RETRIES; attempt++) {
    try {
      const url =
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?period1=${start}&period2=${end}` +
        `&interval=1d&events=history&includeAdjustedClose=true`;

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/131.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });

      const body = await response.text();

      if (!response.ok) {
        throw new Error(
          `Yahoo HTTP ${response.status}: ${body.slice(0, 180)}`
        );
      }

      const json = JSON.parse(body);

      if (
        !json.chart ||
        !json.chart.result ||
        !json.chart.result.length
      ) {
        throw new Error("Yahoo mengembalikan data chart kosong");
      }

      return parseYahooHistoryBody(json, symbol);

    } catch (err) {
      lastError = err;

      if (attempt < CFG.RETRIES) {
        await sleep(CFG.RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
}


  throw new Error(`${symbol}: ${lastError?.message || "Yahoo fetch gagal"}`);
}

async function mapConcurrent(items, worker, concurrency = CFG.CONCURRENCY) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runner()
    )
  );
  return results;
}

async function loadSymbols() {
  const envSymbols = process.env.PFS_SYMBOLS?.trim();
  if (envSymbols) {
    return [...new Set(
      envSymbols
        .split(",")
        .map((x) => x.trim().toUpperCase().replace(/\s+/g, ""))
        .filter(Boolean)
    )];
  }

  const file = JSON.parse(
    await fs.readFile(new URL("./symbols.json", import.meta.url), "utf8")
  );

  if (!Array.isArray(file)) {
    throw new Error("symbols.json harus berupa array kode saham.");
  }

  return [...new Set(
    file.map((x) => String(x).trim().toUpperCase().replace(/\s+/g, ""))
      .filter(Boolean)
  )];
}

function toCSV(rows) {
  const headers = [
    "RANK","SAHAM","PFS","SIGNAL","VOLATILITAS","AKUMULASI_1D",
    "RATA_AKUMULASI_1D","AKUMULASI_5D","RATA_AKUMULASI_5D",
    "AKUMULASI_10D","RATA_AKUMULASI_10D","CLOSE","PERUBAHAN_PCT",
    "RSI14","EMA20","EMA50","MACD_HIST","VOL_VS_AVG20","ATR14_PCT",
    "20D_HIGH","RSR20","RSR60","CANDLE","TREND","ALASAN"
  ];

  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return `"${s.replaceAll('"', '""')}"`;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.rank, r.ticker, r.score, r.signal, r.volatility,
      r.accumulation, r.accumulationAvg1d, r.accumulation5d,
      r.accumulationAvg5d, r.accumulation10d, r.accumulationAvg10d,
      r.close, r.changePct, r.rsi, r.ema20, r.ema50, r.macdHist,
      r.volRatio, r.atrPct, r.high20, r.rsr20, r.rsr60,
      r.candle, r.trend, r.reason
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const symbols = await loadSymbols();
  if (!symbols.length) throw new Error("Tidak ada saham di symbols.json.");

  console.log(`PFS Scanner V59 Node.js`);
  console.log(`PFS minimum : ${CFG.MIN_SCORE}`);
  console.log(`Universe    : ${symbols.length} saham`);
  console.log(`Max output  : ${CFG.MAX_RESULTS}`);

  // IHSG wajib karena RSR20/RSR60 V59 membandingkan saham terhadap ^JKSE.
  console.log("Mengambil histori IHSG...");
  const ihsg = await fetchYahooHistory("^JKSE");

  if (ihsg.length < CFG.MIN_BARS) {
    throw new Error(`Data IHSG tidak cukup: ${ihsg.length} baris.`);
  }

  const fetched = await mapConcurrent(
    symbols,
    async (ticker, index) => {
     const stock = await fetchYahooHistory(ticker);
      console.log(`[${index + 1}/${symbols.length}] ${ticker} -> ${stock.length} candle`);
      return { ticker, stock };
    },
    CFG.CONCURRENCY
  );

  const results = [];
  const errors = [];

  for (const item of fetched) {
    if (item?.error) {
      errors.push({
        ticker: item?.ticker || "UNKNOWN",
        error: item.error.message,
      });
      continue;
    }

    const { ticker, stock } = item;
    if (!stock || stock.length < CFG.MIN_BARS) {
      errors.push({
        ticker,
        error: `Data tidak cukup (${stock?.length || 0} baris)`,
      });
      continue;
    }

    try {
      const calc = calculateIndicators(stock, ihsg);
      const s = screenScore(stock, calc);
      const last = stock.at(-1);
      const prev = stock.at(-2);

      results.push({
        ticker,
        dataDate: dateKey(last.date),
        score: s.score,
        signal: s.signal,
        volatility: getVolatilityCategory(s.atrPct),
        close: last.close,
        volume: last.volume,
        rsi: s.rsi,
        ema20: calc.latest.ema20,
        ema50: s.ema50,
        macdHist: calc.latest.macdHist,
        volRatio: s.volRatio,
        atrPct: s.atrPct,
        volatility10Pct: s.volatility10Pct,
        volatility10Score: s.volatility10Score,
        volatility10Label: s.volatility10Label,
        trendQuality: s.trendQuality,
        accumulation: s.accumulation,
        accumulationScore: s.accumulationScore,
        accumulation5d: s.accumulation5d,
        accumulation5dScore: s.accumulation5dScore,
        accumulation10d: s.accumulation10d,
        accumulation10dScore: s.accumulation10dScore,
        accumulationAvg1d: accumulationAverage(stock, 1),
        accumulationAvg5d: accumulationAverage(stock, 5),
        accumulationAvg10d: accumulationAverage(stock, 10),
        prevClose: prev?.close ?? null,
        changePct: s.changePct,
        high20: s.high20,
        distHigh: s.distHigh,
        rsr20: calc.latest.rsr20,
        rsr60: calc.latest.rsr60,
        candle: s.candle,
        trend: s.trend,
        reason: s.reason,
      });
    } catch (error) {
      errors.push({ ticker, error: error.message });
    }
  }

  results.sort((a, b) => b.score - a.score);

  // V59: minimum PFS 62 + ranking + hard cap 50.
  const qualified = results
    .filter((r) => r.score >= CFG.MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, CFG.MAX_RESULTS);

  qualified.forEach((r, i) => {
    r.rank = i + 1;
  });

  await fs.mkdir("output", { recursive: true });
  await fs.writeFile(
    "output/screening.json",
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      market: "IDX",
      timeframe: "1D",
      minPFS: CFG.MIN_SCORE,
      checked: symbols.length,
      successful: results.length,
      qualified: qualified.length,
      errors: errors.length,
      results: qualified,
    }, null, 2)
  );

  await fs.writeFile("output/screening.csv", toCSV(qualified));
  await fs.writeFile("output/errors.json", JSON.stringify(errors, null, 2));

  console.log("");
  console.log(`Selesai. Dicek: ${symbols.length}`);
  console.log(`Berhasil: ${results.length}`);
  console.log(`PFS >= ${CFG.MIN_SCORE}: ${qualified.length}`);
  console.log(`Error: ${errors.length}`);
  console.table(errors.slice(0, 20));

console.table(
  qualified.slice(0, 20).map((r) => ({
    RANK: r.rank,
    SAHAM: r.ticker,
    PFS: r.score,
    SIGNAL: r.signal,
    VOL: r.volatility,
    AKUM: r.accumulation,
    RSR20: r.rsr20,
    "VOL/AVG20": Number(r.volRatio).toFixed(2),
  }))
);
}

main().catch((error) => {
  console.error("SCREENING GAGAL:", error);
  process.exitCode = 1;
});
