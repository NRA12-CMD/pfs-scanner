// PFS Scanner V66.11 SAFE ENTRY - 50 CANDLE + MACD + ENTRY SAFETY - HIGH WINRATE - GITHUB ACTIONS CONTROLLER - FAST 100D
// PFS Scanner V66 HIGH WINRATE - PFS + EAS + Timing + Trend + Entry + Adaptive Recovery + Telegram Controller
// FIX V64.2: header is valid JavaScript comments; no plain-text title outside comments.
// Converted from V59_PFS_MIN_62_FAST_SCREENING.gs
// Core screening logic preserved; Google Sheets UI/SpreadsheetApp features are removed.
//
// Default:
// - Market: IDX
// - Timeframe: Daily 1D
// - Lookback: 100 trading candles (fetch window expanded to calendar days automatically)
// - Base Minimum PFS: 62
// - STRICT qualification: PFS + EAS + Timing + Trend + Entry Score + Entry Safety + UPTREND
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
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

  // V66 HIGH WINRATE PROFILE
  // Tujuan: menaikkan kualitas sinyal hijau (Close > -1%) dengan filter berlapis.
  // Tidak menjamin WR 90%; angka 90% harus dibuktikan oleh backtest out-of-sample.
  HIGH_WINRATE_MIN_PFS: 85,
  HIGH_WINRATE_MIN_EAS: 75,
  HIGH_WINRATE_MIN_TREND: 80,
  HIGH_WINRATE_MIN_TIMING: 75,
  HIGH_WINRATE_MIN_ENTRY: 85,
  HIGH_WINRATE_MIN_RSR20: 70,
  HIGH_WINRATE_MIN_VOL_RATIO: 1.20,
  HIGH_WINRATE_MIN_ACCUMULATION: 50,
  HIGH_WINRATE_MIN_VOLATILITY_LABEL: "SEDANG",
  HIGH_WINRATE_REQUIRE_MACD_POSITIVE: true,
  HIGH_WINRATE_REQUIRE_BULLISH_CANDLE: true,

  // V65 ADAPTIVE RECOVERY BACKTEST + TELEGRAM CONTROLLER
  BACKTEST_DAYS: 120,
  BACKTEST_HORIZON_DAYS: 10,
  BACKTEST_TP1_PCT: 3.5,
  // V65 Adaptive Recovery: no fixed SL -3% exit.
  RECOVERY_AD1_DD_PCT: 4.0,
  RECOVERY_AD2_DD_PCT: 6.0,
  RECOVERY_MAX_DD_PCT: 8.0,
  RECOVERY_MAX_AD: 2,
  RECOVERY_MIN_PFS: 70,
  RECOVERY_MIN_EAS: 50,
  RECOVERY_MIN_TREND: 55,
  RECOVERY_MIN_TIMING: 45,
  RECOVERY_MIN_ENTRY: 62,
  RECOVERY_TP1_PCT: 3.5,
  BACKTEST_MIN_BARS: 80,

  MAX_RESULTS: 50,
  DISPLAY_DAYS: 20,
  CHART_CANDLES: 50,
  PRICE_CHANNEL_PERIOD: 10,
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

// Harga beli rata-rata akumulasi = volume-weighted typical price ((High+Low+Close)/3)
// dari candle pada periode 1D/5D/10D. Ini bukan data broker summary.
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

  // V66.11: High20 tidak lagi memberi bonus EAS.
  // Kedekatan High20 dipakai khusus untuk menilai keamanan entry,
  // agar EAS tidak mendorong pembelian saham yang sudah terlalu tinggi.
  const obvTrend = Boolean(calc.latest.obvTrend);
  if (obvTrend) { score += 15; reasons.push("OBV mendukung"); }
  else if (Number(calc.latest.obv ?? 0) > 0) score += 5;

  if (rsi >= 50 && rsi <= 68) { score += 10; reasons.push("RSI sehat"); }
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
    obvTrend
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

function calculateEntrySafety(stock, calc, s, eas, trendScore, timingScore, entryScore) {
  const last = stock?.at(-1);
  const prev = stock?.at(-2);
  if (!last || !prev || !calc?.latest) {
    return { safe: false, score: 0, mode: "🔴 AVOID / WAIT", reason: "Data entry tidak cukup", distEma20Pct: null, distHighPct: null };
  }

  const close = Number(last.close);
  const ema20 = Number(calc.latest.ema20 || 0);
  const ema50 = Number(s?.ema50 || calc.latest.ema50 || 0);
  const rsi = Number(s?.rsi || calc.latest.rsi || calcRSI(stock, stock.length - 1, 14));
  const willr = Number(calc.latest.willr ?? -50);
  const macdHist = Number(calc.latest.macdHist || 0);
  const volRatio = Number(s?.volRatio || 0);
  const high20 = Math.max(...stock.slice(-20).map(z => Number(z.high) || 0));
  const distEma20Pct = ema20 > 0 ? ((close / ema20) - 1) * 100 : 999;
  const distHighPct = high20 > 0 ? ((high20 - close) / high20) * 100 : 999;
  const dailyChange = Number(s?.changePct ?? (prev.close ? ((close / Number(prev.close)) - 1) * 100 : 0));
  const range = Number(last.high) - Number(last.low);
  const closeLocation = range > 0 ? (close - Number(last.low)) / range : 0.5;
  const bullish = close > Number(last.open);
  const bearish = close < Number(last.open);
  const uptrend = String(s?.trendQuality || '').toUpperCase() === 'UPTREND';

  // Terlalu jauh dari EMA20 / RSI tinggi / lonjakan candle = jangan kejar.
  const overextended =
    rsi > 72 ||
    distEma20Pct > 8 ||
    (bullish && dailyChange > 4 && distEma20Pct > 5) ||
    (distHighPct <= 0.5 && dailyChange > 3 && volRatio > 1.8);

  let score = 0;
  if (distEma20Pct >= -1 && distEma20Pct <= 3) score += 25;
  else if (distEma20Pct >= -2 && distEma20Pct <= 5) score += 18;
  else if (distEma20Pct <= 7) score += 8;

  if (rsi >= 48 && rsi <= 65) score += 20;
  else if (rsi >= 42 && rsi <= 70) score += 12;

  if (willr >= -80 && willr <= -35) score += 15;
  else if (willr > -90 && willr <= -20) score += 8;

  if (macdHist > 0) score += 15;
  else if (macdHist >= -0.01) score += 7;

  if (volRatio >= 0.8 && volRatio <= 1.8) score += 10;
  else if (volRatio >= 0.6) score += 5;

  if (close >= ema20 && ema20 >= ema50) score += 10;
  else if (close >= ema20) score += 5;

  if (overextended) score -= 30;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const strongQuality = Number(s?.score || 0) >= 85 && Number(eas || 0) >= 75 && Number(trendScore || 0) >= 80 && Number(timingScore || 0) >= 75 && Number(entryScore || 0) >= 85 && uptrend;
  const mediumQuality = Number(s?.score || 0) >= 75 && Number(eas || 0) >= 55 && Number(trendScore || 0) >= 60 && Number(timingScore || 0) >= 55 && Number(entryScore || 0) >= 70 && uptrend;

  if (overextended) {
    return { safe: false, score, mode: "🟡 WAIT PULLBACK", reason: `Terlalu jauh dari EMA20 (${distEma20Pct.toFixed(1)}%) / RSI ${rsi.toFixed(1)}`, distEma20Pct, distHighPct };
  }

  const redPullback = bearish && dailyChange >= -2.5 && distEma20Pct >= -1 && distEma20Pct <= 4 && rsi <= 68 && macdHist >= -0.01 && volRatio >= 0.8 && strongQuality;
  const greenConfirm = bullish && dailyChange <= 4 && distEma20Pct <= 5 && distHighPct <= 4 && volRatio >= 1.0 && macdHist > 0 && strongQuality;

  if (redPullback) return { safe: true, score, mode: "🔥 BUY ON RED PULLBACK", reason: "Pullback sehat, struktur UPTREND masih terjaga", distEma20Pct, distHighPct };
  if (greenConfirm) return { safe: true, score, mode: "🟢 BUY ON GREEN CONFIRMATION", reason: "Konfirmasi bullish + volume mendukung", distEma20Pct, distHighPct };
  if (mediumQuality && score >= 70) return { safe: false, score, mode: "🟡 WAIT / CICIL", reason: "Setup cukup kuat, tunggu harga masuk area aman", distEma20Pct, distHighPct };
  return { safe: false, score, mode: "🔴 AVOID / WAIT", reason: "Kualitas entry belum aman", distEma20Pct, distHighPct };
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


function calculateChartData(stock, candles = CFG.CHART_CANDLES) {
  const src = stock.slice(-candles);
  if (!src.length) return [];

  const closes = stock.map(x => Number(x.close) || 0);
  const ema = (values, period) => {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const out = [];
    let e = values[0];
    out.push(e);
    for (let i = 1; i < values.length; i++) {
      e = values[i] * k + e * (1 - k);
      out.push(e);
    }
    return out;
  };

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  let obv = 0;
  const obvArr = [];
  for (let i = 0; i < stock.length; i++) {
    if (i > 0) {
      if (stock[i].close > stock[i - 1].close) obv += Number(stock[i].volume) || 0;
      else if (stock[i].close < stock[i - 1].close) obv -= Number(stock[i].volume) || 0;
    }
    obvArr.push(obv);
  }

  return src.map((bar, localIndex) => {
    const i = stock.length - src.length + localIndex;
    const start = Math.max(0, i - CFG.PRICE_CHANNEL_PERIOD + 1);
    const window = stock.slice(start, i + 1);
    const pcHigh = Math.max(...window.map(x => Number(x.high) || 0));
    const pcLow = Math.min(...window.map(x => Number(x.low) || 0));
    const rsi14 = calcRSI(stock, i, 14);
    const wrStart = Math.max(0, i - 14 + 1);
    const wrWindow = stock.slice(wrStart, i + 1);
    const wrHigh = Math.max(...wrWindow.map(x => Number(x.high) || 0));
    const wrLow = Math.min(...wrWindow.map(x => Number(x.low) || 0));
    const williamsR14 = wrHigh === wrLow ? -50 : ((wrHigh - Number(bar.close)) / (wrHigh - wrLow)) * -100;
    const ema8all = ema(closes, 8);
    const ema14all = ema(closes, 14);
    const macdLine = ema8all[i] - ema14all[i];
    const macdSeries = stock.map((_, k) => ema8all[k] - ema14all[k]);
    const macdSignalSeries = ema(macdSeries, 9);
    const macdHist = macdLine - macdSignalSeries[i];
    return {
      date: dateKey(bar.date),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume) || 0,
      ema20: Number(ema20[i]),
      ema50: Number(ema50[i]),
      priceChannelHigh10: pcHigh,
      priceChannelLow10: pcLow,
      rsi14: Number(rsi14),
      williamsR14: Number(williamsR14),
      macdLine: Number.isFinite(Number(macdLine)) ? Number(macdLine) : 0,
      macdSignal: Number.isFinite(Number(macdSignalSeries[i])) ? Number(macdSignalSeries[i]) : 0,
      macdHist: Number.isFinite(Number(macdHist)) ? Number(macdHist) : 0,
      obv: Number(obvArr[i]) || 0,
    };
  });
}

function svgEsc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function makeStockChartSVG(ticker, chartData, metrics = {}) {
  if (!chartData?.length) return "";
  const W = 1600, H = 2200;
  const left = 90, right = 45, top = 95, gap = 18;
  const plotW = W - left - right;
  const n = chartData.length;
  const x = i => left + (n === 1 ? plotW / 2 : i * plotW / (n - 1));
  const priceH = 500, rsiH = 150, obvH = 150, wrH = 150, volH = 145;
  const rsiTop = top + priceH + gap;
  const obvTop = rsiTop + rsiH + gap;
  const wrTop = obvTop + obvH + gap;
  const volTop = wrTop + wrH + gap;
  const summaryTop = volTop + volH + 28;

  const allPrices = chartData.flatMap(d => [
    d.high, d.low, d.ema20, d.ema50, d.priceChannelHigh10, d.priceChannelLow10
  ]).filter(Number.isFinite);
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
  const padP = Math.max((maxP - minP) * 0.08, maxP * 0.005 || 1);
  const pMin = minP - padP, pMax = maxP + padP;
  const py = v => top + (pMax - v) / (pMax - pMin) * priceH;

  const ry = v => rsiTop + (100 - Math.max(0, Math.min(100, v))) / 100 * rsiH;
  const wrY = v => wrTop + (-Math.max(-100, Math.min(0, v))) / 100 * wrH;
  const obvs = chartData.map(d => Number(d.obv) || 0);
  const obvMin = Math.min(...obvs), obvMax = Math.max(...obvs);
  const obvPad = Math.max((obvMax - obvMin) * 0.08, 1);
  const obvLo = obvMin - obvPad, obvHi = obvMax + obvPad;
  const oy = v => obvTop + (obvHi - v) / (obvHi - obvLo) * obvH;

  const maxV = Math.max(...chartData.map(d => Number(d.volume) || 0), 1);
  const vy = v => volTop + (maxV - v) / maxV * volH;
  const cw = Math.max(8, Math.min(24, plotW / n * 0.58));

  const line = (key, mapper) => chartData.map((d,i) => {
    const v = Number(d[key]);
    return Number.isFinite(v) ? `${i ? "L" : "M"}${x(i).toFixed(1)},${mapper(v).toFixed(1)}` : "";
  }).filter(Boolean).join(" ");

  const candles = chartData.map((d,i) => {
    const xx=x(i), yO=py(d.open), yC=py(d.close), yH=py(d.high), yL=py(d.low);
    const y=Math.min(yO,yC), h=Math.max(2,Math.abs(yC-yO));
    const up=Number(d.close)>=Number(d.open);
    const body=up ? "#16a34a" : "#ef4444";
    return `<line x1="${xx.toFixed(1)}" y1="${yH.toFixed(1)}" x2="${xx.toFixed(1)}" y2="${yL.toFixed(1)}" stroke="${body}" stroke-width="2"/><rect x="${(xx-cw/2).toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${body}" stroke="${body}"/>`;
  }).join("");

  const volumes = chartData.map((d,i) => {
    const xx=x(i)-cw/2, y=vy(Number(d.volume)||0);
    const body=Number(d.close)>=Number(d.open) ? "#16a34a" : "#ef4444";
    return `<rect x="${xx.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(1,volTop+volH-y).toFixed(1)}" fill="${body}" opacity="0.62"/>`;
  }).join("");

  const grid = (y0,h, qs=[0.25,0.5,0.75]) =>
    qs.map(q=>`<line x1="${left}" y1="${(y0+h*q).toFixed(1)}" x2="${W-right}" y2="${(y0+h*q).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`).join("");

  const labels = chartData.map((d,i) =>
    i % 5 === 0 || i === n-1
      ? `<text x="${x(i).toFixed(1)}" y="${(volTop+volH+22).toFixed(1)}" font-size="16" text-anchor="middle" fill="#4b5563" font-family="Arial">${svgEsc(d.date.slice(5))}</text>`
      : ""
  ).join("");

  const num = (v, dec=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US",{minimumFractionDigits:dec,maximumFractionDigits:dec}) : "-";
  const pct = v => Number.isFinite(Number(v)) ? `${Number(v)>=0?"+":""}${Number(v).toFixed(2)}%` : "-";
  const integer = v => Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("en-US") : "-";
  const last = chartData.at(-1) || {};
  const signal = metrics.entryDecision || "-";
  const score = Number(metrics.pfs ?? 0);
  const scoreLabel = score >= 85 ? "SANGAT BAIK" : score >= 75 ? "BAIK" : score >= 65 ? "CUKUP" : "LEMAH";

  const card = (x0,y0,w,h,title,rows,accent="#0f3d91") => {
    const rowH = Math.max(28, (h-42)/Math.max(rows.length,1));
    return `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="10" fill="#ffffff" stroke="#d1d5db"/>
      <text x="${x0+w/2}" y="${y0+27}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="${accent}">${svgEsc(title)}</text>
      ${rows.map((r,j)=>`<text x="${x0+18}" y="${y0+48+j*rowH}" font-size="17" font-family="Arial" fill="#111827">${svgEsc(r[0])}</text><text x="${x0+w-18}" y="${y0+48+j*rowH}" text-anchor="end" font-size="17" font-family="Arial" font-weight="700" fill="${svgEsc(r[2]||"#111827")}">${svgEsc(r[1])}</text>`).join("")}`;
  };

  const summaryY = summaryTop;
  const gap2 = 14, cols = 3, cardW = (W-left-right-gap2*(cols-1))/cols, cardH = 215;
  const scoreW = cardW;
  const scoreCard = `<rect x="${left}" y="${summaryY}" width="${scoreW}" height="${cardH}" rx="10" fill="#f0fdf4" stroke="#bbf7d0"/>
    <text x="${left+scoreW/2}" y="${summaryY+30}" text-anchor="middle" font-size="19" font-family="Arial" font-weight="700" fill="#166534">PFS (PREDICTIVE FILTER SCORE)</text>
    <text x="${left+scoreW/2}" y="${summaryY+110}" text-anchor="middle" font-size="66" font-family="Arial" font-weight="700" fill="#15803d">${integer(score)}<tspan font-size="30">/100</tspan></text>
    <rect x="${left+scoreW/2-85}" y="${summaryY+132}" width="170" height="38" rx="8" fill="#15803d"/><text x="${left+scoreW/2}" y="${summaryY+158}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="white">${svgEsc(scoreLabel)}</text>
    <text x="${left+scoreW/2}" y="${summaryY+192}" text-anchor="middle" font-size="19" font-family="Arial" font-weight="700" fill="#166534">${svgEsc(signal)}</text>`;

  const scoreCards = [
    ["ENTRY SCORE", `${integer(metrics.entryScore)}/100`, `Grade ${metrics.entryGrade||"-"}`],
    ["EAS", `${integer(metrics.eas)}/100`, metrics.accumulationStatus || metrics.accumulation || "-"],
    ["TIMING", `${integer(metrics.timing)}/100`, "TIMING"],
    ["TREND", `${integer(metrics.trend)}/100`, metrics.trendQuality || "TREND"]
  ];
  const smallW = (W-left-right-gap2*4)/5;
  const scoreRow = scoreCards.map((c,i)=>{
    const x0=left+scoreW+gap2+i*(smallW+gap2);
    return `<rect x="${x0}" y="${summaryY}" width="${smallW}" height="${cardH}" rx="10" fill="#ffffff" stroke="#d1d5db"/>
      <text x="${x0+smallW/2}" y="${summaryY+30}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="#111827">${c[0]}</text>
      <text x="${x0+smallW/2}" y="${summaryY+102}" text-anchor="middle" font-size="48" font-family="Arial" font-weight="700" fill="#111827">${c[1]}</text>
      <text x="${x0+smallW/2}" y="${summaryY+145}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="#166534">${svgEsc(c[2])}</text>`;
  }).join("");

  const row2Y = summaryY + cardH + 16;
  const row3Y = row2Y + 190 + 16;
  const row4Y = row3Y + 160 + 16;

  const cards =
    card(left,row2Y,cardW,190,"MOMENTUM & STRENGTH",[
      ["RSR 20/60",`${integer(metrics.rsr20)} / ${integer(metrics.rsr60)}`],
      ["RSI 14",num(metrics.rsi14)],
      ["WILLIAM %R 14",num(metrics.williamsR14)],
      ["OBV",num(last.obv)],
      ["CANDLE",metrics.candle||"-"]
    ]) +
    card(left+cardW+gap2,row2Y,cardW,190,"AKUMULASI & HARGA BELI",[
      ["Akum 1D",`${metrics.accumulation||"-"} | Avg Beli ${num(metrics.accumulationAvg1d)}`],
      ["Akum 5D",`${metrics.accumulation5d||"-"} | Avg Beli ${num(metrics.accumulationAvg5d)}`],
      ["Akum 10D",`${metrics.accumulation10d||"-"} | Avg Beli ${num(metrics.accumulationAvg10d)}`],
      ["Avg Beli 1D",num(metrics.accumulationAvg1d)],
      ["Avg Beli 5D / 10D",`${num(metrics.accumulationAvg5d)} / ${num(metrics.accumulationAvg10d)}`]
    ]) +
    card(left+2*(cardW+gap2),row2Y,cardW,190,"HARGA & VOLUME",[
      ["CLOSE",integer(metrics.close)],
      ["PERUBAHAN",pct(metrics.changePct)],
      ["VOLUME",num(last.volume,0)],
      ["VOL / AVG20",num(metrics.volRatio)],
      ["ATR 14",pct(metrics.atrPct)]
    ]) +
    card(left,row3Y,cardW,160,"MOVING AVERAGE",[
      ["EMA 20",num(last.ema20)],
      ["EMA 50",num(last.ema50)]
    ]) +
    card(left+cardW+gap2,row3Y,cardW,160,"PRICE CHANNEL 10",[
      ["UPPER",integer(last.priceChannelHigh10)],
      ["MIDDLE",integer((Number(last.priceChannelHigh10)+Number(last.priceChannelLow10))/2)],
      ["LOWER",integer(last.priceChannelLow10)]
    ]) +
    card(left+2*(cardW+gap2),row3Y,cardW,160,"VOLATILITAS & TREND",[
      ["Volatilitas",metrics.volatility||"-"],
      ["Trend",metrics.trendQuality||"-"],
      ["Trend Score",`${integer(metrics.trend)}/100`]
    ]) +
    `<rect x="${left}" y="${row4Y}" width="${W-left-right}" height="115" rx="10" fill="#ffffff" stroke="#d1d5db"/>
      <text x="${left+180}" y="${row4Y+30}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="#0f3d91">CANDLE & POLA</text>
      <text x="${left+180}" y="${row4Y+66}" text-anchor="middle" font-size="20" font-family="Arial" font-weight="700" fill="#15803d">${svgEsc(metrics.candle||"-")}</text>
      <text x="${left+W/2}" y="${row4Y+30}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="#0f3d91">KESIMPULAN</text>
      <text x="${left+W/2}" y="${row4Y+66}" text-anchor="middle" font-size="18" font-family="Arial" fill="#111827">${svgEsc((metrics.reason||"Trend dan momentum berdasarkan filter PFS").slice(0,110))}</text>
      <text x="${W-right-180}" y="${row4Y+30}" text-anchor="middle" font-size="18" font-family="Arial" font-weight="700" fill="#0f3d91">REKOMENDASI</text>
      <text x="${W-right-180}" y="${row4Y+66}" text-anchor="middle" font-size="20" font-family="Arial" font-weight="700" fill="#15803d">${svgEsc(signal)}</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#f8fafc"/>
<rect x="18" y="15" width="${W-36}" height="${H-30}" rx="14" fill="white" stroke="#cbd5e1"/>
<text x="${left}" y="52" font-size="34" font-family="Arial" font-weight="700" fill="#123b8f">${svgEsc(ticker)}</text>
<text x="${left+155}" y="50" font-size="25" font-family="Arial" font-weight="700" fill="#111827">PFS REALTIME SCREENING</text>
<rect x="${W-430}" y="28" width="190" height="42" rx="9" fill="#15803d"/>
<text x="${W-335}" y="57" text-anchor="middle" font-size="20" font-family="Arial" font-weight="700" fill="white">${svgEsc(signal)}</text>
<text x="${W-215}" y="53" font-size="18" font-family="Arial" fill="#374151">${svgEsc(metrics.dataDate||last.date||"-")} | 1D IDX</text>

<text x="${left}" y="82" font-size="18" font-family="Arial" fill="#111827">
O ${integer(last.open)}   H ${integer(last.high)}   L ${integer(last.low)}   C ${integer(last.close)}
<tspan fill="${Number(last.close)>=Number(last.open)?"#15803d":"#dc2626"}">  ${pct(metrics.changePct)}</tspan>
</text>
<text x="${W-right}" y="82" text-anchor="end" font-size="18" font-family="Arial" font-weight="700" fill="#111827">50 CANDLE TERAKHIR</text>

${grid(top,priceH)}
${candles}
<path d="${line('priceChannelHigh10',py)}" fill="none" stroke="#7c3aed" stroke-width="2"/>
<path d="${line('priceChannelLow10',py)}" fill="none" stroke="#7c3aed" stroke-width="2"/>
<path d="${line('ema20',py)}" fill="none" stroke="#2563eb" stroke-width="3"/>
<path d="${line('ema50',py)}" fill="none" stroke="#f59e0b" stroke-width="3"/>
<text x="${left+8}" y="${top+24}" font-size="17" font-family="Arial" font-weight="700" fill="#2563eb">EMA20 ${num(last.ema20)}</text>
<text x="${left+190}" y="${top+24}" font-size="17" font-family="Arial" font-weight="700" fill="#f59e0b">EMA50 ${num(last.ema50)}</text>
<text x="${left+390}" y="${top+24}" font-size="17" font-family="Arial" font-weight="700" fill="#7c3aed">PRICE CHANNEL 10</text>
${volumes}

<line x1="${left}" y1="${ry(70)}" x2="${W-right}" y2="${ry(70)}" stroke="#c4b5fd" stroke-dasharray="6 5"/>
<line x1="${left}" y1="${ry(30)}" x2="${W-right}" y2="${ry(30)}" stroke="#c4b5fd" stroke-dasharray="6 5"/>
<path d="${line('rsi14',ry)}" fill="none" stroke="#7c3aed" stroke-width="3"/>
<text x="${left+10}" y="${rsiTop+25}" font-size="18" font-family="Arial" font-weight="700">RSI 14 <tspan fill="#7c3aed">${num(last.rsi14)}</tspan></text>

${grid(obvTop,obvH)}
<path d="${line('obv',oy)}" fill="none" stroke="#2563eb" stroke-width="3"/>
<text x="${left+10}" y="${obvTop+25}" font-size="18" font-family="Arial" font-weight="700">OBV <tspan fill="#2563eb">${num(last.obv)}</tspan></text>

<line x1="${left}" y1="${wrY(-20)}" x2="${W-right}" y2="${wrY(-20)}" stroke="#c4b5fd" stroke-dasharray="6 5"/>
<line x1="${left}" y1="${wrY(-80)}" x2="${W-right}" y2="${wrY(-80)}" stroke="#c4b5fd" stroke-dasharray="6 5"/>
<path d="${line('williamsR14',wrY)}" fill="none" stroke="#7c3aed" stroke-width="3"/>
<text x="${left+10}" y="${wrTop+25}" font-size="18" font-family="Arial" font-weight="700">WILLIAMS %R 14 <tspan fill="#7c3aed">${num(last.williamsR14)}</tspan></text>

<text x="${left+10}" y="${volTop+25}" font-size="18" font-family="Arial" font-weight="700">VOLUME <tspan fill="#15803d">${num(last.volume,0)}</tspan></text>
${labels}

${scoreCard}${scoreRow}
${cards}
<text x="${left}" y="${H-15}" font-size="15" font-family="Arial" fill="#64748b">Data diambil saat screening • 50 candle • EMA20 • EMA50 • Price Channel 10 • RSI14 • OBV • Williams %R 14 • MACD • Volume</text>
</svg>`;
}

async function ensureSharp() {
  try {
    return (await import("sharp")).default;
  } catch (_) {
    console.log("sharp belum tersedia. Menginstall sharp otomatis...");
    await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", [
      "install", "--no-save", "--no-package-lock", "sharp"
    ], { timeout: 180000 });
    return (await import("sharp")).default;
  }
}

function qcSafeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function quickChartMainConfig(ticker, chartData) {
  const labels = chartData.map((_, i) => String(i + 1));
  const candles = chartData.map((d, i) => ({
    x: i + 1,
    o: qcSafeNumber(d.open), h: qcSafeNumber(d.high),
    l: qcSafeNumber(d.low), c: qcSafeNumber(d.close)
  }));
  const line = (label, field, borderColor, dash = []) => ({
    type: "line", label, data: chartData.map((d, i) => ({ x: i + 1, y: qcSafeNumber(d[field], null) })),
    borderColor, borderWidth: 2, pointRadius: 0, fill: false, tension: 0.15,
    borderDash: dash
  });
  return {
    type: "candlestick",
    data: { labels, datasets: [
      { label: "Harga", data: candles, borderColor: "#222", color: { up: "#16a34a", down: "#dc2626", unchanged: "#64748b" } },
      line("EMA20", "ema20", "#2563eb"),
      line("EMA50", "ema50", "#f59e0b"),
      line("PC10 HIGH", "priceChannelHigh10", "#7c3aed", [5, 4]),
      line("PC10 LOW", "priceChannelLow10", "#7c3aed", [5, 4])
    ]},
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: true, position: "top", labels: { font: { size: 18 } } },
        title: { display: true, text: `${ticker} | 50 CANDLE | EMA20/50 | PRICE CHANNEL 10`, font: { size: 28, weight: "bold" } }
      },
      scales: {
        x: { type: "linear", min: 1, max: labels.length, ticks: { stepSize: 5, font: { size: 12 } }, grid: { display: false } },
        y: { position: "left", ticks: { font: { size: 14 } } }
      }
    }
  };
}

function quickChartOscConfig(ticker, chartData) {
  const labels = chartData.map((_, i) => String(i + 1));
  return {
    type: "line",
    data: { labels, datasets: [
      { label: "RSI14", data: chartData.map(d => qcSafeNumber(d.rsi14, null)), borderColor: "#2563eb", borderWidth: 3, pointRadius: 0, tension: 0.15 },
      { label: "Williams %R14", data: chartData.map(d => qcSafeNumber(d.williamsR14, null)), borderColor: "#9333ea", borderWidth: 3, pointRadius: 0, tension: 0.15 },
      { label: "RSI 70", data: chartData.map(() => 70), borderColor: "#dc2626", borderDash: [6,4], pointRadius: 0, borderWidth: 1 },
      { label: "RSI 30", data: chartData.map(() => 30), borderColor: "#16a34a", borderDash: [6,4], pointRadius: 0, borderWidth: 1 },
      { label: "W%R -20", data: chartData.map(() => -20), borderColor: "#dc2626", borderDash: [4,4], pointRadius: 0, borderWidth: 1 },
      { label: "W%R -80", data: chartData.map(() => -80), borderColor: "#16a34a", borderDash: [4,4], pointRadius: 0, borderWidth: 1 }
    ]},
    options: {
      responsive: false, animation: false,
      plugins: { legend: { position: "top", labels: { font: { size: 16 } } }, title: { display: true, text: `${ticker} | RSI14 + WILLIAMS %R14`, font: { size: 24, weight: "bold" } } },
      scales: { x: { ticks: { font: { size: 12 } } }, y: { min: -100, max: 100, ticks: { font: { size: 14 } } } }
    }
  };
}

function quickChartVolumeObvConfig(ticker, chartData) {
  const labels = chartData.map((_, i) => String(i + 1));
  return {
    type: "line",
    data: { labels, datasets: [
      { label: "OBV", data: chartData.map(d => qcSafeNumber(d.obv, null)), borderColor: "#0891b2", borderWidth: 3, pointRadius: 0, tension: 0.15, yAxisID: "yObv" },
      { label: "Volume", data: chartData.map(d => qcSafeNumber(d.volume, null)), type: "bar", backgroundColor: "rgba(100,116,139,0.35)", borderColor: "rgba(100,116,139,0.5)", yAxisID: "yVol" }
    ]},
    options: {
      responsive: false, animation: false,
      plugins: { legend: { position: "top", labels: { font: { size: 16 } } }, title: { display: true, text: `${ticker} | OBV + VOLUME`, font: { size: 24, weight: "bold" } } },
      scales: {
        x: { ticks: { font: { size: 12 } } },
        yObv: { position: "left", ticks: { font: { size: 14 } } },
        yVol: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { font: { size: 14 } } }
      }
    }
  };
}


function quickChartMACDConfig(ticker, chartData) {
  const labels = chartData.map((d) => d.date || '');
  const hist = chartData.map(d => qcSafeNumber(d.macdHist, null));
  const macdLine = chartData.map(d => qcSafeNumber(d.macdLine, null));
  const signalLine = chartData.map(d => qcSafeNumber(d.macdSignal, null));
  return {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'MACD Histogram', data: hist, backgroundColor: hist.map(v => Number(v) >= 0 ? 'rgba(22,163,74,0.65)' : 'rgba(220,38,38,0.65)'), borderWidth: 0, order: 3 },
      { label: 'MACD Line', data: macdLine, type: 'line', borderColor: '#2563eb', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.15, order: 1 },
      { label: 'Signal 9', data: signalLine, type: 'line', borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.15, order: 2 }
    ]},
    options: {
      responsive: false, animation: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 16 } } }, title: { display: true, text: `${ticker} | MACD (12,26,9)`, font: { size: 24, weight: 'bold' } } },
      scales: {
        x: { ticks: { font: { size: 11 }, maxTicksLimit: 10 } },
        y: { ticks: { font: { size: 14 } }, grid: { color: 'rgba(148,163,184,0.25)' } }
      }
    }
  };
}

async function quickChartPNG(config, width = 1600, height = 720) {
  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "4",
      width, height, devicePixelRatio: 1,
      format: "png", backgroundColor: "white", chart: config
    })
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.length < 1000) {
    let detail = "";
    try { detail = buffer.toString("utf8").slice(0, 500); } catch (_) {}
    throw new Error(`QuickChart HTTP ${response.status}: ${detail}`);
  }
  return buffer;
}

function metricsPanelSVG(ticker, metrics) {
  const esc = (v) => String(v ?? "-")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const num = (v, d=2) => Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d}) : "-";
  const integer = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("en-US") : "-";
  const pct = (v) => Number.isFinite(Number(v)) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%` : "-";

  // V66.7: warna filter dibuat berdasarkan kekuatan filter.
  // HIJAU = KUAT, KUNING = SEDANG, MERAH = LEMAH.
  const bandScore = (value, strong, medium) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return { bg:"#f3f4f6", border:"#d1d5db", fg:"#6b7280" };
    if (n >= strong) return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if (n >= medium) return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const bandLabel = (value) => {
    const v = String(value ?? "").toUpperCase();
    if (!v) return { bg:"#f3f4f6", border:"#d1d5db", fg:"#6b7280" };
    if (/(KUAT|TOP|A\+|\bA\b|EARLY ACCUMULATION|UPTREND|BULLISH|POSITIF|SEHAT)/.test(v))
      return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if (/(SEDANG|CUKUP|MIXED|MULAI|AKUMULASI AWAL|WATCHLIST|CICIL|GRADE B|NETRAL)/.test(v))
      return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const bandChange = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return bandLabel(v);
    if (n > 0.5) return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if (n >= -0.5) return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const bandRSI = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return bandLabel(v);
    if (n >= 50 && n <= 70) return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if ((n >= 45 && n < 50) || (n > 70 && n <= 75)) return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const bandMACD = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return bandLabel(v);
    if (n > 0) return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if (n >= -0.01) return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const bandVolRatio = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return bandLabel(v);
    if (n >= 1.2) return { bg:"#dcfce7", border:"#86efac", fg:"#166534" };
    if (n >= 1.0) return { bg:"#fef9c3", border:"#fde047", fg:"#854d0e" };
    return { bg:"#fee2e2", border:"#fca5a5", fg:"#991b1b" };
  };

  const scoreLabel = (n, strong, medium) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return "-";
    if (v >= strong) return "KUAT";
    if (v >= medium) return "SEDANG";
    return "LEMAH";
  };

  const rawEntryMode = String(metrics.entryMode || "🟡 WAIT / CICIL");
  const entryMode = rawEntryMode.includes("RED PULLBACK")
    ? { label: rawEntryMode, detail: String(metrics.entrySafetyReason || "Pullback sehat"), bg: "#dcfce7", border: "#16a34a", fg: "#166534" }
    : rawEntryMode.includes("GREEN CONFIRMATION")
      ? { label: rawEntryMode, detail: String(metrics.entrySafetyReason || "Konfirmasi bullish"), bg: "#dcfce7", border: "#16a34a", fg: "#166534" }
      : rawEntryMode.includes("WAIT PULLBACK") || rawEntryMode.includes("WAIT / CICIL")
        ? { label: rawEntryMode, detail: String(metrics.entrySafetyReason || "Tunggu area entry aman"), bg: "#fef9c3", border: "#eab308", fg: "#854d0e" }
        : { label: rawEntryMode, detail: String(metrics.entrySafetyReason || "Entry belum aman"), bg: "#fee2e2", border: "#ef4444", fg: "#991b1b" };
  const entryCategoryStyle = (category) => {
    if (category === "A") return { bg:"#dcfce7", border:"#16a34a", fg:"#166534" };
    if (category === "B") return { bg:"#fef9c3", border:"#eab308", fg:"#854d0e" };
    if (category === "C") return { bg:"#dbeafe", border:"#60a5fa", fg:"#1d4ed8" };
    return { bg:"#fee2e2", border:"#ef4444", fg:"#991b1b" };
  };

  const cards = [
    ["PFS", `${integer(metrics.pfs)}/100`, scoreLabel(metrics.pfs,85,75), bandScore(metrics.pfs,85,75)],
    ["ENTRY", `${integer(metrics.entryScore)}/100`, `${esc(metrics.entryGrade || "-")} · ${esc(metrics.entryDecision || "-")}`, bandScore(metrics.entryScore,85,70)],
    ["EAS", `${integer(metrics.eas)}/100`, scoreLabel(metrics.eas,75,55), bandScore(metrics.eas,75,55)],
    ["TIMING", `${integer(metrics.timing)}/100`, scoreLabel(metrics.timing,75,55), bandScore(metrics.timing,75,55)],
    ["TREND", `${integer(metrics.trend)}/100`, esc(metrics.trendQuality || scoreLabel(metrics.trend,80,60)), bandScore(metrics.trend,80,60)],
    ["RSR20 / 60", `${integer(metrics.rsr20)} / ${integer(metrics.rsr60)}`, Number(metrics.rsr20)>=70 ? "KUAT" : Number(metrics.rsr20)>=60 ? "SEDANG" : "LEMAH", bandScore(metrics.rsr20,70,60)],
    ["AKUMULASI 1D", esc(metrics.accumulation || "-"), `Avg Beli ${num(metrics.accumulationAvg1d)} · Score ${integer(metrics.accumulationScore)}`, bandScore(metrics.accumulationScore,75,55)],
    ["AKUMULASI 5D", esc(metrics.accumulation5d || "-"), `Avg Beli ${num(metrics.accumulationAvg5d)} · Score ${integer(metrics.accumulation5dScore)}`, bandScore(metrics.accumulation5dScore,75,55)],
    ["AKUMULASI 10D", esc(metrics.accumulation10d || "-"), `Avg Beli ${num(metrics.accumulationAvg10d)} · Score ${integer(metrics.accumulation10dScore)}`, bandScore(metrics.accumulation10dScore,75,55)],
    ["VOLATILITAS", esc(metrics.volatility), `${num(metrics.atrPct)}% ATR14`, bandLabel(metrics.volatility)],
    ["RSI14", num(metrics.rsi14), Number(metrics.rsi14)>=50 && Number(metrics.rsi14)<=70 ? "SEHAT" : Number(metrics.rsi14)>=45 ? "SEDANG" : "LEMAH", bandRSI(metrics.rsi14)],
    ["MACD", num(metrics.macdHist), Number(metrics.macdHist)>0 ? "POSITIF" : Number(metrics.macdHist)>=-0.01 ? "NETRAL" : "NEGATIF", bandMACD(metrics.macdHist)],
    ["VOL / AVG20", num(metrics.volRatio), Number(metrics.volRatio)>=1.2 ? "KUAT" : Number(metrics.volRatio)>=1 ? "SEDANG" : "LEMAH", bandVolRatio(metrics.volRatio)],
    ["CANDLE", esc(metrics.candle), "KONDISI", bandLabel(metrics.candle)],
    ["PERUBAHAN", pct(metrics.changePct), Number(metrics.changePct)>0.5 ? "KUAT" : Number(metrics.changePct)>=-0.5 ? "SEDANG" : "LEMAH", bandChange(metrics.changePct)],
    ["TREND", esc(metrics.trend || metrics.trendQuality), "STATUS", bandLabel(metrics.trend || metrics.trendQuality)],
    ["ENTRY MODE", esc(entryMode.label), esc(entryMode.detail), { bg: entryMode.bg, border: entryMode.border, fg: entryMode.fg }],
    ["ENTRY LEVEL", esc(metrics.entryCategoryLabel || "-"), esc(metrics.entryCategory === "A" ? "Prioritas / harga masih sehat" : `Agresif ${num(metrics.entryAggressive)} · ⭐ Ideal ${num(metrics.entryIdeal)} · Konservatif ${num(metrics.entryConservative)}`), entryCategoryStyle(metrics.entryCategory)]
  ];

  const W = 1600, H = 760;
  const margin = 28, gap = 12, cols = 4;
  const cardW = (W - margin*2 - gap*(cols-1)) / cols;
  const cardH = 88;
  const startY = 72;

  const cardSVG = (item, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const x = margin + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    const [title, value, sub, c] = item;
    const special = title === "ENTRY MODE" || title === "ENTRY LEVEL";
    if (special) {
      // V66.12 FIX: jangan menaruh value dan sub pada baris yang sama.
      // Label ENTRY MODE/LEVEL bisa panjang sehingga sebelumnya saling menimpa.
      const safeValue = String(value || "-");
      const safeSub = String(sub || "-");
      return `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${c.bg}" stroke="${c.border}" stroke-width="2"/>
        <text x="${x+16}" y="${y+22}" font-family="Arial" font-size="16" font-weight="700" fill="#374151">${title}</text>
        <text x="${x+16}" y="${y+51}" font-family="Arial" font-size="19" font-weight="700" fill="${c.fg}">${safeValue}</text>
        <text x="${x+16}" y="${y+75}" font-family="Arial" font-size="11" font-weight="600" fill="${c.fg}">${safeSub}</text>`;
    }
    return `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${c.bg}" stroke="${c.border}" stroke-width="2"/>
      <text x="${x+16}" y="${y+23}" font-family="Arial" font-size="16" font-weight="700" fill="#374151">${title}</text>
      <text x="${x+16}" y="${y+53}" font-family="Arial" font-size="25" font-weight="700" fill="${c.fg}">${value}</text>
      <text x="${x+cardW-16}" y="${y+53}" text-anchor="end" font-family="Arial" font-size="13" font-weight="700" fill="${c.fg}">${sub}</text>`;
  };

  const legendY = 735;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#ffffff"/>
    <text x="${margin}" y="38" font-family="Arial" font-size="25" font-weight="700" fill="#111827">${esc(ticker)} — PANEL FILTER</text>
    <text x="${W-margin}" y="38" text-anchor="end" font-family="Arial" font-size="16" fill="#6b7280">Data ${esc(metrics.dataDate || "-")}</text>
    ${cards.map(cardSVG).join("")}
    <circle cx="${margin+8}" cy="${legendY}" r="7" fill="#22c55e"/><text x="${margin+22}" y="${legendY+6}" font-family="Arial" font-size="15" fill="#166534" font-weight="700">KUAT</text>
    <circle cx="${margin+100}" cy="${legendY}" r="7" fill="#eab308"/><text x="${margin+114}" y="${legendY+6}" font-family="Arial" font-size="15" fill="#854d0e" font-weight="700">SEDANG</text>
    <circle cx="${margin+210}" cy="${legendY}" r="7" fill="#ef4444"/><text x="${margin+224}" y="${legendY+6}" font-family="Arial" font-size="15" fill="#991b1b" font-weight="700">LEMAH</text>
    <text x="${W-margin}" y="${legendY+6}" text-anchor="end" font-family="Arial" font-size="14" fill="#6b7280">EMA20 ${num(metrics.ema20)} · EMA50 ${num(metrics.ema50)} · PC10 · RSI14 · OBV · W%R14 · MACD · Volume</text>
  </svg>`;
}


function calculateEntryMode(r) {
  const pfs = Number(r?.score ?? r?.pfs ?? 0);
  const entry = Number(r?.entryScore ?? 0);
  const eas = Number(r?.earlyAccumulationScore ?? r?.eas ?? 0);
  const timing = Number(r?.timingScore ?? r?.timing ?? 0);
  const trend = Number(r?.trendScore ?? r?.trend ?? 0);
  const volRatio = Number(r?.volRatio ?? 0);
  const uptrend = String(r?.trendQuality || '').toUpperCase() === 'UPTREND';
  const candle = String(r?.candle || '').toUpperCase();
  const strong = pfs >= 85 && entry >= 85 && eas >= 75 && timing >= 75 && trend >= 80 && uptrend;
  const medium = pfs >= 75 && entry >= 70 && eas >= 55 && timing >= 55 && trend >= 60 && uptrend;
  const redPullback = candle === 'BEARISH' && strong && volRatio >= 0.8;
  const greenConfirm = candle === 'BULLISH' && strong && volRatio >= 1.0;
  if (redPullback) return { label: '🔥 BUY ON RED PULLBACK', detail: 'Pullback sehat dalam UPTREND', bg: '#dcfce7', border: '#16a34a', fg: '#166534' };
  if (greenConfirm) return { label: '🟢 BUY ON GREEN CONFIRMATION', detail: 'Konfirmasi bullish + volume mendukung', bg: '#dcfce7', border: '#16a34a', fg: '#166534' };
  if (medium) return { label: '🟡 WAIT / CICIL', detail: 'Filter cukup kuat, tunggu konfirmasi', bg: '#fef9c3', border: '#eab308', fg: '#854d0e' };
  return { label: '🔴 AVOID / WAIT', detail: 'Filter belum cukup kuat', bg: '#fee2e2', border: '#ef4444', fg: '#991b1b' };
}


function calculateIdealEntryPlan(stock, calc, s) {
  const last = stock?.at(-1);
  if (!last || !calc?.latest) return { category: "C", label: "🔵 C — WAIT PULLBACK", aggressive: null, ideal: null, conservative: null, zoneLow: null, zoneHigh: null, reason: "Data harga tidak cukup" };
  const close = Number(last.close);
  const ema20 = Number(calc.latest.ema20 || 0);
  const ema50 = Number(s?.ema50 || 0);
  const pcStart = Math.max(0, stock.length - CFG.PRICE_CHANNEL_PERIOD);
  const pcWindow = stock.slice(pcStart);
  const pcLow = pcWindow.length ? Math.min(...pcWindow.map(x => Number(x.low) || Infinity)) : null;
  const low5 = stock.slice(-5).reduce((m, x) => Math.min(m, Number(x.low) || m), Infinity);
  const low10 = stock.slice(-10).reduce((m, x) => Math.min(m, Number(x.low) || m), Infinity);
  const atr14 = calcATR(stock, stock.length - 1, 14);

  const supports = [ema20, ema50, pcLow, low5, low10]
    .filter(v => Number.isFinite(v) && v > 0 && v < close)
    .sort((a,b) => b-a);
  const nearest = supports[0] ?? ema20 ?? close;
  const second = supports[1] ?? ema50 ?? nearest;
  const lowest = supports.length ? supports[supports.length - 1] : Math.max(0, close - atr14);

  // Tiga level dibuat sebagai catatan zona, bukan jaminan harga pasti.
  const aggressive = nearest;
  const ideal = supports.length >= 2 ? (nearest + second) / 2 : Math.max(0, nearest - atr14 * 0.25);
  const conservativeBase = Math.min(lowest, ema50 > 0 ? ema50 : lowest);
  const conservative = Math.max(0, Math.min(ideal - Math.max(atr14 * 0.25, ideal * 0.005), conservativeBase));
  const zoneLow = Math.min(conservative, ideal);
  const zoneHigh = Math.max(aggressive, ideal);

  const pfs = Number(s?.score || 0);
  const eas = Number(s?.earlyAccumulationScore || 0);
  const trend = Number(s?.trendScore || 0);
  const timing = Number(s?.timingScore || 0);
  const entry = Number(s?.entryScore || 0);
  const safety = Number(s?.entrySafetyScore || 0);
  const overextended = Boolean(s?.entryMode && String(s.entryMode).includes("WAIT PULLBACK"));

  // A = setup sangat kuat + harga relatif aman.
  if (pfs >= 80 && eas >= 70 && trend >= 75 && timing >= 70 && entry >= 80 && safety >= 70 && !overextended) {
    return {
      category: "A", label: "🟢 A — ENTRY AMAN / PRIORITAS", aggressive: null, ideal: null, conservative: null,
      zoneLow: null, zoneHigh: null, reason: "Setup kuat dan harga masih dalam area entry sehat"
    };
  }

  // B = setup memenuhi baseline dan harga masih cukup layak untuk cicil/konfirmasi.
  if (pfs >= 75 && eas >= 55 && trend >= 60 && timing >= 55 && entry >= 70 && safety >= 55 && !overextended) {
    return {
      category: "B", label: "🟡 B — CICIL / KONFIRMASI", aggressive: aggressive, ideal: ideal, conservative: conservative,
      zoneLow, zoneHigh, reason: "Setup cukup kuat; entry bertahap dan tunggu konfirmasi"
    };
  }

  // C = setup masih menarik tetapi harga/timing belum ideal. Simpan zona harga untuk catatan beli.
  return {
    category: "C", label: "🔵 C — WAIT PULLBACK", aggressive, ideal, conservative, zoneLow, zoneHigh,
    reason: overextended ? "Harga terlalu jauh/tinggi; tunggu pullback ke zona support" : "Setup belum ideal untuk dikejar; tunggu harga masuk zona entry"
  };
}

function formatEntryPlanText(plan) {
  if (!plan) return "-";
  if (plan.category === "A") return `${plan.label}`;
  return `${plan.label} | Agresif ${formatPrice(plan.aggressive)} | Ideal ${formatPrice(plan.ideal)} | Konservatif ${formatPrice(plan.conservative)}`;
}

async function renderTelegramChartPNG(ticker, chartData, metrics = {}) {
  if (!Array.isArray(chartData) || chartData.length < 5) return null;
  // V66.9: pastikan nilai rata-rata pembelian akumulasi tersedia di panel Telegram.
  if (!Number.isFinite(Number(metrics.accumulationAvg1d))) metrics.accumulationAvg1d = accumulationAverage(chartData, 1);
  if (!Number.isFinite(Number(metrics.accumulationAvg5d))) metrics.accumulationAvg5d = accumulationAverage(chartData, 5);
  if (!Number.isFinite(Number(metrics.accumulationAvg10d))) metrics.accumulationAvg10d = accumulationAverage(chartData, 10);
  const sharp = await ensureSharp();
  const main = await quickChartPNG(quickChartMainConfig(ticker, chartData), 1600, 760);
  const osc = await quickChartPNG(quickChartOscConfig(ticker, chartData), 1600, 430);
  const vol = await quickChartPNG(quickChartVolumeObvConfig(ticker, chartData), 1600, 420);
  const macd = await quickChartPNG(quickChartMACDConfig(ticker, chartData), 1600, 350);
  const panel = await sharp(Buffer.from(metricsPanelSVG(ticker, metrics))).png().toBuffer();
  const final = await sharp({ create: { width: 1600, height: 2720, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([
      { input: main, top: 0, left: 0 },
      { input: osc, top: 760, left: 0 },
      { input: vol, top: 1190, left: 0 },
      { input: macd, top: 1610, left: 0 },
      { input: panel, top: 1960, left: 0 }
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();
  if (final.length < 1000) throw new Error("PNG dashboard hasil QuickChart kosong.");
  const safe = String(ticker).replace(/[^A-Za-z0-9_-]/g, "_");
  const pngFile = `output/charts/${safe}_TELEGRAM.png`;
  await fs.writeFile(pngFile, final);
  return final;
}

async function sendTelegramPhoto(chatId, imageBuffer, caption = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN/CHAT_ID belum diatur");
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 1000) {
    throw new Error("Buffer PNG chart tidak valid atau kosong");
  }
  if (imageBuffer.length > 9_500_000) {
    throw new Error(`PNG chart terlalu besar: ${(imageBuffer.length / 1048576).toFixed(2)} MB`);
  }

  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 1024));
  form.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'PFS_REALTIME.png');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch (_) { throw new Error(`Telegram sendPhoto HTTP ${response.status}: ${raw.slice(0,200)}`); }
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram sendPhoto HTTP ${response.status}`);
  }
  return result.result;
}

function telegramStockCaption(r) {
  return [
    `📊 ${r.ticker} | PFS REALTIME`,
    `PFS ${fmtTelegramInt(r.score)}/100 | ${r.signal || '-'}`,
    `ENTRY ${fmtTelegramInt(r.entryScore)}/100 | ${r.entryDecision || '-'} | Grade ${r.entryGrade || '-'}`,
    `${r.entryCategoryLabel || r.entryMode || '🔴 AVOID / WAIT'} | Safety ${fmtTelegramInt(r.entrySafetyScore)}/100`,
    r.entryCategory === 'A' ? `🎯 Entry A: harga masih sehat untuk prioritas/cicil` : `🎯 Harga Catatan: Agresif ${fmtTelegramNum(r.entryAggressive,0)} | Ideal ${fmtTelegramNum(r.entryIdeal,0)} | Konservatif ${fmtTelegramNum(r.entryConservative,0)}`,
    `EAS ${fmtTelegramInt(r.earlyAccumulationScore)} | Timing ${fmtTelegramInt(r.timingScore)} | Trend ${fmtTelegramInt(r.trendScore)}`,
    `RSI14 ${fmtTelegramNum(r.rsi14)} | OBV ${fmtTelegramNum(r.obv)} | W%R14 ${fmtTelegramNum(r.williamsR14)}`,
    `EMA20 ${fmtTelegramNum(r.ema20)} | EMA50 ${fmtTelegramNum(r.ema50)} | Vol/Avg20 ${fmtTelegramNum(r.volRatio)}x`,
    `Akum 1D ${r.accumulation||'-'} | 5D ${r.accumulation5d||'-'} | 10D ${r.accumulation10d||'-'}`,
    `Close ${fmtTelegramNum(r.close,0)} | Chg ${fmtTelegramPct(r.changePct)} | ${r.trendQuality||'-'}`,
    `🖼 Chart 50 candle: EMA20/50 + PC10 + RSI14 + OBV + Williams %R14 + MACD + Volume`
  ].join('\n');
}

const fmtTelegramNum = (value, decimals = 2) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : '-';
};
const fmtTelegramInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toString() : '-';
};
const fmtTelegramPct = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '-';
};

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
    "RANK","SAHAM","PFS","TIMING_SCORE","TREND_SCORE","ENTRY_SCORE","ENTRY_DECISION","ENTRY_GRADE","ENTRY_SAFETY_SCORE","ENTRY_SAFETY","ENTRY_MODE","ENTRY_CATEGORY","ENTRY_CATEGORY_LABEL","ENTRY_AGGRESSIVE","ENTRY_IDEAL","ENTRY_CONSERVATIVE","SIGNAL","VOLATILITAS","EAS","EARLY_ACCUMULATION",
    "AKUMULASI_1D","RATA_AKUMULASI_1D","AKUMULASI_5D","RATA_AKUMULASI_5D",
    "AKUMULASI_10D","RATA_AKUMULASI_10D","CLOSE","PERUBAHAN_PCT",
    "RSI14","EMA20","EMA50","MACD_HIST","VOL_VS_AVG20","ATR14_PCT",
    "20D_HIGH","RSR20","RSR60","CANDLE","TREND","ALASAN","CHART_50_CANDLE"
  ];

  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return `"${s.replaceAll('"', '""')}"`;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.rank, r.ticker, r.score, r.timingScore, r.trendScore, r.entryScore, r.entryDecision, r.entryGrade, r.entrySafetyScore, r.entrySafety, r.entryMode, r.entryCategory, r.entryCategoryLabel, r.entryAggressive, r.entryIdeal, r.entryConservative, r.signal, r.volatility, r.earlyAccumulationScore, r.earlyAccumulationLabel,
      r.accumulation, r.accumulationAvg1d, r.accumulation5d,
      r.accumulationAvg5d, r.accumulation10d, r.accumulationAvg10d,
      r.close, r.changePct, r.rsi, r.ema20, r.ema50, r.macdHist,
      r.volRatio, r.atrPct, r.high20, r.rsr20, r.rsr60,
      r.candle, r.trend, r.reason, r.chart50File
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

function highWinratePass(stock, calc, s, eas, trendScore, timingScore, entry) {
  const x = calc.latest;
  const last = stock.at(-1);
  const prev = stock.at(-2);
  if (!x || !last || !prev) return { pass: false, reasons: ["DATA_TIDAK_LENGKAP"] };

  const bullishCandle = last.close > last.open && last.close > prev.close;
  const checks = [
    [s.score >= CFG.HIGH_WINRATE_MIN_PFS, `PFS>=${CFG.HIGH_WINRATE_MIN_PFS}`],
    [eas.score >= CFG.HIGH_WINRATE_MIN_EAS, `EAS>=${CFG.HIGH_WINRATE_MIN_EAS}`],
    [trendScore >= CFG.HIGH_WINRATE_MIN_TREND, `TREND>=${CFG.HIGH_WINRATE_MIN_TREND}`],
    [timingScore >= CFG.HIGH_WINRATE_MIN_TIMING, `TIMING>=${CFG.HIGH_WINRATE_MIN_TIMING}`],
    [entry.entryScore >= CFG.HIGH_WINRATE_MIN_ENTRY, `ENTRY>=${CFG.HIGH_WINRATE_MIN_ENTRY}`],
    [s.trendQuality === "UPTREND", "UPTREND"],
    [Number(x.rsr20) >= CFG.HIGH_WINRATE_MIN_RSR20, `RSR20>=${CFG.HIGH_WINRATE_MIN_RSR20}`],
    [Number(s.volRatio) >= CFG.HIGH_WINRATE_MIN_VOL_RATIO, `VOL/AVG20>=${CFG.HIGH_WINRATE_MIN_VOL_RATIO}`],
    [Number(s.accumulationScore) >= CFG.HIGH_WINRATE_MIN_ACCUMULATION, `ACCUM>=${CFG.HIGH_WINRATE_MIN_ACCUMULATION}`],
    [s.volatility10Label === "SEDANG" || s.volatility10Label === "KUAT", "VOLATILITAS>=SEDANG"],
    [Number(s.rsi) >= 50 && Number(s.rsi) <= 70, "RSI 50-70"],
    [!CFG.HIGH_WINRATE_REQUIRE_MACD_POSITIVE || Number(x.macdHist) > 0, "MACD>0"],
    [!CFG.HIGH_WINRATE_REQUIRE_BULLISH_CANDLE || bullishCandle, "CANDLE BULLISH"],
    [Number(last.close) > Number(x.ema20), "CLOSE>EMA20"],
    [Number(x.ema20) > Number(s.ema50), "EMA20>EMA50"],
    [Number(last.close) > Number(s.ema50), "CLOSE>EMA50"],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { pass: failed.length === 0, reasons: failed };
}

function classifyBacktestClose(changePct) {
  const c = Number(changePct);
  if (!Number.isFinite(c)) return null;
  // Kriteria 1: candle merah lebih dari -1% (close di bawah -1%).
  if (c < -1.0) return "MERAH: Close < -1%";
  // Kriteria 2: close harian nol atau positif.
  if (c > -1.0) return "CLOSE_>-1%";
  // Close antara -1% dan 0% tidak masuk kategori merah.
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
  let tp1HitDay = null, recoveryDay = null, breakevenDay = null, failedDay = null, exitDay = null;
  let exitReason = 'EXPIRED', maxDrawdownPct = 0, maxGainPct = 0, lowestPrice = entry, highestPrice = entry;

  for (let j = entryIndex + 1; j <= end; j++) {
    const bar = stock[j];
    const high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
    if (![high, low, close].every(Number.isFinite)) continue;
    const day = j - entryIndex;
    lowestPrice = Math.min(lowestPrice, low);
    highestPrice = Math.max(highestPrice, high);
    maxDrawdownPct = Math.min(maxDrawdownPct, ((low / averagePrice) - 1) * 100);
    maxGainPct = Math.max(maxGainPct, ((high / averagePrice) - 1) * 100);

    // SINGLE ADAPTIVE TARGET: +3.5% dari average price TERBARU.
    const adaptiveTarget = averagePrice * (1 + CFG.RECOVERY_TP1_PCT / 100);
    if (high >= adaptiveTarget) {
      tp1HitDay = day;
      exitDay = day;
      exitReason = 'TP1_ADAPTIVE';
      recoveryDay = adCount > 0 ? day : recoveryDay;
      break;
    }

    if (breakevenDay === null && close >= averagePrice) {
      breakevenDay = day;
      if (adCount > 0 && recoveryDay === null) recoveryDay = day;
    }

    const ddClose = ((close / averagePrice) - 1) * 100;
    const threshold = adCount === 0 ? -CFG.RECOVERY_AD1_DD_PCT : -CFG.RECOVERY_AD2_DD_PCT;
    if (adCount < CFG.RECOVERY_MAX_AD && ddClose <= threshold) {
      const rec = recoveryScoreForDay(stock, j, ihsg);
      if (rec?.eligible && Math.abs(ddClose) <= CFG.RECOVERY_MAX_DD_PCT) {
        totalCost += close;
        totalUnits += 1;
        averagePrice = totalCost / totalUnits;
        adCount += 1;
        adEvents.push({
          number: adCount,
          date: dateKey(bar.date),
          day,
          price: close,
          drawdownPct: ddClose,
          averagePriceAfter: averagePrice,
          recoveryScore: rec.recoveryScore,
          pfs: rec.pfs,
          eas: rec.eas,
          trendScore: rec.trendScore,
          timingScore: rec.timingScore,
          entryScore: rec.entryScore
        });
        continue;
      }
    }

    if (ddClose <= -CFG.RECOVERY_MAX_DD_PCT) {
      const rec = recoveryScoreForDay(stock, j, ihsg);
      if (!(rec?.eligible && adCount < CFG.RECOVERY_MAX_AD)) {
        failedDay = day;
        exitDay = day;
        exitReason = 'FAILED_RECOVERY';
        break;
      }
    }
  }

  if (exitDay === null) {
    exitDay = end - entryIndex;
    exitReason = 'EXPIRED';
  }
  const exitPrice = Number(stock[entryIndex + exitDay]?.close ?? stock[end]?.close ?? entry);
  const finalReturnPct = ((exitPrice / averagePrice) - 1) * 100;
  const recoveryStatus = exitReason === 'TP1_ADAPTIVE'
    ? (adCount > 0 ? 'RECOVERY_TP1' : 'TP1_DIRECT')
    : exitReason === 'FAILED_RECOVERY'
      ? 'FAILED'
      : adCount > 0 && breakevenDay !== null
        ? 'RECOVERY'
        : adCount > 0
          ? 'PULLBACK_AD'
          : 'DIRECT';

  return {
    entry,
    initialAveragePrice: entry,
    finalAveragePrice: averagePrice,
    totalUnits,
    adCount,
    adEvents,
    adaptiveTargetPct: CFG.RECOVERY_TP1_PCT,
    tp1: averagePrice * (1 + CFG.RECOVERY_TP1_PCT / 100),
    tp1Hit: tp1HitDay !== null,
    tp1HitDay,
    recoveryDay,
    breakevenDay,
    failedDay,
    exitDay,
    exitDate: dateKey(stock[entryIndex + exitDay]?.date ?? stock[end]?.date),
    exitPrice,
    exitReason,
    recoveryStatus,
    daysToRecovery: recoveryDay,
    daysToBEP: breakevenDay,
    daysToTP1: tp1HitDay,
    maxGainPct,
    maxDrawdownPct,
    lowestPrice,
    highestPrice,
    finalReturnPct
  };
}
async function runBacktest(fetched, ihsg, mode = "all") {
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
        let highWinrate = null;
        if (mode === "highwinrate") {
          if (criterion !== "CLOSE_>-1%") continue;
          highWinrate = highWinratePass(histStock, calc, s, eas, trendScore, timingScore, entry);
          if (!highWinrate.pass) continue;
        }
        const outcome=evaluateAdaptiveRecovery(stock,i,ihsg); if(!outcome) continue;
        trades.push({tradeId:`${ticker}-${dateKey(signalBar.date)}`,ticker,signalDate:dateKey(signalBar.date),criterion,filterProfile:mode === "highwinrate" ? "HIGH_WINRATE" : "BASELINE",changePct,pfs:s.score,eas:eas.score,trendScore,timingScore,entryScore:entry.entryScore,entryDecision:entry.entryDecision,entryGrade:entry.entryGrade,trendQuality:s.trendQuality,highWinrateChecks:highWinrate?.reasons || [],...outcome});
      }catch(_){ }
    }
  }
  const summarize = (rows) => {
    const n = rows.length;
    const tp1 = rows.filter(x => x.tp1Hit).length;
    const rec = rows.filter(x => x.recoveryStatus === 'RECOVERY_TP1' || x.recoveryStatus === 'RECOVERY').length;
    const fail = rows.filter(x => x.exitReason === 'FAILED_RECOVERY').length;
    const ad = rows.filter(x => x.adCount > 0);
    const adRec = ad.filter(x => x.recoveryStatus === 'RECOVERY_TP1' || x.recoveryStatus === 'RECOVERY');
    const avg = (a) => a.length ? average(a) : null;
    return {
      signals: n,
      tp1Hit: tp1,
      tp1WinRate: n ? tp1 / n * 100 : 0,
      recovery: rec,
      recoveryRate: n ? rec / n * 100 : 0,
      failedRecovery: fail,
      failedRate: n ? fail / n * 100 : 0,
      averageDownTrades: ad.length,
      averageDownSuccess: adRec.length,
      averageDownSuccessRate: ad.length ? adRec.length / ad.length * 100 : 0,
      averageADCount: avg(ad.map(x => x.adCount)) ?? 0,
      avgFinalReturnPct: n ? average(rows.map(x => x.finalReturnPct)) : 0,
      avgMaxGainPct: n ? average(rows.map(x => x.maxGainPct)) : 0,
      avgMaxDrawdownPct: n ? average(rows.map(x => x.maxDrawdownPct)) : 0,
      avgDaysToRecovery: avg(rows.filter(x => Number.isFinite(x.daysToRecovery)).map(x => x.daysToRecovery)),
      avgDaysToTP1: avg(rows.filter(x => Number.isFinite(x.daysToTP1)).map(x => x.daysToTP1))
    };
  };
  const criteria = {
    "MERAH: Close < -1%": summarize(trades.filter(x => x.criterion === 'MERAH: Close < -1%')),
    "CLOSE_>-1%": summarize(trades.filter(x => x.criterion === 'CLOSE_>-1%')),
    ALL: summarize(trades)
  };
  const byGrade = {};
  for (const grade of ['A+', 'A', 'B']) {
    byGrade[grade] = {
      "MERAH: Close < -1%": summarize(trades.filter(x => x.entryGrade === grade && x.criterion === 'MERAH: Close < -1%')),
      "CLOSE_>-1%": summarize(trades.filter(x => x.entryGrade === grade && x.criterion === 'CLOSE_>-1%'))
    };
  }
  const grouped = {};
  for (const t of trades) (grouped[t.ticker] ??= []).push(t);
  const stockSummary = Object.entries(grouped).map(([ticker, rows]) => ({
    ticker,
    trades: rows.length,
    tp1Hit: rows.filter(x => x.tp1Hit).length,
    recoveryTrades: rows.filter(x => x.recoveryStatus === 'RECOVERY_TP1' || x.recoveryStatus === 'RECOVERY').length,
    averageDownTrades: rows.filter(x => x.adCount > 0).length,
    winRateTP1: rows.length ? rows.filter(x => x.tp1Hit).length / rows.length * 100 : 0,
    recoveryRate: (() => {
      const a = rows.filter(x => x.adCount > 0);
      return a.length ? rows.filter(x => x.adCount > 0 && (x.recoveryStatus === 'RECOVERY_TP1' || x.recoveryStatus === 'RECOVERY')).length / a.length * 100 : 0;
    })(),
    avgReturnPct: average(rows.map(x => x.finalReturnPct)),
    avgMaxDrawdownPct: average(rows.map(x => x.maxDrawdownPct)),
    avgDaysToRecovery: (() => {
      const a = rows.filter(x => Number.isFinite(x.daysToRecovery)).map(x => x.daysToRecovery);
      return a.length ? average(a) : null;
    })(),
    avgDaysToTP1: (() => {
      const a = rows.filter(x => Number.isFinite(x.daysToTP1)).map(x => x.daysToTP1);
      return a.length ? average(a) : null;
    })()
  })).sort((a, b) => b.avgReturnPct - a.avgReturnPct);
  await fs.mkdir('output',{recursive:true});
  await fs.writeFile('output/backtest.json',JSON.stringify({generatedAt:new Date().toISOString(),version: mode === 'highwinrate' ? 'V66_HIGH_WINRATE_ADAPTIVE_RECOVERY' : 'V65_ADAPTIVE_RECOVERY',lookbackSignalDays:CFG.BACKTEST_DAYS,horizonDays:CFG.BACKTEST_HORIZON_DAYS,targets:{adaptiveTpPct:CFG.RECOVERY_TP1_PCT,ad1DrawdownPct:CFG.RECOVERY_AD1_DD_PCT,ad2DrawdownPct:CFG.RECOVERY_AD2_DD_PCT,maxRecoveryDrawdownPct:CFG.RECOVERY_MAX_DD_PCT,maxAD:CFG.RECOVERY_MAX_AD},noLookahead:true,criteria,byGrade,stockSummary,trades},null,2));
  const headers=['tradeId','ticker','signalDate','criterion','filterProfile','changePct','pfs','eas','trendScore','timingScore','entryScore','entryDecision','entryGrade','trendQuality','entry','initialAveragePrice','finalAveragePrice','totalUnits','adCount','adEvents','adaptiveTargetPct','tp1','tp1Hit','tp1HitDay','recoveryDay','breakevenDay','failedDay','exitDay','exitDate','exitPrice','exitReason','recoveryStatus','daysToRecovery','daysToBEP','daysToTP1','maxGainPct','maxDrawdownPct','lowestPrice','highestPrice','finalReturnPct'];
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  await fs.writeFile('output/backtest.csv',[headers.join(','),...trades.map(t=>headers.map(h=>esc(h==='adEvents'?JSON.stringify(t[h]||[]):t[h])).join(','))].join('\n')+'\n');
  const sh=['ticker','trades','tp1Hit','recoveryTrades','averageDownTrades','winRateTP1','recoveryRate','avgReturnPct','avgMaxDrawdownPct','avgDaysToRecovery','avgDaysToTP1'];
  await fs.writeFile('output/backtest_per_saham.csv',[sh.join(','),...stockSummary.map(t=>sh.map(h=>esc(t[h])).join(','))].join('\n')+'\n');

  // TXT manual verification: satu baris per trade agar win rate bisa dicek manual.
  const pct = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(2) + '%' : '-';
  const yn = (v) => v ? 'YES' : 'NO';
  const manual = [];
  manual.push('PFS BACKTEST V66.1 HIGH WINRATE + SINGLE ADAPTIVE TP - MANUAL VERIFICATION');
  manual.push('==============================================================');
  manual.push(`Generated : ${new Date().toISOString()}`);
  manual.push(`Signal lookback : ${CFG.BACKTEST_DAYS} hari`);
  manual.push(`Horizon : ${CFG.BACKTEST_HORIZON_DAYS} hari`);
  manual.push(`ADAPTIVE TP : +${CFG.RECOVERY_TP1_PCT}% dari average price terbaru`);
  manual.push(`AD1 : -${CFG.RECOVERY_AD1_DD_PCT}% | AD2 : -${CFG.RECOVERY_AD2_DD_PCT}% | MAX DD : -${CFG.RECOVERY_MAX_DD_PCT}%`);
  manual.push('MERAH : Close < -1%');
  manual.push('HIJAU : Close > -1%');
  manual.push(`PROFILE : ${mode === 'highwinrate' ? 'HIGH WINRATE' : 'BASELINE'}`);
  manual.push('');
  manual.push('RINGKASAN PER KRITERIA');
  manual.push('-----------------------');
  for (const [label, x] of Object.entries(criteria)) {
    manual.push(`${label}`);
    manual.push(`Signals=${x.signals} | TP Adaptive=${x.tp1Hit} (${x.tp1WinRate.toFixed(2)}%) | Recovery=${x.recovery} (${x.recoveryRate.toFixed(2)}%) | AD=${x.averageDownTrades} | AD Recovery=${x.averageDownSuccessRate.toFixed(2)}% | Failed=${x.failedRecovery} (${x.failedRate.toFixed(2)}%)`);
    manual.push(`Avg Return=${pct(x.avgFinalReturnPct)} | Avg Max DD=${pct(x.avgMaxDrawdownPct)} | Avg Days Recovery=${x.avgDaysToRecovery == null ? '-' : x.avgDaysToRecovery.toFixed(2)} | Avg Days TP1=${x.avgDaysToTP1 == null ? '-' : x.avgDaysToTP1.toFixed(2)}`);
    manual.push('');
  }
  manual.push('DETAIL SETIAP TRADE');
  manual.push('===================');
  for (const t of trades) {
    manual.push([
      `${t.tradeId} | ${t.ticker} | ${t.signalDate}`,
      `Criterion=${t.criterion}`,
      `Profile=${t.filterProfile || "BASELINE"}`,
      `CloseChange=${pct(t.changePct)}`,
      `PFS/EAS=${t.pfs}/${t.eas}`,
      `Timing/Trend/Entry=${t.timingScore}/${t.trendScore}/${t.entryScore}`,
      `Grade=${t.entryGrade}`,
      `Entry=${formatPrice(t.entry)}`,
      `AD_Count=${t.adCount}`,
      `AD_Events=${(t.adEvents||[]).map(a => `AD${a.number}@D+${a.day}=${formatPrice(a.price)} Avg=${formatPrice(a.averagePriceAfter)}`).join(' ; ') || '-'}`,
      `FinalAvg=${formatPrice(t.finalAveragePrice)}`,
      `Lowest=${formatPrice(t.lowestPrice)}`,
      `MaxDD=${pct(t.maxDrawdownPct)}`,
      `TP1=${yn(t.tp1Hit)}@D+${t.tp1HitDay ?? '-'}`,
      `Recovery=D+${t.daysToRecovery ?? '-'}`,
      `BEP=D+${t.daysToBEP ?? '-'}`,
      `Exit=D+${t.exitDay}@${formatPrice(t.exitPrice)}`,
      `Reason=${t.exitReason}`,
      `Status=${t.recoveryStatus}`,
      `FinalReturn=${pct(t.finalReturnPct)}`
    ].join(' | '));
  }
  manual.push('');
  manual.push('REKAP PER SAHAM');
  manual.push('================');
  for (const s of stockSummary) {
    manual.push(`${s.ticker} | Trades=${s.trades} | TP1=${s.tp1Hit} | TP1_WR=${s.winRateTP1.toFixed(2)}% | RecoveryTrades=${s.recoveryTrades} | ADTrades=${s.averageDownTrades} | RecoveryRate=${s.recoveryRate.toFixed(2)}% | AvgReturn=${pct(s.avgReturnPct)} | AvgMaxDD=${pct(s.avgMaxDrawdownPct)} | AvgRecoveryD=${s.avgDaysToRecovery == null ? '-' : s.avgDaysToRecovery.toFixed(2)} | AvgTP1D=${s.avgDaysToTP1 == null ? '-' : s.avgDaysToTP1.toFixed(2)}`);
  }
  await fs.writeFile('output/backtest_manual_verifikasi.txt', manual.join('\n') + '\n', 'utf8');

  // DETAIL PER SAHAM: ringkasan + seluruh trade saham agar mudah dicek manual.
  const detailPerSaham = [];
  detailPerSaham.push('PFS BACKTEST V66.1 HIGH WINRATE - SINGLE ADAPTIVE TP 3.5% - DETAIL PER SAHAM');
  detailPerSaham.push('==============================================================');
  detailPerSaham.push(`Generated : ${new Date().toISOString()}`);
  detailPerSaham.push(`Signal lookback : ${CFG.BACKTEST_DAYS} hari | Horizon : ${CFG.BACKTEST_HORIZON_DAYS} hari`);
  detailPerSaham.push(`Adaptive TP +${CFG.RECOVERY_TP1_PCT}% | AD1 -${CFG.RECOVERY_AD1_DD_PCT}% | AD2 -${CFG.RECOVERY_AD2_DD_PCT}% | MAX DD -${CFG.RECOVERY_MAX_DD_PCT}%`);
  detailPerSaham.push('Kriteria merah : Close < -1% | Kriteria hijau : Close > -1%');
  detailPerSaham.push('');
  for (const s of stockSummary) {
    detailPerSaham.push(`### ${s.ticker}`);
    detailPerSaham.push(`Trades=${s.trades} | TP1=${s.tp1Hit} | TP1_WR=${s.winRateTP1.toFixed(2)}% | Recovery=${s.recoveryTrades} | AD=${s.averageDownTrades} | AD_Recovery=${s.recoveryRate.toFixed(2)}%`);
    detailPerSaham.push(`AvgReturn=${pct(s.avgReturnPct)} | AvgMaxDD=${pct(s.avgMaxDrawdownPct)} | AvgRecoveryDay=${s.avgDaysToRecovery == null ? '-' : s.avgDaysToRecovery.toFixed(2)} | AvgTP1Day=${s.avgDaysToTP1 == null ? '-' : s.avgDaysToTP1.toFixed(2)}`);
    const stockTrades = grouped[s.ticker] || [];
    for (const t of stockTrades) {
      detailPerSaham.push(
        `  ${t.signalDate} | ${t.criterion} | Entry=${formatPrice(t.entry)} | Change=${pct(t.changePct)} | PFS/EAS=${t.pfs}/${t.eas} | Grade=${t.entryGrade} | AD=${t.adCount} | FinalAvg=${formatPrice(t.finalAveragePrice)} | TP1=${t.tp1Hit ? 'D+' + t.tp1HitDay : '-'} | REC=${t.daysToRecovery == null ? '-' : 'D+' + t.daysToRecovery} | BEP=${t.daysToBEP == null ? '-' : 'D+' + t.daysToBEP} | Exit=D+${t.exitDay} ${t.exitDate} | Reason=${t.exitReason} | Return=${pct(t.finalReturnPct)}`
      );
      if (t.adEvents?.length) {
        for (const a of t.adEvents) {
          detailPerSaham.push(
            `    AD${a.number}: D+${a.day} ${a.date} @ ${formatPrice(a.price)} | DD=${pct(a.drawdownPct)} | AvgAfter=${formatPrice(a.averagePriceAfter)} | RecoveryScore=${a.recoveryScore} | PFS/EAS=${a.pfs}/${a.eas}`
          );
        }
      }
    }
    detailPerSaham.push('');
  }
  await fs.writeFile('output/backtest_detail_per_saham.txt', detailPerSaham.join('\n') + '\n', 'utf8');

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

async function sendTelegramDocument(chatId, filePath, caption = "") {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return;
  const fileBuffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([fileBuffer], { type: "text/plain" }), path.basename(filePath));
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || "Telegram sendDocument gagal");
}

function commandHelp() {
  return [
    "🤖 PFS BACKTEST CONTROLLER V65",
    "━━━━━━━━━━━━━━━━━━━━",
    "/backtest — jalankan backtest lengkap",
    "/backtest_merah — hanya Close < -1%",
    "/backtest_hijau — hanya Close > -1%",
    "/backtest_highwinrate — Close > -1% + filter HIGH WINRATE",
    "/backtest_status — cek proses berjalan",
    "/backtest_hasil — ringkasan backtest terakhir",
    "/backtest_detail KODE — detail per saham",
    "/screening — jalankan screening IDX",
    "/help — daftar perintah",
    "━━━━━━━━━━━━━━━━━━━━",
    `Adaptive TP +${CFG.RECOVERY_TP1_PCT}% | AD1 -${CFG.RECOVERY_AD1_DD_PCT}% | AD2 -${CFG.RECOVERY_AD2_DD_PCT}% | MAX DD -${CFG.RECOVERY_MAX_DD_PCT}% | Horizon ${CFG.BACKTEST_HORIZON_DAYS}D`,
    `HIGH WINRATE: PFS>=${CFG.HIGH_WINRATE_MIN_PFS} | EAS>=${CFG.HIGH_WINRATE_MIN_EAS} | Trend>=${CFG.HIGH_WINRATE_MIN_TREND} | Timing>=${CFG.HIGH_WINRATE_MIN_TIMING} | Entry>=${CFG.HIGH_WINRATE_MIN_ENTRY}`,
  ].join("\n");
}

function formatBacktestCriterion(label, x) {
  return [
    label,
    `Sinyal       : ${x.signals}`,
    `TP Adaptive   : +${CFG.RECOVERY_TP1_PCT}% | Hit: ${x.tp1Hit} | WR: ${x.tp1WinRate.toFixed(1)}%`,
    `Recovery     : ${x.recovery} | Rate: ${x.recoveryRate.toFixed(1)}%`,
    `AD Trades    : ${x.averageDownTrades} | AD Success: ${x.averageDownSuccessRate.toFixed(1)}%`,
    `Failed       : ${x.failedRecovery} | Rate: ${x.failedRate.toFixed(1)}%`,
    `Avg Return   : ${x.avgFinalReturnPct.toFixed(2)}%`,
    `Avg Max DD   : ${x.avgMaxDrawdownPct.toFixed(2)}%`,
    `Avg Recovery : ${x.avgDaysToRecovery == null ? '-' : x.avgDaysToRecovery.toFixed(1) + 'D'}`,
    `Avg TP       : ${x.avgDaysToTP1 == null ? '-' : x.avgDaysToTP1.toFixed(1) + 'D'}`
  ].join('\n');
}

function formatTradeDetail(t) {
  return [
    `📌 ${t.ticker} | ${t.signalDate}`,
    `Entry       : ${formatPrice(t.entry)} | PFS ${t.pfs}`,
    `Timing/Trend/Entry : ${t.timingScore}/${t.trendScore}/${t.entryScore}`,
    `Grade       : ${t.entryGrade} | ${t.criterion}`,
    `AD          : ${t.adCount}x | Avg akhir ${formatPrice(t.finalAveragePrice)}`,
    ...(t.adEvents || []).map(a => `  AD${a.number} D+${a.day} ${a.date} @ ${formatPrice(a.price)} | Avg ${formatPrice(a.averagePriceAfter)} | RS ${a.recoveryScore}`),
    `Adaptive TP : +${CFG.RECOVERY_TP1_PCT}% | Target akhir ${formatPrice(t.tp1)}`,
    `Recovery    : ${t.daysToRecovery == null ? '-' : 'D+' + t.daysToRecovery}`,
    `BEP         : ${t.daysToBEP == null ? '-' : 'D+' + t.daysToBEP}`,
    `TP Hit      : ${t.tp1HitDay == null ? '-' : 'D+' + t.tp1HitDay}`,
    `Max DD      : ${t.maxDrawdownPct.toFixed(2)}%`,
    `Exit        : D+${t.exitDay} ${t.exitDate} @ ${formatPrice(t.exitPrice)}`,
    `Status      : ${t.recoveryStatus} | Return ${t.finalReturnPct.toFixed(2)}%`
  ].join('\n');
}

async function getBacktestDataAndRun(mode = "all") {
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
  return runBacktest(fetched, ihsg, mode);
}

async function runTelegramBacktestCommand(chatId, mode) {
  if (BACKTEST_RUNNING) {
    await sendTelegramTo(chatId, "⏳ BACKTEST MASIH BERJALAN.\nGunakan /backtest_status untuk mengecek proses.");
    return;
  }

  BACKTEST_RUNNING = true;
  LAST_BACKTEST_AT = new Date();
  const isHighWinrate = mode === "highwinrate";
  await sendTelegramTo(chatId,
    "⏳ BACKTEST DIMULAI\n\n" +
    (isHighWinrate
      ? "🏆 MODE HIGH WINRATE\n🟢 Hanya Close > -1%\n" +
        `PFS>=${CFG.HIGH_WINRATE_MIN_PFS} | EAS>=${CFG.HIGH_WINRATE_MIN_EAS} | Trend>=${CFG.HIGH_WINRATE_MIN_TREND} | Timing>=${CFG.HIGH_WINRATE_MIN_TIMING} | Entry>=${CFG.HIGH_WINRATE_MIN_ENTRY}\n` +
        `RSR20>=${CFG.HIGH_WINRATE_MIN_RSR20} | Vol/Avg20>=${CFG.HIGH_WINRATE_MIN_VOL_RATIO} | Accum>=${CFG.HIGH_WINRATE_MIN_ACCUMULATION} | RSI 50-70 | MACD>0\n\n`
      : "🔴 Kriteria 1: Close < -1%\n🟢 Kriteria 2: Close > -1%\n\n") +
    `Adaptive TP +${CFG.BACKTEST_TP1_PCT}% | MAX DD -${CFG.RECOVERY_MAX_DD_PCT}%\n` +
    `Horizon: ${CFG.BACKTEST_HORIZON_DAYS} hari\n\n` +
    "Server sedang menghitung..."
  );

  try {
    const result = await getBacktestDataAndRun(mode);
    const red = result.criteria["MERAH: Close < -1%"] || {signals:0,tp1Hit:0,tp1WinRate:0,recovery:0,recoveryRate:0,averageDownTrades:0,averageDownSuccessRate:0,failedRecovery:0,failedRate:0,avgFinalReturnPct:0,avgMaxDrawdownPct:0,avgDaysToRecovery:null,avgDaysToTP1:null,};
    const green = result.criteria["CLOSE_>-1%"] || red;
    const selected = mode === "red" ? red : mode === "green" || mode === "highwinrate" ? green : null;

    let message = `🧪 BACKTEST SELESAI — V66 ${mode === "highwinrate" ? "HIGH WINRATE" : "ADAPTIVE RECOVERY"}\n━━━━━━━━━━━━━━━━━━━━\n`;
    if (selected) {
      message += formatBacktestCriterion(mode === "red" ? "🔴 CLOSE < -1%" : mode === "highwinrate" ? "🏆 HIGH WINRATE: CLOSE > -1%" : "🟢 CLOSE > -1%", selected);
    } else {
      message += formatBacktestCriterion("🔴 CLOSE < -1%", red) + "\n\n" +
        formatBacktestCriterion("🟢 CLOSE > -1%", green) + "\n\n" +
        (red.tp1WinRate >= green.tp1WinRate
          ? `🏆 TP1 WIN RATE TERBAIK: 🔴 MERAH (${red.tp1WinRate.toFixed(1)}%)`
          : `🏆 TP1 WIN RATE TERBAIK: 🟢 HIJAU (${green.tp1WinRate.toFixed(1)}%)`);
    }
    message += "\n━━━━━━━━━━━━━━━━━━━━\n📁 JSON: output/backtest.json\n📄 CSV detail: output/backtest.csv\n📊 CSV per saham: output/backtest_per_saham.csv\n📝 TXT manual: output/backtest_manual_verifikasi.txt\n📋 TXT detail per saham: output/backtest_detail_per_saham.txt";
    await sendTelegramTo(chatId, message);
    await sendTelegramDocument(
      chatId,
      "output/backtest_manual_verifikasi.txt",
      "📝 TXT MANUAL — cek setiap trade, AD, Adaptive TP, Recovery, Exit, dan Return."
    );
    await sendTelegramDocument(
      chatId,
      "output/backtest.csv",
      "📄 CSV DETAIL — seluruh trade backtest, cocok untuk Excel/Google Sheets."
    );
    await sendTelegramDocument(
      chatId,
      "output/backtest_per_saham.csv",
      "📊 CSV PER SAHAM — win rate TP1, recovery, AD, return, dan hari recovery."
    );
    await sendTelegramDocument(
      chatId,
      "output/backtest_detail_per_saham.txt",
      "📋 TXT PER SAHAM — detail lengkap setiap saham dan setiap trade."
    );
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
    "/help", "/start", "/backtest", "/backtest_merah", "/backtest_hijau", "/backtest_highwinrate",
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
    } else if (cmd.command === "/backtest_highwinrate") {
      await runTelegramBacktestCommand(cmd.chatId, "highwinrate");
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
        const red = data.criteria["MERAH: Close < -1%"];
        const green = data.criteria["CLOSE_>-1%"];
        await sendTelegramTo(cmd.chatId,
          "📊 HASIL BACKTEST TERAKHIR\n━━━━━━━━━━━━━━━━━━━━\n" +
          formatBacktestCriterion("🔴 MERAH: Close < -1%", red) + "\n\n" +
          formatBacktestCriterion("🟢 CLOSE > -1%", green)
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
        } else if (command === "/backtest_highwinrate") {
          void runTelegramBacktestCommand(chatId, "highwinrate");
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
            const red = data.criteria["MERAH: Close < -1%"];
            const green = data.criteria["CLOSE_>-1%"];
            await sendTelegramTo(chatId,
              "📊 HASIL BACKTEST TERAKHIR\n━━━━━━━━━━━━━━━━━━━━\n" +
              formatBacktestCriterion("🔴 MERAH: Close < -1%", red) + "\n\n" +
              formatBacktestCriterion("🟢 CLOSE > -1%", green)
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

  console.log(`PFS Scanner V66.12 ENTRY A/B/C + SAFE PRICE + 50 CANDLE + MACD Node.js`);
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
      const entrySafety = calculateEntrySafety(stock, calc, s, eas.score, trendScore, timingScore, entry.entryScore);
      const entryPlan = calculateIdealEntryPlan(stock, calc, { ...s, earlyAccumulationScore: eas.score, trendScore, timingScore, entryScore: entry.entryScore, entrySafetyScore: entrySafety.score, entryMode: entrySafety.mode });
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
        entrySafetyScore: entrySafety.score,
        entrySafety: entrySafety.safe ? "AMAN" : "TUNGGU",
        entryMode: entrySafety.mode,
        entryCategory: entryPlan.category,
        entryCategoryLabel: entryPlan.label,
        entryPlanReason: entryPlan.reason,
        entryAggressive: entryPlan.aggressive,
        entryIdeal: entryPlan.ideal,
        entryConservative: entryPlan.conservative,
        entryZoneLow: entryPlan.zoneLow,
        entryZoneHigh: entryPlan.zoneHigh,
        entrySafetyReason: entrySafety.reason,
        distEma20Pct: entrySafety.distEma20Pct,
        distHighPct: entrySafety.distHighPct,
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
        obv: calculateChartData(stock, 1).at(-1)?.obv ?? 0,
        williamsR14: calculateChartData(stock, 1).at(-1)?.williamsR14 ?? null,
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
        chart50: calculateChartData(stock, CFG.CHART_CANDLES),
      });
    } catch (error) {
      errors.push({ ticker, error: error.message });
    }
  }

  // V66.12 ENTRY 3 TINGKAT: Entry Safety bukan lagi filter biner.
  // Baseline hanya menentukan kandidat; Entry A/B/C menentukan kualitas timing/harga masuk.
  // A = prioritas aman, B = cicil/konfirmasi, C = wait pullback + harga ideal.
  const baselineQualified = results.filter((r) => {
    const passPFS = r.score >= CFG.QUALIFY_MIN_PFS;
    const passEAS = r.earlyAccumulationScore >= CFG.QUALIFY_MIN_EAS;
    const passTrend = r.trendScore >= CFG.QUALIFY_MIN_TREND;
    const passTiming = r.timingScore >= CFG.QUALIFY_MIN_TIMING;
    const passEntry = r.entryScore >= CFG.QUALIFY_MIN_ENTRY;
    const passTrendQuality = !CFG.REQUIRE_UPTREND || r.trendQuality === "UPTREND";
    return passPFS && passEAS && passTrend && passTiming && passEntry && passTrendQuality;
  });

  const rejectedByStrictFilter = results.length - baselineQualified.length;
  const categoryOrder = { A: 0, B: 1, C: 2 };
  const qualified = baselineQualified
    .sort((a, b) =>
      (categoryOrder[a.entryCategory] ?? 9) - (categoryOrder[b.entryCategory] ?? 9) ||
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

  // V66.9 REALTIME TELEGRAM DASHBOARD CHART: hanya saham LOLOS yang dibuatkan chart.
  // Chart dibuat setelah filter final sehingga data/indikator sama persis dengan hasil Telegram.
  // 50 candle + EMA20/EMA50 + Price Channel 10 + RSI14 + OBV + Williams %R14 + MACD + Volume + PFS metrics.
  await fs.mkdir("output/charts", { recursive: true });
  for (const r of qualified) {
    const safeTicker = String(r.ticker).replace(/[^A-Za-z0-9_-]/g, "_");
    const chartFile = `output/charts/${safeTicker}_50CANDLE.svg`;
    await fs.writeFile(chartFile, makeStockChartSVG(r.ticker, r.chart50), "utf8");
    r.chart50File = chartFile;
    r.chart50Candles = r.chart50.length;
    try {
      r.telegramChartPng = await renderTelegramChartPNG(r.ticker, r.chart50, {
        pfs: r.score, entryScore: r.entryScore, entryDecision: r.entryDecision, entryGrade: r.entryGrade,
        entrySafetyScore: r.entrySafetyScore, entrySafety: r.entrySafety, entryMode: r.entryMode, entrySafetyReason: r.entrySafetyReason,
        entryCategory: r.entryCategory, entryCategoryLabel: r.entryCategoryLabel, entryPlanReason: r.entryPlanReason,
        entryAggressive: r.entryAggressive, entryIdeal: r.entryIdeal, entryConservative: r.entryConservative,
        eas: r.earlyAccumulationScore, timing: r.timingScore, trend: r.trendScore, rsr20: r.rsr20, rsr60: r.rsr60,
        rsi14: r.rsi14, macdHist: r.macdHist, volRatio: r.volRatio, atrPct: r.atrPct,
        accumulation: r.accumulation, accumulation5d: r.accumulation5d, accumulation10d: r.accumulation10d,
        accumulationAvg1d: r.accumulationAvg1d, accumulationAvg5d: r.accumulationAvg5d, accumulationAvg10d: r.accumulationAvg10d,
        close: r.close, changePct: r.changePct, dataDate: r.dataDate, trendQuality: r.trendQuality,
        volatility: r.volatility, candle: r.candle, reason: r.reason,
        ema20: r.ema20, ema50: r.ema50, macdHist: r.macdHist,
        accumulationScore: r.accumulationScore, accumulation5dScore: r.accumulation5dScore, accumulation10dScore: r.accumulation10dScore,
        trend: r.trend, williamsR14: r.williamsR14, obv: r.obv,
      });
      const pngFile = `output/charts/${safeTicker}_REALTIME.png`;
      await fs.writeFile(pngFile, r.telegramChartPng);
      r.telegramChartFile = pngFile;
    } catch (chartError) {
      r.telegramChartError = chartError.message;
      console.warn(`QuickChart gagal ${r.ticker}: ${chartError.message}`);
    }
  }

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
      results: qualified.map(({ telegramChartPng, ...r }) => r),
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
    "📊 PFS SCREENING IDX - V66.12 ENTRY A/B/C\n" +
    `Total LOLOS : ${qualified.length}\n` +
    `Filter PFS  : >= ${CFG.QUALIFY_MIN_PFS}\n` +
    `EAS/Timing  : >= ${CFG.QUALIFY_MIN_EAS} / >= ${CFG.QUALIFY_MIN_TIMING}\n` +
    `Trend/Entry : >= ${CFG.QUALIFY_MIN_TREND} / >= ${CFG.QUALIFY_MIN_ENTRY}\n` +
    `Trend wajib : ${CFG.REQUIRE_UPTREND ? "UPTREND" : "TIDAK"}\n` +
    `Entry Safety: WAJIB AMAN (anti-kejar harga)\n` +
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
        `🎯 ENTRY ${r.entryCategory || "-"} : ${cleanText(r.entryCategoryLabel)}\n` +
        `   Score ${fmtInt(r.entryScore)}/100 | ${cleanText(r.entryDecision)} | Grade ${cleanText(r.entryGrade)}\n` +
        (r.entryCategory === "A" ? `   Harga: AMAN / PRIORITAS\n` : `   Harga beli: Agresif ${fmtNum(r.entryAggressive,0)} | ⭐ Ideal ${fmtNum(r.entryIdeal,0)} | Konservatif ${fmtNum(r.entryConservative,0)}\n`) +
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
    const btRed = backtest.criteria["MERAH: Close < -1%"];
    const btGreen = backtest.criteria["CLOSE_>-1%"];
    telegramText +=
      "\n🧪 BACKTEST V66.1 HIGH WINRATE - SINGLE ADAPTIVE TP\n" +
      `Target : Adaptive TP +${CFG.RECOVERY_TP1_PCT}% | Horizon ${CFG.BACKTEST_HORIZON_DAYS}D\n` +
       `AD : D1 -${CFG.RECOVERY_AD1_DD_PCT}% | D2 -${CFG.RECOVERY_AD2_DD_PCT}% | Max DD -${CFG.RECOVERY_MAX_DD_PCT}%\n` +
      `🔴 MERAH: Close < -1% : ${btRed.signals} | TP1 ${btRed.tp1WinRate.toFixed(1)}% | REC ${btRed.recoveryRate.toFixed(1)}% | AD ${btRed.averageDownSuccessRate.toFixed(1)}%\n` +
      `🟢 CLOSE > -1%      : ${btGreen.signals} | TP1 ${btGreen.tp1WinRate.toFixed(1)}% | REC ${btGreen.recoveryRate.toFixed(1)}% | AD ${btGreen.averageDownSuccessRate.toFixed(1)}%\n` +
      "━━━━━━━━━━━━━━━━━━━━\n";
  }

  // CHART MENJADI PESAN UTAMA: kirim 1 dashboard PNG per saham LOLOS.
  // Teks ringkasan tetap dikirim setelah semua foto agar Telegram tidak hanya berisi teks.
  let chartSent = 0;
  for (const r of qualified) {
    try {
      if (!r.telegramChartPng) {
        throw new Error(r.telegramChartError || "PNG chart tidak berhasil dibuat");
      }
      await sendTelegramPhoto(
        process.env.TELEGRAM_CHAT_ID,
        r.telegramChartPng,
        telegramStockCaption(r)
      );
      chartSent++;
      console.log(`CHART TELEGRAM TERKIRIM: ${r.ticker}`);
    } catch (photoError) {
      console.error(`Gagal kirim chart Telegram ${r.ticker}:`, photoError.message);
      // Jangan diam: kirim error yang jelas supaya penyebab terlihat di Telegram.
      await sendTelegramTo(
        process.env.TELEGRAM_CHAT_ID,
        `⚠️ CHART ${r.ticker} GAGAL DIKIRIM
${photoError.message}`
      );
    }
  }

  // Ringkasan screening dikirim terakhir.
  const TELEGRAM_LIMIT = 3800;
  for (let i = 0; i < telegramText.length; i += TELEGRAM_LIMIT) {
    await sendTelegram(telegramText.substring(i, i + TELEGRAM_LIMIT));
  }
  console.log(`TELEGRAM CHART: ${chartSent}/${qualified.length} berhasil dikirim sebagai FOTO`);

  console.log("");
  console.log(`Selesai. Dicek: ${symbols.length}`);
  console.log(`Berhasil: ${results.length}`);
  console.log(`ENTRY A/B/C LOLOS: ${qualified.length} | Di luar baseline: ${rejectedByStrictFilter}`);
  console.log(`CHART: ${qualified.length} dashboard PNG (50 candle + EMA20 + EMA50 + PC10 + RSI14 + OBV + Williams %R14 + Volume + Avg Beli Akumulasi 1D/5D/10D)`);
  console.log(`Error: ${errors.length}`);
  if (shouldRunBacktest && backtest) {
    console.log(`BACKTEST MERAH < -1%: ${backtest.criteria["MERAH: Close < -1%"].tp1WinRate.toFixed(1)}%`);
    console.log(`BACKTEST CLOSE > -1%: ${backtest.criteria["CLOSE_>-1%"].signals} sinyal | TP1 WR ${backtest.criteria["CLOSE_>-1%"].tp1WinRate.toFixed(1)}%`);
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
