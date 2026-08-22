// PFS Scanner V64.4 GITHUB ACTIONS CONTROLLER - FAST 100D
// PFS Scanner V64.2 FAST - PFS + EAS + Timing + Trend + Entry + Telegram Backtest Controller
// FIX V64.2: header is valid JavaScript comments; no plain-text title outside comments.
// Converted from V59_PFS_MIN_62_FAST_SCREENING.gs
// Core screening logic preserved; Google Sheets UI/SpreadsheetApp features are removed.
//
// Default:
// - Market: IDX
// - Timeframe: Daily 1D
// - Lookback: 100 trading candles (fetch window expanded to calendar days automatically)
// - Base Minimum PFS: 62
// - STRICT qualification: PFS + EAS + Timing + Trend + Entry Score + UPTREND
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

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram belum dikonfigurasi");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
  });

  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram error: ${result.description}`);
  }
}

const CFG = {
  LOOKBACK_DAYS: 100,
  MIN_BARS: 80,
  // Yahoo period1/period2 uses calendar days; expand enough to obtain ~100 trading candles.
  CALENDAR_DAYS_MULTIPLIER: 1.70,
  MIN_CALENDAR_DAYS: 180,
  MIN_SCORE: 62,

  // STRICT ENTRY FILTERS
  QUALIFY_MIN_PFS: 75,
  QUALIFY_MIN_EAS: 55,
  QUALIFY_MIN_TREND: 60,
  QUALIFY_MIN_TIMING: 55,
  QUALIFY_MIN_ENTRY: 70,
  REQUIRE_UPTREND: true,

  // V65 ADAPTIVE RECOVERY BACKTEST + TELEGRAM CONTROLLER
  BACKTEST_DAYS: 120,
  BACKTEST_HORIZON_DAYS: 10,
  BACKTEST_TP1_PCT: 3.0,
  BACKTEST_TP2_PCT: 6.0,
  // V65 Adaptive Recovery: no fixed SL -3% exit.
  RECOVERY_AD1_DD_PCT: 2.0,
  RECOVERY_AD2_DD_PCT: 4.0,
  RECOVERY_MAX_DD_PCT: 8.0,
  RECOVERY_MAX_AD: 2,
  RECOVERY_MIN_PFS: 70,
  RECOVERY_MIN_EAS: 50,
  RECOVERY_MIN_TREND: 55,
  RECOVERY_MIN_TIMING: 45,
  RECOVERY_MIN_ENTRY: 62,
  RECOVERY_TP1_PCT: 3.0,
  RECOVERY_TP2_PCT: 6.0,
  BACKTEST_MIN_BARS: 80,

  MAX_RESULTS: 50,
  DISPLAY_DAYS: 20,
  VOLATILITY_TOP_ATR_PCT: 5.50,
  VOLATILITY_STRONG_ATR_PCT: 2.00,
  VOLATILITY_MIN_ATR_PCT: 1.00,
  VOLATILITY10_STRONG_PCT: 2.50,
  VOLATILITY10_MIN_PCT: 1.50,
  // V64.2 FAST: faster fetch while keeping the full universe intact.
  CONCURRENCY: 12,
  RETRIES: 1,
  RETRY_DELAY_MS: 500,
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


function calculateEarlyAccumulationScore(stock, calc) {
  const last = stock?.at(-1);
  const prev = stock?.at(-2);
  if (!last || !prev || !calc?.latest) {
    return { score: 0, label: "LEMAH", reasons: [] };
  }

  const close = Number(last.close);
  const prevClose = Number(prev.close);

  // V61.1 FIX:
  // Jangan mengambil volRatio/RSI/EMA50 dari calc.latest karena field tersebut
  // memang tidak disimpan di calculateIndicators(). Hitung ulang di sini
  // supaya Early Accumulation Score benar-benar terisi.
  const avg20Vol = average(stock.slice(-20).map((x) => Number(x.volume) || 0));
  const volRatio = avg20Vol > 0 ? (Number(last.volume) || 0) / avg20Vol : 0;
  const rsi = calcRSI(stock, stock.length - 1, 14);
  const ema20 = Number(calc.latest.ema20 ?? 0);
  const ema50 = calcEMAAt(stock.map((x) => Number(x.close) || 0), 50);
  const macdHist = Number(calc.latest.macdHist ?? 0);

  const lookback = stock.slice(Math.max(0, stock.length - 20));
  const high20 = Math.max(...lookback.map((x) => Number(x.high) || 0));
  const nearHigh = high20 > 0 ? close / high20 : 0;

  let score = 0;
  const reasons = [];

  if (volRatio >= 1.5) { score += 20; reasons.push("Volume kuat"); }
  else if (volRatio >= 1.2) { score += 15; reasons.push("Volume naik"); }
  else if (volRatio >= 1.0) { score += 10; }

  const five = stock.slice(Math.max(0, stock.length - 5));
  const ten = stock.slice(Math.max(0, stock.length - 10));

  const avgMove = arr => {
    if (arr.length < 2) return 0;
    const first = Number(arr[0].close);
    const lastC = Number(arr.at(-1).close);
    return first > 0 ? ((lastC / first) - 1) * 100 : 0;
  };

  const acc5 = avgMove(five);
  const acc10 = avgMove(ten);

  if (acc5 > 0) { score += 20; reasons.push("Akumulasi 5D"); }
  else if (acc5 >= -1) score += 10;

  if (acc10 > 0) { score += 15; reasons.push("Akumulasi 10D"); }
  else if (acc10 >= -2) score += 8;

  if (nearHigh >= 0.98) { score += 15; reasons.push("Dekat High 20D"); }
  else if (nearHigh >= 0.95) score += 10;

  if (rsi >= 50 && rsi <= 70) { score += 10; reasons.push("RSI sehat"); }
  else if (rsi >= 45 && rsi < 50) score += 5;

  if (macdHist > 0) { score += 10; reasons.push("MACD positif"); }
  else if (macdHist >= -0.01) score += 5;

  if (close > ema20 && ema20 >= ema50) {
    score += 10;
    reasons.push("Trend mendukung");
  }

  score = Math.round(Math.min(100, score));

  const label =
    score >= 80 ? "EARLY ACCUMULATION" :
    score >= 65 ? "AKUMULASI AWAL" :
    score >= 50 ? "MULAI TERBENTUK" :
    "LEMAH";

  return {
    score,
    label,
    reasons,
    acc5,
    acc10,
    nearHigh
  };
}


function calculateTrendScore(stock, calc, s) {
  const x = calc.latest;
  let score = 0;

  // Struktur EMA = komponen terbesar karena trend harus konsisten.
  if (x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20) score += 30;
  else if (x.close > x.ema20 && x.ema8 > x.ema14) score += 22;
  else if (x.close > x.ema20) score += 12;

  if (x.rsr20 >= 70) score += 20;
  else if (x.rsr20 >= 60) score += 15;
  else if (x.rsr20 >= 50) score += 8;

  if (x.rsr60 >= 70) score += 10;
  else if (x.rsr60 >= 60) score += 7;
  else if (x.rsr60 >= 50) score += 4;

  if (x.momentum >= 80) score += 15;
  else if (x.momentum >= 70) score += 12;
  else if (x.momentum >= 60) score += 8;
  else if (x.momentum >= 50) score += 4;

  if (x.macdHist > 0) score += 10;
  else if (x.macdHist >= -0.01) score += 5;

  if (x.obvTrend) score += 10;
  else score += 3;

  const ema50 = Number(s.ema50 || 0);
  if (ema50 > 0 && x.close > ema50) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateTimingScore(stock, calc, s) {
  const x = calc.latest;
  const last = stock.at(-1);
  const prev = stock.at(-2);
  if (!last || !prev) return 0;

  let score = 0;

  // Williams %R: mencari timing yang belum terlalu overbought.
  if (x.willr > -80 && x.willr <= -50) score += 30;
  else if (x.willr > -90 && x.willr <= -40) score += 22;
  else if (x.willr > -100) score += 12;

  const high20 = Math.max(...stock.slice(-CFG.DISPLAY_DAYS).map((z) => Number(z.high) || 0));
  const distHigh = high20 > 0 ? ((high20 - last.close) / high20) * 100 : 100;
  if (distHigh >= 0 && distHigh <= 2) score += 20;
  else if (distHigh <= 5) score += 15;
  else if (distHigh <= 8) score += 8;

  const volRatio = Number(s.volRatio || 0);
  if (volRatio >= 1.5) score += 20;
  else if (volRatio >= 1.2) score += 15;
  else if (volRatio >= 1.0) score += 8;

  const range = Number(last.high) - Number(last.low);
  const closeLocation = range > 0 ? (Number(last.close) - Number(last.low)) / range : 0.5;
  const bullishCandle = last.close > last.open && last.close > prev.close;
  if (bullishCandle) score += 15;
  else if (last.close > last.open) score += 8;

  if (closeLocation >= 0.70) score += 15;
  else if (closeLocation >= 0.55) score += 10;
  else if (closeLocation >= 0.45) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateEntryDecision(pfs, eas, trendScore, timingScore) {
  // Final Entry Score: PFS 40% + EAS 25% + Trend 20% + Timing 15%.
  const entryScore = Math.round(
    Number(pfs || 0) * 0.40 +
    Number(eas || 0) * 0.25 +
    Number(trendScore || 0) * 0.20 +
    Number(timingScore || 0) * 0.15
  );

  let entryDecision = "TUNGGU";
  let entryGrade = "D";

  if (
    entryScore >= 85 &&
    pfs >= 85 && eas >= 75 && trendScore >= 80 && timingScore >= 75
  ) {
    entryDecision = "ENTRY A+";
    entryGrade = "A+";
  } else if (
    entryScore >= 78 &&
    pfs >= 80 && eas >= 65 && trendScore >= 70 && timingScore >= 65
  ) {
    entryDecision = "ENTRY A";
    entryGrade = "A";
  } else if (
    entryScore >= 70 &&
    pfs >= 75 && eas >= 55 && trendScore >= 60 && timingScore >= 55
  ) {
    entryDecision = "CICIL ENTRY";
    entryGrade = "B";
  } else if (entryScore >= 60 && pfs >= 70) {
    entryDecision = "WATCHLIST";
    entryGrade = "C";
  }

  return { entryScore, entryDecision, entryGrade };
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

  // LOOKBACK_DAYS = target trading candles, not raw calendar days.
  // Yahoo returns trading sessions only, so 100 calendar days produced only ~65 bars.
  // Expand the Yahoo request window so IDX normally returns >= 80 bars.
  const calendarDays = Math.max(
    CFG.MIN_CALENDAR_DAYS,
    Math.ceil(lookbackDays * CFG.CALENDAR_DAYS_MULTIPLIER)
  );

  const start = Math.floor(
    (Date.now() - calendarDays * 24 * 60 * 60 * 1000) / 1000
  );

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${start}&period2=${end}&interval=1d&events=history&includeAdjustedClose=true`;

  let lastError = null;
  for (let attempt = 0; attempt <= CFG.RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`Yahoo HTTP ${response.status}: ${body.slice(0, 180)}`);
      }

      return parseYahooHistoryBody(JSON.parse(body), symbol);
    } catch (err) {
      lastError = err;
      if (attempt < CFG.RETRIES) {
        await sleep(CFG.RETRY_DELAY_MS * (attempt + 1));
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
    "RANK","SAHAM","PFS","TIMING_SCORE","TREND_SCORE","ENTRY_SCORE","ENTRY_DECISION","ENTRY_GRADE","SIGNAL","VOLATILITAS","EAS","EARLY_ACCUMULATION",
    "AKUMULASI_1D","RATA_AKUMULASI_1D","AKUMULASI_5D","RATA_AKUMULASI_5D",
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
      r.rank, r.ticker, r.score, r.timingScore, r.trendScore, r.entryScore, r.entryDecision, r.entryGrade, r.signal, r.volatility, r.earlyAccumulationScore, r.earlyAccumulationLabel,
      r.accumulation, r.accumulationAvg1d, r.accumulation5d,
      r.accumulationAvg5d, r.accumulation10d, r.accumulationAvg10d,
      r.close, r.changePct, r.rsi, r.ema20, r.ema50, r.macdHist,
      r.volRatio, r.atrPct, r.high20, r.rsr20, r.rsr60,
      r.candle, r.trend, r.reason
    ].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}


function strictPassForBacktest(pfs, eas, trendScore, timingScore, entryScore, trendQuality) {
  return (
    pfs >= CFG.QUALIFY_MIN_PFS &&
    eas >= CFG.QUALIFY_MIN_EAS &&
    trendScore >= CFG.QUALIFY_MIN_TREND &&
    timingScore >= CFG.QUALIFY_MIN_TIMING &&
    entryScore >= CFG.QUALIFY_MIN_ENTRY &&
    (!CFG.REQUIRE_UPTREND || trendQuality === "UPTREND")
  );
}

function classifyBacktestClose(changePct) {
  const c = Number(changePct);
  if (!Number.isFinite(c)) return null;
  // Kriteria 1: candle merah, tetapi minus tidak lebih dari 1%.
  if (c >= -1.0 && c < 0) return "MERAH_-1%_SAMPAI_0%";
  // Kriteria 2: close harian nol atau positif.
  if (c >= 0) return "CLOSE_>=_0%";
  // Lebih merah dari -1% tidak masuk dua kelompok ini.
  return null;
}

function recoveryScoreForDay(stock, index, ihsg) {
  const histStock = stock.slice(0, index + 1);
  if (histStock.length < CFG.BACKTEST_MIN_BARS) return null;
  const signalBar = histStock.at(-1);
  const histIHSG = ihsg.filter(x => x.date <= signalBar.date);
  if (histIHSG.length < CFG.BACKTEST_MIN_BARS) return null;
  try {
    const calc = calculateIndicators(histStock, histIHSG);
    const s = screenScore(histStock, calc);
    const eas = calculateEarlyAccumulationScore(histStock, calc);
    const trendScore = calculateTrendScore(histStock, calc, s);
    const timingScore = calculateTimingScore(histStock, calc, s);
    const entry = calculateEntryDecision(s.score, eas.score, trendScore, timingScore);
    let score = 0;
    if (s.score >= 85) score += 25; else if (s.score >= 75) score += 22; else if (s.score >= 70) score += 18; else if (s.score >= 65) score += 12;
    if (eas.score >= 75) score += 20; else if (eas.score >= 65) score += 17; else if (eas.score >= 50) score += 13; else if (eas.score >= 40) score += 8;
    if (trendScore >= 75) score += 20; else if (trendScore >= 65) score += 16; else if (trendScore >= 55) score += 12; else if (trendScore >= 45) score += 6;
    if (timingScore >= 70) score += 15; else if (timingScore >= 55) score += 12; else if (timingScore >= 45) score += 8; else if (timingScore >= 35) score += 4;
    if (s.trendQuality === 'UPTREND') score += 10; else if (s.trendQuality === 'MIXED BULLISH') score += 5;
    const last = histStock.at(-1), prev = histStock.at(-2);
    if (last && prev && last.close >= last.open && last.close >= prev.close) score += 10;
    score = Math.min(100, Math.round(score));
    const eligible = score >= 60 && s.score >= CFG.RECOVERY_MIN_PFS && eas.score >= CFG.RECOVERY_MIN_EAS && trendScore >= CFG.RECOVERY_MIN_TREND && timingScore >= CFG.RECOVERY_MIN_TIMING && entry.entryScore >= CFG.RECOVERY_MIN_ENTRY && s.trendQuality !== 'LEMAH';
    return { recoveryScore: score, eligible, pfs:s.score, eas:eas.score, trendScore, timingScore, entryScore:entry.entryScore, trendQuality:s.trendQuality, rsi:s.rsi, macdHist:calc.latest.macdHist, rsr20:calc.latest.rsr20, accumulationScore:s.accumulationScore };
  } catch (_) { return null; }
}

function evaluateAdaptiveRecovery(stock, entryIndex, ihsg) {
  const entry = Number(stock[entryIndex]?.close);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const end = Math.min(stock.length - 1, entryIndex + CFG.BACKTEST_HORIZON_DAYS);
  let totalCost = entry, totalUnits = 1, averagePrice = entry, adCount = 0;
  const adEvents = [];
  let tp1HitDay=null, tp2HitDay=null, recoveryDay=null, breakevenDay=null, failedDay=null, exitDay=null;
  let exitReason='EXPIRED', maxDrawdownPct=0, maxGainPct=0, lowestPrice=entry, highestPrice=entry;

  for (let j=entryIndex+1; j<=end; j++) {
    const bar=stock[j], high=Number(bar.high), low=Number(bar.low), close=Number(bar.close);
    if (![high,low,close].every(Number.isFinite)) continue;
    const day=j-entryIndex;
    lowestPrice=Math.min(lowestPrice,low); highestPrice=Math.max(highestPrice,high);
    maxDrawdownPct=Math.min(maxDrawdownPct,((low/averagePrice)-1)*100);
    maxGainPct=Math.max(maxGainPct,((high/averagePrice)-1)*100);
    const tp1=averagePrice*(1+CFG.RECOVERY_TP1_PCT/100), tp2=averagePrice*(1+CFG.RECOVERY_TP2_PCT/100);

    if (tp1HitDay===null && high>=tp1) tp1HitDay=day;
    if (tp2HitDay===null && high>=tp2) { tp2HitDay=day; exitDay=day; exitReason='TP2'; break; }
    if (breakevenDay===null && close>=averagePrice) { breakevenDay=day; if (adCount>0 && recoveryDay===null) recoveryDay=day; }
    if (tp1HitDay!==null) continue;

    const ddClose=((close/averagePrice)-1)*100;
    const threshold=adCount===0 ? -CFG.RECOVERY_AD1_DD_PCT : -CFG.RECOVERY_AD2_DD_PCT;
    if (adCount<CFG.RECOVERY_MAX_AD && ddClose<=threshold) {
      const rec=recoveryScoreForDay(stock,j,ihsg);
      if (rec?.eligible && Math.abs(ddClose)<=CFG.RECOVERY_MAX_DD_PCT) {
        totalCost+=close; totalUnits+=1; averagePrice=totalCost/totalUnits; adCount+=1;
        adEvents.push({number:adCount,date:dateKey(bar.date),day,price:close,drawdownPct:ddClose,averagePriceAfter:averagePrice,recoveryScore:rec.recoveryScore,pfs:rec.pfs,eas:rec.eas,trendScore:rec.trendScore,timingScore:rec.timingScore,entryScore:rec.entryScore});
        continue;
      }
    }
    if (ddClose<=-CFG.RECOVERY_MAX_DD_PCT) {
      const rec=recoveryScoreForDay(stock,j,ihsg);
      if (!(rec?.eligible && adCount<CFG.RECOVERY_MAX_AD)) { failedDay=day; exitDay=day; exitReason='FAILED_RECOVERY'; break; }
    }
  }
  if (exitDay===null) { exitDay=end-entryIndex; exitReason='EXPIRED'; }
  const exitPrice=Number(stock[entryIndex+exitDay]?.close ?? stock[end]?.close ?? entry);
  const finalReturnPct=((exitPrice/averagePrice)-1)*100;
  const recoveryStatus=exitReason==='TP2'?'RECOVERY_TP2':exitReason==='FAILED_RECOVERY'?'FAILED':adCount>0&&breakevenDay!==null?'RECOVERY':adCount>0?'PULLBACK_AD':'DIRECT';
  return {entry,initialAveragePrice:entry,finalAveragePrice:averagePrice,totalUnits,adCount,adEvents,tp1:entry*(1+CFG.RECOVERY_TP1_PCT/100),tp2:entry*(1+CFG.RECOVERY_TP2_PCT/100),tp1Hit:tp1HitDay!==null,tp2Hit:tp2HitDay!==null,tp1HitDay,tp2HitDay,recoveryDay,breakevenDay,failedDay,exitDay,exitDate:dateKey(stock[entryIndex+exitDay]?.date ?? stock[end]?.date),exitPrice,exitReason,recoveryStatus,daysToRecovery:recoveryDay,daysToBEP:breakevenDay,daysToTP1:tp1HitDay,daysToTP2:tp2HitDay,maxGainPct,maxDrawdownPct,lowestPrice,highestPrice,finalReturnPct};
}

async function runBacktest(fetched, ihsg) {
  const trades=[];
  for (const item of fetched) {
    if (item?.error || !item.stock || item.stock.length < CFG.BACKTEST_MIN_BARS+CFG.BACKTEST_HORIZON_DAYS) continue;
    const ticker=item.ticker, stock=item.stock;
    const lastSignalIndex=stock.length-CFG.BACKTEST_HORIZON_DAYS-1;
    const firstSignalIndex=Math.max(CFG.BACKTEST_MIN_BARS-1,lastSignalIndex-CFG.BACKTEST_DAYS+1);
    for(let i=firstSignalIndex;i<=lastSignalIndex;i++){
      const histStock=stock.slice(0,i+1), signalBar=histStock.at(-1), prevBar=histStock.at(-2);
      if(!signalBar||!prevBar) continue;
      const changePct=prevBar.close?((signalBar.close/prevBar.close)-1)*100:null;
      const criterion=classifyBacktestClose(changePct); if(!criterion) continue;
      const histIHSG=ihsg.filter(x=>x.date<=signalBar.date); if(histIHSG.length<CFG.BACKTEST_MIN_BARS) continue;
      try{
        const calc=calculateIndicators(histStock,histIHSG), s=screenScore(histStock,calc), eas=calculateEarlyAccumulationScore(histStock,calc);
        const trendScore=calculateTrendScore(histStock,calc,s), timingScore=calculateTimingScore(histStock,calc,s), entry=calculateEntryDecision(s.score,eas.score,trendScore,timingScore);
        if(!strictPassForBacktest(s.score,eas.score,trendScore,timingScore,entry.entryScore,s.trendQuality)) continue;
        const outcome=evaluateAdaptiveRecovery(stock,i,ihsg); if(!outcome) continue;
        trades.push({tradeId:`${ticker}-${dateKey(signalBar.date)}`,ticker,signalDate:dateKey(signalBar.date),criterion,changePct,pfs:s.score,eas:eas.score,trendScore,timingScore,entryScore:entry.entryScore,entryDecision:entry.entryDecision,entryGrade:entry.entryGrade,trendQuality:s.trendQuality,...outcome});
      }catch(_){ }
    }
  }
  const summarize=(rows)=>{
    const n=rows.length,tp1=rows.filter(x=>x.tp1Hit).length,tp2=rows.filter(x=>x.tp2Hit).length,rec=rows.filter(x=>x.recoveryStatus==='RECOVERY'||x.recoveryStatus==='RECOVERY_TP2').length,fail=rows.filter(x=>x.exitReason==='FAILED_RECOVERY').length,ad=rows.filter(x=>x.adCount>0),adRec=ad.filter(x=>x.recoveryStatus==='RECOVERY'||x.recoveryStatus==='RECOVERY_TP2');
    const avg=(a)=>a.length?average(a):null;
    return {signals:n,tp1Hit:tp1,tp1WinRate:n?tp1/n*100:0,tp2Hit:tp2,tp2WinRate:n?tp2/n*100:0,recovery:rec,recoveryRate:n?rec/n*100:0,failedRecovery:fail,failedRate:n?fail/n*100:0,averageDownTrades:ad.length,averageDownSuccess:adRec.length,averageDownSuccessRate:ad.length?adRec.length/ad.length*100:0,averageADCount:avg(ad.map(x=>x.adCount))??0,avgFinalReturnPct:n?average(rows.map(x=>x.finalReturnPct)):0,avgMaxGainPct:n?average(rows.map(x=>x.maxGainPct)):0,avgMaxDrawdownPct:n?average(rows.map(x=>x.maxDrawdownPct)):0,avgDaysToRecovery:avg(rows.filter(x=>Number.isFinite(x.daysToRecovery)).map(x=>x.daysToRecovery)),avgDaysToTP1:avg(rows.filter(x=>Number.isFinite(x.daysToTP1)).map(x=>x.daysToTP1)),avgDaysToTP2:avg(rows.filter(x=>Number.isFinite(x.daysToTP2)).map(x=>x.daysToTP2))};
  };
  const criteria={"MERAH_-1%_SAMPAI_0%":summarize(trades.filter(x=>x.criterion==='MERAH_-1%_SAMPAI_0%')),"CLOSE_>=_0%":summarize(trades.filter(x=>x.criterion==='CLOSE_>=_0%')),ALL:summarize(trades)};
  const byGrade={}; for(const grade of ['A+','A','B']) byGrade[grade]={"MERAH_-1%_SAMPAI_0%":summarize(trades.filter(x=>x.entryGrade===grade&&x.criterion==='MERAH_-1%_SAMPAI_0%')),"CLOSE_>=_0%":summarize(trades.filter(x=>x.entryGrade===grade&&x.criterion==='CLOSE_>=_0%'))};
  const grouped={}; for(const t of trades)(grouped[t.ticker]??=[]).push(t);
  const stockSummary=Object.entries(grouped).map(([ticker,rows])=>({ticker,trades:rows.length,tp1Hit:rows.filter(x=>x.tp1Hit).length,recoveryTrades:rows.filter(x=>x.recoveryStatus==='RECOVERY'||x.recoveryStatus==='RECOVERY_TP2').length,averageDownTrades:rows.filter(x=>x.adCount>0).length,winRateTP1:rows.length?rows.filter(x=>x.tp1Hit).length/rows.length*100:0,recoveryRate:(()=>{const a=rows.filter(x=>x.adCount>0);return a.length?rows.filter(x=>x.adCount>0&&(x.recoveryStatus==='RECOVERY'||x.recoveryStatus==='RECOVERY_TP2')).length/a.length*100:0})(),avgReturnPct:average(rows.map(x=>x.finalReturnPct)),avgMaxDrawdownPct:average(rows.map(x=>x.maxDrawdownPct)),avgDaysToRecovery:(()=>{const a=rows.filter(x=>Number.isFinite(x.daysToRecovery)).map(x=>x.daysToRecovery);return a.length?average(a):null})(),avgDaysToTP1:(()=>{const a=rows.filter(x=>Number.isFinite(x.daysToTP1)).map(x=>x.daysToTP1);return a.length?average(a):null})(),avgDaysToTP2:(()=>{const a=rows.filter(x=>Number.isFinite(x.daysToTP2)).map(x=>x.daysToTP2);return a.length?average(a):null})()})).sort((a,b)=>b.avgReturnPct-a.avgReturnPct);
  await fs.mkdir('output',{recursive:true});
  await fs.writeFile('output/backtest.json',JSON.stringify({generatedAt:new Date().toISOString(),version:'V65_ADAPTIVE_RECOVERY',lookbackSignalDays:CFG.BACKTEST_DAYS,horizonDays:CFG.BACKTEST_HORIZON_DAYS,targets:{tp1Pct:CFG.RECOVERY_TP1_PCT,tp2Pct:CFG.RECOVERY_TP2_PCT,ad1DrawdownPct:CFG.RECOVERY_AD1_DD_PCT,ad2DrawdownPct:CFG.RECOVERY_AD2_DD_PCT,maxRecoveryDrawdownPct:CFG.RECOVERY_MAX_DD_PCT,maxAD:CFG.RECOVERY_MAX_AD},noLookahead:true,criteria,byGrade,stockSummary,trades},null,2));
  const headers=['tradeId','ticker','signalDate','criterion','changePct','pfs','eas','trendScore','timingScore','entryScore','entryDecision','entryGrade','trendQuality','entry','initialAveragePrice','finalAveragePrice','totalUnits','adCount','adEvents','tp1','tp2','tp1Hit','tp2Hit','tp1HitDay','tp2HitDay','recoveryDay','breakevenDay','failedDay','exitDay','exitDate','exitPrice','exitReason','recoveryStatus','daysToRecovery','daysToBEP','daysToTP1','daysToTP2','maxGainPct','maxDrawdownPct','lowestPrice','highestPrice','finalReturnPct'];
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  await fs.writeFile('output/backtest.csv',[headers.join(','),...trades.map(t=>headers.map(h=>esc(h==='adEvents'?JSON.stringify(t[h]||[]):t[h])).join(','))].join('\n')+'\n');
  const sh=['ticker','trades','tp1Hit','recoveryTrades','averageDownTrades','winRateTP1','recoveryRate','avgReturnPct','avgMaxDrawdownPct','avgDaysToRecovery','avgDaysToTP1','avgDaysToTP2'];
  await fs.writeFile('output/backtest_per_saham.csv',[sh.join(','),...stockSummary.map(t=>sh.map(h=>esc(t[h])).join(','))].join('\n')+'\n');
  return {criteria,byGrade,stockSummary,trades};
}

// ============================================================
// V65 ADAPTIVE RECOVERY TELEGRAM BACKTEST CONTROLLER
// Server mode lama: BOT_MODE=1 node scanner.js
// GitHub Actions mode: TELEGRAM_ONESHOT=1 node scanner.js
// Perintah: /backtest, /backtest_merah, /backtest_hijau,
//           /backtest_status, /backtest_hasil, /screening, /help
// ============================================================
let BACKTEST_RUNNING = false;
let LAST_BACKTEST_AT = null;

async function telegramApi(method, body = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diatur.");
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || `Telegram API ${method} gagal`);
  return result.result;
}

async function sendTelegramTo(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  const TELEGRAM_LIMIT = 3800;
  for (let i = 0; i < message.length; i += TELEGRAM_LIMIT) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: message.substring(i, i + TELEGRAM_LIMIT),
    });
  }
}

function commandHelp() {
  return [
    "🤖 PFS BACKTEST CONTROLLER V65",
    "━━━━━━━━━━━━━━━━━━━━",
    "/backtest — jalankan backtest lengkap",
    "/backtest_merah — hanya close -1% s/d <0%",
    "/backtest_hijau — hanya close >=0%",
    "/backtest_status — cek proses berjalan",
    "/backtest_hasil — ringkasan backtest terakhir",
    "/backtest_detail KODE — detail per saham",
    "/screening — jalankan screening IDX",
    "/help — daftar perintah",
    "━━━━━━━━━━━━━━━━━━━━",
    `TP1 +${CFG.RECOVERY_TP1_PCT}% | TP2 +${CFG.RECOVERY_TP2_PCT}% | AD1 -${CFG.RECOVERY_AD1_DD_PCT}% | AD2 -${CFG.RECOVERY_AD2_DD_PCT}% | MAX DD -${CFG.RECOVERY_MAX_DD_PCT}% | Horizon ${CFG.BACKTEST_HORIZON_DAYS}D`,
  ].join("\n");
}

function formatBacktestCriterion(label, x) {
  return [label,`Sinyal       : ${x.signals}`,`TP1 Hit      : ${x.tp1Hit} | WR: ${x.tp1WinRate.toFixed(1)}%`,`TP2 Hit      : ${x.tp2Hit} | WR: ${x.tp2WinRate.toFixed(1)}%`,`Recovery     : ${x.recovery} | Rate: ${x.recoveryRate.toFixed(1)}%`,`AD Trades    : ${x.averageDownTrades} | AD Success: ${x.averageDownSuccessRate.toFixed(1)}%`,`Failed       : ${x.failedRecovery} | Rate: ${x.failedRate.toFixed(1)}%`,`Avg Return   : ${x.avgFinalReturnPct.toFixed(2)}%`,`Avg Max DD   : ${x.avgMaxDrawdownPct.toFixed(2)}%`,`Avg Recovery : ${x.avgDaysToRecovery==null?"-":x.avgDaysToRecovery.toFixed(1)+"D"}`,`Avg TP1/TP2  : ${x.avgDaysToTP1==null?"-":x.avgDaysToTP1.toFixed(1)+"D"} / ${x.avgDaysToTP2==null?"-":x.avgDaysToTP2.toFixed(1)+"D"}`].join("\n");
}

function formatTradeDetail(t) {
  return [`📌 ${t.ticker} | ${t.signalDate}`,`Entry       : ${formatPrice(t.entry)} | PFS ${t.pfs}`,`Timing/Trend/Entry : ${t.timingScore}/${t.trendScore}/${t.entryScore}`,`Grade       : ${t.entryGrade} | ${t.criterion}`,`AD          : ${t.adCount}x | Avg akhir ${formatPrice(t.finalAveragePrice)}`,...(t.adEvents||[]).map(a=>`  AD${a.number} D+${a.day} ${a.date} @ ${formatPrice(a.price)} | RS ${a.recoveryScore}`),`Recovery    : ${t.daysToRecovery==null?"-":"D+"+t.daysToRecovery}`,`BEP         : ${t.daysToBEP==null?"-":"D+"+t.daysToBEP}`,`TP1         : ${t.tp1HitDay==null?"-":"D+"+t.tp1HitDay}`,`TP2         : ${t.tp2HitDay==null?"-":"D+"+t.tp2HitDay}`,`Max DD      : ${t.maxDrawdownPct.toFixed(2)}%`,`Exit        : D+${t.exitDay} ${t.exitDate} @ ${formatPrice(t.exitPrice)}`,`Status      : ${t.recoveryStatus} | Return ${t.finalReturnPct.toFixed(2)}%`].join("\n");
}

async function getBacktestDataAndRun() {
  const symbols = await loadSymbols();
  if (!symbols.length) throw new Error("Tidak ada saham di symbols.json.");
  const ihsg = await fetchYahooHistory("^JKSE");
  if (ihsg.length < CFG.MIN_BARS) throw new Error(`Data IHSG tidak cukup: ${ihsg.length} baris.`);

  const fetched = await mapConcurrent(
    symbols,
    async (ticker) => {
      const yahooSymbol = ticker.endsWith(".JK") ? ticker : `${ticker}.JK`;
      const stock = await fetchYahooHistory(yahooSymbol);
      return { ticker: ticker.replace(/\.JK$/i, ""), stock };
    },
    CFG.CONCURRENCY
  );
  return runBacktest(fetched, ihsg);
}

async function runTelegramBacktestCommand(chatId, mode) {
  if (BACKTEST_RUNNING) {
    await sendTelegramTo(chatId, "⏳ BACKTEST MASIH BERJALAN.\nGunakan /backtest_status untuk mengecek proses.");
    return;
  }

  BACKTEST_RUNNING = true;
  LAST_BACKTEST_AT = new Date();
  await sendTelegramTo(chatId,
    "⏳ BACKTEST DIMULAI\n\n" +
    "🔴 Kriteria 1: Close -1% s/d <0%\n" +
    "🟢 Kriteria 2: Close >=0%\n\n" +
    `TP1 +${CFG.BACKTEST_TP1_PCT}% | TP2 +${CFG.BACKTEST_TP2_PCT}% | SL -${CFG.RECOVERY_MAX_DD_PCT}%\n` +
    `Horizon: ${CFG.BACKTEST_HORIZON_DAYS} hari\n\n` +
    "Server sedang menghitung..."
  );

  try {
    const result = await getBacktestDataAndRun();
    const red = result.criteria["MERAH_-1%_SAMPAI_0%"];
    const green = result.criteria["CLOSE_>=_0%"];
    const selected = mode === "red" ? red : mode === "green" ? green : null;

    let message = "🧪 BACKTEST SELESAI — V65 ADAPTIVE RECOVERY\n━━━━━━━━━━━━━━━━━━━━\n";
    if (selected) {
      message += formatBacktestCriterion(mode === "red" ? "🔴 CLOSE -1% s/d <0%" : "🟢 CLOSE >=0%", selected);
    } else {
      message += formatBacktestCriterion("🔴 CLOSE -1% s/d <0%", red) + "\n\n" +
        formatBacktestCriterion("🟢 CLOSE >=0%", green) + "\n\n" +
        (red.tp1WinRate >= green.tp1WinRate
          ? `🏆 TP1 WIN RATE TERBAIK: 🔴 MERAH (${red.tp1WinRate.toFixed(1)}%)`
          : `🏆 TP1 WIN RATE TERBAIK: 🟢 HIJAU (${green.tp1WinRate.toFixed(1)}%)`);
    }
    message += "\n━━━━━━━━━━━━━━━━━━━━\n📁 JSON: output/backtest.json\n📄 CSV: output/backtest.csv\n📊 Per saham: output/backtest_per_saham.csv";
    await sendTelegramTo(chatId, message);
  } catch (error) {
    await sendTelegramTo(chatId, `❌ BACKTEST GAGAL\n\n${error.message}`);
  } finally {
    BACKTEST_RUNNING = false;
  }
}

async function runTelegramScreeningCommand(chatId) {
  await sendTelegramTo(chatId,
    "⏳ SCREENING DIMULAI\n\n" +
    "📊 PFS + EAS + Timing + Trend + Entry\n" +
    `PFS minimum: ${CFG.QUALIFY_MIN_PFS} | Entry minimum: ${CFG.QUALIFY_MIN_ENTRY}\n` +
    "Server sedang menghitung..."
  );

  const oldChatId = process.env.TELEGRAM_CHAT_ID;
  const oldRunBacktest = process.env.RUN_BACKTEST;
  try {
    process.env.TELEGRAM_CHAT_ID = String(chatId);
    process.env.RUN_BACKTEST = "0";
    await main();
  } catch (error) {
    await sendTelegramTo(chatId, `❌ SCREENING GAGAL\n\n${error.message}`);
  } finally {
    if (oldChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChatId;
    if (oldRunBacktest === undefined) delete process.env.RUN_BACKTEST;
    else process.env.RUN_BACKTEST = oldRunBacktest;
  }
}

async function telegramBotOneShot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diatur.");

  const allowedChatId = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : null;
  const offsetFile = "output/telegram_offset.json";
  await fs.mkdir("output", { recursive: true });

  let offset = 0;
  let hasState = false;
  try {
    const raw = await fs.readFile(offsetFile, "utf8");
    const state = JSON.parse(raw);
    offset = Number(state.offset) || 0;
    hasState = true;
  } catch (_) {}

  const updates = await telegramApi("getUpdates", {
    offset,
    timeout: 0,
    limit: 100,
    allowed_updates: ["message"]
  });

  if (!updates.length) {
    if (!hasState) {
      await fs.writeFile(offsetFile, JSON.stringify({ offset: 0, initializedAt: new Date().toISOString() }, null, 2));
      console.log("Telegram: controller diinisialisasi. Perintah lama tidak dieksekusi.");
    } else {
      console.log("Telegram: tidak ada perintah baru.");
    }
    return;
  }

  const latestUpdateId = updates[updates.length - 1].update_id;

  // Run pertama: pesan lama diabaikan, tetapi perintah yang dikirim maksimal 15 menit
  // sebelum workflow berjalan tetap boleh dieksekusi. Ini mencegah /backtest baru ikut terbuang.
  const initCutoff = Math.floor(Date.now() / 1000) - 15 * 60;
  const allowedCommands = new Set([
    "/help", "/start", "/backtest", "/backtest_merah", "/backtest_hijau",
    "/backtest_status", "/backtest_hasil", "/backtest_detail", "/screening"
  ]);
  const recognized = [];

  for (const update of updates) {
    const msg = update.message;
    if (!msg?.text) continue;
    const chatId = String(msg.chat.id);
    if (allowedChatId && chatId !== allowedChatId) continue;
    if (!hasState && Number(msg.date || 0) < initCutoff) continue;
    const command = msg.text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
    if (allowedCommands.has(command)) recognized.push({ updateId: update.update_id, chatId, command });
  }

  if (!recognized.length) {
    await fs.writeFile(offsetFile, JSON.stringify({ offset: latestUpdateId + 1, updatedAt: new Date().toISOString() }, null, 2));
    console.log(`Telegram: ${updates.length} update dibaca, tidak ada command PFS.`);
    return;
  }

  const cmd = recognized[recognized.length - 1];
  console.log(`Telegram command: ${cmd.command} dari chat ${cmd.chatId}`);

  try {
    if (cmd.command === "/help" || cmd.command === "/start") {
      await sendTelegramTo(cmd.chatId, commandHelp());
    } else if (cmd.command === "/backtest") {
      await runTelegramBacktestCommand(cmd.chatId, "all");
    } else if (cmd.command === "/backtest_merah") {
      await runTelegramBacktestCommand(cmd.chatId, "red");
    } else if (cmd.command === "/backtest_hijau") {
      await runTelegramBacktestCommand(cmd.chatId, "green");
    } else if (cmd.command === "/backtest_status") {
      let status = "belum ada hasil backtest.";
      try {
        const raw = await fs.readFile("output/backtest.json", "utf8");
        const data = JSON.parse(raw);
        status = `hasil terakhir: ${data.generatedAt || "tersedia"}`;
      } catch (_) {}
      await sendTelegramTo(cmd.chatId,
        "📡 GITHUB ACTIONS STATUS\n━━━━━━━━━━━━━━━━━━━━\n" +
        "✅ Controller aktif\n" +
        "⏱ Polling Telegram: maksimal sekitar 5 menit\n" +
        `📊 ${status}`
      );
    } else if (cmd.command === "/screening") {
      await runTelegramScreeningCommand(cmd.chatId);
    } else if (cmd.command === "/backtest_detail") {
      const parts=(updates.find(u=>u.update_id===cmd.updateId)?.message?.text||"").trim().split(/\s+/);
      const ticker=String(parts[1]||"").toUpperCase().replace(/\.JK$/i,"");
      if(!ticker) await sendTelegramTo(cmd.chatId,"Gunakan: /backtest_detail KODE\nContoh: /backtest_detail MAYA");
      else { try { const raw=await fs.readFile("output/backtest.json","utf8"); const data=JSON.parse(raw); const rows=(data.trades||[]).filter(x=>String(x.ticker).toUpperCase()===ticker); if(!rows.length) await sendTelegramTo(cmd.chatId,`⚠️ Tidak ada trade historis untuk ${ticker}.`); else { let text=`📊 DETAIL BACKTEST ${ticker}\n━━━━━━━━━━━━━━━━━━━━\n`; for(const t of rows.slice(-20)){ const b=formatTradeDetail(t)+"\n━━━━━━━━━━━━━━━━━━━━\n"; if((text+b).length>3500){await sendTelegramTo(cmd.chatId,text);text="";} text+=b;} if(text) await sendTelegramTo(cmd.chatId,text); } } catch(_) { await sendTelegramTo(cmd.chatId,"⚠️ Belum ada output/backtest.json. Jalankan /backtest terlebih dahulu."); } }
    } else if (cmd.command === "/backtest_hasil") {
      try {
        const raw = await fs.readFile("output/backtest.json", "utf8");
        const data = JSON.parse(raw);
        const red = data.criteria["MERAH_-1%_SAMPAI_0%"];
        const green = data.criteria["CLOSE_>=_0%"];
        await sendTelegramTo(cmd.chatId,
          "📊 HASIL BACKTEST TERAKHIR\n━━━━━━━━━━━━━━━━━━━━\n" +
          formatBacktestCriterion("🔴 MERAH -1% s/d <0%", red) + "\n\n" +
          formatBacktestCriterion("🟢 CLOSE >=0%", green)
        );
      } catch (_) {
        await sendTelegramTo(cmd.chatId, "⚠️ Belum ada hasil backtest. Jalankan /backtest terlebih dahulu.");
      }
    }
  } finally {
    await fs.writeFile(
      offsetFile,
      JSON.stringify({ offset: latestUpdateId + 1, updatedAt: new Date().toISOString(), lastCommand: cmd.command }, null, 2)
    );
  }
}

async function telegramBotLoop() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diatur.");
  const allowedChatId = process.env.TELEGRAM_CHAT_ID ? String(process.env.TELEGRAM_CHAT_ID) : null;
  let offset = 0;

  // Abaikan pesan lama agar server tidak mengeksekusi perintah tertunda saat pertama hidup.
  try {
    const old = await telegramApi("getUpdates", { timeout: 0, limit: 100 });
    if (old.length) offset = old[old.length - 1].update_id + 1;
  } catch (e) {
    console.error("Gagal inisialisasi Telegram bot:", e.message);
  }

  await sendTelegram("🤖 PFS V65 ADAPTIVE RECOVERY BACKTEST CONTROLLER AKTIF\nKetik /help untuk melihat perintah.");
  console.log("Telegram Backtest Controller aktif. Menunggu perintah...");

  while (true) {
    try {
      const updates = await telegramApi("getUpdates", { offset, timeout: 30, limit: 20 });
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text) continue;
        const chatId = String(msg.chat.id);
        if (allowedChatId && chatId !== allowedChatId) continue;

        const command = msg.text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
        if (command === "/help" || command === "/start") {
          await sendTelegramTo(chatId, commandHelp());
        } else if (command === "/backtest") {
          void runTelegramBacktestCommand(chatId, "all");
        } else if (command === "/backtest_merah") {
          void runTelegramBacktestCommand(chatId, "red");
        } else if (command === "/backtest_hijau") {
          void runTelegramBacktestCommand(chatId, "green");
        } else if (command === "/backtest_status") {
          await sendTelegramTo(chatId,
            BACKTEST_RUNNING
              ? "⏳ BACKTEST SEDANG BERJALAN..."
              : `✅ SERVER SIAP. Backtest terakhir: ${LAST_BACKTEST_AT ? LAST_BACKTEST_AT.toLocaleString("id-ID") : "belum ada sejak server aktif"}`
          );
        } else if (command === "/screening") {
          await runTelegramScreeningCommand(chatId);
        } else if (command === "/backtest_detail") {
          const ticker=String(msg.text.trim().split(/\s+/)[1]||"").toUpperCase().replace(/\.JK$/i,"");
          if(!ticker) await sendTelegramTo(chatId,"Gunakan: /backtest_detail KODE\nContoh: /backtest_detail MAYA");
          else { try { const raw=await fs.readFile("output/backtest.json","utf8"); const data=JSON.parse(raw); const rows=(data.trades||[]).filter(x=>String(x.ticker).toUpperCase()===ticker); if(!rows.length) await sendTelegramTo(chatId,`⚠️ Tidak ada trade historis untuk ${ticker}.`); else { let text=`📊 DETAIL BACKTEST ${ticker}\n━━━━━━━━━━━━━━━━━━━━\n`; for(const t of rows.slice(-20)){ const b=formatTradeDetail(t)+"\n━━━━━━━━━━━━━━━━━━━━\n"; if((text+b).length>3500){await sendTelegramTo(chatId,text);text="";} text+=b;} if(text) await sendTelegramTo(chatId,text); } } catch(_) { await sendTelegramTo(chatId,"⚠️ Belum ada output/backtest.json. Jalankan /backtest terlebih dahulu."); } }
        } else if (command === "/backtest_hasil") {
          try {
            const raw = await fs.readFile("output/backtest.json", "utf8");
            const data = JSON.parse(raw);
            const red = data.criteria["MERAH_-1%_SAMPAI_0%"];
            const green = data.criteria["CLOSE_>=_0%"];
            await sendTelegramTo(chatId,
              "📊 HASIL BACKTEST TERAKHIR\n━━━━━━━━━━━━━━━━━━━━\n" +
              formatBacktestCriterion("🔴 MERAH -1% s/d <0%", red) + "\n\n" +
              formatBacktestCriterion("🟢 CLOSE >=0%", green)
            );
          } catch (e) {
            await sendTelegramTo(chatId, "⚠️ Belum ada hasil backtest. Jalankan /backtest terlebih dahulu.");
          }
        }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await sleep(3000);
    }
  }
}

async function main() {
  const shouldRunBacktest = String(process.env.RUN_BACKTEST ?? "1") !== "0";
  const symbols = await loadSymbols();
  if (!symbols.length) throw new Error("Tidak ada saham di symbols.json.");

  console.log(`PFS Scanner V65.1 ADAPTIVE RECOVERY + PFS + EAS + TIMING + TREND + ENTRY Node.js`);
  console.log(`PFS minimum : ${CFG.MIN_SCORE}`);
  console.log(`History     : ${CFG.LOOKBACK_DAYS} trading candles (Yahoo window auto-expanded)`);
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
      const yahooSymbol = ticker.endsWith(".JK") ? ticker : `${ticker}.JK`;
      const stock = await fetchYahooHistory(yahooSymbol);
      console.log(`[${index + 1}/${symbols.length}] ${ticker} -> ${stock.length} candle`);
      return { ticker: ticker.replace(/\.JK$/i, ""), stock };
    },
    CFG.CONCURRENCY
  );

  let backtest = null;
  if (shouldRunBacktest) {
    // V65 ADAPTIVE RECOVERY BACKTEST: dijalankan dari data historis yang sama, tanpa look-ahead.
    console.log("Menjalankan backtest 2 kriteria close...");
    backtest = await runBacktest(fetched, ihsg);
    console.log("Backtest selesai:", JSON.stringify(backtest.criteria, null, 2));
  } else {
    console.log("Mode screening-only: backtest dilewati.");
  }

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
      const eas = calculateEarlyAccumulationScore(stock, calc);
      const trendScore = calculateTrendScore(stock, calc, s);
      const timingScore = calculateTimingScore(stock, calc, s);
      const entry = calculateEntryDecision(s.score, eas.score, trendScore, timingScore);
      const last = stock.at(-1);
      const prev = stock.at(-2);

      results.push({
        ticker,
        dataDate: dateKey(last.date),
        score: s.score,
        pfsSignal: s.signal,
        signal: entry.entryDecision,
        timingScore,
        trendScore,
        entryScore: entry.entryScore,
        entryDecision: entry.entryDecision,
        entryGrade: entry.entryGrade,
        earlyAccumulationScore: eas.score,
        earlyAccumulationLabel: eas.label,
        earlyAccumulationReason: eas.reasons.join(" | "),
        volatility: getVolatilityCategory(s.atrPct),
        close: last.close,
        volume: last.volume,
        rsi: s.rsi,
        rsi14: s.rsi,
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

  // V62 STRICT: semua skor utama menjadi FILTER WAJIB, bukan sekadar ranking.
  // PFS >= 75, EAS >= 55, Trend >= 60, Timing >= 55, Entry >= 70, dan UPTREND.
  // Dengan demikian penambahan skor benar-benar mengurangi kandidat yang lolos.
  const rejectedByStrictFilter = results.filter((r) => {
    const passPFS = r.score >= CFG.QUALIFY_MIN_PFS;
    const passEAS = r.earlyAccumulationScore >= CFG.QUALIFY_MIN_EAS;
    const passTrend = r.trendScore >= CFG.QUALIFY_MIN_TREND;
    const passTiming = r.timingScore >= CFG.QUALIFY_MIN_TIMING;
    const passEntry = r.entryScore >= CFG.QUALIFY_MIN_ENTRY;
    const passTrendQuality = !CFG.REQUIRE_UPTREND || r.trendQuality === "UPTREND";
    return !(passPFS && passEAS && passTrend && passTiming && passEntry && passTrendQuality);
  }).length;

  const qualified = results
    .filter((r) => {
      const passPFS = r.score >= CFG.QUALIFY_MIN_PFS;
      const passEAS = r.earlyAccumulationScore >= CFG.QUALIFY_MIN_EAS;
      const passTrend = r.trendScore >= CFG.QUALIFY_MIN_TREND;
      const passTiming = r.timingScore >= CFG.QUALIFY_MIN_TIMING;
      const passEntry = r.entryScore >= CFG.QUALIFY_MIN_ENTRY;
      const passTrendQuality = !CFG.REQUIRE_UPTREND || r.trendQuality === "UPTREND";
      return passPFS && passEAS && passTrend && passTiming && passEntry && passTrendQuality;
    })
    .sort(
      (a, b) =>
        b.entryScore - a.entryScore ||
        b.score - a.score ||
        b.trendScore - a.trendScore ||
        b.timingScore - a.timingScore ||
        b.earlyAccumulationScore - a.earlyAccumulationScore
    )
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
      rejectedByStrictFilter,
      errors: errors.length,
      results: qualified,
    }, null, 2)
  );

  await fs.writeFile("output/screening.csv", toCSV(qualified));
  await fs.writeFile("output/errors.json", JSON.stringify(errors, null, 2));

  // ============ TELEGRAM FULL SCREENING ============
  const fmtNum = (value, decimals = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };
  const fmtInt = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const fmtPct = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  };
  const cleanText = (value) => {
    if (value === undefined || value === null || value === "") return "-";
    const text = String(value);
    if (text.toLowerCase() === "undefined" || text.toLowerCase() === "null") return "-";
    return text;
  };

  let telegramText =
    "📊 PFS SCREENING IDX - V62 STRICT\n" +
    `Total LOLOS : ${qualified.length}\n` +
    `Filter PFS  : >= ${CFG.QUALIFY_MIN_PFS}\n` +
    `EAS/Timing  : >= ${CFG.QUALIFY_MIN_EAS} / >= ${CFG.QUALIFY_MIN_TIMING}\n` +
    `Trend/Entry : >= ${CFG.QUALIFY_MIN_TREND} / >= ${CFG.QUALIFY_MIN_ENTRY}\n` +
    `Trend wajib : ${CFG.REQUIRE_UPTREND ? "UPTREND" : "TIDAK"}\n` +
    `Dicek       : ${symbols.length}\n` +
    `Berhasil    : ${results.length}\n` +
    `Ditolak     : ${rejectedByStrictFilter}\n` +
    `Error       : ${errors.length}\n` +
    "━━━━━━━━━━━━━━━━━━━━\n";

  if (qualified.length === 0) {
    telegramText += "\n⚠️ TIDAK ADA SAHAM LOLOS FILTER.\n";
    if (errors.length > 0) {
      telegramText += "\nContoh error pertama: " + errors.slice(0, 5).map(e => `${e.ticker}: ${e.error}`).join(" | ");
    } else if (results.length > 0) {
      const top = results.slice(0, 5).map(r => `${r.ticker}=${fmtInt(r.score)}`).join(", ");
      telegramText += `\nTop score di bawah minimum: ${top}`;
    }
  } else {
    telegramText += "\n";
    qualified.forEach((r, i) => {
      telegramText +=
        `${i + 1}. ${r.ticker} | PFS ${fmtInt(r.score)} | ${r.signal || "-"}\n` +
        `🎯 ENTRY    : ${fmtInt(r.entryScore)}/100 | ${cleanText(r.entryDecision)} | Grade ${cleanText(r.entryGrade)}\n` +
        `⏱ TIMING   : ${fmtInt(r.timingScore)}/100\n` +
        `📈 TREND    : ${fmtInt(r.trendScore)}/100 | ${cleanText(r.trendQuality)}\n` +
        `🟢 EAS      : ${fmtInt(r.earlyAccumulationScore)}/100 | ${cleanText(r.earlyAccumulationLabel)}\n` +
        `Vol        : ${cleanText(r.volatility)}\n` +
        `Akum 1D    : ${cleanText(r.accumulation)} | Avg 1D  : ${fmtNum(r.accumulationAvg1d)}\n` +
        `Akum 5D    : ${cleanText(r.accumulation5d)} | Avg 5D  : ${fmtNum(r.accumulationAvg5d)}\n` +
        `Akum 10D   : ${cleanText(r.accumulation10d)} | Avg 10D: ${fmtNum(r.accumulationAvg10d)}\n` +
        `Close      : ${fmtNum(r.close, 0)} | Chg : ${fmtPct(r.changePct)}\n` +
        `RSI14      : ${fmtNum(r.rsi14)}\n` +
        `EMA20      : ${fmtNum(r.ema20)}\n` +
        `EMA50      : ${fmtNum(r.ema50)}\n` +
        `MACD       : ${fmtNum(r.macdHist)}\n` +
        `VOL/AVG20  : ${fmtNum(r.volRatio)}\n` +
        `ATR14      : ${fmtPct(r.atrPct)}\n` +
        `HIGH20     : ${fmtNum(r.high20, 0)}\n` +
        `RSR20/60   : ${fmtInt(r.rsr20)} / ${fmtInt(r.rsr60)}\n` +
        `CANDLE     : ${r.candle || "-"}\n` +
        `TREND      : ${r.trend || "-"}\n` +
        `EAS REASON : ${cleanText(r.earlyAccumulationReason)}\n` +
        "━━━━━━━━━━━━━━━━━━━━\n";
    });
  }

  if (shouldRunBacktest && backtest) {
    const btRed = backtest.criteria["MERAH_-1%_SAMPAI_0%"];
    const btGreen = backtest.criteria["CLOSE_>=_0%"];
    telegramText +=
      "\n🧪 BACKTEST V65 ADAPTIVE RECOVERY - 2 KRITERIA\n" +
      `Target : TP1 +${CFG.RECOVERY_TP1_PCT}% | TP2 +${CFG.RECOVERY_TP2_PCT}% | Horizon ${CFG.BACKTEST_HORIZON_DAYS}D\n` +
       `AD : D1 -${CFG.RECOVERY_AD1_DD_PCT}% | D2 -${CFG.RECOVERY_AD2_DD_PCT}% | Max DD -${CFG.RECOVERY_MAX_DD_PCT}%\n` +
      `🔴 MERAH -1% s/d <0% : ${btRed.signals} | TP1 ${btRed.tp1WinRate.toFixed(1)}% | TP2 ${btRed.tp2WinRate.toFixed(1)}% | REC ${btRed.recoveryRate.toFixed(1)}% | AD ${btRed.averageDownSuccessRate.toFixed(1)}%\n` +
      `🟢 CLOSE >=0%        : ${btGreen.signals} | TP1 ${btGreen.tp1WinRate.toFixed(1)}% | TP2 ${btGreen.tp2WinRate.toFixed(1)}% | REC ${btGreen.recoveryRate.toFixed(1)}% | AD ${btGreen.averageDownSuccessRate.toFixed(1)}%\n` +
      "━━━━━━━━━━━━━━━━━━━━\n";
  }

  const TELEGRAM_LIMIT = 3800;
  for (let i = 0; i < telegramText.length; i += TELEGRAM_LIMIT) {
    await sendTelegram(telegramText.substring(i, i + TELEGRAM_LIMIT));
  }

  console.log("");
  console.log(`Selesai. Dicek: ${symbols.length}`);
  console.log(`Berhasil: ${results.length}`);
  console.log(`STRICT LOLOS: ${qualified.length} | Ditolak filter: ${rejectedByStrictFilter}`);
  console.log(`Error: ${errors.length}`);
  if (shouldRunBacktest && backtest) {
    console.log(`BACKTEST MERAH -1% s/d <0%: ${backtest.criteria["MERAH_-1%_SAMPAI_0%"].signals} sinyal | TP1 WR ${backtest.criteria["MERAH_-1%_SAMPAI_0%"].tp1WinRate.toFixed(1)}%`);
    console.log(`BACKTEST CLOSE >=0%: ${backtest.criteria["CLOSE_>=_0%"].signals} sinyal | TP1 WR ${backtest.criteria["CLOSE_>=_0%"].tp1WinRate.toFixed(1)}%`);
  }
  console.table(
    qualified.slice(0, 20).map((r) => ({
      RANK: r.rank,
      SAHAM: r.ticker,
      PFS: r.score,
      TIMING: r.timingScore,
      TREND: r.trendScore,
      ENTRY: r.entryScore,
      DECISION: r.entryDecision,
      VOL: r.volatility,
      AKUM: r.accumulation,
      RSR20: r.rsr20,
      "VOL/AVG20": Number(r.volRatio).toFixed(2),
    }))
  );
}

const BOT_MODE = String(process.env.BOT_MODE || "").toLowerCase();
const TELEGRAM_ONESHOT = String(process.env.TELEGRAM_ONESHOT || "").toLowerCase();

if (TELEGRAM_ONESHOT === "1" || TELEGRAM_ONESHOT === "true") {
  telegramBotOneShot().catch((error) => {
    console.error("TELEGRAM ONESHOT GAGAL:", error);
    process.exitCode = 1;
  });
} else if (BOT_MODE === "1" || BOT_MODE === "true" || process.argv.includes("--bot")) {
  telegramBotLoop().catch((error) => {
    console.error("TELEGRAM BOT GAGAL:", error);
    process.exitCode = 1;
  });
} else {
  main().catch((error) => {
    console.error("SCREENING GAGAL:", error);
    process.exitCode = 1;
  });
}
