// V59 FAST SCREENING
// PFS minimum 62; hasil diranking dan dibatasi sebelum penulisan sheet.

/**
 * V57: Format Adaptive Target + Volume + Volatility consistently and classify Volume quality.
 * Volume quality is based on VOL vs AVG20:
 *   >= 1.50x = BAIK (green text)
 *   >= 0.75x = SEDANG (yellow/orange text)
 *   < 0.75x  = LEMAH (red text)
 */

/**
 * V58: Tampilan angka SCREENING dibuat 2 desimal secara umum.
 * CLOSE, RSI14, EMA20, EMA50, 20D HIGH, RSR20, dan RSR60 ditampilkan bulat.
 * Nilai internal/perhitungan tetap tidak diubah.
 */
/**
 * Kategori volatilitas berdasarkan ATR14 sebagai % harga.
 * Digunakan khusus untuk tampilan kolom VOLATILITAS di SCREENING.
 */
function getVolatilityCategoryV55_(atrPct) {
  const v = Number(atrPct);
  if (!isFinite(v)) return 'LEMAH';
  if (v >= CFG.VOLATILITY_TOP_ATR_PCT) return 'TOP VOLATILITAS';
  if (v >= CFG.VOLATILITY_STRONG_ATR_PCT) return 'KUAT';
  if (v >= CFG.VOLATILITY_MIN_ATR_PCT) return 'SEDANG';
  return 'LEMAH';
}

function normalizeVolumeV53_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.round(value);

  let s = String(value).trim();
  if (!s) return 0;

  // Hilangkan simbol yang bukan angka/separator.
  s = s.replace(/[^\d.,-]/g, '');

  // Untuk data volume Indonesia: 133.476.700 -> 133476700.
  // Jika ada beberapa titik, anggap titik sebagai pemisah ribuan.
  if ((s.match(/\./g) || []).length >= 2) {
    s = s.replace(/\./g, '').replace(/,/g, '');
  } else if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) {
    // 133.476,7 -> 133476.7
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') >= 0) {
    // Volume biasanya integer; koma dianggap pemisah ribuan jika 3 digit sesudahnya.
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length === 3) {
      s = parts[0] + parts[1];
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.indexOf('.') >= 0) {
    const parts = s.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      s = parts[0] + parts[1];
    } else {
      s = s.replace(/\./g, '');
    }
  }

  const n = Number(s);
  return isFinite(n) ? Math.round(n) : 0;
}

function formatRekapAdaptiveTargetVolumeV53_(sheet, rowCount) {
  if (!sheet || rowCount <= 0) return;

  // Adaptive Target (H) and Volume (M) share the same base fill.
  const base = '#d9ead3';
  sheet.getRange(2, 8, rowCount, 1).setBackground(base).setFontColor('#000000');
  sheet.getRange(2, 13, rowCount, 1).setNumberFormat('#,##0').setBackground(base);

  // Volume text color according to VOL vs AVG20 in column N.
  const ratios = sheet.getRange(2, 14, rowCount, 1).getValues();
  const volumeColors = ratios.map(function(r) {
    const raw = String(r[0] == null ? '' : r[0]).replace(',', '.');
    const ratio = parseFloat(raw.replace(/x/gi, '').replace('%', ''));
    if (!isFinite(ratio)) return ['#000000'];
    if (ratio >= 1.50) return ['#008000'];       // baik
    if (ratio >= 0.75) return ['#b8860b'];       // sedang
    return ['#cc0000'];                           // lemah
  });

  sheet.getRange(2, 13, rowCount, 1)
    .setFontColor('#000000'); // base; then apply quality color to volume only
  sheet.getRange(2, 13, rowCount, 1).setFontColors(volumeColors);
}

/**
 * ================================================================
 * PFS GOOGLE SHEETS V63 - DETAIL DATA / FAST QUOTA-SAFE - DAILY 20 CANDLE
 * ================================================================
 * TUJUAN:
 * Menghilangkan error #ERROR! dari GOOGLEFINANCE.
 *
 * CARA KERJA:
 * INPUT!A2 = kode saham IDX, contoh:
 *   BBRI
 *   BBCA
 *   ANTM
 *   BMRI
 *   TLKM
 *
 * Apps Script mengambil histori harian langsung dari Yahoo Finance
 * Chart data endpoint:
 *   https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
 *
 * CHART hasil screening membuka TradingView Advanced Chart dengan
 * Williams %R, Momentum, MACD, dan OBV otomatis.
 *
 * Untuk saham Indonesia:
 *   BBRI -> BBRI.JK
 *   BBCA -> BBCA.JK
 *   ANTM -> ANTM.JK
 *
 * IHSG:
 *   ^JKSE
 *
 * Tidak memakai GOOGLEFINANCE untuk sumber data pasar. V27 tetap memakai Yahoo untuk market data, tetapi mengurangi request histori dengan cache 6 jam + quote batch.
 *
 * INDIKATOR:
 *   Harga
 *   EMA8
 *   EMA14
 *   EMA20
 *   RSR20
 *   RSR60
 *   William %R(14)
 *   Momentum Score
 *   OBV
 *   MFI(14)
 *   MACD Histogram (8,14,9)
 *   PFS 0-100
 *   Timing Score 0-30
 *   Sinyal
 *   Entry 1/2/3
 *   Akumulasi 1D: LEMAH / SEDANG / KUAT / DISTRIBUSI berdasarkan
 *   perubahan harga, posisi close dalam range candle, dan volume vs rata-rata 20 hari.
 *
 * SCREENING DAILY 20 CANDLE:
 *   Multi-filter ranking: Trend/EMA, RSI14, MACD, Volume, 20D High,
 *   RSR20/RSR60, Bullish Candlestick, dan Volatilitas 10D (ATR10/Close).
 *   Volatilitas 10D di atas sedang diberi bonus hanya bila trend minimal MIXED BULLISH; UPTREND + volatilitas 10D KUAT mendapat bonus maksimum.
 *   Output hanya saham dengan Predictive Filter Score >= 62, maksimal Top 100, diurutkan dari score tertinggi.
 *
 * PFS WEIGHT:
 *   RSR20       10
 *   RSR60       10
 *   EMA        15
 *   WilliamsR  15
 *   Momentum   15
 *   OBV        15
 *   MFI        10
 *   MACD       10
 *   TOTAL     100
 *
 * OPTIMASI V53 - FAST + QUOTA SAFE + DETAIL DATA:
 *   - CacheService menyimpan hasil Yahoo sementara agar screening berulang
 *     tidak melakukan UrlFetchApp.fetch untuk saham yang sama terus-menerus.
 *   - Histori cache berlaku 6 jam; harga terbaru diambil lewat quote batch setiap siklus monitor.
 *   - LockService mencegah dua eksekusi bersamaan mengambil ticker yang sama.
 *   - Jika kuota UrlFetch memang sudah habis, script menampilkan pesan yang
 *     jelas dan tidak mengulang request secara agresif.
 *
 * CATATAN:
 * Data Yahoo Finance adalah sumber pihak ketiga dan endpoint chart
 * bukan API publik resmi dengan SLA. Jika provider mengubah akses,
 * script dapat memerlukan penyesuaian.
 * ================================================================
 */

const CFG = {
  INPUT_SHEET: 'INPUT',
  DATA_SHEET: 'DATA',
  PFS_SHEET: 'PFS',
  SCREEN_SHEET: 'SCREENING',
  INPUT_CELL: 'A2',
  LOOKBACK_DAYS: 500,
  DISPLAY_DAYS: 20,
  TOP_N: 100,
  MIN_SCORE: 62,
  MIN_BARS: 80,
  // Volatilitas berdasarkan ATR(14) sebagai % dari harga.
  // >= 2.50% = kuat, >= 1.50% = di atas sedang.
  // Kategori VOLATILITAS ATR14 % untuk kolom di sebelah SIGNAL.
  // TOP >= 3.00 | KUAT >= 2.00 | SEDANG >= 1.00 | LEMAH < 1.00
  VOLATILITY_TOP_ATR_PCT: 5.50,
  VOLATILITY_STRONG_ATR_PCT: 2.00,
  VOLATILITY_MIN_ATR_PCT: 1.00,
  // Volatilitas 10D: ATR(10) sebagai % harga. Bonus hanya aktif jika trend minimal MIXED BULLISH.
  VOLATILITY10_STRONG_PCT: 2.50,
  VOLATILITY10_MIN_PCT: 1.50,
  // Batas perubahan Close 1D untuk dua filter terpisah:
  // < +1% dan > +1%.
  CLOSE_PREV_MAX_PCT: 1.00,

  // Filter khusus Historical / Replay:
  // TRUE = hanya mengambil sinyal ketika Close hari ini <= Close kemarin -1%.
  HISTORICAL_CLOSE_DROP_PCT: -1.00,

  // Historical / Replay Backtest
  HISTORICAL_REPLAY_DAYS: 250,
  HISTORICAL_MIN_PFS: 75,
  HISTORICAL_TARGET_PCT: 4.00,
  HISTORICAL_MAX_FORWARD_DAYS: 20,
  // TRUE = historical replay juga memakai filter Close <= -1% vs close hari sebelumnya.
  // FALSE = hanya PFS > 70 sebagai syarat sinyal.
  HISTORICAL_USE_CLOSE_FILTER: true,

  // ================================================================
  // ADAPTIVE AVERAGE DOWN / RECOVERY ENGINE
  // ================================================================
  // AD hanya dipertimbangkan jika saham sudah mempunyai entry terkunci
  // di REKAP_SCREENING dan harga turun dari entry tersebut.
  AD_ENABLED: true,
  AD1_MAX_DRAWDOWN_PCT: -2.00,
  AD2_MAX_DRAWDOWN_PCT: -5.00,
  AD_MAX_DRAWDOWN_PCT: -7.00,
  // Recovery sedikit lebih longgar: tetap selektif, tetapi tidak terlalu ketat.
  AD1_MIN_RECOVERY_SCORE: 75,
  AD2_MIN_RECOVERY_SCORE: 82,
  AD_MIN_PFS: 75,
  AD_MAX_ATR_MULTIPLE: 2.50,
  AD1_CAPITAL_PCT: 50,
  AD2_CAPITAL_PCT: 25,
  // Target recovery setelah AD. Target dihitung ulang dari average baru.
  AD_RECOVERY_TARGET_PCT: 2.00,
  // Jika recovery sangat kuat, target boleh sedikit lebih jauh.
  AD_STRONG_RECOVERY_SCORE: 90,
  AD_STRONG_RECOVERY_TARGET_PCT: 3.00,
  // Target adaptive tidak boleh melebihi target awal jika target awal tersedia,
  // kecuali AD_STRONG_TARGET_OVERRIDE = true.
  AD_STRONG_TARGET_OVERRIDE: false,

  // ================================================================
  // TELEGRAM AUTO ALERT
  // ================================================================
  TELEGRAM_ENABLED: true,
  TELEGRAM_TRIGGER_MINUTES: 10,
  TELEGRAM_STATE_KEY: 'PFS_TELEGRAM_ALERT_STATE_V53',

  // ================================================================
  // URLFETCH / YAHOO CACHE PROTECTION
  // ================================================================
  // 300 detik = 1 menit. Cocok untuk monitor otomatis karena interval monitor 10 menit dan data harian
  // tidak perlu diambil ulang setiap menit.
  YAHOO_CACHE_TTL_SECONDS: 21600, // 6 jam untuk histori OHLCV; candle berjalan ditimpa quote terbaru.
  YAHOO_QUOTE_CACHE_TTL_SECONDS: 30, // 30 detik; quote dipaksa fresh saat screening/UPDATE REALTIME.
  YAHOO_FORCE_FRESH_QUOTE_ON_SCREENING: true, // jangan pakai quote cache saat screening manual/auto.
  // Maksimum ukuran payload cache yang kita izinkan agar aman terhadap
  // batas ukuran CacheService.
  YAHOO_CACHE_MAX_BYTES: 90000,
  YAHOO_CACHE_PREFIX: 'PFS_YF_V53_',
  YAHOO_BATCH_SIZE: 25,
  YAHOO_QUOTE_BATCH_SIZE: 80,
  // V65: CLOSE SCREENING memakai snapshot candle 1 menit terbaru Yahoo.
  REALTIME_CLOSE_1M_ENABLED: true,
  REALTIME_CLOSE_1M_MAX_SYMBOLS: 120,
  REALTIME_CLOSE_1M_BATCH_SIZE: 20,
  SCREENING_LOCK_TIMEOUT_MS: 1500,

  // ================================================================
  // V56 FAST ENGINE
  // ================================================================
  // Mempercepat seluruh menu PFS tanpa mengubah rumus/skor/fitur.
  FAST_MODE: true,
  FAST_TOAST_EVERY: 25,
  FAST_REFORMAT_SCREENING: false,
  FAST_RECREATE_FILTER: true
};

function onOpen(e) {
  // Menu dibuat otomatis setiap spreadsheet dibuka.
  // Jika onOpen dijalankan manual dari editor, jalankan installPFSMenu()
  // sekali saja untuk memaksa pembuatan menu.
  if (!e || !e.source) return;
  createPFSMenu_();
  try { refreshAllSheetTables_(); } catch (err) {
    console.log('Refresh tabel/filter saat onOpen: ' + err.message);
  }
}

function onInstall(e) {
  // Memastikan menu juga dibuat setelah script dipasang/diotorisasi.
  createPFSMenu_();
}

function installPFSMenu() {
  createPFSMenu_();
  refreshAllSheetTables_();
  SpreadsheetApp.getUi().alert(
    'Menu PFS sudah dipasang.\n\n' +
    'Jika belum terlihat, reload / refresh Google Sheets.'
  );
}

function createPFSMenu_() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('PFS')
      .addItem('1. Setup / Reset', 'setupPFS')
      .addItem('2. Screening Semua Saham', 'screenAllStocks')
      .addItem('3. Update Dashboard Saham Terpilih + DATA Detail', 'updatePFS')
      .addSeparator()
      .addItem('4. Adaptive Average Down', 'updateAdaptiveAverageDown')
      .addItem('5. Setup Telegram Alert', 'setupTelegramAlert')
      .addItem('6. Test Telegram', 'testTelegramAlert')
      .addItem('7. Start Auto Monitor 10 Menit', 'startAutoMonitor10Min')
      .addItem('8. Stop Auto Monitor', 'stopAutoMonitor')
      .addItem('9. UPDATE REALTIME: Rekap + PFS + Signal + Pergerakan', 'updateRekapRealtime')
      .addItem('10. Rekap Signal Watchlist PFS 65–70', 'updateRekapSignalWatchlist')
      .addItem('11. Filter Close < +1% + Rekap', 'screenClosePrevPlus1Pct')
      .addItem('12. Filter Close > +1%', 'screenClosePrevAbove1Pct')
      .addSeparator()
      .addItem('13. Historical Replay 250 Candle', 'historicalReplay50Days')
      .addItem('14. Ringkasan Backtest', 'showBacktestSummary')
      .addItem('15. Rapikan Rekap Screening', 'rapikanRekapScreening')
      .addItem('16. Tes Sumber Data', 'testDataSource')
      .addSeparator()
      .addItem('17. Rapikan Semua Sheet + Filter', 'refreshAllSheetTables')
      .addItem('18. Bersihkan Cache Data Pasar', 'clearMarketDataCache')
      .addItem('19. Tes Sumber Data Cepat', 'testFastMarketData')
      .addItem('20. Tes CLOSE Realtime 1 Menit', 'testRealtimeCloseV65')
      .addItem('21. Analisis Skor Predictive', 'analisisSkorPredictive')
      .addToUi();
  } catch (err) {
    console.log('PFS menu tidak dapat dibuat: ' + err.message);
  }
}

/**
 * ================================================================
 * TELEGRAM AUTO ALERT V28
 * ================================================================
 * Token + Chat ID disimpan di Script Properties milik spreadsheet.
 * Tidak perlu menaruh token di cell atau membagikannya ke pembuat script.
 */
function setupTelegramAlert() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const oldToken = props.getProperty('PFS_TELEGRAM_BOT_TOKEN') || '';
  const oldChat = props.getProperty('PFS_TELEGRAM_CHAT_ID') || '';

  const tokenResp = ui.prompt(
    'PFS → Setup Telegram Alert',
    'Masukkan Bot Token Telegram dari @BotFather.\n\nToken tidak disimpan di sheet.',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenResp.getSelectedButton() !== ui.Button.OK) return;
  const token = tokenResp.getResponseText().trim() || oldToken;
  if (!token) throw new Error('Bot Token Telegram belum diisi.');

  const chatResp = ui.prompt(
    'PFS → Setup Telegram Alert',
    'Masukkan Chat ID Telegram.\n\nContoh: 123456789 atau -1001234567890',
    ui.ButtonSet.OK_CANCEL
  );
  if (chatResp.getSelectedButton() !== ui.Button.OK) return;
  const chatId = chatResp.getResponseText().trim() || oldChat;
  if (!chatId) throw new Error('Chat ID Telegram belum diisi.');

  props.setProperties({
    PFS_TELEGRAM_BOT_TOKEN: token,
    PFS_TELEGRAM_CHAT_ID: chatId,
    PFS_TELEGRAM_CONFIGURED_AT: new Date().toISOString()
  }, false);

  const result = sendTelegramMessage_('✅ <b>PFS Telegram terhubung</b>\nAuto Alert siap digunakan.');
  ui.alert(result.ok
    ? 'Telegram berhasil terhubung.\n\nSelanjutnya pilih PFS → Start Auto Monitor 10 Menit.'
    : 'Konfigurasi tersimpan, tetapi test Telegram gagal:\n' + result.error);
}

function testTelegramAlert() {
  const result = sendTelegramMessage_(
    '🧪 <b>PFS TEST ALERT</b>\nTelegram aktif.\nWaktu: ' + formatDateTime_(new Date())
  );
  SpreadsheetApp.getUi().alert(result.ok ? 'Test Telegram berhasil.' : 'Test Telegram gagal:\n' + result.error);
}

function startAutoMonitor10Min() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PFS_TELEGRAM_BOT_TOKEN') || !props.getProperty('PFS_TELEGRAM_CHAT_ID')) {
    throw new Error('Telegram belum diset. Jalankan PFS → Setup Telegram Alert terlebih dahulu.');
  }

  stopAutoMonitor(false);
  ScriptApp.newTrigger('autoMonitorPFS_')
    .timeBased()
    .everyMinutes(10)
    .create();

  props.setProperty('PFS_AUTO_MONITOR_ACTIVE', 'true');
  SpreadsheetApp.getUi().alert(
    'Auto Monitor 10 Menit AKTIF.\n\n' +
    'Sistem akan mengecek sinyal BUY, SELL/EXIT, AD1, AD2, dan STOP AD.\n' +
    'Telegram hanya dikirim ketika ada instruksi/status baru.'
  );
}

function stopAutoMonitor(showAlert) {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'autoMonitorPFS_') ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().setProperty('PFS_AUTO_MONITOR_ACTIVE', 'false');
  if (showAlert !== false) SpreadsheetApp.getUi().alert('Auto Monitor PFS dihentikan.');
}

function autoMonitorPFS_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('PFS_AUTO_MONITOR_ACTIVE') !== 'true') return;
    if (!props.getProperty('PFS_TELEGRAM_BOT_TOKEN') || !props.getProperty('PFS_TELEGRAM_CHAT_ID')) return;

    // 1) Screening otomatis. Fungsi ini juga memperbarui REKAP dan ADAPTIVE_AD.
    try { screenAllStocks(true); } catch (e) { console.log('Auto screening: ' + e.message); }

    // 2) Kirim hanya instruksi yang belum pernah dikirim.
    const signals = collectTelegramSignals_();
    const state = getTelegramState_();
    const nextState = {};

    signals.forEach(function(sig) {
      nextState[sig.key] = sig.signature;
      if (state[sig.key] !== sig.signature) {
        const result = sendTelegramMessage_(sig.message);
        if (!result.ok) console.log('Telegram gagal ' + sig.key + ': ' + result.error);
      }
    });

    // Buang state lama yang sudah tidak muncul agar sheet tidak menumpuk state.
    setTelegramState_(nextState);
  } finally {
    lock.releaseLock();
  }
}

function collectTelegramSignals_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const signals = [];
  const rekap = ss.getSheetByName('REKAP_SCREENING');
  const ad = ss.getSheetByName('ADAPTIVE_AD');

  // BUY: hanya baris REKAP yang ditandai BARU dan belum pernah tercapai target.
  if (rekap && rekap.getLastRow() >= 2) {
    const data = rekap.getRange(2, 1, rekap.getLastRow() - 1, Math.max(11, rekap.getLastColumn())).getValues();
    data.forEach(function(r) {
      const date = normalizeRekapDate_(r[0]);
      const ticker = String(r[1] || '').trim().toUpperCase();
      const pfs = Number(r[2]) || 0;
      const signal = String(r[3] || '').trim();
      const entry = parseRekapPrice_(r[4]);
      const target = Number(r[5]) || 0;
      const confirm = String(r[7] || '').toUpperCase();
      const note = String(r[10] || '').toUpperCase();
      if (!ticker || !entry || confirm.indexOf('TERCAPAI') === 0) return;
      if (note.indexOf('BARU') === -1) return;
      if (signal.indexOf('POTENSIAL') === -1 && signal.indexOf('PRIORITAS') === -1) return;
      const key = 'BUY|' + ticker + '|' + date;
      signals.push({
        key: key,
        signature: [pfs, entry, target, signal].join('|'),
        message: '🟢 <b>PFS BUY ALERT</b>\n' +
          'Saham: <b>' + escapeTelegram_(ticker) + '</b>\n' +
          'Signal: ' + escapeTelegram_(signal) + '\n' +
          'PFS: <b>' + pfs.toFixed(0) + '</b>\n' +
          'Harga Entry: <b>' + formatPrice_(entry) + '</b>\n' +
          'Target: <b>' + formatPrice_(target) + '</b>\n' +
          'Tanggal: ' + escapeTelegram_(date)
      });
    });
  }

  // SELL/EXIT: jika REKAP menunjukkan target tercapai.
  if (rekap && rekap.getLastRow() >= 2) {
    const data = rekap.getRange(2, 1, rekap.getLastRow() - 1, Math.max(11, rekap.getLastColumn())).getValues();
    data.forEach(function(r) {
      const date = normalizeRekapDate_(r[0]);
      const ticker = String(r[1] || '').trim().toUpperCase();
      const entry = parseRekapPrice_(r[4]);
      const target = Number(r[5]) || 0;
      const confirm = String(r[7] || '').toUpperCase();
      if (!ticker || confirm.indexOf('TERCAPAI') !== 0) return;
      const key = 'SELL|' + ticker + '|' + date;
      signals.push({
        key: key,
        signature: [entry, target, confirm].join('|'),
        message: '🔴 <b>PFS SELL / EXIT ALERT</b>\n' +
          'Saham: <b>' + escapeTelegram_(ticker) + '</b>\n' +
          'Entry: <b>' + formatPrice_(entry) + '</b>\n' +
          'Target: <b>' + formatPrice_(target) + '</b>\n' +
          'Status: <b>TARGET TERCAPAI</b>\n' +
          'Konfirmasi: ' + escapeTelegram_(confirm)
      });
    });
  }

  // AD: hanya baris yang benar-benar muncul di ADAPTIVE_AD.
  if (ad && ad.getLastRow() >= 2) {
    const data = ad.getRange(2, 1, ad.getLastRow() - 1, 28).getValues();
    data.forEach(function(r) {
      const date = normalizeRekapDate_(r[0]);
      const ticker = String(r[1] || '').trim().toUpperCase();
      const status = String(r[17] || '').trim().toUpperCase();
      if (!ticker || (status !== 'AD1 BOLEH' && status !== 'AD2 BOLEH')) return;
      const current = Number(r[5]) || 0;
      const dd = Number(r[6]) || 0;
      const recovery = Number(r[16]) || 0;
      const adPrice = status === 'AD2 BOLEH' ? Number(r[20]) : Number(r[19]);
      const pfs = Number(r[9]) || 0;
      const indicator = String(r[18] || '');
      const key = status + '|' + ticker + '|' + date;
      signals.push({
        key: key,
        signature: [status, current, dd, recovery, adPrice, pfs, indicator].join('|'),
        message: (status === 'AD1 BOLEH' ? '🔵' : '🟣') + ' <b>PFS ' + status + '</b>\n' +
          'Saham: <b>' + escapeTelegram_(ticker) + '</b>\n' +
          'Harga Sekarang: <b>' + formatPrice_(current) + '</b>\n' +
          'Drawdown: <b>' + formatPct_(dd) + '</b>\n' +
          'PFS: <b>' + pfs.toFixed(0) + '</b>\n' +
          'Recovery Score: <b>' + recovery.toFixed(0) + '</b>\n' +
          'Harga ' + status.replace(' BOLEH','') + ': <b>' + formatPrice_(adPrice) + '</b>\n' +
          'Indikator: ' + escapeTelegram_(indicator)
      });
    });
  }

  return signals;
}

function sendTelegramMessage_(message) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('PFS_TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('PFS_TELEGRAM_CHAT_ID');
  if (!token || !chatId) return {ok:false, error:'Bot Token / Chat ID belum dikonfigurasi.'};

  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code >= 200 && code < 300) return {ok:true};
    return {ok:false, error:'HTTP ' + code + ': ' + body};
  } catch (e) {
    return {ok:false, error:e.message};
  }
}

function getTelegramState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CFG.TELEGRAM_STATE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

function setTelegramState_(state) {
  PropertiesService.getScriptProperties().setProperty(CFG.TELEGRAM_STATE_KEY, JSON.stringify(state));
}

function escapeTelegram_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatPrice_(v) {
  if (!isFinite(Number(v))) return '-';
  return Number(v).toLocaleString('id-ID', {maximumFractionDigits: 2, minimumFractionDigits: 0});
}

function formatPct_(v) {
  if (!isFinite(Number(v))) return '-';
  return Number(v).toFixed(2) + '%';
}

function formatDateTime_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
}


/**
 * ================================================================
 * ANALISIS SKOR PREDICTIVE
 * Membuat / memperbarui sheet ANALISIS_PREDICTIVE dari hasil
 * SCREENING. Breakdown mengikuti logika Predictive Filter V27:
 * Close>EMA8, EMA8>EMA14, EMA14>EMA20, RSR20>=60, MACD Hist>0.
 * Sekaligus menampilkan Timing, Trend, Entry Score dan riwayat.
 * ================================================================
 */
function analisisSkorPredictive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const src = ss.getSheetByName(CFG.SCREEN_SHEET);
  const pfs = ss.getSheetByName(CFG.PFS_SHEET);
  const sh = getOrCreate_(ss, 'ANALISIS_PREDICTIVE');

  sh.clear();
  sh.clearConditionalFormatRules();

  sh.getRange('A1:H1').merge();
  sh.getRange('A1').setValue('ANALISIS SKOR PREDICTIVE FILTER (PFS)');
  sh.getRange('A1').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center');

  sh.getRange('A3:B6').setValues([
    ['Sumber', CFG.SCREEN_SHEET],
    ['Minimal PFS', CFG.MIN_SCORE],
    ['Tanggal Analisis', new Date()],
    ['Catatan', 'Breakdown mengikuti logika PFS yang aktif pada V53.']
  ]);

  // Jika SCREENING belum berisi hasil, gunakan dashboard PFS untuk analisis
  // satu saham.
  let rows = [];
  if (src && src.getLastRow() >= 2) {
    const vals = src.getRange(2, 1, src.getLastRow() - 1, 25).getValues();
    rows = vals.filter(r => r[1] && Number(r[2]) >= 0);
  }

  // Header breakdown
  sh.getRange('A8:M8').setValues([[
    'RANK','SAHAM','PFS','TREND /20','RSI /15','MACD /15',
    'VOLUME /15','20D HIGH /15','RSR /10','CANDLE /10','ATR /10','RAW SCORE','STATUS'
  ]]);

  if (!rows.length) {
    sh.getRange('A10').setValue('Belum ada hasil SCREENING. Jalankan PFS → Screening Semua Saham terlebih dahulu.');
    sh.autoResizeColumns(1, 13);
    ui.alert('Analisis Skor Predictive', 'Belum ada hasil SCREENING. Jalankan Screening Semua Saham lalu pilih menu ini lagi.', ui.ButtonSet.OK);
    return;
  }

  const out = rows.map(function(r, i) {
    const score = Number(r[2]) || 0;
    const rsi = Number(r[13]) || 0;
    const ema20 = Number(r[14]) || 0;
    const ema50 = Number(r[15]) || 0;
    const macd = Number(r[16]) || 0;
    const volRatio = Number(r[17]) || 0;
    const atrPct = Number(r[18]) || 0;
    const high20 = Number(r[19]) || 0;
    const rsr20 = Number(r[20]) || 0;
    const rsr60 = Number(r[21]) || 0;
    const candle = String(r[22] || '');
    const close = Number(r[11]) || 0;

    const trend =
      (close > ema20 ? 7 : 0) +
      (ema20 > ema50 ? 7 : 0) +
      (close > ema50 ? 6 : 0);

    const rsiScore =
      (rsi >= 50 && rsi <= 70) ? 15 :
      ((rsi >= 45 && rsi < 50) || (rsi > 70 && rsi <= 75)) ? 8 :
      0;

    const macdScore = macd > 0 ? 15 : 0;

    const volumeScore =
      volRatio >= 1.5 ? 15 :
      volRatio >= 1.2 ? 12 :
      volRatio >= 1.0 ? 7 : 0;

    const highScore =
      high20 > 0 && close >= high20 * 0.99 ? 15 :
      high20 > 0 && close >= high20 * 0.97 ? 10 :
      high20 > 0 && close >= high20 * 0.93 ? 5 : 0;

    let rsrScore = 0;
    if (rsr20 >= 70) rsrScore += 6;
    else if (rsr20 >= 60) rsrScore += 4;
    if (rsr60 >= 70) rsrScore += 4;
    else if (rsr60 >= 60) rsrScore += 3;

    const candleScore = candle === 'BULLISH' ? 10 : (close > 0 && candle !== 'BEARISH' ? 5 : 0);
    const atrScore =
      atrPct >= CFG.VOLATILITY_STRONG_ATR_PCT ? 10 :
      atrPct >= CFG.VOLATILITY_MIN_ATR_PCT ? 5 : 0;

    const raw = trend + rsiScore + macdScore + volumeScore + highScore + rsrScore + candleScore + atrScore;
    const status =
      score >= 90 ? 'PRIORITAS+' :
      score >= 80 ? 'PRIORITAS' :
      score >= 70 ? 'POTENSIAL' :
      score >= 60 ? 'WATCHLIST' : 'LEMAH';

    return [
      i + 1, r[1], score, trend, rsiScore, macdScore,
      volumeScore, highScore, rsrScore, candleScore, atrScore, raw, status
    ];
  });

  // Hasil sudah diurutkan oleh SCREENING; tetap urutkan berdasarkan PFS.
  out.sort((a,b) => Number(b[2]) - Number(a[2]));
  out.forEach((r,i) => r[0] = i + 1);

  sh.getRange(9,1,out.length,13).setValues(out);

  // Ringkasan
  const top = out[0];
  sh.getRange('O8:P15').setValues([
    ['RINGKASAN','NILAI'],
    ['Saham terbaik', top[1]],
    ['PFS terbaik', top[2]],
    ['Status', top[12]],
    ['Raw score', top[11]],
    ['Bobot aktif', 'Trend 20 + RSI 15 + MACD 15 + Volume 15 + High20 15 + RSR 10 + Candle 10 + ATR 10'],
    ['Batas screening', CFG.MIN_SCORE],
    ['Interpretasi', 'PFS >= 80 kuat; 70-79 potensial; 65-69 watchlist akumulasi; <65 lemah']
  ]);

  // Penjelasan formula
  sh.getRange('A' + (11 + out.length) + ':F' + (18 + out.length)).setValues([
    ['KOMPONEN','KRITERIA','BOBOT','ARTI','',''],
    ['Trend','Close>EMA20, EMA20>EMA50, Close>EMA50','20','Struktur trend'],
    ['RSI14','50-70 = penuh; 45-50 / 70-75 = parsial','15','Kondisi momentum sehat'],
    ['MACD','Histogram > 0','15','Momentum bullish'],
    ['Volume','Volume/Avg20 >= 1.50 / 1.20 / 1.00','15','Konfirmasi partisipasi'],
    ['20D High','Dekat high 20 hari','15','Potensi breakout'],
    ['RSR','RSR20 + RSR60','10','Kekuatan relatif vs IHSG'],
    ['Candle','Bullish','10','Konfirmasi harga'],
    ['VOLATILITAS 10D','ATR10/Close >=2.50% kuat; >=1.50% sedang','maks 10','Bonus hanya jika trend minimal MIXED BULLISH']
  ]);

  sh.setFrozenRows(8);
  sh.getRange('A8:M8').setFontWeight('bold').setBackground('#1f4e78').setFontColor('#ffffff');
  sh.getRange('O8:P8').setFontWeight('bold').setBackground('#1f4e78').setFontColor('#ffffff');
  sh.getRange(9,3,out.length,1).setNumberFormat('0');
  sh.getRange(9,4,out.length,9).setNumberFormat('0');
  sh.getRange(9,12,out.length,1).setNumberFormat('0');
  sh.getRange(9,13,out.length,1).setFontWeight('bold');
  sh.autoResizeColumns(1,16);
  sh.setColumnWidth(12, 95);
  sh.setColumnWidth(13, 110);
  sh.setColumnWidth(15, 170);
  sh.setColumnWidth(16, 300);

  // Warna status PFS
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(80)
      .setBackground('#d9ead3').setRanges([sh.getRange(9,3,out.length,1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(70,79)
      .setBackground('#fff2cc').setRanges([sh.getRange(9,3,out.length,1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(70)
      .setBackground('#f4cccc').setRanges([sh.getRange(9,3,out.length,1)]).build()
  ];
  sh.setConditionalFormatRules(rules);

  SpreadsheetApp.getActive().toast('Analisis Skor Predictive selesai: ' + out.length + ' saham dianalisis.', 'PFS', 5);
}

function setupPFS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const data = getOrCreate_(ss, CFG.DATA_SHEET);
  const pfs = getOrCreate_(ss, CFG.PFS_SHEET);
  const screening = getOrCreate_(ss, CFG.SCREEN_SHEET);
  const adaptiveAD = getOrCreate_(ss, 'ADAPTIVE_AD');

  input.clear();
  data.clear();
  pfs.clear();
  screening.clear();
  adaptiveAD.clear();

  input.getRange('A1:C25').setValues([
    ['Kode Saham IDX', 'Keterangan', 'Aktif'],
    ['BBRI', 'Contoh saham IDX', true],
    ['BBCA', 'Contoh saham IDX', true],
    ['BMRI', 'Contoh saham IDX', true],
    ['TLKM', 'Contoh saham IDX', true],
    ['ANTM', 'Contoh saham IDX', true],
    ['ASII', 'Contoh saham IDX', true],
    ['BRIS', 'Contoh saham IDX', true],
    ['ICBP', 'Contoh saham IDX', true],
    ['INDF', 'Contoh saham IDX', true],
    ['UNTR', 'Contoh saham IDX', true],
    ['ADRO', 'Contoh saham IDX', true],
    ['PGAS', 'Contoh saham IDX', true],
    ['KLBF', 'Contoh saham IDX', true],
    ['SMGR', 'Contoh saham IDX', true],
    ['ACES', 'Contoh saham IDX', true],
    ['ERAA', 'Contoh saham IDX', true],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false],
    ['', '', false]
  ]);

  input.getRange('E1:F8').setValues([
    ['SETTING', 'NILAI'],
    ['Periode candlestick screening', CFG.DISPLAY_DAYS],
    ['Top saham ditampilkan', CFG.TOP_N],
    ['Minimal Predictive Filter Score', CFG.MIN_SCORE],
    ['Timeframe', 'Daily / 1D'],
    ['Histori kalkulasi', CFG.LOOKBACK_DAYS + ' hari kalender'],
    ['Sumber data', 'Yahoo Finance'],
    ['Catatan', 'Centang TRUE pada kolom C untuk ikut screening']
  ]);

  pfs.getRange('A1:D18').setValues([
    ['INDIKATOR', 'NILAI', 'SKOR', 'DETAIL / INTERPRETASI'],
    ['Harga', '', '', 'Harga penutupan terbaru'],
    ['EMA8', '', '', 'EMA 8 hari'],
    ['EMA14', '', '', 'EMA 14 hari'],
    ['EMA20', '', '', 'EMA 20 hari'],
    ['RSR20', '', '', 'Relative strength saham vs IHSG 20 hari'],
    ['RSR60', '', '', 'Relative strength saham vs IHSG 60 hari'],
    ['William %R', '', '', 'Williams %R period 14'],
    ['Momentum Score', '', '', 'Skor momentum 0-100'],
    ['OBV', '', '', 'On Balance Volume'],
    ['MFI', '', '', 'Money Flow Index 14'],
    ['MACD Histogram', '', '', 'MACD(8,14,9) histogram'],
    ['PFS', '', '', 'Predictive Filter Score 0-100'],
    ['Timing Score', '', '', 'Timing 0-30'],
    ['Sinyal', '', '', 'Sinyal gabungan PFS + timing'],
    ['Entry 1', '', '', 'Entry awal'],
    ['Entry 2', '', '', 'Entry pullback'],
    ['Entry 3', '', '', 'Entry konfirmasi']
  ]);

  screening.getRange('A1:Z1').setValues([[
    'RANK','SAHAM','PREDICTIVE FILTER SCORE','SIGNAL','VOLATILITAS','CHART','AKUMULASI 1D','RATA AKUMULASI 1D','AKUMULASI 5D','RATA AKUMULASI 5D','AKUMULASI 10D','RATA AKUMULASI 10D','CLOSE','PERUBAHAN %','RSI14','EMA20','EMA50',
    'MACD HIST','VOL vs AVG20','ATR14 %','20D HIGH','RSR20','RSR60',
    'CANDLE','TREND','ALASAN'
  ]]);

  screening.getRange('A2:Z2').setValues([[
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
  ]]);

  formatSheets_(input, data, pfs);
  formatScreening_(screening);
  applyAutoTable_(adaptiveAD, 28, true);

  SpreadsheetApp.getUi().alert(
    'PFS Daily 20 Candlestick berhasil disiapkan.\\n\\n' +
    '1. Isi daftar saham pada INPUT kolom A.\\n' +
    '2. TRUE pada kolom C = ikut screening.\\n' +
    '3. Pilih PFS > Screening Semua Saham.\\n\\n' +
    'Sistem akan mengambil Daily 1D, memakai 20 candle terakhir untuk screening, ' +
    'dan histori lebih panjang untuk EMA/RSR/MACD.\\n\\nSaham dengan Predictive Filter Score >= 55 ditampilkan, diurutkan dari score tertinggi. Volatilitas 10D (ATR10/Close) di atas 1.50% mendapat bonus score hanya jika trend minimal MIXED BULLISH; trend UPTREND + volatilitas 10D KUAT mendapat bonus maksimum.'
  );
}
function updatePFS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const data = getOrCreate_(ss, CFG.DATA_SHEET);
  const pfs = getOrCreate_(ss, CFG.PFS_SHEET);

  const ticker = String(input.getRange(CFG.INPUT_CELL).getDisplayValue())
    .trim().toUpperCase().replace(/\s+/g, '');

  if (!ticker) throw new Error('INPUT!A2 kosong. Masukkan contoh BBRI.');

  ss.toast('Mengambil data ' + ticker + '...', 'PFS', 5);

  const stock = fetchYahooHistory_(ticker + '.JK', CFG.LOOKBACK_DAYS);
  const ihsg = fetchYahooHistory_('^JKSE', CFG.LOOKBACK_DAYS);

  if (!stock || stock.length < CFG.MIN_BARS)
    throw new Error('Data ' + ticker + '.JK tidak cukup. Diterima ' + (stock ? stock.length : 0) + ' baris.');
  if (!ihsg || ihsg.length < CFG.MIN_BARS)
    throw new Error('Data IHSG (^JKSE) tidak cukup. Diterima ' + (ihsg ? ihsg.length : 0) + ' baris.');

  const calc = calculateIndicators_(stock, ihsg);
  writeDataSheet_(data, calc, ticker);
  const prev = calc.rows.length >= 2 ? calc.rows[calc.rows.length - 2] : null;
  writeDashboard_(pfs, calc.latest, ticker, prev);

  applyAutoTable_(data, 20, true);
  applyAutoTable_(pfs, 4, false);
  SpreadsheetApp.flush();
  ss.toast('Dashboard ' + ticker + ' selesai. Filter/tabel otomatis diperbarui.', 'PFS', 5);
}


function accumulationAverage_(stock, days) {
  const n = stock.length;
  if (n < 1) return '-';

  const start = Math.max(0, n - days);
  let totalPV = 0;
  let totalV = 0;

  for (let i = start; i < n; i++) {
    const d = stock[i];
    const high = Number(d.high);
    const low = Number(d.low);
    const close = Number(d.close);
    const volume = Number(d.volume || 0);

    if (!isFinite(close) || volume <= 0) continue;

    // Harga rata-rata berbobot volume (VWAP-like).
    const typicalPrice = (high + low + close) / 3;
    totalPV += typicalPrice * volume;
    totalV += volume;
  }

  if (totalV <= 0) return '-';

  return formatAccumulationAverage_(totalPV / totalV);
}

function formatAccumulationAverage_(value) {
  if (!isFinite(value)) return '-';
  return Number(value).toLocaleString('id-ID', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  });
}

function screenAllStocks(fromAutoMonitor) {
  if (fromAutoMonitor === true) {
    return screenAllStocksCore_(true);
  }

  const screeningLock = LockService.getScriptLock();
  if (!screeningLock.tryLock(CFG.SCREENING_LOCK_TIMEOUT_MS)) {
    throw new Error(
      'SCREENING SEDANG BERJALAN. Proses baru dibatalkan agar eksekusi tidak menumpuk. ' +
      'Tunggu proses sebelumnya selesai.'
    );
  }

  try {
    return screenAllStocksCore_(false);
  } finally {
    try { screeningLock.releaseLock(); } catch (ignore) {}
  }
}


/**
 * ================================================================
 * REKAP SIGNAL WATCHLIST (PFS 65–70) - OTOMATIS
 * ================================================================
 * V55:
 * - Dibuat otomatis setiap kali Screening Semua Saham selesai.
 * - Menampilkan semua saham dengan SIGNAL WATCHLIST dari hasil screening.
 * - Struktur kolom mengikuti REKAP_SCREENING dan ditambah PERGERAKAN SAHAM % setelah KEUNTUNGAN %.
 * - Tidak melakukan request market tambahan sehingga tidak memperlambat screening.
 * - Harga screening, jam, adaptive target dan keuntungan dihitung dari hasil
 *   screening TERBARU.
 * - Jika tidak ada WATCHLIST PFS 65–70, sheet tetap dibuat dan hanya berisi header.
 */

/**
 * V55: Parser angka pasar yang aman untuk format Indonesia/Google Sheets.
 * Contoh yang didukung:
 *   133476700
 *   "133,476,700"
 *   "133.476.700"
 *   "133.476.700 lot"
 *   "0,23x"
 */
function parseMarketNumberV53_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;

  let s = String(value).trim();
  if (!s) return 0;

  // Hapus simbol selain angka, minus, koma, titik, dan x.
  s = s.replace(/\s/g, '').replace(/[^\d,.\-xX]/g, '');
  if (!s) return 0;

  // Untuk ratio seperti 0,23x / 1.23x.
  if (/x$/i.test(s)) {
    s = s.replace(/x$/i, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) {
      s = s.replace(',', '.');
    } else if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      s = s.replace(/\./g, '').replace(',', '.');
    }
    const ratio = parseFloat(s);
    return isFinite(ratio) ? ratio : 0;
  }

  // Jika ada titik dan koma, tentukan separator desimal dari separator terakhir.
  if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (s.indexOf('.') >= 0) {
    // Untuk volume "133.476.700", titik adalah pemisah ribuan.
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = parts.join('');
    }
  } else if (s.indexOf(',') >= 0) {
    // Untuk volume "133,476,700", koma adalah pemisah ribuan.
    const parts = s.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      s = parts.join('');
    }
  }

  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function updateRekapSignalWatchlistFromResults_(ss, results) {
  const sheet = getOrCreate_(ss, 'REKAP SIGNAL WATCHLIST (PFS 65–70)');
  const lockSheet = getOrCreateRekapLockSheet_(ss, 'REKAP_WATCHLIST_LOCK');
  const locks = loadRekapLocks_(lockSheet);

  const headers = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  ensureRekapColumns_(sheet, headers.length);
  sheet.getRange(1,1,1,headers.length).setValues([headers]);

  // Baca histori tanpa menghapus tanggal/screening sebelumnya.
  // Penting: migrasi lama harus membedakan format 15 kolom vs 16 kolom.
  // Format 16 kolom memiliki status BARU/LAMA di kolom P (index 15).
  const oldRows = [];
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const raw = sheet.getRange(
      2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 16)
    ).getValues();

    raw.forEach(function(r) {
      const date = normalizeRekapDate_(r[0]);
      const ticker = String(r[1] || '').trim().toUpperCase();
      if (!date || !ticker) return;

      const statusP = String(r[15] || '').trim().toUpperCase();
      const statusO = String(r[14] || '').trim().toUpperCase();

      let movement = '';
      let confirmation = 'BELUM TERCAPAI';
      let hitDate = '';
      let hitTime = '';
      let volume = 0;
      let volRatio = 0;
      let note = '';

      if (statusP === 'BARU' || statusP === 'LAMA') {
        // V53/V55: A:P
        movement = r[9] == null ? '' : String(r[9]).trim();
        confirmation = r[10] == null ? 'BELUM TERCAPAI' : String(r[10]).trim();
        hitDate = r[11] ? normalizeRekapDate_(r[11]) : '';
        hitTime = r[12] ? String(r[12]).trim() : '';
        volume = parseMarketNumberV53_(r[13]);
        volRatio = parseMarketNumberV53_(r[14]);
        note = statusP;
      } else if (statusO === 'BARU' || statusO === 'LAMA') {
        // V50/V53 lama: A:O, J masih KONFIRMASI TARGET.
        movement = '';
        confirmation = r[9] == null ? 'BELUM TERCAPAI' : String(r[9]).trim();
        hitDate = r[10] ? normalizeRekapDate_(r[10]) : '';
        hitTime = r[11] ? String(r[11]).trim() : '';
        volume = parseMarketNumberV53_(r[12]);
        volRatio = parseMarketNumberV53_(r[13]);
        note = statusO;
      } else {
        // Fallback format lama.
        movement = '';
        confirmation = String(r[9] || 'BELUM TERCAPAI').trim();
        hitDate = r[10] ? normalizeRekapDate_(r[10]) : '';
        hitTime = r[11] ? String(r[11]).trim() : '';
        volume = parseMarketNumberV53_(r[12]);
        volRatio = parseMarketNumberV53_(r[13]);
        note = (String(r[14] || '').trim().toUpperCase() === 'BARU') ? 'BARU' : 'LAMA';
      }

      const oldPrice = parseRekapPrice_(r[6]);
      const oldTarget = Number(r[7]) || 0;
      oldRows.push([
        date, ticker, Number(r[2]) || 0, String(r[3] || '').trim(),
        r[4] || '', r[5] == null ? '' : r[5],
        r[6] || oldPrice, oldTarget,
        Number(r[8]) || calculateTargetProfitPct_(oldPrice, oldTarget),
        movement, confirmation || 'BELUM TERCAPAI', hitDate, hitTime,
        volume, volRatio, note === 'BARU' ? 'BARU' : 'LAMA'
      ]);
    });
  }

  const keyMap = {};
  oldRows.forEach(function(r, i) {
    const date = normalizeRekapDate_(r[0]);
    const ticker = String(r[1] || '').trim().toUpperCase();
    if (date && ticker) keyMap[date + '|' + ticker] = i;
  });

  // Harga screening terakhir per saham untuk menghitung pergerakan.
  const latestPriceByTicker = {};
  oldRows.forEach(function(r) {
    const ticker = String(r[1] || '').trim().toUpperCase();
    const price = parseRekapPrice_(r[6]);
    const date = normalizeRekapDate_(r[0]);
    if (!ticker || price <= 0 || !date) return;
    const current = latestPriceByTicker[ticker];
    if (!current || date > current.date) {
      latestPriceByTicker[ticker] = {date: date, price: price};
    }
  });

  const now = nowRekapLockTime_();

  const watchlist = (results || []).filter(function(r) {
    const pfs = Number(r.score) || 0;
    return /WATCHLIST/i.test(String(r.signal || '')) && pfs >= 65 && pfs <= 70;
  });

  watchlist.sort(function(a,b) {
    return (Number(b.score)||0) - (Number(a.score)||0);
  });

  watchlist.forEach(function(r) {
    const ticker = String(r.ticker || '').trim().toUpperCase();
    const dataDate = r.dataDate || normalizeRekapDate_(new Date());
    if (!ticker || !dataDate) return;

    const key = dataDate + '|' + ticker;
    const exists = Object.prototype.hasOwnProperty.call(keyMap, key);
    const idx = exists ? keyMap[key] : -1;
    const previous = exists ? oldRows[idx] : null;

    const currentPfs = Number(r.score) || 0;
    const currentSignal = String(r.signal || '').trim();
    const price = Number(r.close) || 0;
    if (price <= 0) return;

    let referencePrice = 0;
    if (previous) referencePrice = parseRekapPrice_(previous[6]);
    if (referencePrice <= 0 && latestPriceByTicker[ticker]) {
      referencePrice = Number(latestPriceByTicker[ticker].price) || 0;
    }

    let movement = 'BARU';
    if (referencePrice > 0) {
      const deltaPct = ((price / referencePrice) - 1) * 100;
      movement = (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(2) + '%';
    }

    let signalChange = 'BARU';
    let pfsChange = 'BARU';
    if (previous) {
      const previousSignal = String(previous[3] || '').trim();
      signalChange = previousSignal === currentSignal
        ? 'TETAP'
        : (previousSignal
          ? previousSignal + ' → ' + currentSignal
          : 'BARU → ' + currentSignal);

      const deltaPfs = currentPfs - (Number(previous[2]) || 0);
      pfsChange = deltaPfs > 0 ? '+' + deltaPfs : String(deltaPfs);
    }

    // V55: Watchlist juga mengunci harga, jam screening, dan adaptive target
    // pada screening pertama untuk TANGGAL + SAHAM.
    const locked = locks[key] || {};
    const lockedPrice = Number(locked.price) > 0 ? Number(locked.price) : price;
    let target = Number(locked.target) || 0;
    if (target <= lockedPrice) {
      target = Number(r.adaptiveTarget1) || calculateAdaptiveTarget1_(
        lockedPrice, Number(r.atrPct)||0, Number(r.high20)||0, currentSignal
      );
      if (target <= lockedPrice) {
        target = calculateAdaptiveTarget1_(
          lockedPrice, Number(r.atrPct)||0, Number(r.high20)||0, currentSignal
        );
      }
    }

    const confirmation = exists
      ? (String(previous[10] || '').trim() || 'BELUM TERCAPAI')
      : 'BELUM TERCAPAI';
    const hitDate = exists ? (previous[11] || '') : '';
    const hitTime = exists ? (previous[12] || '') : '';
    const lockedScreenTime = locked.lockTime || (exists ? parseRekapScreeningTime_(previous[6]) : now);

    const record = [
      dataDate, ticker, currentPfs, currentSignal, signalChange, pfsChange,
      formatRekapPriceWithTime_(lockedPrice, lockedScreenTime),
      target,
      calculateTargetProfitPct_(lockedPrice, target),
      movement,
      confirmation,
      hitDate,
      hitTime,
      parseMarketNumberV53_(r.volume),
      parseMarketNumberV53_(r.volRatio),
      exists ? 'LAMA' : 'BARU'
    ];

    if (exists) {
      oldRows[idx] = record;
    } else {
      keyMap[key] = oldRows.length;
      oldRows.push(record);
    }

    latestPriceByTicker[ticker] = {date: dataDate, price: price};
    // Jangan menimpa lock saat screening diulang.
    if (!locks[key]) {
      locks[key] = {
        date: dataDate,
        ticker: ticker,
        price: lockedPrice,
        target: target,
        lockTime: lockedScreenTime
      };
    }
  });

  saveRekapLocks_(lockSheet, locks);

  oldRows.sort(function(a,b) {
    const da = normalizeRekapDate_(a[0]);
    const db = normalizeRekapDate_(b[0]);
    if (da !== db) return db.localeCompare(da);
    const pa = Number(a[2]) || 0;
    const pb = Number(b[2]) || 0;
    if (pb !== pa) return pb - pa;
    return String(a[1]).localeCompare(String(b[1]));
  });

  const rowsToClear = Math.max(sheet.getLastRow() - 1, oldRows.length, 1);
  sheet.getRange(2,1,rowsToClear,headers.length).clearContent();

  if (oldRows.length) {
    sheet.getRange(2,1,oldRows.length,headers.length).setValues(oldRows);
  }

  formatRekapSignalWatchlist_(sheet, oldRows.length);

  ss.toast(
    'Watchlist tersimpan: ' + oldRows.length +
    ' baris histori | screening aktif PFS 65–70: ' + watchlist.length,
    'PFS',
    5
  );
}

function updateRekapSignalWatchlist(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const screening = ss.getSheetByName(CFG.SCREEN_SHEET || 'SCREENING');

  if (!screening || screening.getLastRow() < 2) {
    if (!silent) {
      SpreadsheetApp.getUi().alert(
        'Sheet SCREENING belum memiliki hasil.\n\nJalankan Screening Semua Saham terlebih dahulu.'
      );
    }
    return;
  }

  const values = screening.getDataRange().getValues();
  const h = values[0].map(function(v) {
    return String(v == null ? '' : v).trim().toUpperCase();
  });

  const ix = {
    ticker: h.indexOf('SAHAM'),
    score: h.indexOf('PREDICTIVE FILTER SCORE'),
    signal: h.indexOf('SIGNAL'),
    close: h.indexOf('CLOSE'),
    vol: h.indexOf('VOLUME'),
    volRatio: h.indexOf('VOL VS AVG20'),
    atr: h.indexOf('ATR14 %'),
    high20: h.indexOf('20D HIGH'),
    date: h.indexOf('TANGGAL DATA')
  };

  const results = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const ticker = ix.ticker >= 0 ? String(row[ix.ticker] || '').trim().toUpperCase() : '';
    const signal = ix.signal >= 0 ? String(row[ix.signal] || '').trim() : '';
    const score = ix.score >= 0 ? parseMarketNumberV53_(row[ix.score]) : 0;

    if (!ticker || !/WATCHLIST/i.test(signal) || score < 65 || score > 70) continue;

    const close = ix.close >= 0 ? parseMarketNumberV53_(row[ix.close]) : 0;
    const atrPct = ix.atr >= 0 ? Number(row[ix.atr]) || 0 : 0;
    const high20 = ix.high20 >= 0 ? Number(row[ix.high20]) || 0 : 0;

    results.push({
      ticker: ticker,
      score: score,
      signal: signal,
      close: close,
      adaptiveTarget1: calculateAdaptiveTarget1_(close, atrPct, high20, signal),
      atrPct: atrPct,
      high20: high20,
      volume: ix.vol >= 0 ? parseMarketNumberV53_(row[ix.vol]) : 0,
      volRatio: ix.volRatio >= 0 ? parseMarketNumberV53_(row[ix.volRatio]) : 0,
      dataDate: ix.date >= 0 ? normalizeRekapDate_(row[ix.date]) : normalizeRekapDate_(new Date())
    });
  }

  // SCREENING tidak menampilkan kolom VOLUME. Untuk menu manual,
  // ambil volume terbaru hanya untuk kandidat WATCHLIST yang volumenya belum ada.
  // fetchYahooHistory_ memakai cache, sehingga tidak mengambil ulang data yang sudah tersimpan.
  results.forEach(function(r) {
    if (Number(r.volume) > 0) return;
    try {
      const stock = fetchYahooHistory_(r.ticker + '.JK', 5);
      if (stock && stock.length) {
        const last = stock[stock.length - 1];
        r.volume = Number(last.volume) || 0;
      }
    } catch (e) {
      console.log('Volume WATCHLIST ' + r.ticker + ' gagal: ' + e.message);
    }
  });

  updateRekapSignalWatchlistFromResults_(ss, results);

  if (!silent) {
    SpreadsheetApp.getUi().alert(
      'REKAP SIGNAL WATCHLIST (PFS 65–70) diperbarui.\n\n' +
      'Data aktif WATCHLIST: ' + results.length +
      '\nHistori screening lama tetap disimpan.'
    );
  }
}

function formatRekapSignalWatchlist_(sheet, rowCount) {
  const headers = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  sheet.getRange(1,1,1,headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1,42);

  const widths = [105,80,55,115,150,90,115,110,90,120,160,110,125,115,95,100];
  widths.forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });

  if (!rowCount) {
    if (typeof applyAutoTable_ === 'function') applyAutoTable_(sheet, headers.length, true);
    return;
  }

  sheet.getRange(2,1,rowCount,1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2,3,rowCount,1).setNumberFormat('0');
  sheet.getRange(2,6,rowCount,1).setNumberFormat('0');
  sheet.getRange(2,8,rowCount,1).setNumberFormat('#,##0.00');
  sheet.getRange(2,9,rowCount,1).setNumberFormat('0.00"%"');
  sheet.getRange(2,13,rowCount,1).setNumberFormat('@');
  sheet.getRange(2,12,rowCount,1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2,14,rowCount,1).setNumberFormat('#,##0');
  sheet.getRange(2,15,rowCount,1).setNumberFormat('0.00"x"');

  sheet.getRange(2,7,rowCount,1).setHorizontalAlignment('left');
  sheet.getRange(2,3,rowCount,1).setHorizontalAlignment('center');
  sheet.getRange(2,6,rowCount,1).setHorizontalAlignment('center');
  sheet.getRange(2,8,rowCount,1).setHorizontalAlignment('right');
  sheet.getRange(2,9,rowCount,2).setHorizontalAlignment('right');
  sheet.getRange(2,14,rowCount,1).setHorizontalAlignment('right');
  sheet.getRange(2,15,rowCount,1).setHorizontalAlignment('center');

  // Signal WATCHLIST.
  sheet.getRange(2,4,rowCount,1)
    .setBackground('#fff2cc')
    .setFontColor('#7f6000')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Adaptive Target + Volume satu warna dasar.
  const base = '#d9ead3';
  sheet.getRange(2,8,rowCount,1).setBackground(base).setFontColor('#000000');
  sheet.getRange(2,14,rowCount,1).setBackground(base);

  // Warna huruf volume berdasarkan VOL vs AVG20.
  const ratios = sheet.getRange(2,15,rowCount,1).getValues();
  const colors = ratios.map(function(r){
    const raw = String(r[0] == null ? '' : r[0]).replace(',', '.');
    const ratio = parseFloat(raw.replace(/x/gi,'').replace('%',''));
    if (!isFinite(ratio)) return ['#000000'];
    if (ratio >= 1.50) return ['#008000'];
    if (ratio >= 0.75) return ['#b8860b'];
    return ['#cc0000'];
  });
  sheet.getRange(2,14,rowCount,1).setFontColors(colors);

  // Pergerakan saham: naik hijau, turun merah, 0 hitam, BARU abu-abu.
  const movements = sheet.getRange(2,10,rowCount,1).getValues();
  const movementColors = movements.map(function(r){
    const s = String(r[0] == null ? '' : r[0]).trim();
    if (!s || s === 'BARU') return ['#666666'];
    const n = parseFloat(s.replace('%','').replace(',','.'));
    if (!isFinite(n) || Math.abs(n) < 0.000001) return ['#000000'];
    return [n > 0 ? '#008000' : '#cc0000'];
  });
  sheet.getRange(2,10,rowCount,1).setFontColors(movementColors).setFontWeight('bold');

  // Perubahan PFS: naik hijau, turun merah, 0 hitam.
  const pfsChanges = sheet.getRange(2,6,rowCount,1).getValues();
  const pfsColors = pfsChanges.map(function(r){
    const s = String(r[0] == null ? '' : r[0]).trim();
    if (s === '0') return ['#000000'];
    if (/^\+/.test(s)) return ['#008000'];
    if (/^-/.test(s)) return ['#cc0000'];
    return ['#000000'];
  });
  sheet.getRange(2,6,rowCount,1).setFontColors(pfsColors);

  // BARU/LAMA mudah dibedakan.
  const notes = sheet.getRange(2,16,rowCount,1).getValues();
  const noteColors = notes.map(function(r){
    return [String(r[0] || '').toUpperCase() === 'BARU' ? '#0000cc' : '#666666'];
  });
  sheet.getRange(2,16,rowCount,1).setFontColors(noteColors).setFontWeight('bold');

  sheet.setRowHeights(2,rowCount,32);

  if (typeof applyAutoTable_ === 'function') {
    applyAutoTable_(sheet, headers.length, true);
  }
}

function screenAllStocksCore_(fromAutoMonitor) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const screening = getOrCreate_(ss, CFG.SCREEN_SHEET);

  const lastRow = Math.max(input.getLastRow(), 2);
  const values = input.getRange(2, 1, lastRow - 1, 3).getValues();
  const tickers = values
    .filter(r => r[2] === true || String(r[2]).toUpperCase() === 'TRUE')
    .map(r => String(r[0]).trim().toUpperCase().replace(/\s+/g,''))
    .filter(Boolean);

  if (!tickers.length)
    throw new Error('Tidak ada saham aktif. Isi kode di INPUT kolom A dan TRUE di kolom C.');

  ss.toast('Mengambil harga terbaru + histori ter-cache...', 'PFS', 5);
  const symbols = ['^JKSE'].concat(tickers.map(function(t) { return t + '.JK'; }));

  // V62: harga terbaru diambil secara batch dan dipaksa fresh saat screening (1- beberapa request), sedangkan
  // histori OHLCV disimpan 6 jam. Ini menghindari fetch histori ratusan saham
  // setiap kali Auto Monitor 10 menit berjalan.
  const latestQuotes = fetchYahooLatestQuotesBatch_(symbols, CFG.YAHOO_FORCE_FRESH_QUOTE_ON_SCREENING);
  const batchData = fetchYahooHistoryBatch_(symbols, CFG.LOOKBACK_DAYS);

  // Gabungkan quote terbaru ke histori yang ter-cache agar indikator tetap
  // memakai candle hari berjalan tanpa harus mengunduh ulang histori.
  symbols.forEach(function(symbol) {
    if (batchData[symbol] && latestQuotes[symbol]) {
      batchData[symbol] = mergeLatestQuoteIntoHistory_(batchData[symbol], latestQuotes[symbol]);
    }
  });

  const ihsg = batchData['^JKSE'];

  if (!ihsg || ihsg.length < CFG.MIN_BARS)
    throw new Error('Data IHSG tidak cukup. Cache histori belum tersedia/valid. Jalankan refresh data saat kuota tersedia.');

  const results = [];
  const errors = [];

  tickers.forEach(function(ticker, idx) {
    try {
      if ((idx % (CFG.FAST_MODE ? CFG.FAST_TOAST_EVERY : 10)) === 0 || idx === tickers.length - 1) {
        ss.toast('Menghitung PFS ' + (idx + 1) + '/' + tickers.length, 'PFS', 3);
      }
      const stock = batchData[ticker + '.JK'];
      if (!stock || stock.length < CFG.MIN_BARS) {
        errors.push(ticker + ': data tidak cukup');
        return;
      }
      const calc = calculateIndicators_(stock, ihsg);
      const s = screenScore_(stock, calc);
      const dailyChangePct = getLatestDailyChangePct_(stock);

      results.push({
        ticker: ticker,
        dataDate: normalizeRekapDate_(stock[stock.length - 1].date),
        score: s.score,
        signal: s.signal,
        close: getLatestValidClose_(stock),
        adaptiveTarget1: calculateAdaptiveTarget1_(
          getLatestValidClose_(stock),
          s.atrPct,
          s.high20,
          s.signal
        ),
        volume: Number(stock[stock.length - 1].volume || 0),
        rsi: s.rsi,
        ema20: calc.latest.ema20,
        ema50: s.ema50,
        macdHist: calc.latest.macdHist,
        volRatio: s.volRatio,
        atrPct: s.atrPct,
        atrScore: s.atrScore,
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
        accumulationAvg1d: accumulationAverage_(stock, 1),
        accumulationAvg5d: accumulationAverage_(stock, 5),
        accumulationAvg10d: accumulationAverage_(stock, 10),
        prevClose: Number(stock[stock.length - 2].close),
        changePct: dailyChangePct,
        high20: s.high20,
        distHigh: s.distHigh,
        rsr20: calc.latest.rsr20,
        rsr60: calc.latest.rsr60,
        candle: s.candle,
        trend: s.trend,
        reason: s.reason
      });
    } catch (e) {
      errors.push(ticker + ': ' + e.message);
    }
  });

  results.sort((a,b) => b.score - a.score);

  // V66: paksa CLOSE yang ditampilkan di SCREENING memakai harga terakhir
  // dari candle 1 menit Yahoo, bukan regularMarketPrice dari endpoint quote.
  // Hanya CLOSE + PERUBAHAN % yang ditimpa; skor/indikator tetap mengikuti
  // perhitungan screening yang sudah berjalan.
  if (CFG.REALTIME_CLOSE_1M_ENABLED && results.length) {
    const realtimeSymbols = results
      .slice(0, CFG.REALTIME_CLOSE_1M_MAX_SYMBOLS)
      .map(function(r) { return r.ticker + '.JK'; });
    const realtimeCloseMap = fetchYahooRealtimeClose1mBatchV65_(realtimeSymbols);
    results.forEach(function(r) {
      const q = realtimeCloseMap[r.ticker + '.JK'];
      if (!q || !isFinite(Number(q.price)) || Number(q.price) <= 0) return;
      // V66: PERUBAHAN % wajib memakai CLOSE HARI INI vs CLOSE HARI PERDAGANGAN SEBELUMNYA.
      // Previous close diambil dari metadata Yahoo (chartPreviousClose) agar
      // tidak salah mengambil close H-2 ketika histori cache belum memiliki candle hari ini.
      const previous = isFinite(Number(q.previousClose)) && Number(q.previousClose) > 0
        ? Number(q.previousClose)
        : Number(r.prevClose);
      r.close = Number(q.price);
      r.prevClose = previous;
      if (isFinite(previous) && previous > 0) {
        r.changePct = ((r.close - previous) / previous) * 100;
      }
    });
  }

  // V57: jangan clear() karena itu menghapus formatting dan memaksa
  // format ulang seluruh sheet. Hapus isi saja agar tampilan tetap.
  const oldScreenRows = Math.max(screening.getLastRow(), 2);
  screening.getRange(1, 1, oldScreenRows, 26).clearContent();
  screening.getRange('A1:Z1').setValues([[
    'RANK','SAHAM','PREDICTIVE FILTER SCORE','SIGNAL','VOLATILITAS','CHART','AKUMULASI 1D','RATA AKUMULASI 1D','AKUMULASI 5D','RATA AKUMULASI 5D','AKUMULASI 10D','RATA AKUMULASI 10D','CLOSE','PERUBAHAN %','RSI14','EMA20','EMA50',
    'MACD HIST','VOL vs AVG20','ATR14 %','20D HIGH','RSR20','RSR60',
    'CANDLE','TREND','ALASAN'
  ]]);

  // V58: semua saham dengan PFS >= 62 masuk SCREENING agar kandidat PFS 62+ dapat dibandingkan.
  const qualified = results.filter(r => r.score >= CFG.MIN_SCORE).sort((a, b) => b.score - a.score).slice(0, CFG.MAX_RESULTS || 50);
  const top = qualified.slice(0, CFG.TOP_N);
  if (top.length) {
    screening.getRange(2,1,top.length,26).setValues(
      top.map((r,i) => [
        i+1,r.ticker,r.score,r.signal,getVolatilityCategoryV55_(r.atrPct),'',r.accumulation,r.accumulationAvg1d,r.accumulation5d,r.accumulationAvg5d,r.accumulation10d,r.accumulationAvg10d,r.close,r.changePct,r.rsi,r.ema20,r.ema50,
        r.macdHist,r.volRatio,r.atrPct,r.high20,r.rsr20,r.rsr60,
        r.candle,r.trend,r.reason
      ])
    );
    addChartLinks_(screening, 2, top.length);
    colorScreening_(screening, top.length);
  } else {
    // Tidak ada saham PFS >= 62: tampilkan kandidat tertinggi sebagai diagnosis.
    screening.getRange('A2:Z2').merge();
    screening.getRange('A2').setValue(
      'TIDAK ADA SAHAM DENGAN PFS >= ' + CFG.MIN_SCORE +
      '. Kandidat dengan score tertinggi ditampilkan di bawah untuk pengecekan.'
    ).setFontWeight('bold').setHorizontalAlignment('center');

    const diag = results.slice(0, Math.min(10, results.length));
    if (diag.length) {
      screening.getRange('A4:Z4').setValues([[
        'RANK','SAHAM','SCORE','SIGNAL','VOLATILITAS','CHART','AKUMULASI 1D','RATA AKUMULASI 1D','AKUMULASI 5D','RATA AKUMULASI 5D','AKUMULASI 10D','RATA AKUMULASI 10D','CLOSE','PERUBAHAN %','RSI14','EMA20','EMA50',
        'MACD HIST','VOL vs AVG20','ATR14 %','20D HIGH','RSR20','RSR60',
        'CANDLE','TREND','ALASAN'
      ]]);
      screening.getRange(5,1,diag.length,26).setValues(
        diag.map((r,i) => [
          i+1,r.ticker,r.score,r.signal,getVolatilityCategoryV55_(r.atrPct),'',r.accumulation,r.accumulationAvg1d,r.accumulation5d,r.accumulationAvg5d,r.accumulation10d,r.accumulationAvg10d,r.close,r.changePct,r.rsi,r.ema20,r.ema50,
          r.macdHist,r.volRatio,r.atrPct,r.high20,r.rsr20,r.rsr60,
          r.candle,r.trend,r.reason
        ])
      );
      addChartLinks_(screening, 5, diag.length);
      colorScreening_(screening, diag.length);
    }
  }

  // V57: formatting berat tidak diulang setiap screening.
  // Header/warna/ukuran tetap dipertahankan; filter cukup diperbarui.
  if (CFG.FAST_MODE) {
    refreshScreeningFilterFast_(screening, 26);
  } else {
    formatScreening_(screening);
  }
  screening.getRange('AA1:AB7').setValues([ 
    ['RINGKASAN','NILAI'],
    ['Jumlah saham dicek', tickers.length],
    ['Berhasil', results.length],
    ['Score >= ' + CFG.MIN_SCORE, qualified.length],
    ['Ditampilkan', top.length],
    ['Urutan', 'PFS tertinggi → terendah (menampilkan PFS >= 62)'],
    ['Error', errors.length]
  ]);
  if (errors.length) screening.getRange(8,27,errors.length,1).setValues(errors.map(x => [x]));

  // V58: REKAP SIGNAL WATCHLIST (PFS 65–70) tetap dipertahankan sebagai watchlist khusus.
  // Tidak melakukan fetch tambahan; memakai hasil `results` yang sudah dihitung.
  try {
    updateRekapSignalWatchlistFromResults_(ss, results);
  } catch (watchErr) {
    console.log('Rekap Signal Watchlist gagal: ' + watchErr.message);
  }

  // REKAP otomatis: SIGNAL mulai dari POTENSIAL ke atas.
  // Yang direkap: POTENSIAL, PRIORITAS, dan PRIORITAS+.
  // Screening pertama pada tanggal tersebut memasukkan kandidat sebagai BARU.
  // Screening berikutnya pada tanggal yang sama: saham lama = LAMA, saham baru = BARU.
  if (top.length) {
    updateRekapScreening_(ss, top);
  }

  // Monitor Adaptive Average Down setelah rekap diperbarui.
  if (CFG.AD_ENABLED) {
    try {
      updateAdaptiveAverageDown_(false);
    } catch (adErr) {
      console.log('Adaptive AD monitor gagal: ' + adErr.message);
    }
  }

  SpreadsheetApp.flush();
  ss.toast('Screening selesai: ' + results.length + ' saham. Rekap diperbarui.', 'PFS', 7);

  if (errors.length && !fromAutoMonitor) {
    SpreadsheetApp.getUi().alert(
      'Screening selesai.\\n\\n' +
      'Berhasil: ' + results.length + '\\n' +
      'Error: ' + errors.length + '\\n\\n' +
      'Lihat detail error di kolom W pada sheet SCREENING.'
    );
  }

  if (!CFG.FAST_MODE) applyAutoTable_(screening, 25, true);
}



/**
 * ================================================================
 * REKAP SCREENING OTOMATIS - RINGKAS
 * ================================================================
 * Format REKAP_SCREENING:
 * TANGGAL DATA | SAHAM | PFS | SIGNAL | HARGA SCREENING + JAM | ADAPTIVE TARGET 1 | KEUNTUNGAN % | KONFIRMASI TARGET | VOLUME | VOL vs AVG20 | KETERANGAN
 *
 * Aturan:
 * 1. SIGNAL yang direkap adalah mulai dari POTENSIAL ke atas:
 *      - 🟢 POTENSIAL
 *      - 🔥 PRIORITAS
 *      - 🔥 PRIORITAS+
 * 2. Screening pertama pada suatu tanggal:
 *      - masukkan semua saham yang signal-nya POTENSIAL/PRIORITAS/PRIORITAS+.
 *      - KETERANGAN = BARU.
 * 3. Screening berikutnya pada tanggal yang sama:
 *      - saham yang sudah ada = LAMA.
 *      - saham yang baru muncul = BARU.
 * 4. Key unik = TANGGAL DATA + SAHAM.
 * 5. HARGA SCREENING dan JAM dikunci pada screening pertama untuk tanggal+saham.
 * 6. PFS/SIGNAL/VOLUME/VOL vs AVG20 dan PERGERAKAN SAHAM % di-update dari screening terbaru.
 * 7. PERUBAHAN SIGNAL dan PERUBAHAN PFS dihitung terhadap nilai sebelum update terakhir.
 * 8. Rekapan diurutkan tanggal terbaru -> terlama, lalu PFS tertinggi -> terendah.
 * 9. Update rekapan tidak menghapus data tanggal/saham sebelumnya.
 * 10. ADAPTIVE TARGET 1 dikunci pada screening PERTAMA bersama harga screening dan jamnya.
 *     KEUNTUNGAN % dihitung dari harga screening terkunci ke target terkunci.
 * 11. Pembaruan berikutnya hanya mengecek apakah HIGH sudah mencapai target tersebut.
 */
function updateRekapScreening_(ss, rows) {
  return updateRekapScreeningToSheet_(
    ss,
    rows,
    'REKAP_SCREENING',
    'REKAP_SCREENING_LOCK'
  );
}

function updateRekapFilterCloseLt1_(ss, rows) {
  return updateRekapScreeningToSheet_(
    ss,
    rows,
    'REKAP_FILTER_CLOSE_LT1',
    'REKAP_FILTER_CLOSE_LT1_LOCK'
  );
}

function updateRekapScreeningToSheet_(ss, rows, sheetName, lockSheetName) {
  const sheet = getOrCreate_(ss, sheetName);
  const lockSheet = getOrCreateRekapLockSheet_(ss, lockSheetName);

  const headers = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  ensureRekapColumns_(sheet, headers.length);
  sheet.getRange(1,1,1,headers.length).setValues([headers]);

  const locks = loadRekapLocks_(lockSheet);
  const oldRows = [];
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const raw = sheet.getRange(
      2,1,lastRow-1,Math.max(sheet.getLastColumn(),16)
    ).getValues();

    raw.forEach(function(r) {
      const date = normalizeRekapDate_(r[0]);
      const ticker = String(r[1] || '').trim().toUpperCase();
      if (!date || !ticker) return;

      const statusP = String(r[15] || '').trim().toUpperCase();
      const statusO = String(r[14] || '').trim().toUpperCase();

      let movement = '';
      let confirmation = 'BELUM TERCAPAI';
      let hitDate = '';
      let hitTime = '';
      let volume = 0;
      let volRatio = 0;
      let note = '';

      if (statusP === 'BARU' || statusP === 'LAMA') {
        movement = r[9] == null ? '' : String(r[9]).trim();
        confirmation = String(r[10] || 'BELUM TERCAPAI').trim();
        hitDate = r[11] ? normalizeRekapDate_(r[11]) : '';
        hitTime = r[12] ? String(r[12]).trim() : '';
        volume = parseMarketNumberV53_(r[13]);
        volRatio = parseMarketNumberV53_(r[14]);
        note = statusP;
      } else if (statusO === 'BARU' || statusO === 'LAMA') {
        // Migrasi dari format 15 kolom lama.
        movement = '';
        confirmation = String(r[9] || 'BELUM TERCAPAI').trim();
        hitDate = r[10] ? normalizeRekapDate_(r[10]) : '';
        hitTime = r[11] ? String(r[11]).trim() : '';
        volume = parseMarketNumberV53_(r[12]);
        volRatio = parseMarketNumberV53_(r[13]);
        note = statusO;
      } else {
        movement = '';
        confirmation = String(r[9] || 'BELUM TERCAPAI').trim();
        hitDate = r[10] ? normalizeRekapDate_(r[10]) : '';
        hitTime = r[11] ? String(r[11]).trim() : '';
        volume = parseMarketNumberV53_(r[12]);
        volRatio = parseMarketNumberV53_(r[13]);
        note = 'LAMA';
      }

      const currentPrice = parseRekapPrice_(r[6]);
      const currentTarget = Number(r[7]) || 0;
      const key = date + '|' + ticker;

      if (!Object.prototype.hasOwnProperty.call(locks,key) && currentPrice > 0) {
        locks[key] = {
          date: date, ticker: ticker, price: currentPrice,
          target: currentTarget,
          lockTime: parseRekapScreeningTime_(r[6])
        };
      }

      const locked = locks[key] || {};
      const priceForRow = Number(locked.price) > 0 ? Number(locked.price) : currentPrice;
      const targetForRow = Number(locked.target) > 0 ? Number(locked.target) : currentTarget;

      oldRows.push([
        date, ticker, Number(r[2])||0, String(r[3]||'').trim(),
        r[4]||'', r[5]==null?'':r[5],
        formatRekapPriceWithTime_(priceForRow, locked.lockTime || parseRekapScreeningTime_(r[6])),
        targetForRow,
        calculateTargetProfitPct_(priceForRow,targetForRow),
        movement,
        confirmation,
        hitDate,
        hitTime,
        volume,
        volRatio,
        note === 'BARU' ? 'BARU' : 'LAMA'
      ]);
    });
  }

  saveRekapLocks_(lockSheet, locks);

  const keyMap = {};
  oldRows.forEach(function(r,i) {
    const d=normalizeRekapDate_(r[0]);
    const ticker=String(r[1]||'').trim().toUpperCase();
    if(d&&ticker) keyMap[d+'|'+ticker]=i;
  });

  const latestPriceByTicker = {};
  oldRows.forEach(function(r) {
    const ticker=String(r[1]||'').trim().toUpperCase();
    const date=normalizeRekapDate_(r[0]);
    const price=parseRekapPrice_(r[6]);
    if(!ticker||!date||price<=0) return;
    if(!latestPriceByTicker[ticker] || date > latestPriceByTicker[ticker].date) {
      latestPriceByTicker[ticker]={date:date,price:price};
    }
  });

  const rekapRows = rows.filter(function(r){ return isRekapSignal_(r.signal); });
  const latestScreeningTime = nowRekapLockTime_();

  rekapRows.forEach(function(r) {
    const dataDate=r.dataDate||normalizeRekapDate_(r.date);
    const ticker=String(r.ticker||'').trim().toUpperCase();
    if(!dataDate||!ticker) return;

    const key=dataDate+'|'+ticker;
    const exists=Object.prototype.hasOwnProperty.call(keyMap,key);
    const previous=exists?oldRows[keyMap[key]]:null;
    const latestPrice=Number(r.close)||0;
    if(latestPrice<=0) return;

    let referencePrice=0;
    if(previous) referencePrice=parseRekapPrice_(previous[6]);
    if(referencePrice<=0 && latestPriceByTicker[ticker]) {
      referencePrice=Number(latestPriceByTicker[ticker].price)||0;
    }

    let movement='BARU';
    if(referencePrice>0) {
      const delta=((latestPrice/referencePrice)-1)*100;
      movement=(delta>0?'+':'')+delta.toFixed(2)+'%';
    }

    // V55: Harga screening, JAM screening, dan Adaptive Target dikunci
    // pada screening PERTAMA untuk key TANGGAL + SAHAM. Screening ulang
    // pada hari yang sama tidak boleh menggeser jam atau target awal.
    const locked = locks[key] || {};
    const lockedPrice = Number(locked.price) > 0 ? Number(locked.price) : latestPrice;
    let adaptiveTarget1 = Number(locked.target) || 0;
    if (adaptiveTarget1 <= lockedPrice) {
      adaptiveTarget1 = Number(r.adaptiveTarget1) || calculateAdaptiveTarget1_(
        lockedPrice, Number(r.atrPct)||0, Number(r.high20)||0, r.signal
      );
      if (adaptiveTarget1 <= lockedPrice) {
        adaptiveTarget1 = calculateAdaptiveTarget1_(
          lockedPrice, Number(r.atrPct)||0, Number(r.high20)||0, r.signal
        );
      }
    }

    const targetChanged = false;
    const confirmation = exists
      ? (String(previous[10]||'').trim() || 'BELUM TERCAPAI')
      : 'BELUM TERCAPAI';
    const hitDate = exists ? (previous[11]||'') : '';
    const hitTime = exists ? (previous[12]||'') : '';
    const lockedScreenTime = locked.lockTime || (exists ? parseRekapScreeningTime_(previous[6]) : latestScreeningTime);

    const currentPfs=Number(r.score)||0;
    const currentSignal=String(r.signal||'').trim();
    let signalChange='BARU';
    let pfsChange='BARU';

    if(exists) {
      const previousSignal=String(previous[3]||'').trim();
      signalChange=previousSignal===currentSignal?'TETAP':
        (previousSignal?previousSignal+' → '+currentSignal:'BARU → '+currentSignal);
      const deltaPfs=currentPfs-(Number(previous[2])||0);
      pfsChange=deltaPfs>0?'+'+deltaPfs:String(deltaPfs);
    }

    oldRows[exists?keyMap[key]:oldRows.length]=[
      dataDate,ticker,currentPfs,currentSignal,signalChange,pfsChange,
      formatRekapPriceWithTime_(lockedPrice,lockedScreenTime),
      adaptiveTarget1,calculateTargetProfitPct_(lockedPrice,adaptiveTarget1),
      movement,confirmation,hitDate,hitTime,
      Number(r.volume)||0,Number(r.volRatio)||0,
      exists?'LAMA':'BARU'
    ];
    if(!exists) keyMap[key]=oldRows.length-1;
    latestPriceByTicker[ticker]={date:dataDate,price:latestPrice};
    // Hanya membuat lock pada screening pertama. Jangan pernah menimpa lock lama.
    if (!locks[key]) {
      locks[key]={
        date:dataDate,ticker:ticker,price:lockedPrice,
        target:adaptiveTarget1,lockTime:latestScreeningTime
      };
    }
  });

  saveRekapLocks_(lockSheet,locks);
  updateTargetConfirmations_(oldRows);

  oldRows.sort(function(a,b){
    const da=normalizeRekapDate_(a[0]), db=normalizeRekapDate_(b[0]);
    if(da!==db) return db.localeCompare(da);
    const pa=Number(a[2])||0, pb=Number(b[2])||0;
    if(pb!==pa) return pb-pa;
    return String(a[1]).localeCompare(String(b[1]));
  });

  const rowsToClear=Math.max(sheet.getLastRow()-1,oldRows.length,1);
  sheet.getRange(2,1,rowsToClear,headers.length).clearContent();
  if(oldRows.length) sheet.getRange(2,1,oldRows.length,headers.length).setValues(oldRows);

  formatRekapScreening_(sheet);
  removeStandaloneTargetConfirmationSheet_(ss);
}


/**
 * Sheet internal untuk mengunci harga dan adaptive target.
 * Sheet disembunyikan agar pengguna tidak perlu mengubahnya.
 *
 * Jangan gunakan clear() pada sheet ini saat Setup / Reset.
 * Data lock adalah histori permanen REKAP_SCREENING.
 */
function getOrCreateRekapLockSheet_(ss, lockSheetName) {
  const name = lockSheetName || 'REKAP_SCREENING_LOCK';
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'KEY','TANGGAL DATA','SAHAM','HARGA SCREENING TERKUNCI',
      'ADAPTIVE TARGET 1 TERKUNCI','JAM HARGA TEREKAP'
    ]]);
    sheet.hideSheet();
  } else {
    ensureRekapColumns_(sheet, 6);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'KEY','TANGGAL DATA','SAHAM','HARGA SCREENING TERKUNCI',
      'ADAPTIVE TARGET 1 TERKUNCI','JAM HARGA TEREKAP'
    ]]);
    if (!sheet.isSheetHidden()) sheet.hideSheet();
  }

  return sheet;
}

function loadRekapLocks_(sheet) {
  const locks = {};
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return locks;

  // Kolom ke-6 adalah JAM HARGA TEREKAP. Sheet lama hanya punya 5 kolom,
  // sehingga pembacaan tetap aman karena nilai kolom ke-6 akan kosong.
  const values = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 6)).getValues();

  values.forEach(function(r) {
    const key = String(r[0] || '').trim();
    const date = normalizeRekapDate_(r[1]);
    const ticker = String(r[2] || '').trim().toUpperCase();
    const price = Number(r[3]) || 0;
    const target = Number(r[4]) || 0;
    const lockTime = r[5] || '';

    const finalKey = key || (date && ticker ? date + '|' + ticker : '');
    if (!finalKey || !ticker || price <= 0) return;

    locks[finalKey] = {
      date: date,
      ticker: ticker,
      price: price,
      target: target,
      lockTime: lockTime
    };
  });

  return locks;
}

function saveRekapLocks_(sheet, locks) {
  const keys = Object.keys(locks);
  if (!keys.length) return;

  const rows = keys.map(function(key) {
    const x = locks[key];
    return [
      key,
      x.date || '',
      x.ticker || '',
      Number(x.price) || 0,
      Number(x.target) || 0,
      x.lockTime || ''
    ];
  });

  rows.sort(function(a, b) {
    if (String(a[1]) !== String(b[1])) {
      return String(a[1]).localeCompare(String(b[1]));
    }
    return String(a[2]).localeCompare(String(b[2]));
  });

  const oldLastRow = Math.max(sheet.getLastRow() - 1, 0);
  if (oldLastRow > 0) {
    sheet.getRange(2, 1, oldLastRow, 6).clearContent();
  }

  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  sheet.getRange(2, 6, rows.length, 1).setNumberFormat('HH:mm:ss');
}

function ensureRekapColumns_(sheet, count) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < count) {
    sheet.insertColumnsAfter(maxCols, count - maxCols);
  }
}

function parseRekapPrice_(value) {
  // Mendukung format lama (angka) dan format baru:
  // "119.00\n14:32:10 WIB"
  if (typeof value === 'number') return value || 0;
  const s = String(value || '').trim();
  if (!s) return 0;

  // Ambil angka pertama dari isi sel. Aman untuk harga seperti 1,250.00
  // maupun teks yang memiliki jam di baris berikutnya.
  const cleaned = s.replace(/\s*\n.*$/, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function getRekapLockTimeText_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss');
  }
  const s = String(value).trim();
  if (!s) return '';
  // Jika sudah berupa jam, normalisasi menjadi HH:mm:ss bila memungkinkan.
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return String(m[1]).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00');
  }
  return s;
}

function formatRekapPriceWithTime_(price, lockTime) {
  const p = Number(price) || 0;
  if (p <= 0) return '';

  const timeText = getRekapLockTimeText_(lockTime);
  if (!timeText) return p.toFixed(2);

  // Satu sel tetap berisi harga + jam, tetapi harga historis tetap
  // bersumber dari REKAP_SCREENING_LOCK sehingga tidak bisa berubah.
  return p.toFixed(2) + '\n' + timeText + ' WIB';
}

function nowRekapLockTime_() {
  return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm:ss');
}

function calculateTargetProfitPct_(screeningPrice, targetPrice) {
  const p = Number(screeningPrice) || 0;
  const t = Number(targetPrice) || 0;
  if (p <= 0 || t <= 0) return 0;
  return ((t / p) - 1) * 100;
}

function updateTargetConfirmations_(rows) {
  const FAST_REKAP_MODE = true;
  // Hanya cek baris yang belum tercapai, tetapi untuk baris yang sudah
  // tercapai namun belum memiliki tanggal/jam, isi detailnya juga.
  // FORMAT V53 16 KOLOM:
  // H=TARGET, I=KEUNTUNGAN %, J=PERGERAKAN SAHAM %,
  // K=KONFIRMASI TARGET, L=TGL TERCAPAI, M=JAM TERCAPAI (1M),
  // N=VOLUME, O=VOL vs AVG20, P=KETERANGAN.
  const pending = {};
  rows.forEach(function(r, idx) {
    const confirmation = String(r[10] || '').toUpperCase();
    const target = Number(r[7]) || 0;
    const ticker = String(r[1] || '').trim().toUpperCase();

    if (ticker && target > 0 && confirmation.indexOf('TERCAPAI') !== 0) {
      if (!pending[ticker]) pending[ticker] = [];
      pending[ticker].push(idx);
    }
  });

  Object.keys(pending).forEach(function(ticker) {
    let stock;
    try {
      stock = fetchYahooHistory_(ticker + '.JK', CFG.LOOKBACK_DAYS);
    } catch (e) {
      console.log('Konfirmasi target ' + ticker + ' gagal: ' + e.message);
      return;
    }

    if (!stock || !stock.length) return;

    const byDate = {};
    stock.forEach(function(d, i) {
      byDate[dateKey_(d.date)] = i;
    });

    pending[ticker].forEach(function(rowIndex) {
      const row = rows[rowIndex];
      const targetDate = normalizeRekapDate_(row[0]);
      const target = Number(row[7]) || 0;
      if (!targetDate || target <= 0) return;

      let startIndex = byDate[targetDate];

      if (startIndex === undefined) {
        startIndex = -1;
        for (let i = 0; i < stock.length; i++) {
          const d = normalizeRekapDate_(stock[i].date);
          if (d >= targetDate) {
            startIndex = i;
            break;
          }
        }
      }

      if (startIndex < 0) return;

      // Waktu screening harus menjadi batas bawah konfirmasi.
      // Jika target berada pada HARI YANG SAMA dengan screening, jangan
      // gunakan HIGH harian penuh karena HIGH bisa terjadi sebelum screening.
      const screeningTime = parseRekapScreeningTime_(row[6]);
      const sameDayAsScreening = targetDate === normalizeRekapDate_(row[0]);

      let hitDate = '';
      let hitIndex = -1;
      let hitHour = '';

      if (sameDayAsScreening) {
        const sameDayHour = findTargetHitHour_(ticker + '.JK', targetDate, target, screeningTime);
        if (sameDayHour.hit) {
          hitDate = targetDate;
          hitHour = sameDayHour.hour || '';
          hitIndex = startIndex;
        }
      } else {
        for (let i = startIndex; i < stock.length; i++) {
          const high = Number(stock[i].high) || 0;
          if (high >= target) {
            hitIndex = i;
            hitDate = normalizeRekapDate_(stock[i].date);
            break;
          }
        }

        if (hitIndex >= 0 && hitDate) {
          const hourResult = findTargetHitHour_(ticker + '.JK', hitDate, target, '00:00:00');
          hitHour = hourResult.hour || '';
        }
      }

      if (hitIndex < 0 || !hitDate) {
        row[10] = 'BELUM TERCAPAI';
        row[11] = '';
        row[12] = '';
        return;
      }

      const dayNumber = Math.max(0, hitIndex - startIndex);
      row[10] = 'TERCAPAI HARI KE-' + dayNumber + ' | ' + hitDate;
      row[11] = hitDate;
      row[12] = hitHour;
    });
  });

  // Backfill tanggal/jam untuk data yang sudah TERCAPAI dari versi lama.
  rows.forEach(function(row) {
    const confirmation = String(row[10] || '').trim();
    
    // FAST: baris yang sudah tercapai tidak perlu meminta data Yahoo lagi.
    if (FAST_REKAP_MODE && confirmation.toUpperCase().indexOf('TERCAPAI') === 0) {
      return;
    }
    if (confirmation.toUpperCase().indexOf('TERCAPAI') !== 0) return;

    const match = confirmation.match(/HARI KE-(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})/i);
    if (!match) return;

    // Nilai lama kadang tersimpan sebagai objek Date oleh Google Sheets.
    // Normalisasi ke YYYY-MM-DD WIB agar tidak tampil "Thu Aug ... GMT+0700".
    const existingHitDate = row[11] ? normalizeRekapDate_(row[11]) : '';
    const hitDate = existingHitDate || match[2];
    row[11] = hitDate;

    if (!String(row[12] || '').trim()) {
      const ticker = String(row[1] || '').trim().toUpperCase();
      const target = Number(row[7]) || 0;
      if (ticker && target > 0) {
        const hourResult = findTargetHitHour_(ticker + '.JK', hitDate, target, '00:00:00');
        row[12] = hourResult.hour || '';
      }
    }
  });
}



/**
 * Update REKAP_SCREENING yang sudah ada tanpa membuat ulang data historis.
 *
 * FUNGSI INI SENGAJA HANYA MEMPERBARUI KOLOM:
 *   H = KONFIRMASI TARGET
 *
 * Semua data sebelumnya (tanggal, saham, PFS, signal, HARGA SCREENING, target,
 * keuntungan %, volume, volume ratio, dan keterangan BARU/LAMA) tetap dipertahankan.
 *
 * Gunakan menu:
 *   PFS -> 4. Update Rekap Screening FAST / Cek Adaptive Target
 *
 * Target dianggap tercapai jika HIGH harian >= ADAPTIVE TARGET 1.
 * Hari ke-1 = hari perdagangan setelah tanggal screening.
 */
/**
 * V64 REALTIME REKAP - FIX PERGERAKAN SEMUA BARIS
 * Satu tombol untuk memperbarui PFS, SIGNAL, PERUBAHAN SIGNAL,
 * PERUBAHAN PFS dan PERGERAKAN SAHAM % berdasarkan data pasar terbaru.
 * V64 menambahkan refresh quote TERPISAH untuk seluruh saham yang sudah
 * ada di REKAP_SCREENING, termasuk saham yang saat ini tidak masuk Top N /
 * tidak lagi lolos filter screening. Dengan demikian PERGERAKAN SAHAM %
 * tidak lagi bergantung pada hasil screening terbaru.
 *
 * Alur:
 * 1) Screening ulang memakai quote terbaru.
 * 2) REKAP_SCREENING diperbarui dari hasil screening terbaru.
 * 3) Konfirmasi Adaptive Target diperiksa setelah data terbaru masuk.
 *
 * Harga SCREENING/JAM dan Adaptive Target tetap terkunci sesuai aturan lama.
 */
function updateRekapRealtime() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.SCREENING_LOCK_TIMEOUT_MS)) {
    SpreadsheetApp.getUi().alert(
      'UPDATE REALTIME sedang berjalan. Tunggu proses sebelumnya selesai lalu coba lagi.'
    );
    return;
  }

  try {
    ss.toast('UPDATE REALTIME: mengambil harga + menghitung ulang PFS...', 'PFS V64', 5);

    // Ini memaksa quote terbaru dan menghitung ulang PFS/SIGNAL.
    // Histori OHLCV tetap menggunakan cache sehingga proses tidak seberat
    // mengunduh seluruh histori setiap kali.
    screenAllStocksCore_(false);

    // V64 FIX: refresh PERGERAKAN SAHAM % untuk SEMUA baris REKAP_SCREENING.
    // Tidak hanya saham yang masih lolos screening/top-N. Harga pembanding
    // selalu HARGA SCREENING yang terkunci pada REKAP_SCREENING_LOCK.
    refreshRekapMovementRealtimeV64_(ss);

    // Setelah screening selesai, cek target dengan data terbaru.
    updateRekapAdaptiveTarget();

    // updateRekapAdaptiveTarget() menulis ulang REKAP, sehingga refresh movement
    // dilakukan sekali lagi setelah penulisan terakhir agar nilai movement tidak
    // tertimpa oleh proses normalisasi/target confirmation.
    refreshRekapMovementRealtimeV64_(ss);

    SpreadsheetApp.flush();
    ss.toast(
      'UPDATE REALTIME selesai: PFS, SIGNAL, perubahan PFS, signal dan PERGERAKAN SAHAM % seluruh rekap diperbarui.',
      'PFS V64',
      8
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('UPDATE REALTIME gagal:\n\n' + e.message);
    throw e;
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/**
 * V64 FIX - Refresh PERGERAKAN SAHAM % untuk SELURUH REKAP_SCREENING.
 *
 * Masalah V63:
 * updateRekapScreeningToSheet_() hanya menyentuh saham yang masih ada di
 * hasil screening terbaru. Jika sebuah saham sudah pernah masuk REKAP tetapi
 * kemudian PFS turun / keluar Top-N, kolom PERGERAKAN SAHAM % berhenti berubah.
 *
 * V64 memisahkan refresh harga dari proses screening:
 * - Ambil quote terbaru untuk semua ticker yang ada di REKAP_SCREENING.
 * - Jika endpoint quote batch tidak mengembalikan ticker tertentu, fallback
 *   ke chart 1m Yahoo untuk mendapatkan regularMarketPrice terbaru.
 * - Hitung movement terhadap HARGA SCREENING yang terkunci.
 * - Tidak mengubah HARGA SCREENING/JAM, TARGET, KEUNTUNGAN, PFS, SIGNAL,
 *   status BARU/LAMA, atau histori.
 */
function refreshRekapMovementRealtimeV64_(ss) {
  const sheet = ss.getSheetByName('REKAP_SCREENING');
  if (!sheet || sheet.getLastRow() < 2) return { updated: 0, missing: 0 };

  const lastRow = sheet.getLastRow();
  const values = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  const tickers = [];
  const seen = {};

  values.forEach(function(r) {
    const ticker = String(r[1] || '').trim().toUpperCase();
    if (ticker && !seen[ticker]) {
      seen[ticker] = true;
      tickers.push(ticker);
    }
  });

  if (!tickers.length) return { updated: 0, missing: 0 };

  const lockSheet = getOrCreateRekapLockSheet_(ss, 'REKAP_SCREENING_LOCK');
  const locks = loadRekapLocks_(lockSheet);
  const symbols = tickers.map(function(t) { return t + '.JK'; });

  // Wajib fresh. Jangan gunakan CacheService untuk movement.
  let quotes = fetchYahooLatestQuotesBatch_(symbols, true);
  const missingSymbols = symbols.filter(function(symbol) {
    return !quotes[symbol] || !isFinite(Number(quotes[symbol].price)) || Number(quotes[symbol].price) <= 0;
  });

  // Fallback jika Yahoo Quote API tidak mengembalikan sebagian ticker IDX.
  if (missingSymbols.length) {
    const fallback = fetchYahooRealtimeChartFallbackV64_(missingSymbols);
    Object.keys(fallback).forEach(function(symbol) {
      quotes[symbol] = fallback[symbol];
    });
  }

  let updated = 0;
  let missing = 0;
  const movementValues = [];
  const volumeValues = [];

  values.forEach(function(r) {
    const ticker = String(r[1] || '').trim().toUpperCase();
    if (!ticker) {
      movementValues.push([r[9] || '']);
      volumeValues.push([r[13] || '']);
      return;
    }

    const q = quotes[ticker + '.JK'];
    const date = normalizeRekapDate_(r[0]);
    const key = date + '|' + ticker;
    const locked = locks[key] || {};
    const lockedPrice = Number(locked.price) > 0
      ? Number(locked.price)
      : parseRekapPrice_(r[6]);
    const latestPrice = q ? Number(q.price) : 0;

    if (latestPrice > 0 && lockedPrice > 0) {
      const delta = ((latestPrice / lockedPrice) - 1) * 100;
      movementValues.push([(delta > 0 ? '+' : '') + delta.toFixed(2) + '%']);
      updated++;
    } else {
      movementValues.push([r[9] || '']);
      missing++;
    }

    // Volume terbaru juga disegarkan jika quote tersedia.
    if (q && isFinite(Number(q.volume)) && Number(q.volume) >= 0) {
      volumeValues.push([Math.round(Number(q.volume))]);
    } else {
      volumeValues.push([r[13] || '']);
    }
  });

  // Tulis hanya J (PERGERAKAN) dan N (VOLUME). Semua kolom historis lainnya aman.
  sheet.getRange(2, 10, values.length, 1).setValues(movementValues);
  sheet.getRange(2, 14, values.length, 1).setValues(volumeValues);

  // Format warna movement tanpa mengubah isi lain.
  const movementColors = movementValues.map(function(r) {
    const s = String(r[0] == null ? '' : r[0]).trim();
    if (!s || s === 'BARU') return ['#666666'];
    const n = parseFloat(s.replace('%', '').replace(',', '.'));
    if (!isFinite(n) || Math.abs(n) < 0.000001) return ['#000000'];
    return [n > 0 ? '#008000' : '#cc0000'];
  });
  sheet.getRange(2, 10, values.length, 1)
    .setFontColors(movementColors)
    .setFontWeight('bold');
  sheet.getRange(2, 14, values.length, 1).setNumberFormat('#,##0');

  return { updated: updated, missing: missing, total: values.length };
}

/**
 * V64 fallback quote realtime berbasis Yahoo Chart 1 menit.
 * Dipakai hanya untuk ticker yang tidak dikembalikan endpoint Quote batch.
 * Menggunakan fetchAll agar fallback beberapa saham tetap cepat.
 */
function fetchYahooRealtimeChartFallbackV64_(symbols) {
  const out = {};
  const requests = symbols.map(function(symbol) {
    return {
      url: 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
        '?range=1d&interval=1m&includePrePost=false&events=div%2Csplits',
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*'
      }
    };
  });

  for (let start = 0; start < requests.length; start += 30) {
    const chunk = requests.slice(start, start + 30);
    try {
      const responses = UrlFetchApp.fetchAll(chunk);
      responses.forEach(function(response, idx) {
        try {
          if (response.getResponseCode() !== 200) return;
          const json = JSON.parse(response.getContentText());
          const result = json.chart && json.chart.result && json.chart.result[0];
          if (!result) return;

          const meta = result.meta || {};
          let price = Number(meta.regularMarketPrice);
          let marketTime = meta.regularMarketTime ? Number(meta.regularMarketTime) : null;
          let volume = Number(meta.regularMarketVolume);

          const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
          const timestamps = result.timestamp || [];
          if (quote && timestamps.length) {
            for (let i = timestamps.length - 1; i >= 0; i--) {
              const c = Number(quote.close && quote.close[i]);
              if (isFinite(c) && c > 0) {
                price = c;
                marketTime = Number(timestamps[i]);
                const v = Number(quote.volume && quote.volume[i]);
                if (isFinite(v)) volume = v;
                break;
              }
            }
          }

          if (!isFinite(price) || price <= 0) return;
          const symbol = symbols[start + idx];
          out[symbol] = {
            symbol: symbol,
            price: price,
            volume: isFinite(volume) ? volume : 0,
            marketTime: marketTime,
            fetchedAt: Date.now()
          };
        } catch (ignore) {}
      });
    } catch (e) {
      console.log('Yahoo chart fallback V64 gagal: ' + e.message);
    }
  }

  return out;
}

function updateRekapAdaptiveTarget() {
  // V54 FIX: Update REKAP_SCREENING hanya pada status target.
  // Semua kolom lain dipertahankan persis pada posisi A:P.
  const FAST_REKAP_MODE = true;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('REKAP_SCREENING');

  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert(
      'REKAP_SCREENING belum memiliki data.\n\n' +
      'Jalankan PFS → Screening Semua Saham terlebih dahulu.'
    );
    return;
  }

  const HEADERS = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  // Pastikan REKAP selalu mempunyai 16 kolom dan header yang benar.
  ensureRekapColumns_(sheet, HEADERS.length);
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);
  const raw = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const normalized = [];

  raw.forEach(function(r) {
    const date = normalizeRekapDate_(r[0]);
    const ticker = String(r[1] || '').trim().toUpperCase();
    if (!date || !ticker) return;

    // V54 membaca format A:P secara eksplisit.
    // Jangan pernah memakai kolom M sebagai volume atau kolom O sebagai keterangan.
    const row = [
      date,
      ticker,
      Number(r[2]) || 0,
      String(r[3] || '').trim(),
      r[4] == null ? '' : r[4],
      r[5] == null ? '' : r[5],
      r[6] == null ? '' : r[6],
      Number(r[7]) || 0,
      Number(r[8]) || calculateTargetProfitPct_(parseRekapPrice_(r[6]), Number(r[7]) || 0),
      r[9] == null ? '' : r[9],
      String(r[10] || 'BELUM TERCAPAI').trim(),
      r[11] ? normalizeRekapDate_(r[11]) : '',
      r[12] == null ? '' : String(r[12]).trim(),
      parseMarketNumberV53_(r[13]),
      parseMarketNumberV53_(r[14]),
      (String(r[15] || '').trim().toUpperCase() === 'BARU') ? 'BARU' : 'LAMA'
    ];

    // Jika ada data V50/V51 lama yang belum mempunyai kolom PERGERAKAN,
    // migrasikan berdasarkan header/posisi lama tanpa menggeser volume.
    const noteP = String(r[15] || '').trim().toUpperCase();
    const noteO = String(r[14] || '').trim().toUpperCase();
    if (noteP !== 'BARU' && noteP !== 'LAMA' && (noteO === 'BARU' || noteO === 'LAMA')) {
      // Format lama 15 kolom: J=KONFIRMASI, K=TGL, L=JAM, M=VOLUME, N=RATIO, O=KETERANGAN.
      row[9] = '';
      row[10] = String(r[9] || 'BELUM TERCAPAI').trim();
      row[11] = r[10] ? normalizeRekapDate_(r[10]) : '';
      row[12] = r[11] == null ? '' : String(r[11]).trim();
      row[13] = parseMarketNumberV53_(r[12]);
      row[14] = parseMarketNumberV53_(r[13]);
      row[15] = noteO;
    }

    normalized.push(row);
  });

  if (!normalized.length) {
    SpreadsheetApp.getUi().alert('REKAP_SCREENING tidak mempunyai data yang valid untuk diperbarui.');
    return;
  }

  const before = normalized.filter(function(r) {
    return String(r[10] || '').toUpperCase().indexOf('TERCAPAI') === 0;
  }).length;

  // Hanya memperbarui K:M. Harga screening (G), target (H), keuntungan (I),
  // pergerakan (J), volume (N), ratio (O), dan keterangan (P) tetap.
  updateTargetConfirmations_(normalized);

  // Tulis kembali SELURUH A:P dalam struktur yang sama, sehingga tidak ada
  // lagi pergeseran kolom seperti volume masuk ke jam tercapai.
  ensureRekapColumns_(sheet, HEADERS.length);
  sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, normalized.length), HEADERS.length).clearContent();
  sheet.getRange(2, 1, normalized.length, HEADERS.length).setValues(normalized);
  formatRekapScreening_(sheet);

  // Sinkronkan Watchlist setelah REKAP_SCREENING selesai, tanpa fetch tambahan.
  try {
    updateRekapSignalWatchlist(true);
  } catch (watchErr) {
    console.log('Sinkronisasi REKAP SIGNAL WATCHLIST gagal: ' + watchErr.message);
  }

  removeStandaloneTargetConfirmationSheet_(ss);

  const after = normalized.filter(function(r) {
    return String(r[10] || '').toUpperCase().indexOf('TERCAPAI') === 0;
  }).length;
  const newlyHit = Math.max(0, after - before);
  const pending = normalized.filter(function(r) {
    return String(r[10] || '').toUpperCase().indexOf('BELUM TERCAPAI') === 0;
  }).length;

  SpreadsheetApp.flush();

  ss.toast(
    'REKAP_SCREENING V54 rapi: ' + normalized.length +
    ' data | Target tercapai: ' + after +
    ' | Belum tercapai: ' + pending,
    'PFS', 8
  );

  SpreadsheetApp.getUi().alert(
    'UPDATE REKAP SCREENING SELESAI\n\n' +
    'Total data: ' + normalized.length + '\n' +
    'Target tercapai: ' + after + '\n' +
    'Target baru tercapai: ' + newlyHit + '\n' +
    'Belum tercapai: ' + pending + '\n\n' +
    'Harga screening, jam screening, Adaptive Target, keuntungan, pergerakan, volume dan keterangan tetap pada kolom yang benar.\n' +
    'Histori tetap disimpan.'
  );
}

function removeStandaloneTargetConfirmationSheet_(ss) {
  const oldSheet = ss.getSheetByName('KONFIRMASI_TARGET');
  if (!oldSheet) return;

  try {
    ss.deleteSheet(oldSheet);
    console.log('Sheet KONFIRMASI_TARGET versi lama dihapus.');
  } catch (e) {
    console.log('Gagal menghapus KONFIRMASI_TARGET: ' + e.message);
  }
}


function updateTargetConfirmationSheet_(ss, rows, sourceSheetName) {
  const sourceName = sourceSheetName || 'REKAP_SCREENING';
  const rekap = ss.getSheetByName(sourceName);
  if (!rekap) return;

  const name = sourceName === 'REKAP_SCREENING'
    ? 'KONFIRMASI_TARGET'
    : 'KONFIRMASI_' + sourceName;

  const sheet = getOrCreate_(ss, name);

  const headers = [
    'TANGGAL DATA',
    'SAHAM',
    'PFS',
    'SIGNAL',
    'HARGA SCREENING',
    'TARGET',
    'KEUNTUNGAN %',
    'TANGGAL TERCAPAI',
    'JAM TERCAPAI (1M)',
    'HARI KE-',
    'STATUS',
    'WAKTU KONFIRMASI',
    'KETERANGAN'
  ];

  ensureRekapColumns_(sheet, headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const nowText = Utilities.formatDate(
    new Date(),
    'Asia/Jakarta',
    'yyyy-MM-dd HH:mm:ss'
  );

  const output = [];
  const hitCache = {};

  (rows || []).forEach(function(r) {
    const date = normalizeRekapDate_(r[0]);
    const ticker = String(r[1] || '').trim().toUpperCase();
    const target = Number(r[5]) || 0;
    const confirmation = String(r[7] || '').trim();

    if (!date || !ticker || target <= 0) return;

    const isHit = confirmation.toUpperCase().indexOf('TERCAPAI') === 0;

    let hitDate = '';
    let hourText = '';
    let dayNumber = '';
    let status = isHit ? 'TERCAPAI' : 'BELUM TERCAPAI';
    let note = isHit
      ? 'Tanggal dari candle harian pertama yang HIGH >= target.'
      : 'Belum ada candle harian dengan HIGH >= target.';

    if (isHit) {
      // Format existing: TERCAPAI HARI KE-X | YYYY-MM-DD
      const m = confirmation.match(/HARI KE-(\d+)\s*\|\s*(\d{4}-\d{2}-\d{2})/i);
      if (m) {
        dayNumber = Number(m[1]);
        hitDate = m[2];
      }

      // Ambil jam target dari candle 1 jam pada tanggal tercapai.
      if (hitDate) {
        const cacheKey = ticker + '|' + hitDate + '|' + target;
        if (Object.prototype.hasOwnProperty.call(hitCache, cacheKey)) {
          hourText = hitCache[cacheKey].hour;
          note = hitCache[cacheKey].note;
        } else {
          const intraday = findTargetHitHour_(ticker + '.JK', hitDate, target);
          hourText = intraday.hour;
          note = intraday.note;
          hitCache[cacheKey] = {
            hour: hourText,
            note: note
          };
        }
      }
    }

    output.push([
      date,
      ticker,
      Number(r[2]) || 0,
      r[3] || '',
      parseRekapPrice_(r[4]),
      target,
      Number(r[6]) || calculateTargetProfitPct_(parseRekapPrice_(r[4]), target),
      hitDate || '',
      hourText || '',
      dayNumber === '' ? '' : dayNumber,
      status,
      nowText,
      note
    ]);
  });

  // Terbaru di atas, lalu PFS tertinggi.
  output.sort(function(a, b) {
    if (String(a[0]) !== String(b[0])) {
      return String(b[0]).localeCompare(String(a[0]));
    }
    if (String(a[7]) !== String(b[7])) {
      return String(b[7]).localeCompare(String(a[7]));
    }
    return (Number(b[2]) || 0) - (Number(a[2]) || 0);
  });

  const oldRows = Math.max(sheet.getLastRow() - 1, 1);
  sheet.getRange(2, 1, oldRows, headers.length).clearContent();

  if (output.length) {
    sheet.getRange(2, 1, output.length, headers.length).setValues(output);
  }

  formatTargetConfirmationSheet_(sheet, output.length);

  // Posisikan tepat setelah REKAP_SCREENING.
  try {
    const rekapIndex = rekap.getIndex();
    const targetIndex = sheet.getIndex();
    if (targetIndex !== rekapIndex + 1) {
      sheet.activate();
      ss.moveActiveSheet(rekapIndex + 1);
    }
  } catch (e) {
    console.log('Tidak dapat memindahkan sheet KONFIRMASI_TARGET: ' + e.message);
  }
}


/**
 * Cari jam candle 1 jam pertama yang HIGH >= target pada tanggal target.
 * Output jam menggunakan timezone spreadsheet (idealnya Asia/Jakarta).
 */
function parseRekapScreeningTime_(value) {
  const s = String(value || '');
  const m = s.match(/(?:\n|\s)(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:WIB)?/i);
  return m ? normalizeScreeningTime_(m[1]) : '00:00:00';
}

function normalizeScreeningTime_(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '00:00:00';
  return String(m[1]).padStart(2, '0') + ':' + m[2] + ':' + (m[3] || '00');
}

function findTargetHitHour_(symbol, targetDateText, target, minTimeText) {
  const tz = 'Asia/Jakarta'; // WIB, wajib untuk TGL/JAM TERCAPAI
  const minTime = normalizeScreeningTime_(minTimeText || '00:00:00');

  try {
    const start = new Date(targetDateText + 'T00:00:00+07:00'); // WIB
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const period1 = Math.floor(start.getTime() / 1000);
    const period2 = Math.floor(end.getTime() / 1000);

    const cache = CacheService.getScriptCache();
    const cacheKey = makeYahooCacheKey_(
      'M1_' + String(symbol).replace(/[^A-Z0-9._-]/gi, '_') + '_' + targetDateText + '_' + minTime,
      1
    );

    const cached = cache.get(cacheKey);
    if (cached) {
      const cachedResult = JSON.parse(cached);
      if (cachedResult && cachedResult.hour !== undefined) {
        return cachedResult;
      }
    }

    const url =
      'https://query1.finance.yahoo.com/v8/finance/chart/' +
      encodeURIComponent(symbol) +
      '?period1=' + period1 +
      '&period2=' + period2 +
      '&interval=1m' +
      '&events=history' +
      '&includeAdjustedClose=true';

    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
      }
    });

    if (response.getResponseCode() !== 200) {
      const fallback = {
        hour: '',
        hit: false,
        note: 'Data intraday 1 menit tidak tersedia (HTTP ' + response.getResponseCode() + ').'
      };
      try { cache.put(cacheKey, JSON.stringify(fallback), 86400); } catch (ignore) {}
      return fallback;
    }

    const json = JSON.parse(response.getContentText());
    const result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) {
      const fallback = {
        hour: '',
        hit: false,
        note: 'Data intraday 1 menit tidak tersedia.'
      };
      try { cache.put(cacheKey, JSON.stringify(fallback), 86400); } catch (ignore) {}
      return fallback;
    }

    const quote = result.indicators &&
      result.indicators.quote &&
      result.indicators.quote[0];

    if (!quote) {
      return {
        hour: '',
        hit: false,
        note: 'Data OHLC intraday 1 menit tidak tersedia.'
      };
    }

    for (let i = 0; i < result.timestamp.length; i++) {
      const high = Number(quote.high && quote.high[i]);
      if (!isFinite(high) || high < target) continue;

      const tsDate = new Date(Number(result.timestamp[i]) * 1000);
      const localDate = Utilities.formatDate(tsDate, tz, 'yyyy-MM-dd');

      if (localDate !== targetDateText) continue;

      const hour = Utilities.formatDate(tsDate, tz, 'HH:mm:ss');
      if (hour < minTime) continue;

      const displayHour = Utilities.formatDate(tsDate, tz, 'HH:mm:ss'); // WIB; candle 1 menit, detik data umumnya :00
      const resultObj = {
        hour: displayHour + ' WIB',
        hit: true,
        note: 'Target tersentuh pada candle 1 menit sekitar ' + displayHour + ' WIB.'
      };

      try {
        cache.put(cacheKey, JSON.stringify(resultObj), 86400);
      } catch (ignore) {}

      return resultObj;
    }

    const noHit = {
      hour: '',
      hit: false,
      note: 'Target tercapai pada candle harian, tetapi jam candle 1 menit tidak tersedia.'
    };
    try { cache.put(cacheKey, JSON.stringify(noHit), 86400); } catch (ignore) {}
    return noHit;

  } catch (e) {
    console.log('Cari jam target ' + symbol + ' ' + targetDateText + ': ' + e.message);
    return {
      hour: '',
      note: 'Jam intraday tidak dapat diambil: ' + e.message
    };
  }
}


function formatTargetConfirmationSheet_(sheet, rowCount) {
  const headers = [
    'TANGGAL DATA',
    'SAHAM',
    'PFS',
    'SIGNAL',
    'HARGA SCREENING',
    'TARGET',
    'KEUNTUNGAN %',
    'TANGGAL TERCAPAI',
    'JAM TERCAPAI (1M)',
    'HARI KE-',
    'STATUS',
    'WAKTU KONFIRMASI',
    'KETERANGAN'
  ];

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  const widths = [105, 80, 60, 125, 110, 110, 95, 110, 120, 70, 110, 145, 260];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  if (rowCount <= 0) {
    applyAutoTable_(sheet, headers.length, true);
    return;
  }

  sheet.getRange(2, 1, rowCount, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 3, rowCount, 1).setNumberFormat('0');
  sheet.getRange(2, 5, rowCount, 2).setNumberFormat('#,##0');
  sheet.getRange(2, 7, rowCount, 1).setNumberFormat('0.00"%"');
  sheet.getRange(2, 8, rowCount, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 10, rowCount, 1).setNumberFormat('0');
  sheet.getRange(2, 1, rowCount, headers.length).setVerticalAlignment('middle');

  const statusValues = sheet.getRange(2, 11, rowCount, 1).getValues();
  const statusBgs = statusValues.map(function(r) {
    return [String(r[0] || '').toUpperCase() === 'TERCAPAI'
      ? '#d9ead3'
      : '#fff2cc'];
  });
  sheet.getRange(2, 11, rowCount, 1)
    .setBackgrounds(statusBgs)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange(2, 8, rowCount, 2).setHorizontalAlignment('center');
  sheet.setRowHeights(2, rowCount, 32);
  applyAutoTable_(sheet, headers.length, true);
}




/**
 * ================================================================
 * REKAP SIGNAL LEMAH
 * ================================================================
 * Menyimpan saham dengan SIGNAL LEMAH ke sheet "REKAP SIGNAL LEMAH".
 * Struktur kolom dibuat sama dengan REKAP_SCREENING.
 *
 * Catatan:
 * - Sheet ini khusus untuk riset/watchlist, bukan rekomendasi utama.
 * - Signal dianggap LEMAH jika teks signal mengandung "LEMAH".
 * - Jika PFS/Signal berubah saat screening diperbarui, perubahan
 *   dibandingkan dengan data yang tersimpan sebelumnya.
 * - Harga screening + jam dan adaptive target mengikuti data screening
 *   terbaru, sama seperti REKAP_SCREENING.
 */
function updateRekapSignalLemah() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName('SCREENING');
  if (!source) {
    SpreadsheetApp.getUi().alert('Sheet SCREENING tidak ditemukan.');
    return;
  }

  const targetName = 'REKAP SIGNAL LEMAH';
  const sheet = getOrCreate_(ss, targetName);

  const values = source.getDataRange().getValues();
  if (!values || values.length < 2) {
    SpreadsheetApp.getUi().alert('Sheet SCREENING belum memiliki data.');
    return;
  }

  // Header mengikuti struktur REKAP_SCREENING saat ini.
  const headers = [
    'TANGGAL DATA',
    'SAHAM',
    'PFS',
    'SIGNAL',
    'PERUBAHAN SIGNAL',
    'PERUBAHAN PFS',
    'HARGA SCREENING JAM',
    'ADAPTIVE TARGET 1',
    'KEUNTUNGAN %',
    'KONFIRMASI TARGET',
    'TGL TERCAPAI (WIB)',
    'JAM TERCAPAI (1M, WIB)',
    'VOLUME',
    'VOL vs AVG20',
    'KETERANGAN'
  ];

  // Temukan kolom berdasarkan nama header agar tahan terhadap perubahan posisi.
  const hdr = values[0].map(function(v) {
    return String(v == null ? '' : v).trim().toUpperCase();
  });

  const idx = {
    date: findHeaderIndex_(hdr, ['TANGGAL DATA', 'TANGGAL']),
    ticker: findHeaderIndex_(hdr, ['SAHAM', 'TICKER', 'SYMBOL']),
    pfs: findHeaderIndex_(hdr, ['PFS', 'PREDICTIVE SCORE']),
    signal: findHeaderIndex_(hdr, ['SIGNAL']),
    priceTime: findHeaderIndex_(hdr, ['HARGA SCREENING JAM', 'HARGA SCREENING']),
    target: findHeaderIndex_(hdr, ['ADAPTIVE TARGET 1', 'ADAPTIVE TARGET']),
    profit: findHeaderIndex_(hdr, ['KEUNTUNGAN %']),
    volume: findHeaderIndex_(hdr, ['VOLUME']),
    volAvg: findHeaderIndex_(hdr, ['VOL vs AVG20', 'VOL VS AVG20']),
    note: findHeaderIndex_(hdr, ['KETERANGAN'])
  };

  if (idx.ticker < 0 || idx.signal < 0 || idx.pfs < 0) {
    SpreadsheetApp.getUi().alert('Kolom SAHAM / SIGNAL / PFS tidak ditemukan di sheet SCREENING.');
    return;
  }

  // Ambil data lama untuk mempertahankan status target dan menghitung perubahan.
  const oldValues = sheet.getDataRange().getValues();
  const oldMap = {};
  if (oldValues && oldValues.length > 1) {
    const oh = oldValues[0].map(function(v) {
      return String(v == null ? '' : v).trim().toUpperCase();
    });
    const oi = {
      ticker: findHeaderIndex_(oh, ['SAHAM']),
      pfs: findHeaderIndex_(oh, ['PFS']),
      signal: findHeaderIndex_(oh, ['SIGNAL']),
      confirmation: findHeaderIndex_(oh, ['KONFIRMASI TARGET']),
      hitDate: findHeaderIndex_(oh, ['TGL TERCAPAI (WIB)', 'TGL TERCAPAI']),
      hitTime: findHeaderIndex_(oh, ['JAM TERCAPAI (1M, WIB)', 'JAM TERCAPAI']),
    };

    if (oi.ticker >= 0) {
      for (let r = 1; r < oldValues.length; r++) {
        const key = String(oldValues[r][oi.ticker] || '').trim().toUpperCase();
        if (!key) continue;
        oldMap[key] = {
          pfs: oi.pfs >= 0 ? Number(oldValues[r][oi.pfs]) : null,
          signal: oi.signal >= 0 ? String(oldValues[r][oi.signal] || '') : '',
          confirmation: oi.confirmation >= 0 ? oldValues[r][oi.confirmation] : '',
          hitDate: oi.hitDate >= 0 ? oldValues[r][oi.hitDate] : '',
          hitTime: oi.hitTime >= 0 ? oldValues[r][oi.hitTime] : ''
        };
      }
    }
  }

  const output = [];
  const seen = {};

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const ticker = idx.ticker >= 0 ? String(row[idx.ticker] || '').trim().toUpperCase() : '';
    const signal = idx.signal >= 0 ? String(row[idx.signal] || '').trim() : '';
    const pfs = idx.pfs >= 0 ? Number(row[idx.pfs]) : 0;

    if (!ticker) continue;

    // Hanya signal WATCHLIST dengan PFS di atas 65.
    if (!/WATCHLIST/i.test(signal)) continue;
    if (!(Number(pfs) >= 65 && Number(pfs) <= 70)) continue;

    // Hindari duplikat ticker pada rekap.
    if (seen[ticker]) continue;
    seen[ticker] = true;

    const old = oldMap[ticker] || null;
    const oldPfs = old && isFinite(old.pfs) ? old.pfs : null;
    const pfsChange = oldPfs === null ? 'BARU' : String(pfs - oldPfs);

    let signalChange = 'BARU';
    if (old) {
      const oldSignal = String(old.signal || '').trim();
      signalChange = oldSignal === signal ? 'TETAP' : (oldSignal + ' → ' + signal);
    }

    const dateVal = idx.date >= 0 ? row[idx.date] : new Date();
    const priceTime = idx.priceTime >= 0 ? row[idx.priceTime] : '';
    const target = idx.target >= 0 ? Number(row[idx.target]) || 0 : 0;
    const profit = idx.profit >= 0 ? row[idx.profit] : '';
    const volume = idx.volume >= 0 ? normalizeVolumeV53_(row[idx.volume]) : 0;
    const volAvg = idx.volAvg >= 0 ? row[idx.volAvg] : '';
    const note = idx.note >= 0 ? row[idx.note] : 'BARU';

    // Pertahankan konfirmasi target yang sudah ada. Untuk signal lemah,
    // target tetap dicatat sebagai potensi, bukan rekomendasi.
    const confirmation = old ? old.confirmation : 'BELUM TERCAPAI';
    const hitDate = old ? old.hitDate : '';
    const hitTime = old ? old.hitTime : '';

    output.push([
      dateVal,
      ticker,
      pfs,
      signal,
      signalChange,
      pfsChange,
      priceTime,
      target,
      profit,
      confirmation,
      hitDate,
      hitTime,
      volume,
      volAvg,
      note || 'BARU'
    ]);
  }

  // Urutkan PFS tertinggi.
  output.sort(function(a, b) {
    return (Number(b[2]) || 0) - (Number(a[2]) || 0);
  });

  // Tulis ulang sheet secara cepat satu kali.
  const oldLastRow = Math.max(sheet.getLastRow() - 1, 1);
  const oldLastCol = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), oldLastCol).clearContent();

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (output.length) {
    sheet.getRange(2, 1, output.length, headers.length).setValues(output);
  }

  formatRekapSignalLemah_(sheet, output.length);

  SpreadsheetApp.getUi().alert(
    'Rekap Signal Lemah selesai.\\n\\n' +
    'Jumlah saham signal WATCHLIST: ' + output.length + '\\n' +
    'Sheet: ' + targetName
  );
}


/**
 * Cari index header berdasarkan beberapa nama alternatif.
 */
function findHeaderIndex_(headers, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const pos = headers.indexOf(String(candidates[i]).toUpperCase());
    if (pos >= 0) return pos;
  }
  return -1;
}


/**
 * Format REKAP SIGNAL LEMAH dengan struktur yang sama seperti REKAP_SCREENING.
 */
function formatRekapSignalLemah_(sheet, rowCount) {
  const headers = [
    'TANGGAL DATA',
    'SAHAM',
    'PFS',
    'SIGNAL',
    'PERUBAHAN SIGNAL',
    'PERUBAHAN PFS',
    'HARGA SCREENING JAM',
    'ADAPTIVE TARGET 1',
    'KEUNTUNGAN %',
    'KONFIRMASI TARGET',
    'TGL TERCAPAI (WIB)',
    'JAM TERCAPAI (1M, WIB)',
    'VOLUME',
    'VOL vs AVG20',
    'KETERANGAN'
  ];

  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 42);

  const widths = [105, 80, 55, 115, 150, 90, 115, 110, 90, 160, 110, 125, 115, 95, 100];
  widths.forEach(function(w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  if (!rowCount) return;

  sheet.getRange(2, 3, rowCount, 1).setNumberFormat('0');
  sheet.getRange(2, 8, rowCount, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 9, rowCount, 1).setNumberFormat('0.00%');

  // Signal LEMAH diberi warna lembut agar jelas tetapi tidak dianggap rekomendasi.
  sheet.getRange(2, 4, rowCount, 1)
    .setBackground('#f4cccc')
    .setFontColor('#990000')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Adaptive Target dan Volume satu warna dasar, seperti REKAP_SCREENING.
  const base = '#d9ead3';
  sheet.getRange(2, 8, rowCount, 1).setBackground(base).setFontColor('#000000');
  sheet.getRange(2, 13, rowCount, 1).setBackground(base);

  // Warna huruf volume berdasarkan VOL vs AVG20.
  const ratios = sheet.getRange(2, 14, rowCount, 1).getValues();
  const colors = ratios.map(function(r) {
    const raw = String(r[0] == null ? '' : r[0]).replace(',', '.');
    const ratio = parseFloat(raw.replace(/x/gi, '').replace('%', ''));
    if (!isFinite(ratio)) return ['#000000'];
    if (ratio >= 1.50) return ['#008000'];
    if (ratio >= 0.75) return ['#b8860b'];
    return ['#cc0000'];
  });
  sheet.getRange(2, 13, rowCount, 1).setFontColors(colors);

  // Perubahan PFS: sama = 0.
  const pfsChanges = sheet.getRange(2, 6, rowCount, 1).getValues();
  const pfsColors = pfsChanges.map(function(r) {
    const s = String(r[0] == null ? '' : r[0]).trim();
    if (s === '0') return ['#000000'];
    if (/^\+/.test(s)) return ['#008000'];
    if (/^-/.test(s)) return ['#cc0000'];
    return ['#000000'];
  });
  sheet.getRange(2, 6, rowCount, 1).setFontColors(pfsColors);

  sheet.setRowHeights(2, rowCount, 32);

  if (typeof applyAutoTable_ === 'function') {
    applyAutoTable_(sheet, headers.length, true);
  }
}


/**
 * ================================================================
 * ADAPTIVE AVERAGE DOWN / RECOVERY ENGINE
 * ================================================================
 * Prinsip:
 * 1. Tidak melakukan AD hanya karena harga turun.
 * 2. Entry harus berasal dari harga screening yang sudah terkunci.
 * 3. Harga turun -> hitung drawdown dan Drawdown/ATR.
 * 4. PFS + RSR20/60 + EMA + MACD + OBV + MFI digunakan untuk
 *    menilai apakah pullback masih sehat dan memiliki bukti recovery.
 * 5. AD1 dan AD2 mempunyai ambang score berbeda dan lebih ketat.
 * 6. Setelah drawdown melewati batas maksimum atau struktur rusak,
 *    status = STOP AD.
 *
 * Output sheet:
 * ADAPTIVE_AD
 * HANYA menampilkan status AD1 BOLEH / AD2 BOLEH yang berasal dari
 * posisi aktif di REKAP_SCREENING. HOLD dan STOP tidak ditampilkan.
 */
function updateAdaptiveAverageDown(showAlert) {
  updateAdaptiveAverageDown_(showAlert !== false);
}

function updateAdaptiveAverageDown_(showAlert) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreate_(ss, 'ADAPTIVE_AD');
  const rekap = ss.getSheetByName('REKAP_SCREENING');

  const headers = [
    'TANGGAL ENTRY','SAHAM','PFS ENTRY','ENTRY TERKUNCI',
    'TARGET AWAL','HARGA SEKARANG','DRAWDOWN %','ATR14 %','DD / ATR',
    'PFS SEKARANG','RSR20','RSR60','EMA STRUCTURE','MACD',
    'OBV','MFI','RECOVERY SCORE','STATUS AD','STATUS INDIKATOR',
    'AD1 PRICE','AD2 PRICE','AVG SETELAH AD1','AVG SETELAH AD2',
    'TARGET SETELAH AD1','TARGET SETELAH AD2','TARGET AKTIF','UPSIDE %',
    'ALASAN'
  ];

  sheet.clear();
  sheet.getRange(1,1,1,headers.length).setValues([headers]);

  if (!CFG.AD_ENABLED) {
    sheet.getRange(2,1).setValue('Adaptive Average Down dinonaktifkan di CFG.AD_ENABLED.');
    return;
  }

  if (!rekap || rekap.getLastRow() < 2) {
    sheet.getRange(2,1).setValue(
      'Belum ada REKAP_SCREENING. Jalankan Screening Semua Saham terlebih dahulu.'
    );
    return;
  }

  const lastRow = rekap.getLastRow();
  const raw = rekap.getRange(2,1,lastRow-1,Math.max(11,rekap.getLastColumn())).getValues();

  // Hanya gunakan entry terbaru per ticker yang masih belum mencapai target.
  const latestByTicker = {};
  raw.forEach(function(r) {
    const date = normalizeRekapDate_(r[0]);
    const ticker = String(r[1] || '').trim().toUpperCase();
    const entry = parseRekapPrice_(r[4]);
    const target = Number(r[5]) || 0;
    const confirmation = String(r[7] || '').toUpperCase();
    if (!date || !ticker || entry <= 0) return;
    if (confirmation.indexOf('TERCAPAI') === 0) return;

    if (!latestByTicker[ticker] ||
        date > latestByTicker[ticker].date) {
      latestByTicker[ticker] = {
        date: date,
        ticker: ticker,
        pfsEntry: Number(r[2]) || 0,
        entry: entry,
        target: target
      };
    }
  });

  const tickers = Object.keys(latestByTicker);
  if (!tickers.length) {
    sheet.getRange(2,1).setValue(
      'Tidak ada posisi aktif yang belum mencapai target.'
    );
    return;
  }

  const ihsg = fetchYahooHistory_('^JKSE', CFG.LOOKBACK_DAYS);
  const rows = [];
  const errors = [];

  tickers.forEach(function(ticker) {
    try {
      const pos = latestByTicker[ticker];
      const stock = fetchYahooHistory_(ticker + '.JK', CFG.LOOKBACK_DAYS);
      if (!stock || stock.length < CFG.MIN_BARS) {
        errors.push(ticker + ': data tidak cukup');
        return;
      }

      const calc = calculateIndicators_(stock, ihsg);
      const screen = screenScore_(stock, calc);
      const x = calc.latest;

      const currentPrice = Number(x.close) || 0;
      const drawdownPct = pos.entry > 0
        ? ((currentPrice / pos.entry) - 1) * 100
        : 0;

      const atrPct = Number(screen.atrPct) || 0;
      const ddAtr = atrPct > 0 ? Math.abs(drawdownPct) / atrPct : 999;

      const ad = calculateAdaptiveADScore_(stock, calc, screen, pos.entry);

      const ad1Price = roundPriceByTick_(pos.entry * (1 + CFG.AD1_MAX_DRAWDOWN_PCT / 100));
      const ad2Price = roundPriceByTick_(pos.entry * (1 + CFG.AD2_MAX_DRAWDOWN_PCT / 100));

      const avg1 = weightedAverageAfterAD_(pos.entry, 100, ad1Price, CFG.AD1_CAPITAL_PCT);
      const avg2 = weightedAverageAfterAD2_(
        pos.entry, 100,
        ad1Price, CFG.AD1_CAPITAL_PCT,
        ad2Price, CFG.AD2_CAPITAL_PCT
      );

      // ==============================================================
      // ADAPTIVE TARGET BARU
      // Target dihitung ulang dari average setelah AD.
      // ==============================================================
      const baseRecoveryPct = ad.score >= CFG.AD_STRONG_RECOVERY_SCORE
        ? CFG.AD_STRONG_RECOVERY_TARGET_PCT
        : CFG.AD_RECOVERY_TARGET_PCT;

      const rawTargetAD1 = roundPriceByTick_(
        avg1 * (1 + baseRecoveryPct / 100)
      );
      const rawTargetAD2 = roundPriceByTick_(
        avg2 * (1 + baseRecoveryPct / 100)
      );

      const capToOriginal = function(rawTarget) {
        if (!rawTarget || rawTarget <= 0) return 0;
        if (CFG.AD_STRONG_TARGET_OVERRIDE) return rawTarget;
        if (pos.target > 0) return Math.min(rawTarget, pos.target);
        return rawTarget;
      };

      const targetAD1 = capToOriginal(rawTargetAD1);
      const targetAD2 = capToOriginal(rawTargetAD2);

      let status = 'HOLD - BELUM AD';
      if (drawdownPct >= -0.50) {
        status = 'HOLD - BELUM PULLBACK';
      } else if (drawdownPct < CFG.AD_MAX_DRAWDOWN_PCT || ddAtr > CFG.AD_MAX_ATR_MULTIPLE) {
        status = 'STOP AD';
      } else if (
        drawdownPct <= CFG.AD2_MAX_DRAWDOWN_PCT &&
        screen.score >= CFG.AD_MIN_PFS &&
        ad.score >= CFG.AD2_MIN_RECOVERY_SCORE
      ) {
        status = 'AD2 BOLEH';
      } else if (
        drawdownPct <= CFG.AD1_MAX_DRAWDOWN_PCT &&
        screen.score >= CFG.AD_MIN_PFS &&
        ad.score >= CFG.AD1_MIN_RECOVERY_SCORE
      ) {
        status = 'AD1 BOLEH';
      } else if (drawdownPct <= CFG.AD1_MAX_DRAWDOWN_PCT) {
        status = 'HOLD - TUNGGU RECOVERY';
      }

      // Target aktif:
      // AD2 -> AVG setelah AD2
      // AD1 / waiting recovery -> AVG setelah AD1
      // Belum AD / STOP -> target awal
      let activeTarget = pos.target;
      if (status === 'AD2 BOLEH') {
        activeTarget = targetAD2 || pos.target;
      } else if (
        status === 'AD1 BOLEH' ||
        status === 'HOLD - TUNGGU RECOVERY'
      ) {
        activeTarget = targetAD1 || pos.target;
      }

      const upsideToActiveTarget = currentPrice > 0 && activeTarget > 0
        ? ((activeTarget / currentPrice) - 1) * 100
        : 0;

      const indicatorStatus = getAdaptiveIndicatorStatus_(screen.score, x.rsr20, x.rsr60, ad.emaStructure, ad.macd, ad.obv, Number(x.mfi), ad.score);

      // ADAPTIVE_AD hanya menampilkan saham yang benar-benar mendapat
      // INSTRUKSI Average Down dari REKAP_SCREENING. HOLD/STOP tidak
      // dimasukkan ke sheet ini agar sheet tetap bersih dan fokus.
      if (status === 'AD1 BOLEH' || status === 'AD2 BOLEH') {
        rows.push([
          pos.date,
          ticker,
          pos.pfsEntry,
          pos.entry,
          pos.target,
          currentPrice,
          drawdownPct,
          atrPct,
          ddAtr,
          screen.score,
          x.rsr20,
          x.rsr60,
          ad.emaStructure,
          ad.macd,
          ad.obv,
          ad.mfi,
          ad.score,
          status,
          indicatorStatus,
          ad1Price,
          ad2Price,
          avg1,
          avg2,
          targetAD1,
          targetAD2,
          activeTarget,
          upsideToActiveTarget,
          ad.reason
        ]);
      }
    } catch (e) {
      errors.push(ticker + ': ' + e.message);
    }
  });

  rows.sort(function(a,b) {
    const priority = {
      'AD2 BOLEH': 1,
      'AD1 BOLEH': 2,
      'HOLD - TUNGGU RECOVERY': 3,
      'HOLD - BELUM AD': 4,
      'STOP AD': 5
    };
    const pa = priority[a[17]] || 9;
    const pb = priority[b[17]] || 9;
    return pa - pb || Number(b[16]) - Number(a[16]);
  });

  if (rows.length) {
    sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  }

  if (!rows.length && !errors.length) {
    sheet.getRange(2,1).setValue('Belum ada instruksi Average Down dari REKAP_SCREENING.');
    sheet.getRange(2,1,1,28).merge();
  }

  if (errors.length) {
    const start = Math.max(sheet.getLastRow() + 2, rows.length + 3);
    sheet.getRange(start,1).setValue('ERROR');
    sheet.getRange(start+1,1,errors.length,1).setValues(errors.map(function(e){return [e];}));
  }

  formatAdaptiveADSheet_(sheet, rows.length);
  applyAutoTable_(sheet, 28, true);

  if (showAlert) {
    const ad1 = rows.filter(r => r[17] === 'AD1 BOLEH').length;
    const ad2 = rows.filter(r => r[17] === 'AD2 BOLEH').length;
    const stop = rows.filter(r => r[17] === 'STOP AD').length;

    SpreadsheetApp.getUi().alert(
      'ADAPTIVE AVERAGE DOWN SELESAI\n\n' +
      'Instruksi AD aktif: ' + rows.length + '\n' +
      'AD1 BOLEH: ' + ad1 + '\n' +
      'AD2 BOLEH: ' + ad2 + '\n' +
      'STOP AD: ' + stop + '\n\n' +
      'Hanya saham dengan instruksi AD1/AD2 dari REKAP_SCREENING yang ditampilkan.'
    );
  }
}

function calculateAdaptiveADScore_(stock, calc, screen, entry) {
  const x = calc.latest;
  const n = stock.length;
  const prevCalc = calc.rows.length >= 2 ? calc.rows[calc.rows.length - 2] : null;

  let score = 0;
  const reasons = [];

  // ==============================================================
  // RECOVERY SCORE V23 BALANCED - TOTAL 100
  // Tujuan: mencari pullback yang masih sehat dan punya peluang rebound,
  // dengan sedikit kelonggaran dibanding V22 agar kandidat tidak terlalu cepat gugur.
  // ==============================================================

  // 1) PFS SEKARANG - 25 poin
  // PFS di bawah AD_MIN_PFS adalah HARD GATE: tidak boleh dianggap
  // kandidat recovery meskipun indikator lain masih bagus.
  const pfs = Number(screen.score) || 0;
  if (pfs >= 90) { score += 25; reasons.push('PFS sangat kuat'); }
  else if (pfs >= 85) { score += 23; reasons.push('PFS kuat'); }
  else if (pfs >= 80) { score += 21; reasons.push('PFS sehat'); }
  else if (pfs >= CFG.AD_MIN_PFS) { score += 18; reasons.push('PFS cukup'); }
  else { reasons.push('PFS di bawah batas AD'); }

  // 2) RSR20 - 15 poin: kekuatan relatif jangka pendek lebih penting
  // untuk mendeteksi pullback yang masih berpotensi rebound.
  if (x.rsr20 >= 85) score += 15;
  else if (x.rsr20 >= 75) score += 12;
  else if (x.rsr20 >= 65) score += 8;
  else if (x.rsr20 >= 60) score += 5;
  else if (x.rsr20 >= 55) score += 2;
  else reasons.push('RSR20 lemah');

  // 3) RSR60 - 10 poin: memastikan trend menengah belum rusak.
  if (x.rsr60 >= 85) score += 10;
  else if (x.rsr60 >= 75) score += 8;
  else if (x.rsr60 >= 65) score += 5;
  else if (x.rsr60 >= 55) score += 3;
  else if (x.rsr60 >= 50) score += 1;
  else reasons.push('RSR60 lemah');

  // 4) EMA STRUCTURE - 15 poin
  const emaStrong =
    x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20;
  const emaHealthy =
    x.close > x.ema20 && x.ema8 > x.ema14;
  const emaHolding = x.close > x.ema20;

  let emaLabel = 'RUSAK';
  if (emaStrong) { score += 15; emaLabel = 'KUAT'; }
  else if (emaHealthy) { score += 10; emaLabel = 'SEHAT'; }
  else if (emaHolding) { score += 5; emaLabel = 'HOLD EMA20'; }
  else reasons.push('harga di bawah EMA20');

  // 5) MACD - 15 poin
  // Untuk rebound, MACD negatif yang benar-benar membaik lebih bernilai
  // daripada MACD negatif yang terus memburuk.
  let macdLabel = 'NEGATIF';
  const macdNow = Number(x.macdHist) || 0;
  const macdPrev = prevCalc ? Number(prevCalc.macdHist) || 0 : 0;
  const macdImproving = prevCalc && macdNow > macdPrev;
  const macdCrossing = macdImproving && macdNow > macdPrev && macdNow > -Math.abs(macdPrev) * 0.50;

  if (macdNow > 0) {
    score += 15;
    macdLabel = 'POSITIF';
  } else if (macdImproving && macdCrossing) {
    score += 12;
    macdLabel = 'NEGATIF - MEMBAIK KUAT';
  } else if (macdImproving) {
    score += 8;
    macdLabel = 'NEGATIF - MEMBAIK';
  } else {
    reasons.push('MACD memburuk');
  }

  // 6) OBV - 10 poin
  // Volume harus minimal stabil; OBV turun bersama harga dianggap warning.
  let obvLabel = 'LEMAH';
  const obvNow = Number(x.obv) || 0;
  const obvPrev = prevCalc ? Number(prevCalc.obv) || 0 : 0;
  if (x.obvTrend) {
    score += 10;
    obvLabel = 'SEHAT';
  } else if (prevCalc && obvNow >= obvPrev) {
    score += 6;
    obvLabel = 'STABIL';
  } else {
    reasons.push('OBV melemah');
  }

  // 7) MFI - 5 poin
  // Area 45-75 lebih ideal untuk recovery: ada ruang naik dan belum
  // terlalu overbought. MFI sangat rendah diberi 0.
  const mfi = Number(x.mfi) || 0;
  let mfiLabel = mfi.toFixed(1);
  if (mfi >= 45 && mfi <= 75) score += 5;
  else if ((mfi >= 40 && mfi < 45) || (mfi > 75 && mfi <= 80)) score += 3;
  else if (mfi >= 35) score += 2;
  else if (mfi >= 30) score += 1;
  else reasons.push('MFI lemah');

  // ==============================================================
  // HARD GATE RECOVERY
  // Score tinggi tidak boleh mengalahkan kerusakan struktur utama.
  // ==============================================================
  if (pfs < CFG.AD_MIN_PFS) reasons.push('GATE: PFS < ' + CFG.AD_MIN_PFS);
  if (x.rsr20 < 55) reasons.push('GATE: RSR20 < 55');
  if (x.rsr60 < 50) reasons.push('GATE: RSR60 < 50');
  if (emaLabel === 'RUSAK') reasons.push('GATE: EMA rusak');
  if (macdLabel === 'NEGATIF') reasons.push('GATE: MACD belum membaik');
  if (obvLabel === 'LEMAH') reasons.push('GATE: OBV melemah');
  if (mfi < 30) reasons.push('GATE: MFI terlalu lemah');

  // Pullback yang sehat harus masih berada di area trend menengah.
  // Jika harga di bawah EMA20, score tidak dianggap sebagai recovery kuat.
  if (!emaHolding) reasons.push('pullback terlalu dalam terhadap EMA20');

  // Tambahkan informasi reversal bila momentum mulai berbalik.
  if (macdImproving) reasons.push('MACD mulai recovery');
  if (x.obvTrend) reasons.push('OBV mendukung recovery');

  // Hard cap: kondisi utama rusak -> skor maksimum dibatasi agar tidak
  // bisa menembus threshold AD hanya karena komponen lain bagus.
  const hardGateFailed =
    pfs < CFG.AD_MIN_PFS ||
    x.rsr20 < 55 ||
    x.rsr60 < 50 ||
    emaLabel === 'RUSAK' ||
    macdLabel === 'NEGATIF' ||
    obvLabel === 'LEMAH' ||
    mfi < 30;

  if (hardGateFailed) score = Math.min(score, 69);

  if (!reasons.length) reasons.push('Recovery sehat dan terkonfirmasi');

  return {
    score: Math.max(0, Math.min(100, score)),
    emaStructure: emaLabel,
    macd: macdLabel,
    obv: obvLabel,
    mfi: mfiLabel,
    reason: reasons.join(' | ')
  };
}

function getAdaptiveIndicatorStatus_(pfs, rsr20, rsr60, ema, macd, obv, mfi, recoveryScore) {
  // Status ringkas agar pengguna cukup melihat 1 kolom untuk kondisi indikator.
  const vals = [pfs, rsr20, rsr60, recoveryScore].map(Number);
  if (vals.some(v => !isFinite(v))) return 'DATA TIDAK LENGKAP';

  const hardBad = ema === 'RUSAK' || macd === 'NEGATIF' && obv === 'LEMAH' || pfs < 70 || recoveryScore < 60;
  if (hardBad) return 'RUSAK / WASPADA';

  const strong = pfs >= 85 && rsr20 >= 80 && rsr60 >= 80 && recoveryScore >= 85 &&
    ema === 'KUAT' && macd === 'POSITIF' && obv === 'SEHAT' && mfi >= 50 && mfi <= 80;
  if (strong) return 'SANGAT KUAT';

  const healthy = pfs >= 75 && rsr20 >= 70 && rsr60 >= 70 && recoveryScore >= 75 &&
    ema !== 'RUSAK' && (macd === 'POSITIF' || macd === 'NEGATIF - MEMBAIK') &&
    (obv === 'SEHAT' || obv === 'STABIL');
  if (healthy) return 'SEHAT';

  return 'NETRAL / WASPADA';
}

function weightedAverageAfterAD_(entry, entryCapital, adPrice, adCapitalPct) {
  const p1 = Number(entry) || 0;
  const p2 = Number(adPrice) || 0;
  if (p1 <= 0 || p2 <= 0) return 0;

  const c1 = Number(entryCapital) || 100;
  const c2 = Math.max(0, Number(adCapitalPct) || 0);

  return (p1 * c1 + p2 * c2) / (c1 + c2);
}

function weightedAverageAfterAD2_(entry, entryCapital, ad1Price, ad1Pct, ad2Price, ad2Pct) {
  const p1 = Number(entry) || 0;
  const p2 = Number(ad1Price) || 0;
  const p3 = Number(ad2Price) || 0;
  if (p1 <= 0 || p2 <= 0 || p3 <= 0) return 0;

  const c1 = Number(entryCapital) || 100;
  const c2 = Math.max(0, Number(ad1Pct) || 0);
  const c3 = Math.max(0, Number(ad2Pct) || 0);

  return (p1 * c1 + p2 * c2 + p3 * c3) / (c1 + c2 + c3);
}

function roundPriceByTick_(price) {
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  if (p < 200) return Math.round(p);
  if (p < 500) return Math.round(p / 2) * 2;
  if (p < 2000) return Math.round(p / 5) * 5;
  if (p < 5000) return Math.round(p / 10) * 10;
  return Math.round(p / 25) * 25;
}


/**
 * ================================================================
 * AUTO TABLE + AUTO FILTER
 * ================================================================
 * Semua sheet utama diberi:
 * - header tetap/freeze
 * - filter dropdown pada judul
 * - border tabel
 * - zebra/banding ringan
 * - alignment dan wrap yang rapi
 *
 * Filter selalu dibuat ulang berdasarkan ukuran data terbaru agar
 * baris baru hasil screening ikut masuk ke area filter.
 */
/**
 * V56 FAST: refresh filter/header minimum tanpa menulis ulang seluruh
 * border, ukuran kolom, wrapping, dan formatting setiap kali screening.
 */
function refreshScreeningFilterFast_(sheet, numCols) {
  if (!sheet) return;
  const rows = Math.max(sheet.getLastRow(), 1);
  const cols = Math.max(numCols || sheet.getLastColumn(), 1);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);

  // V60 FIX: FAST_MODE sebelumnya melewati formatScreening_(),
  // sehingga RSI/EMA/MACD/VOL/ATR tampil dengan banyak desimal.
  // Terapkan format angka langsung setiap refresh screening.
  if (rows >= 2 && cols >= 23 && sheet.getName() === CFG.SCREEN_SHEET) {
    const n = rows - 1;
    sheet.getRange(2, 3, n, 1).setNumberFormat('0.00');              // PFS
    sheet.getRange(2, 7, n, 6).setNumberFormat('#,##0.00');           // Akumulasi + rata-rata
    sheet.getRange(2, 13, n, 1).setNumberFormat('#,##0');             // CLOSE bulat
    sheet.getRange(2, 14, n, 1).setNumberFormat('+0.00;-0.00;0.00'); // Perubahan %
    sheet.getRange(2, 15, n, 3).setNumberFormat('0.00');              // RSI14, EMA20, EMA50
    sheet.getRange(2, 18, n, 1).setNumberFormat('0.00');              // MACD HIST
    sheet.getRange(2, 19, n, 1).setNumberFormat('0.00"x"');        // VOL vs AVG20
    sheet.getRange(2, 20, n, 1).setNumberFormat('0.00');              // ATR14 %
    sheet.getRange(2, 21, n, 1).setNumberFormat('#,##0');             // 20D HIGH bulat
    sheet.getRange(2, 22, n, 2).setNumberFormat('0');                 // RSR20, RSR60 bulat
    sheet.getRange(2, 5, n, 1).setFontColor('#000000');               // VOLATILITAS huruf hitam
  }

  if (CFG.FAST_RECREATE_FILTER) {
    try {
      const oldFilter = sheet.getFilter();
      if (oldFilter) oldFilter.remove();
      if (rows >= 2) sheet.getRange(1, 1, rows, cols).createFilter();
    } catch (e) {
      console.log('Fast filter ' + sheet.getName() + ': ' + e.message);
    }
  }
}

/**
 * V56 FAST: applyAutoTable mendukung mode ringan. Mode ringan tidak
 * mengulang border/banding seluruh tabel setiap kali menu dijalankan.
 */
function applyAutoTable_(sheet, numCols, includeBanding, fastMode) {
  if (!sheet) return;

  if (fastMode || CFG.FAST_MODE && sheet.getName() === CFG.SCREEN_SHEET) {
    refreshScreeningFilterFast_(sheet, numCols);
    return;
  }

  const rows = Math.max(sheet.getLastRow(), 1);
  const cols = Math.max(numCols || sheet.getLastColumn(), 1);
  const tableRange = sheet.getRange(1, 1, rows, cols);

  sheet.setFrozenRows(1);

  // Header.
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  // Seluruh tabel.
  tableRange
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);

  // Tabel dibuat dengan border + header tebal.
  // Tidak memakai row-banding setelah screening agar warna indikator
  // hijau/kuning/merah tetap aman dan tidak tertimpa.
  if (includeBanding) {
    try {
      tableRange.getBandings().forEach(function(b) { b.remove(); });
    } catch (e) {}
  }

  // Filter dropdown di baris judul.
  try {
    const oldFilter = sheet.getFilter();
    if (oldFilter) oldFilter.remove();
    if (rows >= 2) {
      sheet.getRange(1, 1, rows, cols).createFilter();
    }
  } catch (e) {
    console.log('Filter ' + sheet.getName() + ': ' + e.message);
  }

  sheet.setRowHeight(1, 34);
}

/**
 * Refresh semua sheet utama sekaligus.
 * Dapat dijalankan dari menu PFS > 12.
 */
function refreshAllSheetTables() {
  refreshAllSheetTables_();
  SpreadsheetApp.getActive().toast(
    'Semua sheet sudah dirapikan, diberi tabel dan filter judul.',
    'PFS',
    5
  );
}

function refreshAllSheetTables_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const specs = {
    'INPUT': { cols: 6, banding: true },
    'DATA': { cols: 30, banding: true },
    'PFS': { cols: 4, banding: false },
    'SCREENING': { cols: 25, banding: true },
    'REKAP_SCREENING': { cols: 15, banding: true },
    'ADAPTIVE_AD': { cols: 28, banding: true },
    'HISTORICAL_SCREENING': { cols: null, banding: true },
    'BACKTEST_RESULT': { cols: null, banding: true },
    'BACKTEST_HARI_WIN': { cols: null, banding: true },
    'BACKTEST_SUMMARY': { cols: null, banding: true }
  };

  Object.keys(specs).forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;

    const spec = specs[name];
    let cols = spec.cols || sheet.getLastColumn();

    // DATA mempunyai catatan di W1, tetapi tabel data sebenarnya A:T.
    if (name === 'DATA') cols = 30;

    // PFS dashboard utama A:D adalah tabel indikator.
    if (name === 'PFS') cols = 4;

    applyAutoTable_(sheet, cols, spec.banding);
  });
}

function formatAdaptiveADSheet_(sheet, rowCount) {
  const COLS = 28;
  const STATUS_COL = 18;
  const INDICATOR_STATUS_COL = 19;

  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,COLS)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);

  if (rowCount > 0) {
    sheet.getRange(2,1,rowCount,1).setNumberFormat('dd/MM/yyyy');

    // Harga / average / target
    sheet.getRange(2,4,rowCount,3).setNumberFormat('#,##0');
    sheet.getRange(2,20,rowCount,7).setNumberFormat('#,##0');

    // Score / indikator
    sheet.getRange(2,3,rowCount,1).setNumberFormat('0');
    sheet.getRange(2,10,rowCount,2).setNumberFormat('0.0');
    sheet.getRange(2,16,rowCount,2).setNumberFormat('0.0');

    // Persentase dibuat sederhana: nilai internal sudah berupa angka persen,
    // jadi gunakan 0.0"%" agar tidak dikali 100 lagi oleh Google Sheets.
    sheet.getRange(2,7,rowCount,2).setNumberFormat('0.0"%"');
    sheet.getRange(2,27,rowCount,1).setNumberFormat('0.0"%"');
    sheet.getRange(2,9,rowCount,1).setNumberFormat('0.00"x"');

    const statusValues = sheet.getRange(2,STATUS_COL,rowCount,1).getValues();
    const indicatorValues = sheet.getRange(2,INDICATOR_STATUS_COL,rowCount,1).getValues();

    const statusBg = statusValues.map(function(r) {
      const s = String(r[0] || '');
      if (s === 'AD1 BOLEH' || s === 'AD2 BOLEH') return ['#b6d7a8'];
      if (s === 'STOP AD') return ['#ea9999'];
      if (s.indexOf('TUNGGU') >= 0) return ['#ffe599'];
      return ['#eeeeee'];
    });
    sheet.getRange(2,STATUS_COL,rowCount,1).setBackgrounds(statusBg).setFontWeight('bold');

    const indicatorBg = indicatorValues.map(function(r) {
      const s = String(r[0] || '');
      if (s === 'SANGAT KUAT') return ['#93c47d'];
      if (s === 'SEHAT') return ['#b6d7a8'];
      if (s === 'NETRAL / WASPADA') return ['#ffe599'];
      return ['#ea9999'];
    });
    sheet.getRange(2,INDICATOR_STATUS_COL,rowCount,1).setBackgrounds(indicatorBg).setFontWeight('bold');
  }

  sheet.autoResizeColumns(1,COLS);

  // Lebar kolom penting agar langsung terbaca.
  sheet.setColumnWidth(1, 105);
  sheet.setColumnWidth(2, 75);
  sheet.setColumnWidth(7, 90);   // Drawdown %
  sheet.setColumnWidth(8, 80);   // ATR14 %
  sheet.setColumnWidth(9, 80);   // DD / ATR
  sheet.setColumnWidth(18, 155); // Status AD
  sheet.setColumnWidth(19, 155); // Status indikator
  sheet.setColumnWidth(28, 430); // Alasan

  applyAutoTable_(sheet, COLS, true);
}

function calculateAdaptiveTarget1_(close, atrPct, high20, signal) {
  const price = Number(close) || 0;
  const atr = Number(atrPct) || 0;
  const high = Number(high20) || 0;
  if (price <= 0) return 0;

  const s = String(signal || '').toUpperCase();

  // Target 1 adaptif berdasarkan ATR14.
  // Signal lebih kuat mendapat ruang target sedikit lebih agresif.
  let atrMultiplier = 1.20; // POTENSIAL
  if (s.indexOf('PRIORITAS+') >= 0) atrMultiplier = 1.80;
  else if (s.indexOf('PRIORITAS') >= 0) atrMultiplier = 1.50;

  // Minimum target 2%, agar target tidak terlalu dekat.
  const atrBasedPct = atr > 0 ? atr * atrMultiplier : 2.00;
  const targetPct = Math.max(2.00, atrBasedPct);

  let target = price * (1 + targetPct / 100);

  // 20D High dipakai sebagai resistance adaptif bila masih realistis.
  // Jangan pernah membuat target di bawah harga terakhir.
  if (high > price) {
    const resistanceTarget = Math.max(price * 1.02, high);
    target = Math.min(target, resistanceTarget);
  }

  // Pembulatan ke tick sederhana sesuai harga.
  if (target < 100) return Math.round(target);
  if (target < 1000) return Math.round(target / 5) * 5;
  if (target < 5000) return Math.round(target / 10) * 10;
  return Math.round(target / 25) * 25;
}

function isRekapSignal_(signal) {
  const s = String(signal || '').toUpperCase().trim();

  // Hanya signal POTENSIAL dan yang lebih kuat.
  // Urutan kekuatan: POTENSIAL < PRIORITAS < PRIORITAS+.
  return s.indexOf('POTENSIAL') >= 0 ||
         s.indexOf('PRIORITAS+') >= 0 ||
         s.indexOf('PRIORITAS') >= 0;
}

function normalizeRekapDate_(value) {
  if (!value) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, 'Asia/Jakarta', 'yyyy-MM-dd');
  }

  const s = String(value).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return compact[1] + '-' + compact[2] + '-' + compact[3];

  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
  }

  return s;
}

function formatRekapScreening_(sheet) {
  const headers = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  ensureRekapColumns_(sheet, headers.length);
  sheet.getRange(1,1,1,headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.getRange('A:P').setVerticalAlignment('middle');

  const widths=[105,80,60,125,150,95,135,125,95,120,190,105,125,125,105,105];
  widths.forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });

  const n=Math.max(sheet.getLastRow()-1,0);
  if(n<=0) return;

  sheet.getRange(2,1,n,1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2,3,n,1).setNumberFormat('0');
  sheet.getRange(2,8,n,1).setWrap(true).setVerticalAlignment('middle');
  sheet.setRowHeights(2,n,34);
  sheet.getRange(2,8,n,1).setNumberFormat('#,##0.00');
  sheet.getRange(2,10,n,2).setNumberFormat('0.00"%"');
  sheet.getRange(2,22,n,1).setNumberFormat('@').setHorizontalAlignment('center');
  sheet.getRange(2,13,n,1).setNumberFormat('@').setHorizontalAlignment('center');
  sheet.getRange(2,14,n,1).setNumberFormat('#,##0');
  sheet.getRange(2,15,n,1).setNumberFormat('0.00"x"');

  sheet.getRange(2,1,n,headers.length)
    .setBackground(null).setFontWeight('normal');

  for(let r=2;r<=n+1;r++){
    const signal=String(sheet.getRange(r,4).getValue()).toUpperCase();
    const signalCell=sheet.getRange(r,4);
    const signalChangeCell=sheet.getRange(r,5);
    const pfsChangeCell=sheet.getRange(r,6);
    const movementCell=sheet.getRange(r,10);
    const confirmation=String(sheet.getRange(r,11).getValue()).toUpperCase();
    const confirmationCell=sheet.getRange(r,11);
    const status=String(sheet.getRange(r,16).getValue()).toUpperCase();
    const statusCell=sheet.getRange(r,16);
    const volRatio=Number(sheet.getRange(r,15).getValue())||0;
    const volCell=sheet.getRange(r,14);
    const priceCell=sheet.getRange(r,7);
    const targetCell=sheet.getRange(r,8);
    const profitCell=sheet.getRange(r,9);

    if(isRekapSignal_(signal)){
      signalCell.setBackground('#b6d7a8').setFontWeight('bold');
    }

    const signalChangeText=String(signalChangeCell.getValue()||'').toUpperCase();
    const pfsDelta=Number(String(pfsChangeCell.getValue()||'').replace('+',''))||0;
    if(signalChangeText==='TETAP'||signalChangeText==='BARU'){
      signalChangeCell.setFontColor('#666666').setHorizontalAlignment('center');
    }else if(signalChangeText.indexOf('→')>=0){
      const parts=signalChangeText.split('→');
      const oldS=parts[0].trim(), newS=parts[1].trim();
      const rank=function(s){
        if(s.indexOf('PRIORITAS+')>=0)return 3;
        if(s.indexOf('PRIORITAS')>=0)return 2;
        if(s.indexOf('POTENSIAL')>=0)return 1;
        return 0;
      };
      signalChangeCell.setFontWeight('bold').setHorizontalAlignment('center');
      signalChangeCell.setFontColor(rank(newS)>rank(oldS)?'#008000':'#cc0000');
    }

    pfsChangeCell.setFontWeight('bold').setHorizontalAlignment('center');
    pfsChangeCell.setFontColor(pfsDelta>0?'#008000':(pfsDelta<0?'#cc0000':'#666666'));

    const movementText=String(movementCell.getValue()||'').trim().toUpperCase();
    const movementNum=parseFloat(movementText.replace('%','').replace(',','.'));
    movementCell.setFontWeight('bold').setHorizontalAlignment('center');
    if(movementText==='BARU'||movementText==='') {
      movementCell.setFontColor('#666666');
    } else if(isFinite(movementNum)) {
      movementCell.setFontColor(movementNum>0?'#008000':(movementNum<0?'#cc0000':'#666666'));
    }

    if(confirmation.indexOf('TERCAPAI')===0){
      confirmationCell.setBackground('#d9ead3').setFontColor('#38761d')
        .setFontWeight('bold').setHorizontalAlignment('center');
    }else if(confirmation.indexOf('BELUM TERCAPAI')===0){
      confirmationCell.setBackground('#fff2cc').setFontColor('#7f6000')
        .setFontWeight('bold').setHorizontalAlignment('center');
    }

    if(status==='BARU'){
      statusCell.setBackground('#cfe2f3').setFontColor('#1155cc')
        .setFontWeight('bold').setHorizontalAlignment('center');
    }else if(status==='LAMA'){
      statusCell.setBackground('#d9ead3').setFontColor('#38761d')
        .setFontWeight('bold').setHorizontalAlignment('center');
    }

    if(volRatio>=1.50){
      volCell.setFontColor('#008000').setFontWeight('bold').setHorizontalAlignment('center');
    }else if(volRatio>=0.75){
      volCell.setFontColor('#b8860b').setFontWeight('bold').setHorizontalAlignment('center');
    }else{
      volCell.setFontColor('#cc0000').setFontWeight('bold').setHorizontalAlignment('center');
    }

    priceCell.setFontWeight('bold');
    targetCell.setFontWeight('bold');
    profitCell.setFontWeight('bold').setHorizontalAlignment('center');
    if(Number(profitCell.getValue())>0) profitCell.setFontColor('#008000');

    sheet.getRange(r,12,1,2).setHorizontalAlignment('center').setVerticalAlignment('middle');
  }

  applyAutoTable_(sheet,headers.length,true);
}


function cleanRekapColumns_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreate_(ss, 'REKAP_SCREENING');
  const keepCols = 16;
  ensureRekapColumns_(sheet, keepCols);

  const headers = [
    'TANGGAL DATA','SAHAM','PFS','SIGNAL','PERUBAHAN SIGNAL','PERUBAHAN PFS',
    'HARGA SCREENING / JAM','ADAPTIVE TARGET 1','KEUNTUNGAN %','PERGERAKAN SAHAM %',
    'KONFIRMASI TARGET','TGL TERCAPAI (WIB)','JAM TERCAPAI (1M, WIB)',
    'VOLUME','VOL vs AVG20','KETERANGAN'
  ];

  sheet.getRange(1, 1, 1, keepCols).setValues([headers]);
  formatRekapScreening_(sheet);
}


function rapikanRekapScreening() {
  cleanRekapColumns_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreate_(ss, 'REKAP_SCREENING');
  const n = sheet.getLastRow() - 1;

  if (n <= 0) {
    formatRekapScreening_(sheet);
    SpreadsheetApp.getUi().alert('REKAP_SCREENING masih kosong.');
    return;
  }

  const range = sheet.getRange(2, 1, n, 16);
  const values = range.getValues();

  values.sort(function(a, b) {
    const da = normalizeRekapDate_(a[0]);
    const db = normalizeRekapDate_(b[0]);
    if (da !== db) return db.localeCompare(da);

    const pa = Number(a[2]) || 0;
    const pb = Number(b[2]) || 0;
    if (pb !== pa) return pb - pa;

    return String(a[1]).localeCompare(String(b[1]));
  });

  range.setValues(values);
  formatRekapScreening_(sheet);
  SpreadsheetApp.getActive().toast('REKAP_SCREENING sudah dirapikan.', 'PFS', 5);
}

function screenClosePrevPlus1Pct() {
  // Backward-compatible alias: now means Close change < +1%.
  runCloseChangeFilter_('LT1');
}

function screenClosePrevBelow1Pct() {
  runCloseChangeFilter_('LT1');
}

function screenClosePrevAbove1Pct() {
  runCloseChangeFilter_('GT1');
}

/**
 * Perubahan Close 1D yang benar:
 * ((Close hari terakhir / Close hari sebelumnya) - 1) x 100.
 * Nilai ini SELALU dihitung dari data Yahoo mentah agar kolom
 * PERUBAHAN % tidak pernah tertukar dengan Previous Close.
 */
function getLatestValidClose_(stock) {
  if (!stock || !stock.length) return 0;

  const last = stock[stock.length - 1];
  const close = Number(last && last.close);

  if (isFinite(close) && close > 0) return close;

  // Fallback jika struktur stock diubah pada versi berikutnya.
  const alternatives = [
    last && last.regularMarketPrice,
    last && last.adjClose,
    last && last.price
  ];

  for (let i = 0; i < alternatives.length; i++) {
    const v = Number(alternatives[i]);
    if (isFinite(v) && v > 0) return v;
  }

  return 0;
}

function getLatestDailyChangePct_(stock) {
  if (!stock || stock.length < 2) return null;

  const lastClose = Number(stock[stock.length - 1].close);
  const prevClose = Number(stock[stock.length - 2].close);

  if (!isFinite(lastClose) || !isFinite(prevClose) || prevClose === 0) {
    return null;
  }

  return ((lastClose / prevClose) - 1) * 100;
}

function runCloseChangeFilter_(mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const screening = getOrCreate_(ss, CFG.SCREEN_SHEET);

  const lastRow = Math.max(input.getLastRow(), 2);
  const values = input.getRange(2, 1, lastRow - 1, 3).getValues();

  const tickers = values
    .filter(r => r[2] === true || String(r[2]).toUpperCase() === 'TRUE')
    .map(r => String(r[0]).trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);

  if (!tickers.length) {
    throw new Error('Tidak ada saham aktif. Isi kode di INPUT kolom A dan TRUE di kolom C.');
  }

  const ihsg = fetchYahooHistory_('^JKSE', CFG.LOOKBACK_DAYS);
  if (!ihsg || ihsg.length < CFG.MIN_BARS) {
    throw new Error('Data IHSG tidak cukup.');
  }

  const isLT1 = mode === 'LT1';
  const title = isLT1 ? 'Close < Prev +1%' : 'Close > Prev +1%';
  const results = [];
  const errors = [];

  tickers.forEach(function(ticker, idx) {
    try {
      ss.toast(
        title + ': ' + (idx + 1) + '/' + tickers.length + ': ' + ticker,
        'PFS',
        3
      );

      const stock = fetchYahooHistory_(ticker + '.JK', CFG.LOOKBACK_DAYS);
      if (!stock || stock.length < CFG.MIN_BARS) {
        errors.push(ticker + ': data tidak cukup');
        return;
      }

      const calc = calculateIndicators_(stock, ihsg);
      const s = screenScore_(stock, calc);

      // Close terakhir dan close hari perdagangan sebelumnya.
      const last = stock[stock.length - 1];
      const prev = stock.length >= 2 ? stock[stock.length - 2] : null;

      const close = num_(last && last.close);
      const prevClose = num_(prev && prev.close);

      // Perubahan harga 1 hari (%) selalu dihitung dari Close terakhir
      // dibanding Close hari perdagangan sebelumnya.
      const changePct = getLatestDailyChangePct_(stock);

      if (changePct === null) {
        errors.push(ticker + ': Close hari sebelumnya tidak tersedia');
        return;
      }

      // Dua kondisi yang saling terpisah:
      // LT1 = perubahan Close < +1%
      // GT1 = perubahan Close > +1%
      // Tepat +1% tidak masuk kedua hasil agar tidak tumpang tindih.
      const passClose = isLT1
        ? changePct < CFG.CLOSE_PREV_MAX_PCT
        : changePct > CFG.CLOSE_PREV_MAX_PCT;

      // Kedua filter tetap memakai PFS minimum.
      const passPFS = s.score >= CFG.MIN_SCORE;

      if (passClose && passPFS) {
        results.push({
          ticker: ticker,
          dataDate: normalizeRekapDate_(last && last.date),
          score: s.score,
          signal: s.signal,
          close: close,
          volume: num_(last && last.volume),
          changePct: changePct,
          rsi: s.rsi,
          ema20: calc.latest.ema20,
          ema50: s.ema50,
          macdHist: calc.latest.macdHist,
          volRatio: s.volRatio,
          atrPct: s.atrPct,
          atrScore: s.atrScore,
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
          accumulationAvg1d: accumulationAverage_(stock, 1),
          accumulationAvg5d: accumulationAverage_(stock, 5),
          accumulationAvg10d: accumulationAverage_(stock, 10),
          high20: s.high20,
          distHigh: s.distHigh,
          rsr20: calc.latest.rsr20,
          rsr60: calc.latest.rsr60,
          candle: s.candle,
          trend: s.trend,
          reason: 'Close 1D ' + changePct.toFixed(2) + '% ' +
            (isLT1 ? '< +' : '> +') +
            CFG.CLOSE_PREV_MAX_PCT.toFixed(2) + '% | ' + s.reason
        });
      }
    } catch (e) {
      errors.push(ticker + ': ' + e.message);
    }
  });

  results.sort((a, b) => b.score - a.score);

  // Hasil kedua kondisi selalu ditampilkan di sheet SCREENING.
  screening.clear();

  const headers = [
    'RANK','SAHAM','PREDICTIVE FILTER SCORE','SIGNAL','VOLATILITAS','CHART',
    'AKUMULASI 1D','RATA AKUMULASI 1D',
    'AKUMULASI 5D','RATA AKUMULASI 5D',
    'AKUMULASI 10D','RATA AKUMULASI 10D',
    'CLOSE','PERUBAHAN %','RSI14','EMA20','EMA50',
    'MACD HIST','VOL vs AVG20','ATR14 %','20D HIGH',
    'RSR20','RSR60','CANDLE','TREND','ALASAN'
  ];

  screening.getRange(1, 1, 1, headers.length).setValues([headers]);

  const top = results.slice(0, CFG.TOP_N);

  if (top.length) {
    const rows = top.map((r, i) => [
      i + 1, r.ticker, r.score, r.signal, getVolatilityCategoryV55_(r.atrPct), '',
      r.accumulation, r.accumulationAvg1d,
      r.accumulation5d, r.accumulationAvg5d,
      r.accumulation10d, r.accumulationAvg10d,
      r.close, r.changePct, r.rsi, r.ema20, r.ema50,
      r.macdHist, r.volRatio, r.atrPct, r.high20,
      r.rsr20, r.rsr60, r.candle, r.trend, r.reason
    ]);

    screening.getRange(2, 1, rows.length, headers.length).setValues(rows);
  } else {
    screening.getRange('A2:Z2').merge();
    screening.getRange('A2').setValue(
      'Tidak ada saham yang memenuhi Close 1D ' +
      (isLT1 ? '< +' : '> +') +
      CFG.CLOSE_PREV_MAX_PCT.toFixed(2) +
      '% DAN PFS >= ' + CFG.MIN_SCORE + '.'
    ).setFontWeight('bold').setHorizontalAlignment('center');
  }

  // Format master diterapkan setelah data filter ditulis agar hasil PFS
  // benar-benar identik dengan Screening Semua Saham.
  formatScreening_(screening);
  if (top.length) {
    addChartLinks_(screening, 2, top.length);
    colorScreening_(screening, top.length);

    // Filter < +1% memiliki REKAP TERPISAH.
    // Tidak mencampur data dengan REKAP_SCREENING utama.
    if (isLT1) {
      updateRekapFilterCloseLt1_(ss, top);
    }
  }

  // Ringkasan selalu dibuat agar kedua filter konsisten.
  screening.getRange('AA1:AB8').setValues([
    ['FILTER CLOSE 1D', 'NILAI'],
    ['Kondisi', isLT1 ? '< +1%' : '> +1%'],
    ['Jumlah saham dicek', tickers.length],
    ['Lolos Close + PFS', results.length],
    ['Ditampilkan', top.length],
    ['Minimum PFS', CFG.MIN_SCORE],
    ['Urutan', 'PFS tertinggi → terendah'],
    ['Error', errors.length]
  ]);

  if (errors.length) {
    screening.getRange(9, 27, errors.length, 1)
      .setValues(errors.map(x => [x]));
  }

  SpreadsheetApp.flush();

  ss.toast(
    title + ' selesai: ' + top.length + ' saham ditampilkan.',
    'PFS',
    7
  );

  if (errors.length) {
    SpreadsheetApp.getUi().alert(
      title + ' selesai.\n\n' +
      'Lolos Close + PFS: ' + results.length + '\n' +
      'Ditampilkan: ' + top.length + '\n' +
      'Error: ' + errors.length +
      '\n\nDetail error ada di kolom AA.'
    );
  }

  applyAutoTable_(screening, 25, true);
  const rekapSheet = ss.getSheetByName('REKAP_SCREENING');
  if (rekapSheet) applyAutoTable_(rekapSheet, 11, true);
}

function writeDataSheet_(data, calc, ticker) {
  data.clear();
  data.clearConditionalFormatRules();

  /*
   * DATA DETAIL V30
   * Menampilkan indikator + score predictive secara lengkap.
   */
  const headers = [
    'Tanggal','Open','High','Low','Close','Volume',
    'KETERANGAN\nAKUMULASI','RATA-RATA\nAKUMULASI','NET VOLUME\nAKUMULASI',
    'EMA8','EMA14','EMA20','RSR20','RSR60','Williams %R',
    'OBV','MFI','MACD','Momentum','OBV Trend',
    'Predictive Filter','Timing Score','Trend Score','Entry Score',
    'Keputusan','Kondisi','Close-1D','Perubahan %','C < C1','C > C1',
    'VOLATILITAS 10D %','VOLATILITY SCORE','VOLATILITY 10D'
  ];

  data.getRange(1,1,1,headers.length).setValues([headers]);

  const dailyRows = calc.rows.slice(-CFG.DISPLAY_DAYS);
  const rows = dailyRows.map(function(x) {
    const stockIndex = calc.rows.indexOf(x);
    const acc = dailyAccumulationInfo_(calc.rows, stockIndex);
    const score = scorePFS_(x);
    const prev = stockIndex > 0 ? calc.rows[stockIndex - 1] : null;
    const vol10 = getVolatility10Meta_(calc.rows, stockIndex);
    score.volatility10Pct = vol10.pct;
    score.volatility10Score = vol10.score;
    score.volatility10Label = vol10.label;
    score.trendQuality = vol10.trendQuality;
    const detail = calculateDataDetailScores_(x, score, prev);

    return [
      x.date,x.open,x.high,x.low,x.close,x.volume,
      acc.status,acc.averagePrice,acc.netVolume,
      x.ema8,x.ema14,x.ema20,x.rsr20,x.rsr60,x.willr,
      x.obv,x.mfi,x.macdHist,x.momentum,x.obvTrend,
      score.pfs,score.timing,detail.trendScore,detail.entryScore,
      score.signal,detail.condition,
      detail.prevClose,detail.changePct,detail.closeBelowPrev,detail.closeAbovePrev,
      score.volatility10Pct,score.volatility10Score,score.volatility10Label
    ];
  });

  if (rows.length) {
    data.getRange(2,1,rows.length,headers.length).setValues(rows);
  }

  formatDetailedDataSheet_(data, rows.length, ticker);
  colorDataIndicators_(data, rows.length, headers.length);
  colorDailyAccumulation_(data, rows.length);
  colorDataScores_(data, rows.length);
  colorDataVolatility10_(data, rows.length);

  data.getRange('AH1').setValue(
    ticker + ': ' + CFG.DISPLAY_DAYS +
    ' candle Daily terakhir. PFS/Timing/Trend/Entry memakai kalkulasi PFS yang sama. Volatilitas 10D ditambahkan untuk memprioritaskan saham trend bagus yang punya ruang gerak. ' +
    'C<C1 dan C>C1 menunjukkan arah Close terhadap Close hari sebelumnya. Volatilitas 10D = ATR(10)/Close; bonus hanya aktif jika trend minimal MIXED BULLISH.'
  ).setWrap(true);

  SpreadsheetApp.flush();
}


function getVolatility10Meta_(rows, index) {
  const x = rows[index];
  if (!x || !Number(x.close)) {
    return {pct: 0, score: 0, label: 'LEMAH', trendQuality: 'LEMAH'};
  }
  const atr10 = calcATR_(rows, index, 10);
  const pct = atr10 > 0 ? (atr10 / Number(x.close)) * 100 : 0;
  const ema50 = calcEMAAt_(rows.map(function(r){ return Number(r.close) || 0; }), 50);
  const trendQuality =
    x.close > ema50 && x.close > x.ema20 && x.ema20 > ema50 ? 'UPTREND' :
    x.close > x.ema20 ? 'MIXED BULLISH' : 'LEMAH';

  let score = 0;
  let label = 'LEMAH';
  if (pct >= CFG.VOLATILITY10_STRONG_PCT) {
    label = 'KUAT';
    if (trendQuality === 'UPTREND') score = 10;
    else if (trendQuality === 'MIXED BULLISH') score = 7;
  } else if (pct >= CFG.VOLATILITY10_MIN_PCT) {
    label = 'SEDANG';
    if (trendQuality === 'UPTREND') score = 5;
    else if (trendQuality === 'MIXED BULLISH') score = 3;
  }
  return {pct:pct, score:score, label:label, trendQuality:trendQuality};
}


/**
 * Score detail DATA:
 * Trend Score 0-100 = EMA 40% + RSR20 20% + RSR60 20% + Momentum 20%.
 * Entry Score 0-100 = PFS 50% + Timing 30% + Williams %R 10% + MACD 10%.
 */
function calculateDataDetailScores_(x, score, prev) {
  const emaPart = (Number(score.ema) || 0) / 15 * 40;
  const rsr20Part = (Number(score.rsr20) || 0) / 10 * 20;
  const rsr60Part = (Number(score.rsr60) || 0) / 10 * 20;
  const momentumPart = (Number(score.momentum) || 0) / 15 * 20;

  const volatilityTrendBonus = Number(score.volatility10Score) || 0;
  const trendScore = Math.round(Math.max(0, Math.min(100,
    emaPart + rsr20Part + rsr60Part + momentumPart + volatilityTrendBonus
  )));

  const pfsPart = (Number(score.pfs) || 0) * 0.50;
  const timingPart = (Number(score.timing) || 0) / 30 * 30;
  const willrPart = (Number(score.willr) || 0) / 15 * 10;
  const macdPart = (Number(score.macd) || 0) / 10 * 10;

  const entryScore = Math.round(Math.max(0, Math.min(100,
    pfsPart + timingPart + willrPart + macdPart
  )));

  let condition = 'LEMAH';
  if (score.pfs >= 90 && score.timing >= 24) condition = 'BULLISH KUAT';
  else if (score.pfs >= 85 && score.timing >= 20) condition = 'BULLISH';
  else if (score.pfs >= 75 && score.timing >= 15) condition = 'POSITIF';
  else if (score.pfs >= 70) condition = 'WATCHLIST';
  else if (score.pfs >= 60) condition = 'NETRAL / TUNGGU';

  const currentClose = Number(x.close) || 0;
  const prevClose = prev ? Number(prev.close) || 0 : 0;
  const changePct = prevClose > 0
    ? ((currentClose / prevClose) - 1) * 100
    : 0;

  return {
    trendScore: trendScore,
    entryScore: entryScore,
    condition: condition,
    prevClose: prevClose,
    changePct: changePct,
    closeBelowPrev: changePct < 0 ? Math.abs(changePct) : 0,
    closeAbovePrev: changePct > 0 ? changePct : 0
  };
}


function formatDetailedDataSheet_(data, rowCount, ticker) {
  const COLS = 33;

  data.setFrozenRows(1);
  data.getRange(1,1,1,COLS)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  if (rowCount > 0) {
    data.getRange(2,1,rowCount,1).setNumberFormat('dd-mmm-yyyy').setHorizontalAlignment('center');
    data.getRange(2,2,rowCount,4).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,6,rowCount,1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,8,rowCount,1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,9,rowCount,1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,10,rowCount,3).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,13,rowCount,2).setNumberFormat('0').setHorizontalAlignment('right');
    data.getRange(2,15,rowCount,1).setNumberFormat('0.00').setHorizontalAlignment('right');
    data.getRange(2,16,rowCount,1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,17,rowCount,3).setNumberFormat('0.00').setHorizontalAlignment('right');
    data.getRange(2,21,rowCount,4).setNumberFormat('0').setHorizontalAlignment('center');
    data.getRange(2,27,rowCount,1).setNumberFormat('#,##0').setHorizontalAlignment('right');
    data.getRange(2,28,rowCount,3).setNumberFormat('0.00"%"').setHorizontalAlignment('center');
    data.getRange(2,31,rowCount,1).setNumberFormat('0.00"%"').setHorizontalAlignment('right');
    data.getRange(2,32,rowCount,1).setNumberFormat('0').setHorizontalAlignment('center').setFontWeight('bold');
    data.getRange(2,33,rowCount,1).setHorizontalAlignment('center').setFontWeight('bold');
    data.getRange(2,7,rowCount,1).setHorizontalAlignment('center').setFontWeight('bold');
    data.getRange(2,20,rowCount,1).setHorizontalAlignment('center');
    data.getRange(2,25,rowCount,2).setHorizontalAlignment('center').setFontWeight('bold');
  }

  data.getRange(1,1,1,6).setBackground('#1f4e78').setFontColor('#ffffff');
  data.getRange(1,7,1,3).setBackground('#38761d').setFontColor('#ffffff');
  data.getRange(1,7,1,3).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  data.getRange(1,10,1,11).setBackground('#674ea7').setFontColor('#ffffff');
  data.getRange(1,21,1,10).setBackground('#1f4e78').setFontColor('#ffffff');

  const widths = {
    1:105,2:85,3:85,4:85,5:90,6:115,
    7:145,8:125,9:165,10:80,11:80,12:85,
    13:75,14:75,15:100,16:120,17:80,18:95,19:90,20:85,
    21:105,22:95,23:95,24:95,25:150,26:145,27:95,28:100,29:85,30:85,
    31:120,32:110,33:125
  };
  Object.keys(widths).forEach(function(k) {
    data.setColumnWidth(Number(k), widths[k]);
  });

  data.setRowHeight(1, 52);
  data.getRange(1,1,Math.max(data.getLastRow(),1),COLS).setVerticalAlignment('middle');
  applyAutoTable_(data, COLS, true);
}


function colorDataScores_(data, rowCount) {
  if (rowCount < 1) return;

  const scoreCols = [21,22,23,24];
  scoreCols.forEach(function(col) {
    const values = data.getRange(2,col,rowCount,1).getValues();
    const bgs = values.map(function(r) {
      const v = Number(r[0]) || 0;
      if (v >= 85) return ['#b6d7a8'];
      if (v >= 70) return ['#d9ead3'];
      if (v >= 60) return ['#fff2cc'];
      return ['#f4cccc'];
    });
    data.getRange(2,col,rowCount,1).setBackgrounds(bgs).setFontWeight('bold');
  });

  const conditionValues = data.getRange(2,26,rowCount,1).getValues();
  const conditionBgs = conditionValues.map(function(r) {
    const s = String(r[0] || '').toUpperCase();
    if (s.indexOf('BULLISH KUAT') >= 0) return ['#93c47d'];
    if (s.indexOf('BULLISH') >= 0 || s.indexOf('POSITIF') >= 0) return ['#b6d7a8'];
    if (s.indexOf('WATCHLIST') >= 0 || s.indexOf('NETRAL') >= 0) return ['#fff2cc'];
    return ['#f4cccc'];
  });
  data.getRange(2,26,rowCount,1).setBackgrounds(conditionBgs).setFontWeight('bold');

  const changeValues = data.getRange(2,28,rowCount,1).getValues();
  const changeBgs = changeValues.map(function(r) {
    const v = Number(r[0]) || 0;
    if (v > 0) return ['#d9ead3'];
    if (v < 0) return ['#f4cccc'];
    return ['#eeeeee'];
  });
  data.getRange(2,28,rowCount,1).setBackgrounds(changeBgs).setFontWeight('bold');
}


function colorDataVolatility10_(data, rowCount) {
  if (rowCount < 1) return;
  const values = data.getRange(2, 31, rowCount, 3).getValues();
  const scoreBgs = [];
  const labelBgs = [];
  for (let i = 0; i < values.length; i++) {
    const score = Number(values[i][1]) || 0;
    const label = String(values[i][2] || '').toUpperCase();
    if (score >= 10) {
      scoreBgs.push(['#b6d7a8']); labelBgs.push(['#b6d7a8']);
    } else if (score >= 7) {
      scoreBgs.push(['#d9ead3']); labelBgs.push(['#d9ead3']);
    } else if (label === 'SEDANG') {
      scoreBgs.push(['#fff2cc']); labelBgs.push(['#fff2cc']);
    } else {
      scoreBgs.push(['#f4cccc']); labelBgs.push(['#f4cccc']);
    }
  }
  data.getRange(2, 32, rowCount, 1).setBackgrounds(scoreBgs).setFontWeight('bold');
  data.getRange(2, 33, rowCount, 1).setBackgrounds(labelBgs).setFontWeight('bold');
}


/**
 * Akumulasi / distribusi harian berbasis OHLCV.
 *
 * CATATAN:
 * NET VOLUME di sini adalah PROXY dari tekanan akumulasi/distribusi
 * berdasarkan OHLCV, BUKAN net lot broker summary asli.
 *
 * Rata2 Akumulasi = typical price (High + Low + Close) / 3.
 * Net Volume = volume x tekanan close dalam range candle.
 * Nilai POSITIF  = tekanan akumulasi.
 * Nilai NEGATIF  = tekanan distribusi.
 *
 * Dengan metode ini LEMAH tetap mempunyai nilai volume jika ada
 * tekanan beli positif. DISTRIBUSI juga ditampilkan dengan lot
 * negatif agar arah tekanannya terlihat jelas.
 */
function dailyAccumulationInfo_(rows, index) {
  const current = rows[index];
  if (!current) {
    return {
      status: 'LEMAH',
      score: 0,
      averagePrice: 0,
      netVolume: 0
    };
  }

  const prev = index > 0 ? rows[index - 1] : null;
  const close = Number(current.close);
  const high = Number(current.high);
  const low = Number(current.low);
  const volume = Number(current.volume || 0);

  const dailyChangePct = prev && Number(prev.close)
    ? ((close / Number(prev.close)) - 1) * 100
    : 0;

  const range = high - low;
  const closeLocation = range > 0
    ? (close - low) / range
    : 0.5;

  const start = Math.max(0, index - 19);
  const volWindow = rows.slice(start, index + 1)
    .map(function(r) { return Number(r.volume || 0); })
    .filter(function(v) { return isFinite(v) && v > 0; });

  const avg20Vol = volWindow.length
    ? volWindow.reduce(function(a,b) { return a + b; }, 0) / volWindow.length
    : 0;

  const volRatio = avg20Vol > 0 ? volume / avg20Vol : 0;

  let score = 0;

  if (dailyChangePct > 0) score += 35;
  else if (dailyChangePct >= -0.25) score += 20;
  else if (dailyChangePct >= -1.0) score += 10;

  if (closeLocation >= 0.70) score += 30;
  else if (closeLocation >= 0.50) score += 20;
  else if (closeLocation >= 0.35) score += 10;

  if (volRatio >= 1.50) score += 35;
  else if (volRatio >= 1.20) score += 25;
  else if (volRatio >= 1.00) score += 15;
  else if (volRatio >= 0.80) score += 8;

  /*
   * Deteksi distribusi:
   * harga melemah + close berada di bagian bawah candle,
   * terutama jika volume di atas rata-rata.
   */
  let distributionScore = 0;

  if (dailyChangePct < -1.00) distributionScore += 35;
  else if (dailyChangePct < -0.25) distributionScore += 20;
  else if (dailyChangePct < 0) distributionScore += 10;

  if (closeLocation <= 0.30) distributionScore += 30;
  else if (closeLocation <= 0.45) distributionScore += 20;
  else if (closeLocation < 0.50) distributionScore += 10;

  if (volRatio >= 1.50) distributionScore += 35;
  else if (volRatio >= 1.20) distributionScore += 25;
  else if (volRatio >= 1.00) distributionScore += 15;
  else if (volRatio >= 0.80) distributionScore += 8;

  const status =
    distributionScore >= 65 ? 'DISTRIBUSI' :
    score >= 75 ? 'KUAT' :
    score >= 50 ? 'SEDANG' : 'LEMAH';

  /*
   * Tekanan net volume:
   * closeLocation 0.00 -> -100% volume (distribusi)
   * closeLocation 0.50 -> 0 net pressure
   * closeLocation 1.00 -> +100% volume (akumulasi)
   *
   * Diperhalus dengan perubahan harian supaya candle naik lebih
   * mencerminkan tekanan beli dan candle turun tekanan jual.
   */
  const rangePressure = (closeLocation - 0.50) * 2;
  const changePressure =
    dailyChangePct > 0.25 ? 0.20 :
    dailyChangePct < -0.25 ? -0.20 : 0;

  let pressure = Math.max(-1, Math.min(1, rangePressure + changePressure));

  /*
   * Pastikan klasifikasi DISTRIBUSI menghasilkan net volume negatif,
   * sedangkan akumulasi LEMAH/SEDANG/KUAT tetap dapat menampilkan
   * volume positif jika memang ada tekanan beli.
   */
  if (status === 'DISTRIBUSI') pressure = Math.min(pressure, -0.10);
  else if (pressure < 0) pressure = 0;

  const netVolume = isFinite(volume)
    ? Math.round(volume * pressure)
    : 0;

  const typicalPrice = (high + low + close) / 3;

  return {
    status: status,
    score: score,
    distributionScore: distributionScore,
    averagePrice: isFinite(typicalPrice) ? typicalPrice : 0,
    netVolume: isFinite(netVolume) ? netVolume : 0
  };
}

function colorDailyAccumulation_(data, rowCount) {
  if (rowCount < 1) return;

  const values = data.getRange(2, 7, rowCount, 1).getValues();
  const backgrounds = values.map(function(row) {
    const status = String(row[0] || '').toUpperCase();
    if (status === 'KUAT') return ['#b6d7a8'];
    if (status === 'SEDANG') return ['#ffe599'];
    if (status === 'DISTRIBUSI') return ['#e06666'];
    if (status === 'LEMAH') return ['#ea9999'];
    return ['#eeeeee'];
  });

  data.getRange(2, 7, rowCount, 1)
    .setBackgrounds(backgrounds)
    .setFontWeight('bold');
}

function screenScore_(stock, calc) {
  const x = calc.latest;
  const n = stock.length;
  const i = n - 1;

  const rsi = calcRSI_(stock, i, 14);
  const ema50 = calcEMAAt_(stock.map(s => s.close), 50);
  const avg20Vol = average_(stock.slice(-20).map(s => s.volume));
  const volRatio = avg20Vol ? x.volume / avg20Vol : 0;

  // Volatilitas 10D: ATR(10) sebagai persentase harga.
  // Tujuannya mencari saham yang sedang punya ruang gerak, tetapi bonus
  // hanya diberikan jika trend minimal MIXED BULLISH agar volatilitas tinggi
  // pada trend lemah tidak otomatis menaikkan PFS. ATR14 tetap dipakai
  // untuk target adaptif/monitor lama.
  const atr10 = calcATR_(stock, i, 10);
  const volatility10Pct = x.close ? (atr10 / x.close) * 100 : 0;
  const atr14 = calcATR_(stock, i, 14);
  const atrPct = x.close ? (atr14 / x.close) * 100 : 0;
  const trendQuality =
    x.close > ema50 && x.close > x.ema20 && x.ema20 > ema50 ? 'UPTREND' :
    x.close > x.ema20 ? 'MIXED BULLISH' : 'LEMAH';

  const high20 = Math.max.apply(null, stock.slice(-CFG.DISPLAY_DAYS).map(s => s.high));
  const distHigh = high20 ? (high20 - x.close) / high20 * 100 : 100;
  const last = stock[n-1];
  const prev = stock[n-2];

  // AKUMULASI HARIAN:
  // Menggabungkan arah harga, posisi close dalam range candle, dan volume
  // dibanding rata-rata 20 hari. Ini adalah proxy akumulasi/distribusi,
  // bukan data broker flow.
  const dailyChangePct = prev && prev.close
    ? ((last.close / prev.close) - 1) * 100
    : 0;
  const candleRange = (last.high - last.low);
  const closeLocation = candleRange > 0
    ? ((last.close - last.low) / candleRange)
    : 0.5;

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
    accumulationScore >= 75 ? 'KUAT' :
    accumulationScore >= 50 ? 'SEDANG' : 'LEMAH';

  const accumulation5d = calcAccumulationPeriod_(stock, 5);
  const accumulation10d = calcAccumulationPeriod_(stock, 10);

  // Bullish candle sederhana: close > open dan close > previous close.
  const bullishCandle = last.close > last.open && last.close > prev.close;
  const candle = bullishCandle ? 'BULLISH' : (last.close < last.open ? 'BEARISH' : 'NETRAL');

  const trend =
    x.close > ema50 && x.close > x.ema20 && x.ema20 > ema50 ? 'UPTREND' :
    x.close > x.ema20 ? 'MIXED BULLISH' : 'LEMAH';

  let score = 0;
  const reasons = [];

  // 20 poin trend
  if (x.close > x.ema20) { score += 7; reasons.push('Close>EMA20'); }
  if (x.ema20 > ema50) { score += 7; reasons.push('EMA20>EMA50'); }
  if (x.close > ema50) { score += 6; reasons.push('Close>EMA50'); }

  // 15 poin RSI sehat
  if (rsi >= 50 && rsi <= 70) { score += 15; reasons.push('RSI sehat'); }
  else if (rsi >= 45 && rsi < 50) score += 8;
  else if (rsi > 70 && rsi <= 75) score += 7;

  // 15 MACD
  if (x.macdHist > 0) { score += 15; reasons.push('MACD positif'); }

  // 15 volume
  if (volRatio >= 1.5) { score += 15; reasons.push('Volume kuat'); }
  else if (volRatio >= 1.2) { score += 12; reasons.push('Volume naik'); }
  else if (volRatio >= 1.0) score += 7;

  // 15 breakout/proximity
  if (x.close >= high20 * 0.99) { score += 15; reasons.push('Breakout/near 20D high'); }
  else if (x.close >= high20 * 0.97) { score += 10; reasons.push('Dekat 20D high'); }
  else if (x.close >= high20 * 0.93) score += 5;

  // 10 relative strength
  if (x.rsr20 >= 70) { score += 6; reasons.push('RSR20 kuat'); }
  else if (x.rsr20 >= 60) score += 4;
  if (x.rsr60 >= 70) { score += 4; reasons.push('RSR60 kuat'); }
  else if (x.rsr60 >= 60) score += 3;

  // 10 candlestick
  if (bullishCandle) { score += 10; reasons.push('Candle bullish'); }
  else if (last.close > last.open) score += 5;

  // 10 volatilitas 10D.
  // KUAT (>=2.50%) diberi bobot tertinggi HANYA jika trend bagus.
  // MIXED BULLISH mendapat bonus parsial; trend LEMAH tidak mendapat bonus.
  let volatility10Score = 0;
  let volatility10Label = 'LEMAH';
  if (volatility10Pct >= CFG.VOLATILITY10_STRONG_PCT) {
    volatility10Label = 'KUAT';
    if (trendQuality === 'UPTREND') volatility10Score = 10;
    else if (trendQuality === 'MIXED BULLISH') volatility10Score = 7;
    if (volatility10Score > 0) reasons.push('Volatilitas 10D KUAT + trend ' + trendQuality);
  } else if (volatility10Pct >= CFG.VOLATILITY10_MIN_PCT) {
    volatility10Label = 'SEDANG';
    if (trendQuality === 'UPTREND') volatility10Score = 5;
    else if (trendQuality === 'MIXED BULLISH') volatility10Score = 3;
    if (volatility10Score > 0) reasons.push('Volatilitas 10D SEDANG + trend ' + trendQuality);
  }
  score += volatility10Score;

  // Score dibatasi 0-100. Bonus volatilitas menambah prioritas
  // tanpa mengubah skala score yang sudah digunakan.
  score = Math.round(Math.min(100, score));

  const signal =
    score > 90 ? '🔥 PRIORITAS+' :
    score > 80 ? '🔥 PRIORITAS' :
    score > 70 ? '🟢 POTENSIAL' :
    score > 60 ? '🟡 WATCHLIST' : '🔴 LEMAH';

  if (!reasons.length) reasons.push('Belum memenuhi filter utama');

  return {
    score: score,
    signal: signal,
    rsi: rsi,
    ema50: ema50,
    prevClose: prev && prev.close ? prev.close : null,
    changePct: dailyChangePct,
    volRatio: volRatio,
    atrPct: atrPct,
    atrScore: volatility10Score,
    volatility10Pct: volatility10Pct,
    volatility10Score: volatility10Score,
    volatility10Label: volatility10Label,
    trendQuality: trendQuality,
    accumulation: accumulation,
    accumulationScore: accumulationScore,
    accumulation5d: accumulation5d.label,
    accumulation5dScore: accumulation5d.score,
    accumulation10d: accumulation10d.label,
    accumulation10dScore: accumulation10d.score,
    high20: high20,
    distHigh: distHigh,
    candle: candle,
    trend: trend,
    reason: reasons.join(' | ')
  };
}


function calcAccumulationPeriod_(stock, days) {
  const n = stock.length;
  if (n < days + 1) return {label:'LEMAH', score:0};

  const start = n - days;
  const firstClose = Number(stock[start - 1].close) || 0;
  const lastClose = Number(stock[n - 1].close) || 0;
  if (!firstClose || !lastClose) return {label:'LEMAH', score:0};

  const returnPct = ((lastClose / firstClose) - 1) * 100;
  let upVol = 0, downVol = 0, locationSum = 0, count = 0;

  for (let j = start; j < n; j++) {
    const prev = stock[j - 1], cur = stock[j];
    const prevC = Number(prev.close) || 0, curC = Number(cur.close) || 0;
    const vol = Number(cur.volume) || 0;
    if (curC >= prevC) upVol += vol; else downVol += vol;
    const range = (Number(cur.high) || 0) - (Number(cur.low) || 0);
    locationSum += range > 0 ? ((curC - Number(cur.low)) / range) : 0.5;
    count++;
  }

  const volPressure = (upVol + downVol) > 0 ? upVol / (upVol + downVol) : 0.5;
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
  return {label: score >= 75 ? 'KUAT' : score >= 50 ? 'SEDANG' : 'LEMAH', score: score};
}

function calcATR_(stock, i, period) {
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

  return trs.length ? average_(trs) : 0;
}

function calcRSI_(stock, i, period) {
  if (i < period) return 50;
  let gains = 0, losses = 0;
  for (let j=i-period+1; j<=i; j++) {
    const d = stock[j].close - stock[j-1].close;
    if (d > 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100/(1+rs);
}

function calcEMAAt_(values, period) {
  if (!values.length) return null;
  const k = 2/(period+1);
  let ema = values[0];
  for (let i=1; i<values.length; i++) ema = values[i]*k + ema*(1-k);
  return ema;
}

function average_(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a,b) => a + Number(b), 0) / arr.length;
}

/**
 * Membuat tombol CHART di kolom E.
 *
 * Saat diklik, chart membuka TradingView Advanced Chart dengan:
 *   - Candlestick
 *   - Volume
 *   - Price Channel (Donchian) periode 10
 *   - MACD
 *   - Williams %R
 *   - OBV
 *
 * Catatan: Relative Strength Rating (RSR) periode 20 bukan indikator
 * built-in TradingView yang dapat dimuat langsung oleh widget. RSR20
 * tetap dihitung oleh screener PFS; untuk menampilkannya sebagai panel
 * di TradingView diperlukan Pine/community script atau chart custom.
 *
 * Menggunakan TradingView Widget Embed agar indikator dapat dimuat
 * otomatis pada saat chart dibuka.
 */
function addChartLinks_(sheet, startRow, rowCount) {
  if (!rowCount || rowCount < 1) return;
  const studies = ['DONCH@tv-basicstudies','MACD@tv-basicstudies','WilliamR@tv-basicstudies','OBV@tv-basicstudies'].join(String.fromCharCode(31));
  const encodedStudies=encodeURIComponent(studies);
  const overrides=encodeURIComponent(JSON.stringify({'donchian channels.length':10,'williams %r.length':14}));
  const tickers=sheet.getRange(startRow,2,rowCount,1).getDisplayValues();
  const rich=tickers.map(function(r){
    const ticker=String(r[0]||'').trim().toUpperCase();
    if(!ticker)return [SpreadsheetApp.newRichTextValue().setText('').build()];
    const url='https://www.tradingview.com/widgetembed/?frameElementId=pfs_'+encodeURIComponent(ticker)+
      '&symbol='+encodeURIComponent('IDX:'+ticker)+'&interval=D&symboledit=1&saveimage=1&toolbarbg=f1f3f6'+
      '&studies='+encodedStudies+'&theme=light&style=1&timezone=Asia%2FJakarta&studies_overrides='+overrides+
      '&overrides=%7B%7D&enabled_features=%5B%5D&disabled_features=%5B%5D&locale=id&utm_source=google_sheets&utm_medium=pfs_screening&utm_campaign=pfs';
    return [SpreadsheetApp.newRichTextValue().setText('📈 CHART').setLinkUrl(url).build()];
  });
  sheet.getRange(startRow,6,rowCount,1).setRichTextValues(rich).setHorizontalAlignment('center').setFontWeight('bold');
}


function formatScreening_(sheet) {
  // MASTER LAYOUT: identik untuk Screening Semua Saham dan PFS Filter.
  const headers = [
    'RANK','SAHAM','PREDICTIVE FILTER SCORE','SIGNAL','VOLATILITAS','CHART',
    'AKUMULASI 1D','RATA AKUMULASI 1D',
    'AKUMULASI 5D','RATA AKUMULASI 5D',
    'AKUMULASI 10D','RATA AKUMULASI 10D',
    'CLOSE','PERUBAHAN %','RSI14','EMA20','EMA50',
    'MACD HIST','VOL vs AVG20','ATR14 %','20D HIGH',
    'RSR20','RSR60','CANDLE','TREND','ALASAN'
  ];
  sheet.getRange(1,1,1,26).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange('A1:Z1').setFontWeight('bold').setHorizontalAlignment('center').setWrap(true);
  sheet.getRange('A:Z').setVerticalAlignment('middle');
  const widths=[60,85,120,120,120,110,105,145,105,145,105,145,100,95,80,100,100,105,105,90,105,75,75,110,110,350];
  widths.forEach((w,i)=>sheet.setColumnWidth(i+1,w));
  if(sheet.getLastRow()>=2){
    const n=sheet.getLastRow()-1;
    // Reset warna huruf kolom S sebelum colorScreening_ menerapkan kategori terbaru.
    sheet.getRange(2,19,n,1).setFontColor('#000000').setFontWeight('normal');
    // V59: default angka hasil SCREENING = 2 desimal.
    // Nilai internal/perhitungan tetap tidak diubah; yang berubah hanya format tampilan.
    sheet.getRange(2,3,n,1).setNumberFormat('0.00');              // PFS
    sheet.getRange(2,7,n,7).setNumberFormat('#,##0.00');           // Akumulasi + rata-rata + Close (sementara)
    sheet.getRange(2,14,n,1).setNumberFormat('+0.00;-0.00;0.00'); // Perubahan %
    sheet.getRange(2,15,n,9).setNumberFormat('0.00');              // RSI, EMA, MACD, VOL ratio, ATR, High, RSR
    sheet.getRange(2,19,n,1).setNumberFormat('0.00"x"');       // VOL vs AVG20
    sheet.getRange(2,22,n,2).setNumberFormat('0.00');              // RSR20 + RSR60

    // V60: RSI14, EMA20, EMA50, MACD HIST, VOL vs AVG20, ATR14 % = 2 desimal, termasuk FAST_MODE.
    // CLOSE, 20D HIGH, RSR20, RSR60 tetap bulat sesuai permintaan sebelumnya.
    sheet.getRange(2,13,n,1).setNumberFormat('#,##0'); // CLOSE
    sheet.getRange(2,15,n,3).setNumberFormat('0.00');   // RSI14, EMA20, EMA50
    sheet.getRange(2,18,n,1).setNumberFormat('0.00');   // MACD HIST
    sheet.getRange(2,19,n,1).setNumberFormat('0.00"x"'); // VOL vs AVG20
    sheet.getRange(2,20,n,1).setNumberFormat('0.00');   // ATR14 %
    sheet.getRange(2,21,n,1).setNumberFormat('#,##0'); // 20D HIGH
    sheet.getRange(2,22,n,2).setNumberFormat('0');     // RSR20, RSR60

    // VOLATILITAS: warna latar tetap mengikuti kategori,
    // tetapi warna huruf WAJIB hitam agar kontras dan konsisten.
    sheet.getRange(2,5,n,1).setFontColor('#000000');
  }

  // Terapkan warna VOL vs AVG20 SETELAH formatScreening selesai.
  // Khusus hasil SCREENING, agar reset format tidak menghapus warna huruf volume.
  colorVolRatioScreening_(sheet);

  // Filter + tabel otomatis selalu diperbarui setelah screening.
  applyAutoTable_(sheet, 26, true);
}

function colorVolRatioScreening_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const n = lastRow - 1;
  const range = sheet.getRange(2, 19, n, 1); // Kolom S
  const values = range.getValues();

  const fontColors = values.map(function(row) {
    const v = Number(row[0]);
    if (!isFinite(v)) return ['#000000'];

    if (v > 1.00) {
      return ['#006100']; // KUAT - hijau pekat
    } else if (v >= 0.50) {
      return ['#bf9000']; // SEDANG - kuning/gold
    } else {
      return ['#cc0000']; // LEMAH - merah
    }
  });

  range.setFontColors(fontColors).setFontWeight('bold');
}

function colorScreening_(sheet, rowCount) {
  if (!sheet || !rowCount) return;

  // V58: 26 kolom karena VOLATILITAS ditempatkan tepat di sebelah SIGNAL.
  const values = sheet.getRange(2, 1, rowCount, 26).getValues();
  const bgs = [], fws = [];

  values.forEach(function(row) {
    const score = Number(row[2]);
    const base = score >= 70 ? '#d9ead3' : '#f4cccc';
    const bg = new Array(26).fill(base);
    const fw = new Array(26).fill('normal');

    fw[2] = 'bold';

    // Kolom VOLATILITAS = E (index 4)
    const vol = String(row[4] || '').trim().toUpperCase();
    if (vol === 'TOP VOLATILITAS') {
      bg[4] = '#38761d';   // hijau tua
      fw[4] = 'bold';
    } else if (vol === 'KUAT') {
      bg[4] = '#b6d7a8';   // hijau muda
      fw[4] = 'bold';
    } else if (vol === 'SEDANG') {
      bg[4] = '#ffe599';   // kuning
      fw[4] = 'bold';
    } else if (vol === 'LEMAH') {
      bg[4] = '#ea9999';   // merah
      fw[4] = 'bold';
    }

    // Akumulasi: setelah penambahan kolom E, indeks bergeser +1.
    [6,8,10].forEach(function(i) {
      const a = String(row[i] || '').trim().toUpperCase();
      if (a === 'KUAT') {
        bg[i] = '#b6d7a8';
        fw[i] = 'bold';
      } else if (a === 'SEDANG') {
        bg[i] = '#ffe599';
        fw[i] = 'bold';
      } else if (a === 'LEMAH') {
        bg[i] = '#ea9999';
        fw[i] = 'bold';
      }
    });

    // Candle = W (index 23)
    const candle = String(row[23] || '').trim().toUpperCase();
    if (candle === 'BULLISH') {
      bg[23] = '#b6d7a8'; fw[23] = 'bold';
    } else if (candle === 'BEARISH') {
      bg[23] = '#ea9999'; fw[23] = 'bold';
    } else if (candle === 'NETRAL') {
      bg[23] = '#ffe599'; fw[23] = 'bold';
    }

    // Trend = X (index 24)
    const trend = String(row[24] || '').trim().toUpperCase();
    if (trend === 'UPTREND') {
      bg[24] = '#b6d7a8'; fw[24] = 'bold';
    } else if (trend === 'MIXED BULLISH') {
      bg[24] = '#ffe599'; fw[24] = 'bold';
    } else if (['LEMAH','DOWNTREND','BEARISH'].indexOf(trend) >= 0) {
      bg[24] = '#ea9999'; fw[24] = 'bold';
    }

    // Perubahan % = N (index 13)
    const chg = Number(row[13]);
    if (isFinite(chg)) {
      if (chg > 0) {
        bg[13] = '#b6d7a8'; fw[13] = 'bold';
      } else if (chg < 0) {
        bg[13] = '#ea9999'; fw[13] = 'bold';
      }
    }

    // VOL vs AVG20 = S (index 18)
    fw[18] = 'bold';

    bgs.push(bg);
    fws.push(fw);
  });

  sheet.getRange(2, 1, rowCount, 26)
    .setBackgrounds(bgs)
    .setFontWeights(fws);

  // V58: teks kategori VOLATILITAS selalu hitam.
  sheet.getRange(2, 5, rowCount, 1).setFontColor('#000000');

  // Warna teks VOL vs AVG20 tetap dipertahankan.
  const colors = values.map(function(row) {
    const v = Number(row[18]);
    return [
      isFinite(v)
        ? (v > 1 ? '#006100' : v >= 0.5 ? '#bf9000' : '#cc0000')
        : '#000000'
    ];
  });

  sheet.getRange(2, 19, rowCount, 1).setFontColors(colors);
}

function testDataSource() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const data = getOrCreate_(ss, CFG.DATA_SHEET);

  const ticker = String(input.getRange(CFG.INPUT_CELL).getDisplayValue())
    .trim().toUpperCase().replace(/\s+/g,'');

  if (!ticker) throw new Error('Isi INPUT!A2 terlebih dahulu.');

  const stock = fetchYahooHistory_(ticker + '.JK', 100);
  const ihsg = fetchYahooHistory_('^JKSE', 100);

  data.clear();
  data.getRange('A1:F1').setValues([[
    'Date','Open','High','Low','Close','Volume'
  ]]);

  if (stock && stock.length) {
    data.getRange(2,1,stock.length,6).setValues(
      stock.map(x => [x.date,x.open,x.high,x.low,x.close,x.volume])
    );
  }

  data.getRange('H1:I1').setValues([['IHSG Date','IHSG Close']]);
  if (ihsg && ihsg.length) {
    data.getRange(2,8,ihsg.length,2).setValues(
      ihsg.map(x => [x.date,x.close])
    );
  }

  data.autoResizeColumns(1, 20);
  [105,90,90,90,90,115,95,90,90,90,95,95,90,90,105,115,90,105,110,100]
    .forEach(function(w, idx) {
      const col = idx + 1;
      if (data.getColumnWidth(col) < w) data.setColumnWidth(col, w);
    });
  data.setColumnWidth(21, 430);

  const msg =
    'TES SUMBER DATA\n\n' +
    ticker + '.JK: ' + (stock ? stock.length : 0) + ' baris\n' +
    '^JKSE: ' + (ihsg ? ihsg.length : 0) + ' baris\n\n' +
    'Jika kedua jumlah > 80, sumber data siap.\n' +
    'Tidak menggunakan GOOGLEFINANCE.';

  SpreadsheetApp.getUi().alert(msg);
}

/**
 * ================================================================
 * V62 - FRESH LATEST QUOTE BATCH
 * ================================================================
 * Satu request quote dapat memuat banyak ticker. Dipakai untuk mengganti
 * candle terakhir dari histori cache 6 jam sehingga Auto Monitor 10 menit
 * tidak perlu mengunduh histori OHLCV ulang setiap siklus.
 */
function fetchYahooLatestQuotesBatch_(symbols, forceFresh) {
  const list = Array.from(new Set((symbols || []).map(function(s) {
    return String(s || '').trim().toUpperCase();
  }).filter(Boolean)));

  const out = {};
  if (!list.length) return out;

  forceFresh = forceFresh === true;

  const cache = CacheService.getScriptCache();
  const uncached = [];

  list.forEach(function(symbol) {
    // V62: screening tidak memakai quote cache agar harga IHSG/saham
    // mengikuti snapshot Yahoo terbaru pada saat screening dijalankan.
    const key = 'PFS_QUOTE_V62_' + symbol.replace(/[^A-Z0-9_\-\.\^=]/g, '_');

    if (!forceFresh) {
      const cached = cache.get(key);
      if (cached) {
        try {
          out[symbol] = JSON.parse(cached);
          return;
        } catch (e) {}
      }
    }

    uncached.push(symbol);
  });

  if (!uncached.length) return out;

  // Yahoo membatasi panjang URL; 80 ticker/request tetap dipakai.
  for (let i = 0; i < uncached.length; i += CFG.YAHOO_QUOTE_BATCH_SIZE) {
    const chunk = uncached.slice(i, i + CFG.YAHOO_QUOTE_BATCH_SIZE);
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' +
      encodeURIComponent(chunk.join(','));

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*'
        }
      });

      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code !== 200) throw new Error('Yahoo Quote HTTP ' + code);

      const json = JSON.parse(body);
      const rows = json.quoteResponse && json.quoteResponse.result
        ? json.quoteResponse.result : [];

      rows.forEach(function(q) {
        const symbol = String(q.symbol || '').toUpperCase();
        if (!symbol) return;

        const item = {
          symbol: symbol,
          price: Number(q.regularMarketPrice),
          open: Number(q.regularMarketOpen),
          high: Number(q.regularMarketDayHigh),
          low: Number(q.regularMarketDayLow),
          volume: Number(q.regularMarketVolume),
          prevClose: Number(q.regularMarketPreviousClose),
          changePct: Number(q.regularMarketChangePercent),
          marketTime: q.regularMarketTime ? Number(q.regularMarketTime) : null,
          fetchedAt: Date.now()
        };

        if (isFinite(item.price)) {
          out[symbol] = item;

          // Cache hanya untuk fungsi lain yang tidak membutuhkan fresh quote.
          // Screening V62 tetap bypass cache.
          try {
            cache.put(
              'PFS_QUOTE_V62_' + symbol.replace(/[^A-Z0-9_\-\.\^=]/g, '_'),
              JSON.stringify(item),
              CFG.YAHOO_QUOTE_CACHE_TTL_SECONDS
            );
          } catch (e) {}
        }
      });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);

      // Jangan menghentikan seluruh screening jika quote gagal.
      // Histori/cache masih dapat dipakai sebagai fallback.
      console.log('Quote batch V62 gagal: ' + msg);
    }
  }

  return out;
}

/**
 * V65 - CLOSE REALTIME SCREENING via Yahoo Chart 1 menit.
 * Mengambil candle 1m terakhir yang tersedia untuk CLOSE pada hasil SCREENING.
 * fetchAll dipakai agar beberapa ticker diproses paralel per batch.
 */
function fetchYahooRealtimeClose1mBatchV65_(symbols) {
  const list = Array.from(new Set((symbols || []).map(function(s) {
    return String(s || '').trim().toUpperCase();
  }).filter(Boolean)));
  const out = {};
  if (!list.length) return out;

  const batchSize = Math.max(1, Number(CFG.REALTIME_CLOSE_1M_BATCH_SIZE || 20));
  for (let start = 0; start < list.length; start += batchSize) {
    const chunk = list.slice(start, start + batchSize);
    const requests = chunk.map(function(symbol) {
      return {
        url: 'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(symbol) +
          '?range=1d&interval=1m&includePrePost=false&events=div%2Csplits',
        method: 'get',
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
          'Accept': 'application/json,text/plain,*/*'
        }
      };
    });

    try {
      const responses = UrlFetchApp.fetchAll(requests);
      responses.forEach(function(response, idx) {
        const symbol = chunk[idx];
        try {
          if (response.getResponseCode() !== 200) return;
          const json = JSON.parse(response.getContentText());
          const result = json.chart && json.chart.result && json.chart.result[0];
          if (!result) return;
          const timestamps = result.timestamp || [];
          const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
          if (!quote || !timestamps.length) return;

          let latestPrice = null;
          let latestTime = null;
          let latestVolume = null;
          for (let i = timestamps.length - 1; i >= 0; i--) {
            const c = Number(quote.close && quote.close[i]);
            if (isFinite(c) && c > 0) {
              latestPrice = c;
              latestTime = Number(timestamps[i]);
              const v = Number(quote.volume && quote.volume[i]);
              latestVolume = isFinite(v) ? v : null;
              break;
            }
          }

          // Jika candle 1m kosong, fallback ke regularMarketPrice.
          if (!(latestPrice > 0)) {
            const meta = result.meta || {};
            const p = Number(meta.regularMarketPrice);
            if (isFinite(p) && p > 0) {
              latestPrice = p;
              latestTime = meta.regularMarketTime ? Number(meta.regularMarketTime) : null;
              const mv = Number(meta.regularMarketVolume);
              latestVolume = isFinite(mv) ? mv : null;
            }
          }

          const meta = result.meta || {};
          const chartPreviousClose = Number(meta.chartPreviousClose);
          const previousClose = isFinite(chartPreviousClose) && chartPreviousClose > 0
            ? chartPreviousClose
            : null;

          if (latestPrice > 0) {
            out[symbol] = {
              symbol: symbol,
              price: latestPrice,
              previousClose: previousClose,
              marketTime: latestTime,
              volume: latestVolume,
              fetchedAt: Date.now()
            };
          }
        } catch (ignore) {}
      });
    } catch (e) {
      console.log('V66 Yahoo 1m batch gagal: ' + e.message);
    }
  }
  return out;
}

function mergeLatestQuoteIntoHistory_(rows, quote) {
  if (!rows || !rows.length || !quote || !isFinite(Number(quote.price))) return rows;

  const result = cloneYahooRows_(rows);
  const ts = quote.marketTime ? new Date(Number(quote.marketTime) * 1000) : new Date();
  const qDate = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());

  // Cari candle pada tanggal yang sama.
  let idx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    const d = new Date(result[i].date);
    if (d.getFullYear() === qDate.getFullYear() &&
        d.getMonth() === qDate.getMonth() &&
        d.getDate() === qDate.getDate()) {
      idx = i;
      break;
    }
    if (d < qDate) break;
  }

  const close = Number(quote.price);
  const prevClose = isFinite(Number(quote.prevClose))
    ? Number(quote.prevClose)
    : (result.length ? Number(result[result.length - 1].close) : null);

  const row = {
    date: qDate,
    open: isFinite(Number(quote.open)) ? Number(quote.open) : close,
    high: isFinite(Number(quote.high)) ? Number(quote.high) : close,
    low: isFinite(Number(quote.low)) ? Number(quote.low) : close,
    close: close,
    prevClose: prevClose,
    changePct: prevClose != null && prevClose !== 0
      ? (close - prevClose) / prevClose * 100 : null,
    volume: isFinite(Number(quote.volume)) ? Number(quote.volume) : 0
  };

  if (idx >= 0) {
    result[idx] = row;
  } else {
    // Jika cache terakhir adalah hari sebelumnya, tambahkan candle hari ini.
    const last = result[result.length - 1];
    if (!last || qDate >= new Date(last.date)) result.push(row);
  }

  // Urutkan tanggal dan hitung ulang prevClose/changePct agar konsisten.
  result.sort(function(a,b) { return new Date(a.date) - new Date(b.date); });
  let prev = null;
  result.forEach(function(r) {
    r.prevClose = prev;
    r.changePct = prev != null && prev !== 0
      ? (Number(r.close) - prev) / prev * 100 : null;
    prev = Number(r.close);
  });
  return result;
}

function clearMarketDataCache() {
  // CacheService tidak menyediakan penghapusan semua key berdasarkan prefix.
  // Mengganti namespace prefix membuat cache lama tidak dipakai lagi.
  CFG.YAHOO_CACHE_PREFIX = 'PFS_YF_V53_REFRESH_' + Date.now() + '_';
  try { PFS_YAHOO_RUNTIME_CACHE_ = {}; } catch (e) {}
  SpreadsheetApp.getUi().alert(
    'Cache data pasar V27 di-reset.\n\n' +
    'Screening berikutnya akan mengambil histori terbaru.\n' +
    'Jika kuota UrlFetch masih habis, tunggu sampai Google mereset kuota.'
  );
}

function testRealtimeCloseV65() {
  const input = getOrCreate_(SpreadsheetApp.getActiveSpreadsheet(), CFG.INPUT_SHEET);
  const ticker = String(input.getRange('A2').getDisplayValue()).trim().toUpperCase();
  if (!ticker) throw new Error('INPUT!A2 kosong. Isi contoh BBRI.');
  const q = fetchYahooRealtimeClose1mBatchV65_([ticker + '.JK', '^JKSE']);
  const stock = q[ticker + '.JK'];
  const ihsg = q['^JKSE'];
  const tz = Session.getScriptTimeZone() || 'Asia/Jakarta';
  SpreadsheetApp.getUi().alert([
    'TES CLOSE REALTIME V65', '',
    ticker + ': ' + (stock ? formatPrice_(stock.price) : 'tidak tersedia'),
    'IHSG: ' + (ihsg ? formatPrice_(ihsg.price) : 'tidak tersedia'), '',
    'Waktu saham: ' + (stock && stock.marketTime ? Utilities.formatDate(new Date(stock.marketTime * 1000), tz, 'yyyy-MM-dd HH:mm:ss') : '-'),
    'Waktu IHSG: ' + (ihsg && ihsg.marketTime ? Utilities.formatDate(new Date(ihsg.marketTime * 1000), tz, 'yyyy-MM-dd HH:mm:ss') : '-'), '',
    'Sumber: Yahoo Finance Chart interval 1 menit.',
    'Ini snapshot candle 1 menit terbaru yang tersedia dari provider, bukan feed tick broker.'
  ].join('\\n'));
}

function testFastMarketData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const ticker = String(input.getRange('A2').getDisplayValue()).trim().toUpperCase();
  if (!ticker) throw new Error('INPUT!A2 kosong. Isi contoh BBRI.');
  const q = fetchYahooLatestQuotesBatch_([ticker + '.JK', '^JKSE']);
  const msg = [
    ticker + ': ' + (q[ticker + '.JK'] ? formatPrice_(q[ticker + '.JK'].price) : 'tidak tersedia'),
    'IHSG: ' + (q['^JKSE'] ? formatPrice_(q['^JKSE'].price) : 'tidak tersedia'),
    '',
    'V62 menggunakan quote batch fresh saat screening; histori OHLCV tetap ter-cache untuk menghemat UrlFetch.'
  ].join('\n');
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * Mengambil histori Yahoo dengan perlindungan UrlFetch.
 *
 * Perubahan V26:
 * 1. CacheService: request yang sama dalam 1 menit tidak memanggil Yahoo lagi.
 * 2. Runtime cache: jika fungsi dipanggil berkali-kali dalam eksekusi yang sama,
 *    data langsung dipakai tanpa membaca cache lagi.
 * 3. LockService: mencegah eksekusi paralel mengambil data ticker yang sama.
 * 4. Data Date direvive kembali menjadi object Date setelah keluar dari cache.
 *
 * CATATAN:
 * Cache ini sengaja tidak dibuat terlalu lama karena harga candle terakhir
 * Yahoo dapat berubah selama jam perdagangan.
 */
function fetchYahooHistory_(symbol, lookbackDays) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const days = Number(lookbackDays) || CFG.LOOKBACK_DAYS;

  if (!normalizedSymbol) {
    throw new Error('Symbol Yahoo kosong.');
  }

  // Cache di level eksekusi: paling cepat dan tidak memakai layanan tambahan.
  if (typeof PFS_YAHOO_RUNTIME_CACHE_ === 'undefined') {
    PFS_YAHOO_RUNTIME_CACHE_ = {};
  }

  const runtimeKey = normalizedSymbol + '|' + days;
  if (PFS_YAHOO_RUNTIME_CACHE_.hasOwnProperty(runtimeKey)) {
    return cloneYahooRows_(PFS_YAHOO_RUNTIME_CACHE_[runtimeKey]);
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = makeYahooCacheKey_(normalizedSymbol, days);

  // Coba ambil dari Script Cache terlebih dahulu.
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const rows = decodeYahooCache_(cached);
      if (rows && rows.length) {
        PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rows;
        return cloneYahooRows_(rows);
      }
    } catch (e) {
      // Cache rusak/tidak kompatibel: abaikan dan ambil ulang dari Yahoo.
      console.log('Cache Yahoo diabaikan untuk ' + normalizedSymbol + ': ' + e.message);
    }
  }

  // Cegah dua trigger yang berjalan bersamaan melakukan fetch ticker yang sama.
  const lock = LockService.getDocumentLock();
  let lockAcquired = false;

  try {
    lockAcquired = lock.tryLock(10000);

    // Setelah mendapat lock, cek cache sekali lagi.
    // Eksekusi lain mungkin baru saja selesai mengambil data.
    if (lockAcquired) {
      const cachedAfterLock = cache.get(cacheKey);
      if (cachedAfterLock) {
        try {
          const rowsAfterLock = decodeYahooCache_(cachedAfterLock);
          if (rowsAfterLock && rowsAfterLock.length) {
            PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rowsAfterLock;
            return cloneYahooRows_(rowsAfterLock);
          }
        } catch (e) {
          console.log('Cache Yahoo pasca-lock diabaikan untuk ' + normalizedSymbol + ': ' + e.message);
        }
      }
    }

    const rows = fetchYahooHistoryRaw_(normalizedSymbol, days);

    // Simpan hasil hanya jika cukup kecil untuk CacheService.
    try {
      const encoded = encodeYahooCache_(rows);
      if (encoded && encoded.length <= CFG.YAHOO_CACHE_MAX_BYTES) {
        cache.put(cacheKey, encoded, CFG.YAHOO_CACHE_TTL_SECONDS);
      } else {
        console.log(
          'Cache Yahoo dilewati untuk ' + normalizedSymbol +
          ' karena payload terlalu besar: ' +
          (encoded ? encoded.length : 0) + ' bytes.'
        );
      }
    } catch (cacheError) {
      // Kegagalan cache tidak boleh menggagalkan screening.
      console.log('Gagal menyimpan cache Yahoo ' + normalizedSymbol + ': ' + cacheError.message);
    }

    PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rows;
    return cloneYahooRows_(rows);

  } catch (e) {
    const msg = String(e && e.message ? e.message : e);

    // Beri pesan khusus untuk kasus kuota UrlFetch agar pengguna tidak
    // mengira data saham rusak.
    if (
      /Service invoked too many times/i.test(msg) ||
      /UrlFetchApp/i.test(msg) ||
      /terlalu sering diminta/i.test(msg)
    ) {
      throw new Error(
        'KUOTA URLFETCH TERCAPAI saat mengambil ' + normalizedSymbol + '. ' +
        'Data Yahoo tidak diambil ulang secara agresif. ' +
        'Tunggu kuota Google reset, lalu jalankan screening kembali. ' +
        'V62 memakai quote fresh saat screening dan cache histori untuk mengurangi request.'
      );
    }

    throw e;
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}


/**
 * ================================================================
 * FAST BATCH FETCH V26
 * ================================================================
 * Cache dicek lebih dulu. Hanya ticker yang belum ada di cache
 * yang dikirim ke Yahoo. Request uncached dikirim secara batch.
 */
function fetchYahooHistoryBatch_(symbols, lookbackDays) {
  const list = Array.from(new Set((symbols || []).map(function(s) {
    return String(s || '').trim().toUpperCase();
  }).filter(Boolean)));

  const days = Number(lookbackDays) || CFG.LOOKBACK_DAYS;
  const out = {};
  const uncached = [];

  if (typeof PFS_YAHOO_RUNTIME_CACHE_ === 'undefined') {
    PFS_YAHOO_RUNTIME_CACHE_ = {};
  }

  const cache = CacheService.getScriptCache();

  list.forEach(function(symbol) {
    const runtimeKey = symbol + '|' + days;
    if (PFS_YAHOO_RUNTIME_CACHE_.hasOwnProperty(runtimeKey)) {
      out[symbol] = cloneYahooRows_(PFS_YAHOO_RUNTIME_CACHE_[runtimeKey]);
      return;
    }

    const cacheKey = makeYahooCacheKey_(symbol, days);
    const cached = cache.get(cacheKey);
    if (cached) {
      try {
        const rows = decodeYahooCache_(cached);
        if (rows && rows.length) {
          PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rows;
          out[symbol] = cloneYahooRows_(rows);
          return;
        }
      } catch (e) {
        console.log('Cache batch diabaikan untuk ' + symbol + ': ' + e.message);
      }
    }

    uncached.push(symbol);
  });

  if (!uncached.length) return out;

  const lock = LockService.getDocumentLock();
  let lockAcquired = false;

  try {
    lockAcquired = lock.tryLock(10000);

    const stillNeed = [];
    uncached.forEach(function(symbol) {
      const runtimeKey = symbol + '|' + days;
      if (PFS_YAHOO_RUNTIME_CACHE_.hasOwnProperty(runtimeKey)) {
        out[symbol] = cloneYahooRows_(PFS_YAHOO_RUNTIME_CACHE_[runtimeKey]);
        return;
      }

      const cached = cache.get(makeYahooCacheKey_(symbol, days));
      if (cached) {
        try {
          const rows = decodeYahooCache_(cached);
          if (rows && rows.length) {
            PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rows;
            out[symbol] = cloneYahooRows_(rows);
            return;
          }
        } catch (e) {}
      }
      stillNeed.push(symbol);
    });

    for (let startIdx = 0; startIdx < stillNeed.length; startIdx += CFG.YAHOO_BATCH_SIZE) {
      const chunk = stillNeed.slice(startIdx, startIdx + CFG.YAHOO_BATCH_SIZE);
      const endTs = Math.floor(Date.now() / 1000);
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const startTs = Math.floor(startDate.getTime() / 1000);

      const requests = chunk.map(function(symbol) {
        const url =
          'https://query1.finance.yahoo.com/v8/finance/chart/' +
          encodeURIComponent(symbol) +
          '?period1=' + startTs +
          '&period2=' + endTs +
          '&interval=1d' +
          '&events=history' +
          '&includeAdjustedClose=true';

        return {
          url: url,
          method: 'get',
          muteHttpExceptions: true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
          }
        };
      });

      let responses;
      try {
        responses = UrlFetchApp.fetchAll(requests);
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (
          /Service invoked too many times/i.test(msg) ||
          /UrlFetchApp/i.test(msg) ||
          /terlalu sering diminta/i.test(msg)
        ) {
          throw new Error(
            'KUOTA URLFETCH TERCAPAI saat screening batch. ' +
            'Tunggu kuota Google reset sebelum screening penuh dijalankan.'
          );
        }
        throw e;
      }

      responses.forEach(function(response, i) {
        const symbol = chunk[i];
        try {
          const code = response.getResponseCode();
          const body = response.getContentText();

          if (code !== 200) {
            throw new Error(
              'Yahoo Finance HTTP ' + code + ' untuk ' + symbol + '. ' +
              body.substring(0, 180)
            );
          }

          const rows = parseYahooHistoryBody_(body, symbol);
          if (!rows || !rows.length) {
            throw new Error('Data Yahoo kosong untuk ' + symbol + '.');
          }

          const runtimeKey = symbol + '|' + days;
          PFS_YAHOO_RUNTIME_CACHE_[runtimeKey] = rows;
          out[symbol] = cloneYahooRows_(rows);

          try {
            const encoded = encodeYahooCache_(rows);
            if (encoded && encoded.length <= CFG.YAHOO_CACHE_MAX_BYTES) {
              cache.put(
                makeYahooCacheKey_(symbol, days),
                encoded,
                CFG.YAHOO_CACHE_TTL_SECONDS
              );
            }
          } catch (cacheError) {
            console.log('Gagal cache batch ' + symbol + ': ' + cacheError.message);
          }
        } catch (e) {
          out[symbol] = null;
          console.log('Batch Yahoo gagal ' + symbol + ': ' + e.message);
        }
      });
    }

    return out;
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

function parseYahooHistoryBody_(body, symbol) {
  const json = JSON.parse(body);

  if (!json.chart || !json.chart.result || !json.chart.result.length) {
    const err = json.chart && json.chart.error
      ? JSON.stringify(json.chart.error)
      : 'Tidak ada result';
    throw new Error('Data Yahoo tidak tersedia untuk ' + symbol + ': ' + err);
  }

  const result = json.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators && result.indicators.quote &&
    result.indicators.quote[0];
  const adj = result.indicators && result.indicators.adjclose &&
    result.indicators.adjclose[0];

  if (!quote) throw new Error('Quote Yahoo tidak tersedia untuk ' + symbol + '.');

  const rows = [];
  let prevClose = null;

  for (let i = 0; i < timestamps.length; i++) {
    const closeRaw = quote.close && quote.close[i] != null
      ? Number(quote.close[i])
      : (adj && adj.adjclose && adj.adjclose[i] != null
        ? Number(adj.adjclose[i])
        : NaN);

    if (!isFinite(closeRaw)) continue;

    const open = quote.open && quote.open[i] != null
      ? Number(quote.open[i]) : closeRaw;
    const high = quote.high && quote.high[i] != null
      ? Number(quote.high[i]) : closeRaw;
    const low = quote.low && quote.low[i] != null
      ? Number(quote.low[i]) : closeRaw;
    const volume = quote.volume && quote.volume[i] != null
      ? Number(quote.volume[i]) : 0;

    let changePct = null;
    if (prevClose != null && prevClose !== 0) {
      changePct = (closeRaw - prevClose) / prevClose * 100;
    }

    rows.push({
      date: new Date(Number(timestamps[i]) * 1000),
      open: open,
      high: high,
      low: low,
      close: closeRaw,
      prevClose: prevClose,
      changePct: changePct,
      volume: volume
    });

    prevClose = closeRaw;
  }

  return rows;
}

/**
 * Fetch Yahoo yang benar-benar melakukan UrlFetchApp.
 * Semua pemanggilan dari script masuk melalui fetchYahooHistory_()
 * sehingga mekanisme cache berlaku konsisten.
 */
function fetchYahooHistoryRaw_(symbol, lookbackDays) {
  const end = Math.floor(Date.now() / 1000);
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const start = Math.floor(startDate.getTime() / 1000);

  const url =
    'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) +
    '?period1=' + start +
    '&period2=' + end +
    '&interval=1d' +
    '&events=history' +
    '&includeAdjustedClose=true';

  let response;

  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
      }
    });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);

    if (
      /Service invoked too many times/i.test(msg) ||
      /UrlFetchApp/i.test(msg) ||
      /terlalu sering diminta/i.test(msg)
    ) {
      throw new Error(
        'UrlFetchApp Google sudah mencapai batas penggunaan. ' +
        'Tunggu kuota reset sebelum meminta data Yahoo lagi.'
      );
    }

    throw e;
  }

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    throw new Error(
      'Yahoo Finance HTTP ' + code + ' untuk ' + symbol + '.\n' +
      body.substring(0,250)
    );
  }

  const json = JSON.parse(body);

  if (!json.chart || !json.chart.result || !json.chart.result.length) {
    const err = json.chart && json.chart.error
      ? JSON.stringify(json.chart.error)
      : 'Tidak ada result';
    throw new Error('Data Yahoo tidak tersedia untuk ' + symbol + ': ' + err);
  }

  const result = json.chart.result[0];
  const timestamps = result.timestamp || [];
  const q = result.indicators && result.indicators.quote
    ? result.indicators.quote[0]
    : null;

  if (!q) throw new Error('Format OHLCV Yahoo tidak tersedia untuk ' + symbol);

  // Fallback harga terakhir:
  // beberapa ticker kadang mengembalikan Close terakhir 0/null
  // walaupun Yahoo masih menyediakan regularMarketPrice.
  const meta = result.meta || {};
  const regularMarketPrice = Number(meta.regularMarketPrice);
  const validMarketPrice =
    isFinite(regularMarketPrice) && regularMarketPrice > 0
      ? regularMarketPrice
      : null;

  const rows = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = num_(q.open && q.open[i]);
    const high = num_(q.high && q.high[i]);
    const low = num_(q.low && q.low[i]);
    const close = num_(q.close && q.close[i]);
    const volume = num_(q.volume && q.volume[i]);

    if (
      open === null || high === null || low === null ||
      close === null || volume === null
    ) continue;

    const d = new Date(timestamps[i] * 1000);
    d.setHours(0,0,0,0);

    const prevClose = rows.length > 0 ? rows[rows.length - 1].close : null;
    const changePct = (prevClose !== null && prevClose !== 0)
      ? ((close - prevClose) / prevClose) * 100
      : null;

    rows.push({
      date: d,
      open: open,
      high: high,
      low: low,
      close: close,
      prevClose: prevClose,
      changePct: changePct,
      volume: volume
    });
  }

  // Pastikan harga terakhir tidak 0 jika Yahoo menyediakan
  // regularMarketPrice yang valid.
  if (rows.length && validMarketPrice !== null) {
    const last = rows[rows.length - 1];
    if (!isFinite(Number(last.close)) || Number(last.close) <= 0) {
      last.close = validMarketPrice;
      if (rows.length >= 2 && Number(rows[rows.length - 2].close) > 0) {
        last.prevClose = Number(rows[rows.length - 2].close);
        last.changePct =
          ((last.close / last.prevClose) - 1) * 100;
      }
    }
  }

  return rows;
}

/**
 * CacheService hanya menyimpan string. Date perlu diubah ke timestamp
 * lalu dikembalikan menjadi Date ketika cache dibaca.
 *
 * gzip + base64 membantu menjaga payload tetap kecil.
 */
function encodeYahooCache_(rows) {
  const compact = (rows || []).map(function(x) {
    return [
      x.date instanceof Date ? x.date.getTime() : new Date(x.date).getTime(),
      x.open, x.high, x.low, x.close, x.prevClose, x.changePct, x.volume
    ];
  });

  const json = JSON.stringify(compact);
  const gz = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
  return Utilities.base64Encode(gz.getBytes());
}

function decodeYahooCache_(encoded) {
  const bytes = Utilities.base64Decode(encoded);
  const json = Utilities.ungzip(
    Utilities.newBlob(bytes, 'application/octet-stream')
  ).getDataAsString();

  const compact = JSON.parse(json);

  return compact.map(function(x) {
    return {
      date: new Date(Number(x[0])),
      open: Number(x[1]),
      high: Number(x[2]),
      low: Number(x[3]),
      close: Number(x[4]),
      prevClose: x[5] === null || x[5] === undefined ? null : Number(x[5]),
      changePct: x[6] === null || x[6] === undefined ? null : Number(x[6]),
      volume: Number(x[7])
    };
  });
}

function cloneYahooRows_(rows) {
  // Kembalikan object baru supaya fungsi indikator tidak secara tidak sengaja
  // mengubah object yang tersimpan di runtime cache.
  return (rows || []).map(function(x) {
    return {
      date: x.date instanceof Date ? new Date(x.date.getTime()) : new Date(x.date),
      open: x.open,
      high: x.high,
      low: x.low,
      close: x.close,
      prevClose: x.prevClose,
      changePct: x.changePct,
      volume: x.volume
    };
  });
}

function makeYahooCacheKey_(symbol, lookbackDays) {
  // Hanya karakter aman untuk CacheService key.
  const safe = String(symbol)
    .replace(/[^A-Z0-9_]/gi, '_')
    .substring(0, 80);

  return CFG.YAHOO_CACHE_PREFIX + safe + '_' + Number(lookbackDays || 0);
}

/**
 * Bersihkan cache Yahoo secara manual.
 *
 * CacheService tidak menyediakan daftar semua key, jadi fungsi ini
 * menggunakan daftar ticker aktif di INPUT + ^JKSE untuk menghapus key
 * yang kemungkinan dipakai script.
 */
function clearYahooCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);
  const lastRow = Math.max(input.getLastRow(), 2);
  const values = input.getRange(2, 1, lastRow - 1, 3).getValues();

  const tickers = values
    .filter(function(r) {
      return r[2] === true || String(r[2]).toUpperCase() === 'TRUE';
    })
    .map(function(r) {
      return String(r[0]).trim().toUpperCase().replace(/\s+/g, '');
    })
    .filter(Boolean);

  const keys = [];

  // CacheService.deleteAll membutuhkan array key yang diketahui.
  tickers.forEach(function(ticker) {
    keys.push(makeYahooCacheKey_(ticker + '.JK', CFG.LOOKBACK_DAYS));
  });
  keys.push(makeYahooCacheKey_('^JKSE', CFG.LOOKBACK_DAYS));

  // Replay dapat memakai lookback yang berbeda.
  const replayRequiredTradingDays =
    80 + CFG.HISTORICAL_REPLAY_DAYS +
    CFG.HISTORICAL_MAX_FORWARD_DAYS + 10;
  const replayLookback = Math.ceil(replayRequiredTradingDays * 1.65);

  tickers.forEach(function(ticker) {
    keys.push(makeYahooCacheKey_(ticker + '.JK', replayLookback));
  });
  keys.push(makeYahooCacheKey_('^JKSE', replayLookback));

  try {
    CacheService.getScriptCache().removeAll(keys);
  } catch (e) {
    console.log('Gagal menghapus sebagian cache Yahoo: ' + e.message);
  }

  // Runtime cache pasti hilang setelah eksekusi selesai, tetapi jika fungsi
  // ini dipanggil setelah fetch dalam eksekusi yang sama, bersihkan juga.
  if (typeof PFS_YAHOO_RUNTIME_CACHE_ !== 'undefined') {
    PFS_YAHOO_RUNTIME_CACHE_ = {};
  }

  SpreadsheetApp.getUi().alert(
    'Cache Yahoo sudah dibersihkan.\n\n' +
    'Gunakan ini hanya jika Anda ingin memaksa pengambilan data Yahoo terbaru.'
  );
}

function calculateIndicators_(stock, ihsg) {
  // Mapping IHSG berdasarkan tanggal YYYY-MM-DD.
  const ihsgMap = {};
  ihsg.forEach(x => ihsgMap[dateKey_(x.date)] = x.close);

  const rows = [];
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];
  const ihsgCloses = [];

  let obv = 0;
  let ema8 = null;
  let ema14 = null;
  let ema20 = null;
  let macdSignal = null;

  const k8 = 2/(8+1);
  const k14 = 2/(14+1);
  const k20 = 2/(20+1);
  const k9 = 2/(9+1);

  for (let i = 0; i < stock.length; i++) {
    const s = stock[i];
    const key = dateKey_(s.date);
    const ih = ihsgMap[key];

    // Kalau tanggal IHSG tidak ada, cari tanggal IHSG terakhir <= tanggal saham.
    const ihClose = ih !== undefined ? ih : nearestPriorIHSG_(ihsg, s.date);

    closes.push(s.close);
    highs.push(s.high);
    lows.push(s.low);
    volumes.push(s.volume);
    ihsgCloses.push(ihClose);

    ema8 = ema8 === null ? s.close : s.close*k8 + ema8*(1-k8);
    ema14 = ema14 === null ? s.close : s.close*k14 + ema14*(1-k14);
    ema20 = ema20 === null ? s.close : s.close*k20 + ema20*(1-k20);

    if (i > 0) {
      if (s.close > stock[i-1].close) obv += s.volume;
      else if (s.close < stock[i-1].close) obv -= s.volume;
    }

    const macd = ema8 - ema14;
    macdSignal = macdSignal === null
      ? macd
      : macd*k9 + macdSignal*(1-k9);

    const macdHist = macd - macdSignal;

    const return20 = i >= 20
      ? s.close / closes[i-20] - 1
      : null;

    const return60 = i >= 60
      ? s.close / closes[i-60] - 1
      : null;

    const ihReturn20 =
      i >= 20 && ihsgCloses[i] != null && ihsgCloses[i-20] != null
      ? ihsgCloses[i] / ihsgCloses[i-20] - 1
      : null;

    const ihReturn60 =
      i >= 60 && ihsgCloses[i] != null && ihsgCloses[i-60] != null
      ? ihsgCloses[i] / ihsgCloses[i-60] - 1
      : null;

    // RSR = excess return vs IHSG, expressed in percentage points.
    // Relative Strength Rating (RSR) 0-100.
    // 50 = performa saham sejalan dengan IHSG.
    // >50 = outperform IHSG; <50 = underperform IHSG.
    const excess20 = return20 !== null && ihReturn20 !== null
      ? (return20 - ihReturn20)
      : null;

    const excess60 = return60 !== null && ihReturn60 !== null
      ? (return60 - ihReturn60)
      : null;

    const rsr20 = excess20 === null
      ? null
      : Math.max(0, Math.min(100, Math.round(50 + excess20 * 200)));

    const rsr60 = excess60 === null
      ? null
      : Math.max(0, Math.min(100, Math.round(50 + excess60 * 200)));

    const start14 = Math.max(0, i-13);
    const hh = Math.max.apply(null, highs.slice(start14,i+1));
    const ll = Math.min.apply(null, lows.slice(start14,i+1));
    const willr = (hh === ll)
      ? -50
      : -100 * ((hh - s.close) / (hh - ll));

    const mfi = calcMFI_(stock, i, 14);

    const momentum = calcMomentumScore_(
      s.close, ema8, ema14, ema20, macdHist, return20, return60
    );

    const obv5 = i >= 5 ? calcOBVAt_(stock, i-5) : null;
    const obvTrend = obv5 === null ? false : obv > obv5;

    rows.push({
      date: s.date,
      open: s.open,
      high: s.high,
      low: s.low,
      close: s.close,
      volume: s.volume,
      ihsgClose: ihClose,
      ema8: ema8,
      ema14: ema14,
      ema20: ema20,
      return20: return20,
      return60: return60,
      rsr20: rsr20,
      rsr60: rsr60,
      willr: willr,
      obv: obv,
      mfi: mfi,
      macdHist: macdHist,
      momentum: momentum,
      obvTrend: obvTrend
    });
  }

  const latest = rows[rows.length-1];

  const scores = scorePFS_(latest);
  latest.rsr20Score = scores.rsr20;
  latest.rsr60Score = scores.rsr60;
  latest.emaScore = scores.ema;
  latest.willrScore = scores.willr;
  latest.momentumScore = scores.momentum;
  latest.obvScore = scores.obv;
  latest.mfiScore = scores.mfi;
  latest.macdScore = scores.macd;
  latest.pfs = scores.pfs;
  latest.timing = scores.timing;
  latest.signal = scores.signal;
  latest.entry1 = scores.entry1;
  latest.entry2 = scores.entry2;
  latest.entry3 = scores.entry3;

  return {rows: rows, latest: latest};
}

function scorePFS_(x) {
  // 1. RSR20 /10
  const rsr20 =
    x.rsr20 === null ? 0 :
    x.rsr20 >= 70 ? 10 :
    x.rsr20 >= 60 ? 8 :
    x.rsr20 >= 50 ? 5 : 0;

  // 2. RSR60 /10
  const rsr60 =
    x.rsr60 === null ? 0 :
    x.rsr60 >= 70 ? 10 :
    x.rsr60 >= 60 ? 8 :
    x.rsr60 >= 50 ? 5 : 0;

  // 3. EMA Structure /15
  const ema =
    x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20 ? 15 :
    x.close > x.ema20 && x.ema8 > x.ema14 ? 10 :
    x.close > x.ema20 ? 5 : 0;

  // 4. William %R /15
  // Zona -80 sampai -50 = pullback/rebound.
  const willr =
    x.willr > -80 && x.willr <= -50 ? 15 :
    x.willr > -90 && x.willr <= -40 ? 10 :
    x.willr > -100 ? 5 : 0;

  // 5. Momentum /15
  const momentum =
    x.momentum >= 80 ? 15 :
    x.momentum >= 70 ? 12 :
    x.momentum >= 60 ? 9 :
    x.momentum >= 50 ? 5 : 0;

  // 6. OBV /15
  const obv = x.obvTrend ? 15 : 5;

  // 7. MFI /10
  const mfi =
    x.mfi >= 50 && x.mfi <= 80 ? 10 :
    x.mfi >= 40 ? 5 : 0;

  // 8. MACD /10
  const macd = x.macdHist > 0 ? 10 : x.macdHist === 0 ? 5 : 0;

  const pfs = Math.max(0, Math.min(100,
    rsr20 + rsr60 + ema + willr + momentum + obv + mfi + macd
  ));

  // Timing 0-30:
  const timingWillr =
    x.willr > -80 && x.willr <= -50 ? 15 :
    x.willr > -90 && x.willr <= -40 ? 10 :
    x.willr > -100 ? 5 : 0;

  const timingEMA =
    x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20 ? 15 :
    x.close > x.ema20 && x.ema8 > x.ema14 ? 10 :
    x.close > x.ema20 ? 5 : 0;

  const timing = timingWillr + timingEMA;

  let signal = 'HINDARI';
  if (pfs >= 90 && timing >= 24) signal = 'ENTRY A+';
  else if (pfs >= 85 && timing >= 20) signal = 'ENTRY A';
  else if (pfs >= 75 && timing >= 15) signal = 'CICIL ENTRY';
  else if (pfs >= 70) signal = 'WATCHLIST';
  else if (pfs >= 60) signal = 'TUNGGU';

  const entry1 =
    pfs >= 85 ? '30% modal' :
    pfs >= 75 ? '20% modal' : 'TUNGGU';

  const entry2 =
    pfs >= 75
      ? (x.close <= x.ema20 * 1.02
        ? '30% modal - dekat EMA20'
        : 'TUNGGU PULLBACK ke EMA20')
      : 'TUNGGU';

  const entry3 =
    pfs >= 80 && x.close > x.ema8 && x.ema8 > x.ema14 && x.ema14 > x.ema20
      ? '40% modal - konfirmasi trend'
      : 'TUNGGU KONFIRMASI';

  return {
    rsr20, rsr60, ema, willr, momentum,
    obv, mfi, macd, pfs, timing, signal,
    entry1, entry2, entry3
  };
}

function calcMomentumScore_(close, ema8, ema14, ema20, macdHist, r20, r60) {
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

function calcMFI_(stock, i, period) {
  const start = Math.max(1, i - period + 1);
  let positive = 0;
  let negative = 0;

  for (let j = start; j <= i; j++) {
    const tp = (stock[j].high + stock[j].low + stock[j].close) / 3;
    const prevTp =
      (stock[j-1].high + stock[j-1].low + stock[j-1].close) / 3;
    const flow = tp * stock[j].volume;

    if (tp > prevTp) positive += flow;
    else if (tp < prevTp) negative += flow;
  }

  if (negative === 0) return 100;

  const ratio = positive / negative;
  return 100 - (100 / (1 + ratio));
}

function calcOBVAt_(stock, index) {
  let obv = 0;
  for (let i = 1; i <= index; i++) {
    if (stock[i].close > stock[i-1].close) obv += stock[i].volume;
    else if (stock[i].close < stock[i-1].close) obv -= stock[i].volume;
  }
  return obv;
}

function writeDashboard_(pfs, x, ticker, prev) {
  pfs.clear();

  pfs.getRange('A1:D18').setValues([
    ['INDIKATOR', 'NILAI', 'SKOR', 'DETAIL / INTERPRETASI'],
    ['Harga', x.close, '', 'Harga penutupan terbaru ' + ticker],
    ['EMA8', x.ema8, x.emaScore, 'EMA 8 hari; trend cepat'],
    ['EMA14', x.ema14, '', 'EMA 14 hari; filter trend'],
    ['EMA20', x.ema20, '', 'EMA 20 hari; support/filter utama'],
    ['RSR20', x.rsr20, x.rsr20Score, 'Relative Strength Rating 0-100; 50 netral, >50 outperform IHSG'],
    ['RSR60', x.rsr60, x.rsr60Score, 'Relative Strength Rating 0-100; 50 netral, >50 outperform IHSG'],
    ['William %R', x.willr, x.willrScore, '-80 s/d -50 = zona pullback/rebound'],
    ['Momentum Score', x.momentum, x.momentumScore, '0-100 dari struktur harga/EMA/MACD'],
    ['OBV', x.obv, x.obvScore, 'OBV naik vs 5 hari sebelumnya = positif'],
    ['MFI', x.mfi, x.mfiScore, 'MFI 50-80 = arus uang relatif sehat'],
    ['MACD Histogram', x.macdHist, x.macdScore, 'MACD(8,14,9); >0 bullish'],
    ['PFS', x.pfs, x.pfs, 'Predictive Filter Score 0-100'],
    ['Timing Score', x.timing, x.timing, '0-30 berdasarkan William %R + EMA'],
    ['Sinyal', x.signal, '', 'Gabungan PFS dan Timing'],
    ['Entry 1', x.entry1, '', 'Entry awal bertahap'],
    ['Entry 2', x.entry2, '', 'Entry saat pullback sehat'],
    ['Entry 3', x.entry3, '', 'Entry setelah konfirmasi trend']
  ]);

  pfs.getRange('A20:D29').setValues([
    ['KOMPONEN PFS', 'NILAI', 'BOBOT', 'ATURAN'],
    ['RSR20', x.rsr20, 10, '>=70 sangat kuat; >=60 kuat; >=50 positif/netral'],
    ['RSR60', x.rsr60, 10, '>=70 sangat kuat; >=60 kuat; >=50 positif/netral'],
    ['EMA Structure', x.emaScore, 15, 'Harga > EMA8 > EMA14 > EMA20'],
    ['William %R', x.willrScore, 15, '-80 sampai -50 = pullback/rebound'],
    ['Momentum', x.momentum, 15, 'Momentum Score 0-100'],
    ['OBV', x.obvScore, 15, 'OBV naik vs 5 hari lalu'],
    ['MFI', x.mfiScore, 10, 'MFI >=50 lebih positif'],
    ['MACD', x.macdScore, 10, 'Histogram >0 bullish'],
    ['TOTAL PFS', x.pfs, 100, '0-100']
  ]);

  pfs.getRange('A32:D39').setValues([
    ['LEVEL', 'PFS', 'TIMING', 'INTERPRETASI'],
    ['ENTRY A+', '>=90', '>=24', 'Setup sangat kuat'],
    ['ENTRY A', '>=85', '>=20', 'Setup kuat'],
    ['CICIL ENTRY', '>=75', '>=15', 'Mulai posisi bertahap'],
    ['WATCHLIST', '>=70', '-', 'Menarik tetapi timing belum ideal'],
    ['TUNGGU', '60-69', '-', 'Belum cukup kuat'],
    ['HINDARI', '<60', '-', 'Filter belum terpenuhi'],
    ['Catatan', '', '', 'PFS adalah filter strategi, bukan jaminan profit']
  ]);

  formatSheets_(
    pfs.getParent().getSheetByName(CFG.INPUT_SHEET),
    pfs.getParent().getSheetByName(CFG.DATA_SHEET),
    pfs
  );

  pfs.getRange('B2:B12').setNumberFormat('#,##0');
  pfs.getRange('B6:B7').setNumberFormat('0.00');
  pfs.getRange('B8:B9').setNumberFormat('0.00');
  pfs.getRange('B13:B14').setNumberFormat('0');
  pfs.getRange('B21:B29').setNumberFormat('0.00');

  pfs.getRange('G2:G3').setNumberFormat('0.00');
  pfs.getRange('B13').setFontWeight('bold').setFontSize(14);
  pfs.getRange('B15').setFontWeight('bold').setFontSize(12);

  colorDashboard_(pfs, x, prev);
}

function pfsStatus_(pfs) {
  if (pfs >= 90) return 'SANGAT KUAT';
  if (pfs >= 85) return 'KUAT';
  if (pfs >= 75) return 'POSITIF';
  if (pfs >= 70) return 'WATCHLIST';
  if (pfs >= 60) return 'TUNGGU';
  return 'LEMAH';
}

function timingStatus_(timing) {
  if (timing >= 24) return 'TIMING SANGAT BAIK';
  if (timing >= 20) return 'TIMING BAIK';
  if (timing >= 15) return 'TIMING CUKUP';
  if (timing >= 10) return 'TIMING LEMAH';
  return 'BELUM SIAP';
}

function signalStatus_(signal) {
  if (signal === 'ENTRY A+') return 'PRIORITAS TINGGI';
  if (signal === 'ENTRY A') return 'PRIORITAS';
  if (signal === 'CICIL ENTRY') return 'BERTAHAP';
  if (signal === 'WATCHLIST') return 'PANTAU';
  if (signal === 'TUNGGU') return 'TUNGGU';
  return 'HINDARI';
}

function nearestPriorIHSG_(ihsg, date) {
  let best = null;
  for (let i = 0; i < ihsg.length; i++) {
    if (ihsg[i].date <= date) best = ihsg[i].close;
    else break;
  }
  return best;
}

function dateKey_(d) {
  return Utilities.formatDate(
    d,
    Session.getScriptTimeZone() || 'Asia/Jakarta',
    'yyyy-MM-dd'
  );
}

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}


/**
 * ============================================================
 * HISTORICAL / REPLAY SCREENER - 250 CANDLE
 * ============================================================
 * Setiap tanggal historis diperlakukan sebagai "hari ini".
 * PFS/screen score dihitung hanya dari data <= tanggal sinyal.
 * Setelah sinyal ditemukan:
 *   Entry = Close hari sinyal
 *   Target = Entry * (1 + 4%)
 *   WIN = High pada hari setelah sinyal sampai maksimal 20 hari
 *          mencapai target.
 *
 * Output:
 *   HISTORICAL_SCREENING
 *   BACKTEST_RESULT
 *   BACKTEST_HARI_WIN
 *   BACKTEST_SUMMARY
 */
function historicalReplay50Days() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = getOrCreate_(ss, CFG.INPUT_SHEET);

  const lastInputRow = input.getLastRow();
  if (lastInputRow < 2) {
    throw new Error('INPUT belum berisi daftar saham.');
  }

  // Dukungan format INPUT:
  // kolom A = ticker, kolom C = TRUE pada versi yang memakai kolom aktif.
  // Jika kolom C kosong, kolom A tetap dianggap aktif.
  const width = Math.max(3, input.getLastColumn());
  const vals = input.getRange(2, 1, lastInputRow - 1, width).getValues();

  const tickers = [];
  vals.forEach(function(r) {
    const ticker = String(r[0] || '').trim().toUpperCase().replace(/\s+/g,'');
    if (!ticker) return;

    const hasActiveCol = r.length >= 3 && r[2] !== '' && r[2] !== null;
    const active = hasActiveCol
      ? (r[2] === true || String(r[2]).toUpperCase() === 'TRUE' || String(r[2]) === '1')
      : true;

    if (active && tickers.indexOf(ticker) === -1) tickers.push(ticker);
  });

  if (!tickers.length) {
    throw new Error('Tidak ada saham aktif di INPUT.');
  }

  const warmupTradingDays = Math.max(CFG.MIN_BARS + 5, 90);
  const forwardDays = CFG.HISTORICAL_MAX_FORWARD_DAYS;
  // 500 candle replay + warmup indikator + forward evaluation.
  // Karena parameter Yahoo memakai hari kalender, beri buffer untuk
  // akhir pekan dan hari libur bursa.
  const requiredTradingDays =
    warmupTradingDays + CFG.HISTORICAL_REPLAY_DAYS + forwardDays + 10;
  const lookbackCalendar = Math.ceil(requiredTradingDays * 1.65);

  const historicalRows = [];
  const backtestRows = [];
  const errors = [];

  // Benchmark IHSG cukup diambil sekali untuk seluruh saham.
  const ihsg = fetchYahooHistory_('^JKSE', lookbackCalendar);
  if (!ihsg || ihsg.length < warmupTradingDays) {
    throw new Error('Data IHSG tidak cukup untuk replay ' + CFG.HISTORICAL_REPLAY_DAYS + ' candle.');
  }

  tickers.forEach(function(ticker, ti) {
    try {
      ss.toast(
        'Replay ' + (ti + 1) + '/' + tickers.length + ': ' + ticker,
        'PFS Historical Replay',
        5
      );

      const stock = fetchYahooHistory_(ticker + '.JK', lookbackCalendar);
      if (!stock || stock.length < warmupTradingDays + CFG.HISTORICAL_REPLAY_DAYS + 5) {
        errors.push(ticker + ': data tidak cukup untuk replay ' + CFG.HISTORICAL_REPLAY_DAYS + ' candle');
        return;
      }

      // Cari index sinyal: jumlah candle replay terakhir yang masih punya
      // minimal 20 hari forward untuk evaluasi target.
      const lastSignalIndex = stock.length - 1 - forwardDays;
      const firstSignalIndex = Math.max(
        CFG.MIN_BARS - 1,
        lastSignalIndex - CFG.HISTORICAL_REPLAY_DAYS + 1
      );

      let signalCountForTicker = 0;

      for (let i = firstSignalIndex; i <= lastSignalIndex; i++) {
        const asOf = stock[i].date;

        // Hanya data sampai hari sinyal. Ini inti anti look-ahead bias.
        const prefixStock = stock.slice(0, i + 1);

        // Benchmark juga dipotong sampai tanggal sinyal.
        const prefixIhsg = ihsg.filter(x => x.date.getTime() <= asOf.getTime());

        const calc = calculateIndicators_(prefixStock, prefixIhsg);
        const screen = screenScore_(prefixStock, calc);

        // PFS yang dipakai di sini adalah score screener 0-100
        // yang sama dengan kolom Predictive Filter Score di SCREENING.
        const pfs = Number(screen.score);

        if (!(pfs > CFG.HISTORICAL_MIN_PFS)) continue;

        const current = stock[i];
        const prev = i > 0 ? stock[i - 1] : null;

        const changePct = prev && prev.close
          ? ((current.close - prev.close) / prev.close) * 100
          : null;

        if (
          CFG.HISTORICAL_USE_CLOSE_FILTER &&
          (changePct === null || changePct > CFG.HISTORICAL_CLOSE_DROP_PCT)
        ) {
          continue;
        }

        signalCountForTicker++;

        const entry = current.close;
        const target = entry * (1 + CFG.HISTORICAL_TARGET_PCT / 100);

        let winDay = null;
        let winDate = null;
        let maxHigh = entry;
        let maxReturn = 0;

        // Hari ke-1 = candle perdagangan setelah hari sinyal.
        const maxJ = Math.min(stock.length - 1, i + forwardDays);

        for (let j = i + 1; j <= maxJ; j++) {
          const f = stock[j];
          if (f.high > maxHigh) maxHigh = f.high;

          const ret = ((f.high / entry) - 1) * 100;
          if (ret > maxReturn) maxReturn = ret;

          if (winDay === null && f.high >= target) {
            winDay = j - i;
            winDate = f.date;
            break;
          }
        }

        const status = winDay !== null ? 'WIN' : 'NOT HIT';

        historicalRows.push([
          current.date,
          ticker,
          pfs,
          screen.signal,
          entry,
          changePct,
          screen.atrScore,
          screen.atrPct,
          screen.volRatio,
          calc.latest.rsr20,
          calc.latest.rsr60,
          screen.rsi,
          screen.ema50,
          screen.candle,
          screen.trend,
          status
        ]);

        backtestRows.push([
          current.date,
          ticker,
          pfs,
          entry,
          target,
          winDay,
          winDate,
          maxHigh,
          maxReturn,
          status,
          screen.atrScore,
          screen.volRatio,
          calc.latest.rsr20,
          calc.latest.rsr60,
          changePct
        ]);
      }

      ss.toast(
        ticker + ': ' + signalCountForTicker + ' sinyal historis',
        'PFS Historical Replay',
        2
      );

    } catch (e) {
      errors.push(ticker + ': ' + e.message);
    }
  });

  // Urutkan berdasarkan tanggal lalu PFS tertinggi.
  historicalRows.sort(function(a,b) {
    return a[0] - b[0] || b[2] - a[2];
  });
  backtestRows.sort(function(a,b) {
    return a[0] - b[0] || b[2] - a[2];
  });

  writeHistoricalReplaySheets_(ss, historicalRows, backtestRows, errors);

  SpreadsheetApp.flush();

  const wins = backtestRows.filter(r => r[9] === 'WIN').length;
  const total = backtestRows.length;
  const winRate = total ? wins / total * 100 : 0;

  SpreadsheetApp.getUi().alert(
    'HISTORICAL REPLAY SELESAI\n\n' +
    'Periode: ' + CFG.HISTORICAL_REPLAY_DAYS + ' candle trading\n' +
    'Syarat: PFS > ' + CFG.HISTORICAL_MIN_PFS + '\n' +
    'Target: +' + CFG.HISTORICAL_TARGET_PCT + '%\n' +
    'Maksimum evaluasi: ' + CFG.HISTORICAL_MAX_FORWARD_DAYS + ' hari\n\n' +
    'Total sinyal: ' + total + '\n' +
    'WIN: ' + wins + '\n' +
    'NOT HIT: ' + (total - wins) + '\n' +
    'Win Rate: ' + winRate.toFixed(2) + '%\n\n' +
    'Detail tersedia di HISTORICAL_SCREENING dan BACKTEST_RESULT.'
  );
}

function writeHistoricalReplaySheets_(ss, historicalRows, backtestRows, errors) {
  const hist = getOrCreate_(ss, 'HISTORICAL_SCREENING');
  const result = getOrCreate_(ss, 'BACKTEST_RESULT');
  const day = getOrCreate_(ss, 'BACKTEST_HARI_WIN');
  const summary = getOrCreate_(ss, 'BACKTEST_SUMMARY');

  hist.clear();
  result.clear();
  day.clear();
  summary.clear();

  const histHeaders = [
    'TANGGAL SINYAL','SAHAM','PFS','SIGNAL','CLOSE ENTRY',
    'PERUBAHAN %','ATR SCORE','ATR14 %','VOL vs AVG20',
    'RSR20','RSR60','RSI14','EMA50','CANDLE','TREND','STATUS'
  ];
  hist.getRange(1,1,1,histHeaders.length).setValues([histHeaders]);

  if (historicalRows.length) {
    hist.getRange(2,1,historicalRows.length,histHeaders.length)
      .setValues(historicalRows);
  }

  const resultHeaders = [
    'TANGGAL SINYAL','SAHAM','PFS','CLOSE ENTRY','TARGET +4%',
    'HARI WIN','TANGGAL WIN','HIGH MAKS','RETURN MAKS %','STATUS',
    'ATR SCORE','VOL vs AVG20','RSR20','RSR60','PERUBAHAN %'
  ];
  result.getRange(1,1,1,resultHeaders.length).setValues([resultHeaders]);

  if (backtestRows.length) {
    result.getRange(2,1,backtestRows.length,resultHeaders.length)
      .setValues(backtestRows);
  }

  // Rekap WIN berdasarkan hari ke berapa.
  const counts = {};
  backtestRows.forEach(function(r) {
    if (r[9] === 'WIN') {
      const d = Number(r[5]);
      counts[d] = (counts[d] || 0) + 1;
    }
  });

  const dayRows = [];
  const totalWins = Object.keys(counts).reduce((a,k) => a + counts[k], 0);

  for (let d=1; d<=CFG.HISTORICAL_MAX_FORWARD_DAYS; d++) {
    const c = counts[d] || 0;
    dayRows.push([
      d,
      c,
      totalWins ? c / totalWins * 100 : 0
    ]);
  }

  day.getRange(1,1,1,3).setValues([[
    'HARI SETELAH SINYAL','JUMLAH WIN','% DARI SELURUH WIN'
  ]]);
  day.getRange(2,1,dayRows.length,3).setValues(dayRows);

  // Ringkasan statistik.
  const total = backtestRows.length;
  const wins = backtestRows.filter(r => r[9] === 'WIN');
  const notHit = total - wins.length;
  const winDays = wins.map(r => Number(r[5]));
  const avgWinDay = winDays.length
    ? winDays.reduce((a,b) => a+b,0) / winDays.length
    : 0;

  let medianWinDay = 0;
  if (winDays.length) {
    const sorted = winDays.slice().sort((a,b) => a-b);
    const mid = Math.floor(sorted.length/2);
    medianWinDay = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid-1] + sorted[mid]) / 2;
  }

  let mostCommonDay = 0;
  let mostCommonCount = 0;
  Object.keys(counts).forEach(function(k) {
    if (counts[k] > mostCommonCount) {
      mostCommonCount = counts[k];
      mostCommonDay = Number(k);
    }
  });

  const summaryRows = [
    ['PARAMETER','NILAI'],
    ['Periode replay (candle trading)', CFG.HISTORICAL_REPLAY_DAYS],
    ['Minimum PFS', '> ' + CFG.HISTORICAL_MIN_PFS],
    ['Target kenaikan', '+' + CFG.HISTORICAL_TARGET_PCT + '%'],
    ['Maksimum hari evaluasi', CFG.HISTORICAL_MAX_FORWARD_DAYS],
    ['Close filter aktif', CFG.HISTORICAL_USE_CLOSE_FILTER ? '<= ' + CFG.HISTORICAL_CLOSE_DROP_PCT + '% vs close sebelumnya' : 'TIDAK'],
    ['Total sinyal', total],
    ['Total WIN', wins.length],
    ['NOT HIT', notHit],
    ['Win Rate %', total ? wins.length / total * 100 : 0],
    ['Rata-rata hari menuju WIN', avgWinDay],
    ['Median hari menuju WIN', medianWinDay],
    ['Hari WIN terbanyak', mostCommonDay ? 'Hari ke-' + mostCommonDay : '-'],
    ['Jumlah WIN pada hari terbanyak', mostCommonCount],
    ['Error data', errors.length]
  ];

  summary.getRange(1,1,summaryRows.length,2).setValues(summaryRows);

  if (errors.length) {
    summary.getRange(summaryRows.length + 2,1,1,1).setValue('DETAIL ERROR');
    summary.getRange(summaryRows.length + 3,1,errors.length,1)
      .setValues(errors.map(e => [e]));
  }

  // Formatting.
  [hist,result,day,summary].forEach(function(sh) {
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,sh.getLastColumn())
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setWrap(true);
    sh.autoResizeColumns(1, sh.getLastColumn());
  });

  if (historicalRows.length) {
    hist.getRange(2,1,historicalRows.length,1).setNumberFormat('dd/MM/yyyy');
    hist.getRange(2,3,historicalRows.length,1).setNumberFormat('0');
    hist.getRange(2,5,historicalRows.length,1).setNumberFormat('#,##0.##');
    hist.getRange(2,6,historicalRows.length,1).setNumberFormat('0.##');
    hist.getRange(2,7,historicalRows.length,1).setNumberFormat('0');
    hist.getRange(2,8,historicalRows.length,1).setNumberFormat('0.##');
    hist.getRange(2,9,historicalRows.length,1).setNumberFormat('0.##x');
  }

  if (backtestRows.length) {
    result.getRange(2,1,backtestRows.length,1).setNumberFormat('dd/MM/yyyy');
    result.getRange(2,3,backtestRows.length,1).setNumberFormat('0');
    result.getRange(2,4,backtestRows.length,2).setNumberFormat('#,##0.##');
    result.getRange(2,7,backtestRows.length,1).setNumberFormat('dd/MM/yyyy');
    result.getRange(2,8,backtestRows.length,1).setNumberFormat('#,##0.##');
    result.getRange(2,9,backtestRows.length,1).setNumberFormat('0.##');
    result.getRange(2,11,backtestRows.length,1).setNumberFormat('0');
    result.getRange(2,12,backtestRows.length,1).setNumberFormat('0.##x');
    result.getRange(2,15,backtestRows.length,1).setNumberFormat('0.##');
  }

  if (dayRows.length) {
    day.getRange(2,3,dayRows.length,1).setNumberFormat('0.##');
  }
  summary.getRange(11,2,1,1).setNumberFormat('0.##');
  summary.getRange(12,2,1,1).setNumberFormat('0.##');

  // Warna status.
  for (let r=2; r<=result.getLastRow(); r++) {
    const status = result.getRange(r,10).getValue();
    result.getRange(r,1,1,result.getLastColumn())
      .setBackground(status === 'WIN' ? '#d9ead3' : '#f4cccc');
  }
}

function showBacktestSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('BACKTEST_SUMMARY');
  if (!sh) {
    SpreadsheetApp.getUi().alert(
      'BACKTEST_SUMMARY belum ada. Jalankan PFS → 6. Historical Replay 50 Hari terlebih dahulu.'
    );
    return;
  }

  const data = sh.getRange(1,1,Math.min(sh.getLastRow(),15),2).getDisplayValues();
  const msg = data.map(r => r[0] + ': ' + r[1]).join('\n');
  SpreadsheetApp.getUi().alert('RINGKASAN HISTORICAL REPLAY\n\n' + msg);
}

function getOrCreate_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function formatSheets_(input, data, pfs) {
  // ============================================================
  // FORMAT INPUT
  // ============================================================
  input.setFrozenRows(1);
  input.setColumnWidth(1, 22);
  input.setColumnWidth(2, 55);
  input.getRange('A1:B1')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  input.getRange('A1:B5')
    .setVerticalAlignment('middle');

  // ============================================================
  // FORMAT DATA - DETAIL 30 KOLOM
  // ============================================================
  data.setFrozenRows(1);
  data.autoResizeColumns(1, 30);

  const minWidths = {
    1:105,2:85,3:85,4:85,5:90,6:115,
    7:145,8:125,9:165,10:80,11:80,12:85,
    13:75,14:75,15:100,16:120,17:80,18:95,19:90,20:85,
    21:105,22:95,23:95,24:95,25:150,26:145,27:95,28:100,29:85,30:85
  };

  Object.keys(minWidths).forEach(function(col) {
    const c = Number(col);
    if (data.getColumnWidth(c) < minWidths[col]) {
      data.setColumnWidth(c, minWidths[col]);
    }
  });

  data.getRange(1,1,1,30)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  data.getRange(1,1,Math.max(data.getLastRow(),1),30).setVerticalAlignment('middle');

  if (data.getLastRow() >= 2) {
    const n = data.getLastRow() - 1;
    data.getRange(2,1,n,1).setNumberFormat('dd-mmm-yyyy');
    data.getRange(2,2,n,4).setNumberFormat('#,##0');
    data.getRange(2,6,n,1).setNumberFormat('#,##0');
    data.getRange(2,8,n,1).setNumberFormat('#,##0');
    data.getRange(2,9,n,1).setNumberFormat('#,##0');
    data.getRange(2,10,n,3).setNumberFormat('#,##0');
    data.getRange(2,13,n,2).setNumberFormat('0');
    data.getRange(2,15,n,1).setNumberFormat('0.00');
    data.getRange(2,16,n,1).setNumberFormat('#,##0');
    data.getRange(2,17,n,3).setNumberFormat('0.00');
    data.getRange(2,21,n,4).setNumberFormat('0');
    data.getRange(2,27,n,1).setNumberFormat('#,##0');
    data.getRange(2,28,n,3).setNumberFormat('0.00"%"');
  }

  data.getRange(1,1,1,6).setBackground('#1f4e78').setFontColor('#ffffff');
  data.getRange(1,7,1,3).setBackground('#38761d').setFontColor('#ffffff');
  data.getRange(1,7,1,3).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  data.getRange(1,10,1,11).setBackground('#674ea7').setFontColor('#ffffff');
  data.getRange(1,21,1,10).setBackground('#1f4e78').setFontColor('#ffffff');

  // ============================================================
  // FORMAT PFS DASHBOARD
  // ============================================================
  pfs.setFrozenRows(1);

  pfs.setColumnWidth(1, 24);
  pfs.setColumnWidth(2, 28);
  pfs.setColumnWidth(3, 14);
  pfs.setColumnWidth(4, 58);
  pfs.setColumnWidth(5, 4);
  pfs.setColumnWidth(6, 22);
  pfs.setColumnWidth(7, 34);
  pfs.setColumnWidth(8, 28);

  pfs.getRange('A1:D18')
    .setVerticalAlignment('middle')
    .setWrap(true);

  pfs.getRange('A1:D1')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  pfs.getRange('A20:D29')
    .setVerticalAlignment('middle')
    .setWrap(true);

  pfs.getRange('A20:D20')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  pfs.getRange('A32:D39')
    .setVerticalAlignment('middle')
    .setWrap(true);

  pfs.getRange('A32:D32')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  pfs.getRange('F1:H7')
    .setVerticalAlignment('middle')
    .setWrap(true);

  pfs.getRange('F1:H1')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  // Tinggi baris supaya teks tidak terpotong.
  pfs.setRowHeight(1, 30);
  for (let r = 2; r <= 18; r++) pfs.setRowHeight(r, 28);
  pfs.setRowHeight(20, 30);
  for (let r = 21; r <= 29; r++) pfs.setRowHeight(r, 28);
  pfs.setRowHeight(32, 30);
  for (let r = 33; r <= 39; r++) pfs.setRowHeight(r, 28);

  pfs.getRange('B2:B12').setNumberFormat('#,##0');
  pfs.getRange('B6:B7').setNumberFormat('0.00');
  pfs.getRange('B8:B9').setNumberFormat('0.00');
  pfs.getRange('B13:B14').setNumberFormat('0');
  pfs.getRange('B21:B29').setNumberFormat('0.00');
  pfs.getRange('G2:G3').setNumberFormat('0.00');

  pfs.getRange('B13')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center');

  pfs.getRange('B14')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  pfs.getRange('B15:B18')
    .setFontWeight('bold')
    .setWrap(true);

  pfs.getRange('G2:G3')
    .setFontWeight('bold')
    .setFontSize(14)
    .setHorizontalAlignment('center');

  pfs.getRange('G4:G7')
    .setFontWeight('bold')
    .setWrap(true);

  // Saat Setup/Reset, semua sheet langsung memiliki filter dan tabel.
  applyAutoTable_(input, 6, true);
  applyAutoTable_(data, 20, true);
  applyAutoTable_(pfs, 4, false);
}


function colorDashboard_(pfs, x, prev) {
  const green = '#d9ead3';
  const red = '#f4cccc';
  const gray = '#eeeeee';

  pfs.getRange('B2:B18').setBackground(null);

  // Warna mengikuti perubahan nilai indikator terbaru vs hari sebelumnya:
  // naik = hijau, melemah = merah, tidak berubah = abu-abu.
  const paint = function(cell, current, previous) {
    if (previous === null || previous === undefined ||
        current === null || current === undefined ||
        !isFinite(Number(current)) || !isFinite(Number(previous))) {
      pfs.getRange(cell).setBackground(gray);
      return;
    }
    const c = Number(current), p = Number(previous);
    pfs.getRange(cell).setBackground(c > p ? green : (c < p ? red : gray));
  };

  paint('B2', x.close, prev && prev.close);
  paint('B3', x.ema8, prev && prev.ema8);
  paint('B4', x.ema14, prev && prev.ema14);
  paint('B5', x.ema20, prev && prev.ema20);
  paint('B6', x.rsr20, prev && prev.rsr20);
  paint('B7', x.rsr60, prev && prev.rsr60);
  paint('B8', x.willr, prev && prev.willr);
  paint('B9', x.momentum, prev && prev.momentum);
  paint('B10', x.obv, prev && prev.obv);
  paint('B11', x.mfi, prev && prev.mfi);
  paint('B12', x.macdHist, prev && prev.macdHist);
  paint('B13', x.pfs, prev && prev.pfs);
  paint('B14', x.timing, prev && prev.timing);

  // Sinyal mengikuti arah perubahan PFS.
  if (prev) {
    pfs.getRange('B15').setBackground(
      x.pfs > prev.pfs ? green : (x.pfs < prev.pfs ? red : gray)
    );
  } else {
    pfs.getRange('B15').setBackground(gray);
  }

  pfs.getRange('B16:B18').setBackground(gray);
}

// Mewarnai seluruh nilai indikator di DATA.
// Setiap kolom indikator dibandingkan dengan baris sebelumnya.
// Naik = hijau, turun/melemah = merah, sama = abu-abu.
// Kolom tanggal, OHLC, volume, dan OBV Trend tidak diberi warna.
function colorDataIndicators_(data, rowCount, colCount) {
  if (rowCount < 2) return;

  const green = '#d9ead3';
  const red = '#f4cccc';
  const gray = '#eeeeee';

  const indicatorCols = [10,11,12,13,14,15,16,17,18,19];

  indicatorCols.forEach(function(col) {
    const values = data.getRange(2, col, rowCount, 1).getValues();
    const backgrounds = values.map(function(row, i) {
      if (i === 0 || row[0] === '' || row[0] === null ||
          values[i - 1][0] === '' || values[i - 1][0] === null) {
        return [gray];
      }

      const current = Number(row[0]);
      const previous = Number(values[i - 1][0]);
      if (!isFinite(current) || !isFinite(previous)) return [gray];

      return [current > previous ? green : (current < previous ? red : gray)];
    });

    data.getRange(2, col, rowCount, 1).setBackgrounds(backgrounds);
  });

  const obvTrend = data.getRange(2,20,rowCount,1).getValues();
  const obvBg = obvTrend.map(function(r) {
    return [String(r[0]).toUpperCase() === 'TRUE' ? green : red];
  });
  data.getRange(2,20,rowCount,1).setBackgrounds(obvBg).setFontWeight('bold');
}
