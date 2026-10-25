// ============================================================================
// Qwerty Learner Plus — Electron 主进程（增强版壳）
// 版本: 1.0.0-enhanced-v7
// 说明: A 层外壳增强（置顶/快捷键/迷你模式/托盘/自启/透明度缩放/自动备份/
//       错误日志/托盘进度）+ B 层桌面增强（AI/剪贴板/发音缓存等 IPC 支撑）。
//       所有私有数据（设置/日志/备份/缓存）写入 %APPDATA%\qwerty-learner-plus，
//       绝不修改原用户数据目录 %APPDATA%\qwerty-learner 中的学习记录。
// ============================================================================
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog,
  shell, clipboard, nativeImage, Notification, session, screen, net, protocol,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// —— 测试/多开隔离（仅当显式设置环境变量时生效，正常启动完全不受影响）——
// QZ_USER_DATA: 覆盖 Electron userData（IndexedDB / Local Storage），用于隔离测试
// QZ_PLUS_DIR:  覆盖插件数据目录（设置/备份/日志/缓存）
if (process.env.QZ_USER_DATA) {
  try { fs.mkdirSync(process.env.QZ_USER_DATA, { recursive: true }); } catch { /* ignore */ }
  try { app.setPath('userData', path.resolve(process.env.QZ_USER_DATA)); } catch { /* ignore */ }
}

// —— 关闭用不到的 Chromium 特性，降低后台开销 ——
app.commandLine.appendSwitch('disable-features', 'MediaRouter,Translate');
app.commandLine.appendSwitch('use-angle', 'd3d11');

// —— 发音缓存自定义协议（B7）：必须在 app ready 之前注册 ——
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'qzcache',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// ---------------------------------------------------------------------------
// 路径与设置
// ---------------------------------------------------------------------------
const APP_VERSION = '1.0.0-enhanced-v8.1';
const PLUS_DIR = process.env.QZ_PLUS_DIR
  ? path.resolve(process.env.QZ_PLUS_DIR)
  : path.join(app.getPath('appData'), 'qwerty-learner-plus');
const LOG_DIR = path.join(PLUS_DIR, 'logs');
const BACKUP_DIR = path.join(PLUS_DIR, 'backups');
const CACHE_DIR = path.join(PLUS_DIR, 'cache');
const AUDIO_CACHE_DIR = path.join(CACHE_DIR, 'audio');
const EXPORTS_DIR = path.join(app.getPath('documents'), 'QwertyLearnerPlus', 'exports');
const UPDATE_DIR = path.join(PLUS_DIR, 'dicts-update'); // 在线更新词库下载目录（删除即回滚）
const SETTINGS_FILE = path.join(PLUS_DIR, 'enhanced-settings.json');
const STATE_FILE = path.join(PLUS_DIR, 'window-state.json');
const ERROR_LOG = path.join(LOG_DIR, 'error.log');
const RENDERER_LOG = path.join(LOG_DIR, 'renderer.log');
const USER_DATA = app.getPath('userData'); // %APPDATA%\qwerty-learner（只读备份源）

for (const d of [PLUS_DIR, LOG_DIR, BACKUP_DIR, CACHE_DIR, AUDIO_CACHE_DIR, EXPORTS_DIR, UPDATE_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 记录在 logError 前，忽略 */ }
}

const DEFAULT_SETTINGS = {
  // A 层
  alwaysOnTop: false,
  miniMode: false,
  closeToTray: true,
  autoStart: false,
  opacity: 1,
  zoom: 1,
  shortcutToggle: 'CommandOrControl+Alt+Q',
  shortcutMini: 'CommandOrControl+Alt+M',
  // B 层
  dailyGoal: 30,
  // v6：记忆曲线（不按章节，自动出词）
  dailyNewWords: 20,        // 每天引入的新词上限
  memoryReviewCap: 200,     // 单次最多带入的到期复习词数
  memoryAutoPron: false,    // 出词时自动发音（默认关）
  clipboardWatch: false,
  onlineLookup: true,   // 免 Key 在线释义/整句翻译（本地词库 + 有道 + dictionaryapi + MyMemory）
  aiExperimental: false, // 预留实验开关（当前版本无 AI 后端，不影响免费释义）
  csvAutoSave: true,     // CSV 快速导出（自动保存到 文档\QwertyLearnerPlus\exports）
  pronCache: false,
  theme: 'indigo',
  panelAppearance: 'auto', // v4：面板外观 auto（跟随应用浅/深色，默认浅色视觉）/ light / dark
  dictFavorites: [],      // v5：收藏的词库文件列表
  dictRecent: {},         // v5：最近使用词库 { file: timestamp }
  fontFamily: 'default',
  darkMode: null,
  keySound: false,
  keySoundVolume: 0.25,
  pomodoroFocus: 25,
  pomodoroBreak: 5,
  goalNotifiedDate: '',
  lastBackupDate: '',
  todayStats: { date: '', words: 0, goal: 30, streak: 0, ratio: 0 },
};

let settings = { ...DEFAULT_SETTINGS };
function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    settings = { ...DEFAULT_SETTINGS, ...raw };
  } catch { settings = { ...DEFAULT_SETTINGS }; }
  // 开机自启以系统真实状态为准
  try {
    const login = app.getLoginItemSettings();
    settings.autoStart = !!login.openAtLogin;
  } catch { /* ignore */ }
  return settings;
}
function saveSettings() {
  try {
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (e) { logError('settings-save', e); }
}
function publicSettings() {
  const rest = { ...settings };
  delete rest.aiKey; // 历史字段，不再使用（免费释义无需 Key）
  return { ...rest, version: APP_VERSION, plusDir: PLUS_DIR, userDataDir: USER_DATA, exportsDir: EXPORTS_DIR };
}

// ---------------------------------------------------------------------------
// A8 错误日志落盘
// ---------------------------------------------------------------------------
function rotateIfNeeded(file, maxBytes = 2 * 1024 * 1024) {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, file + '.1');
    }
  } catch { /* ignore */ }
}
function writeLog(file, tag, message) {
  try {
    rotateIfNeeded(file);
    const line = `[${new Date().toISOString()}] [${tag}] ${typeof message === 'string' ? message : (message && (message.stack || message.message)) || String(message)}\n`;
    fs.appendFileSync(file, line, 'utf-8');
  } catch { /* ignore */ }
}
function logError(tag, err) { writeLog(ERROR_LOG, tag, err); }
function logRenderer(tag, message) { writeLog(RENDERER_LOG, tag, message); }

process.on('uncaughtException', (err) => { logError('uncaughtException', err); });
process.on('unhandledRejection', (err) => { logError('unhandledRejection', err); });

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------
let mainWindow = null;
let clipboardWin = null;
let tray = null;
let isQuitting = false;
let miniPrevBounds = null;
let startHidden = false;
let clipboardTimer = null;
let lastClipboardText = '';
let clipboardHideTimer = null;
const seenConsoleErrors = new Set();
let backupTimer = null;

// ---------------------------------------------------------------------------
// 窗口状态记忆（存到 plus 目录，避免污染用户数据目录）
// ---------------------------------------------------------------------------
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { return null; }
}
function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...b, maximized: win.isMaximized() }), 'utf-8');
    fs.renameSync(tmp, STATE_FILE);
  } catch { /* ignore */ }
}
function isVisibleOnSomeDisplay(s) {
  if (!s || typeof s.x !== 'number') return false;
  try {
    return screen.getAllDisplays().some((d) => {
      const a = d.bounds;
      return s.x >= a.x - 80 && s.y >= a.y - 80 && s.x < a.x + a.width && s.y < a.y + a.height;
    });
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 图标（从 asar 取出到临时文件，托盘更稳）
// ---------------------------------------------------------------------------
function appIconPath() {
  const candidates = [
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, 'enhance/icon.png'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  const src = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!src) return undefined;
  try {
    const out = path.join(app.getPath('temp'), 'qwerty-plus-icon.ico');
    fs.writeFileSync(out, fs.readFileSync(src));
    return out;
  } catch (e) { logError('icon-extract', e); return src; }
}

// ---------------------------------------------------------------------------
// 注入增强脚本（B 层 UI）
// ---------------------------------------------------------------------------
let enhanceInjectedFor = null;
function injectEnhance(win) {
  if (!win || win.isDestroyed()) return;
  const id = win.webContents.id;
  const cssPath = path.join(__dirname, 'enhance/enhance.css');
  const jsPath = path.join(__dirname, 'enhance/enhance.js');
  let css = '';
  let js = '';
  try {
    css = fs.readFileSync(cssPath, 'utf-8');
    js = fs.readFileSync(jsPath, 'utf-8');
  } catch (e) { logError('enhance-read', e); return; }
  const payload = `
    (function(){
      try {
        if (window.__QZ_ENHANCED__) return 'already';
        window.__QZ_ENHANCED__ = true;
        var style = document.createElement('style');
        style.id = 'qz-enhance-style';
        style.textContent = ${JSON.stringify(css)};
        (document.head || document.documentElement).appendChild(style);
        ${js}
        return 'injected';
      } catch (err) {
        console.error('[QZ-ENHANCE] inject failed', err);
        return 'error: ' + err.message;
      }
    })();
  `;
  win.webContents.executeJavaScript(payload, true)
    .then((r) => logRenderer('inject', `inject result: ${r}`))
    .catch((e) => logError('inject-enhance', e));
  enhanceInjectedFor = id;
}

// ---------------------------------------------------------------------------
// A7 用户数据每日自动备份（IndexedDB / Local Storage / Preferences）
// ---------------------------------------------------------------------------
const BACKUP_ITEMS_DIR = ['IndexedDB', 'Local Storage'];
const BACKUP_ITEMS_FILE = ['Preferences'];

function runBackup(reason = 'auto') {
  return new Promise((resolve) => {
    try {
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // YYYYMMDD-HHmmss
      const dest = path.join(BACKUP_DIR, `backup-${stamp}`);
      fs.mkdirSync(dest, { recursive: true });
      const copied = [];
      for (const name of BACKUP_ITEMS_DIR) {
        const src = path.join(USER_DATA, name);
        if (fs.existsSync(src)) {
          try {
            fs.cpSync(src, path.join(dest, name), { recursive: true, force: true, errorOnExist: false });
            copied.push(name);
          } catch (e) { logError('backup-copy-' + name, e); }
        }
      }
      for (const name of BACKUP_ITEMS_FILE) {
        const src = path.join(USER_DATA, name);
        if (fs.existsSync(src)) {
          try {
            fs.copyFileSync(src, path.join(dest, name));
            copied.push(name);
          } catch (e) { logError('backup-copy-' + name, e); }
        }
      }
      // 写一份说明，方便回滚
      try {
        fs.writeFileSync(path.join(dest, 'BACKUP-README.txt'),
          `Qwerty Learner Plus 自动备份\r\n时间: ${now.toLocaleString()}\r\n原因: ${reason}\r\n源目录: ${USER_DATA}\r\n备份内容: ${copied.join(', ')}\r\n恢复方法: 退出应用后，将本目录下的 IndexedDB / Local Storage / Preferences 覆盖回源目录即可。\r\n`,
          'utf-8');
      } catch { /* ignore */ }
      // 保留最近 7 份
      const dirs = fs.readdirSync(BACKUP_DIR)
        .filter((n) => n.startsWith('backup-'))
        .map((n) => ({ n, t: fs.statSync(path.join(BACKUP_DIR, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const d of dirs.slice(7)) {
        try { fs.rmSync(path.join(BACKUP_DIR, d.n), { recursive: true, force: true }); } catch (e) { logError('backup-prune', e); }
      }
      settings.lastBackupDate = now.toISOString().slice(0, 10);
      saveSettings();
      logRenderer('backup', `backup ok (${reason}) -> ${dest}, copied: ${copied.join(',') || 'nothing'}`);
      resolve({ ok: true, path: dest, copied });
    } catch (e) {
      logError('backup', e);
      resolve({ ok: false, error: String(e && e.message || e) });
    }
  });
}
function scheduleDailyBackup() {
  const tryRun = async () => {
    const today = new Date().toISOString().slice(0, 10);
    if (settings.lastBackupDate !== today) await runBackup('auto-daily');
  };
  setTimeout(tryRun, 8000);
  backupTimer = setInterval(tryRun, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// A4 托盘
// ---------------------------------------------------------------------------
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}
function setMiniMode(on, opts = {}) {
  if (!mainWindow) return { ok: false };
  try {
    if (on) {
      if (!miniPrevBounds) miniPrevBounds = mainWindow.getBounds();
      mainWindow.setMinimumSize(320, 130);
      mainWindow.setResizable(true);
      mainWindow.setBounds({ x: miniPrevBounds.x, y: miniPrevBounds.y, width: 560, height: 210 });
      mainWindow.setAlwaysOnTop(true, 'floating');
      settings.miniMode = true;
      sendEvent('mini', true);
      if (tray) tray.setToolTip('Qwerty Learner Plus（迷你模式）');
    } else {
      mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop);
      mainWindow.setMinimumSize(900, 600);
      if (miniPrevBounds) { try { mainWindow.setBounds(miniPrevBounds); } catch { /* ignore */ } }
      miniPrevBounds = null;
      settings.miniMode = false;
      sendEvent('mini', false);
    }
    saveSettings();
    return { ok: true, mini: settings.miniMode };
  } catch (e) { logError('mini-mode', e); return { ok: false, error: String(e.message || e) }; }
}
function setAlwaysOnTop(on) {
  if (!mainWindow) return { ok: false };
  try {
    mainWindow.setAlwaysOnTop(!!on);
    settings.alwaysOnTop = !!on;
    saveSettings();
    return { ok: true, alwaysOnTop: settings.alwaysOnTop };
  } catch (e) { logError('always-on-top', e); return { ok: false, error: String(e.message || e) }; }
}
function updateTrayMenu() {
  if (!tray) return;
  const s = settings.todayStats || {};
  const progressLabel = s.date ? `今日 ${s.words || 0}/${s.goal || settings.dailyGoal} 词 · 连续 ${s.streak || 0} 天` : '今日进度: 暂无数据';
  const menu = Menu.buildFromTemplate([
    { label: 'Qwerty Learner Plus', enabled: false },
    { label: progressLabel, enabled: false },
    { type: 'separator' },
    { label: '显示 / 隐藏窗口', accelerator: settings.shortcutToggle, click: () => toggleMainWindow() },
    { label: settings.miniMode ? '退出迷你模式' : '迷你模式', click: () => { setMiniMode(!settings.miniMode); updateTrayMenu(); } },
    { label: '窗口置顶', type: 'checkbox', checked: !!settings.alwaysOnTop, click: (item) => { setAlwaysOnTop(item.checked); updateTrayMenu(); } },
    { type: 'separator' },
    { label: '立即备份用户数据', click: () => runBackup('manual-tray') },
    { label: '打开备份目录', click: () => shell.openPath(BACKUP_DIR) },
    { label: '打开设置面板', click: () => { showMainWindow(); sendEvent('open-panel', true); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}
function createTray() {
  try {
    const icon = appIconPath();
    tray = new Tray(icon);
    tray.setToolTip('Qwerty Learner Plus');
    tray.on('click', () => toggleMainWindow());
    tray.on('double-click', () => showMainWindow());
    updateTrayMenu();
    logRenderer('tray', 'tray created ok');
  } catch (e) { logError('tray', e); }
}

function sendEvent(type, value) {
  const targets = [mainWindow, clipboardWin].filter((w) => w && !w.isDestroyed());
  for (const w of targets) {
    try { w.webContents.send('enhance:event', { type, value }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// B5 剪贴板查词小窗
// ---------------------------------------------------------------------------
function createClipboardWindow() {
  if (clipboardWin && !clipboardWin.isDestroyed()) return clipboardWin;
  clipboardWin = new BrowserWindow({
    width: 380,
    height: 190,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  clipboardWin.loadFile(path.join(__dirname, 'enhance/clipboard.html'));
  clipboardWin.on('closed', () => { clipboardWin = null; });
  return clipboardWin;
}
function showClipboardWord(word) {
  const win = createClipboardWindow();
  const position = () => {
    try {
      const display = screen.getPrimaryDisplay();
      const wa = display.workArea;
      win.setPosition(wa.x + wa.width - 400, wa.y + wa.height - 230);
    } catch { /* ignore */ }
  };
  const send = () => {
    try { win.webContents.send('clipboard:word', word); } catch { /* ignore */ }
    position();
    win.showInactive();
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
  if (clipboardHideTimer) clearTimeout(clipboardHideTimer);
  clipboardHideTimer = setTimeout(() => {
    try { if (clipboardWin && !clipboardWin.isDestroyed()) clipboardWin.hide(); } catch { /* ignore */ }
  }, 25000);
}
function startClipboardWatch() {
  if (clipboardTimer) return;
  clipboardTimer = setInterval(() => {
    if (!settings.clipboardWatch) return;
    try {
      const text = (clipboard.readText() || '').trim();
      if (!text || text === lastClipboardText) return;
      lastClipboardText = text;
      if (text.length > 50 || !/^[a-zA-Z][a-zA-Z'’\-\s.]+$/.test(text)) return;
      const words = text.split(/\s+/);
      if (words.length > 3) return;
      showClipboardWord(text);
    } catch (e) { logError('clipboard-watch', e); }
  }, 1200);
}

// ---------------------------------------------------------------------------
// B7 发音缓存（拦截 youdao dictvoice 音频请求，落盘缓存后本地回放）
// ---------------------------------------------------------------------------
const YD_PREFIX = 'https://dict.youdao.com/dictvoice?audio=';
function audioCachePath(url) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(AUDIO_CACHE_DIR, h + '.audio');
}
function registerAudioCache() {
  try {
    protocol.handle('qzcache', async (request) => {
      // v5：在线更新的词库文件（优先于 asar 内置文件）
      if (request.url.startsWith('qzcache://dict/')) {
        try {
          const raw = decodeURIComponent(request.url.slice('qzcache://dict/'.length).split('?')[0]);
          const file = path.basename(raw || '');
          if (!file || !/^[A-Za-z0-9._\-]+\.json$/.test(file)) return new Response('', { status: 400 });
          const p = path.join(UPDATE_DIR, file);
          if (!fs.existsSync(p)) return new Response('', { status: 404 });
          return new Response(fs.readFileSync(p), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
        } catch (e) { logError('dict-override-protocol', e); return new Response('', { status: 500 }); }
      }
      const url = decodeURIComponent(request.url.replace('qzcache://audio/', ''));
      const file = audioCachePath(url);
      try {
        if (fs.existsSync(file)) {
          const data = fs.readFileSync(file);
          return new Response(data, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        }
        const res = await net.fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          try { fs.writeFileSync(file, buf); } catch (e) { logError('pron-cache-write', e); }
          return new Response(buf, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        }
        return new Response('', { status: res.status });
      } catch (e) {
        logError('pron-cache', e);
        try {
          const res = await net.fetch(url);
          const buf = Buffer.from(await res.arrayBuffer());
          return new Response(buf, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        } catch { return new Response('', { status: 502 }); }
      }
    });
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['https://dict.youdao.com/dictvoice*'] },
      (details, callback) => {
        try {
          if (settings.pronCache && details.url.startsWith(YD_PREFIX)) {
            callback({ redirectURL: 'qzcache://audio/' + encodeURIComponent(details.url) });
            return;
          }
        } catch (e) { logError('pron-redirect', e); }
        callback({});
      }
    );
  } catch (e) { logError('audio-cache-setup', e); }
}

// ---------------------------------------------------------------------------
// v5：内置词库管理（列表 / 在线更新）
// ---------------------------------------------------------------------------
const DICT_META_FILE = path.join(__dirname, 'enhance/dict-meta.json');
const DICT_GH_API = 'https://api.github.com/repos/RealKai42/qwerty-learner/contents/public/dicts?ref=master';
const RAW_BASE = 'https://raw.githubusercontent.com/RealKai42/qwerty-learner/master/public/dicts/';
const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/RealKai42/qwerty-learner@master/public/dicts/';
let dictMetaCache = null;
let dictListCache = null;
const dictShaCache = new Map(); // file -> {size, sha}

function getDictMeta() {
  if (!dictMetaCache) dictMetaCache = loadJsonSafe(DICT_META_FILE, {});
  return dictMetaCache;
}
function classifyDict(file, meta) {
  const text = [file, meta && meta.name, meta && meta.description, meta && meta.category, (meta && meta.tags) || []].join(' ').toLowerCase();
  if (/\b(gre|gmat)\b|gre/.test(text) && !/degree/.test(text)) return 'GRE';
  if (/雅思|ielts/.test(text)) return '雅思';
  if (/托福|toefl/.test(text)) return '托福';
  if (/考研|kaoyan|yan/.test(text) && /kao|考/.test(text)) return '考研';
  if (/cet|四六级|四级|六级|专四|专八|bec|pte/i.test(text)) return 'CET';
  if (/java|python|javascript|typescript|node|c\+\+|cpp|csharp|sql|linux|git|docker|algorithm|算法|编程|程序|前端|后端|html|css|regex|正则|api|devops|kotlin|swift|rust|golang|vue|react/.test(text)) return '编程';
  return '其他';
}
const dictCountCache = new Map();
function dictEntryFor(file) {
  const meta = getDictMeta()[file] || null;
  let count = 0;
  let size = 0;
  try {
    const p = path.join(__dirname, '../build/dicts', file);
    size = fs.statSync(p).size;
    if (dictCountCache.has(file)) count = dictCountCache.get(file);
    else {
      const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
      count = Array.isArray(arr) ? arr.length : 0;
      dictCountCache.set(file, count);
    }
  } catch { count = meta ? Number(meta.length) || 0 : 0; size = 0; }
  const name = meta && meta.name ? meta.name : file.replace(/\.json$/i, '');
  return {
    file,
    id: (meta && meta.id) || '',
    name,
    description: (meta && meta.description) || '',
    category: classifyDict(file, meta),
    tags: (meta && meta.tags) || [],
    count,
    metaLength: meta ? Number(meta.length) || 0 : 0,
    size,
  };
}
function listBuiltinDicts() {
  if (dictListCache) return dictListCache;
  try {
    const files = fs.readdirSync(path.join(__dirname, '../build/dicts')).filter((f) => /\.json$/i.test(f)).sort();
    const dicts = files.map(dictEntryFor);
    dictListCache = { ok: true, total: dicts.length, dicts };
    return dictListCache;
  } catch (e) {
    logError('dict-list', e);
    return { ok: false, error: String(e.message || e), dicts: [] };
  }
}

// v6：按文件读取整本词库（供「记忆曲线」使用；不分章节，支持在线更新覆盖文件）
const dictContentCache = new Map(); // file -> words[]
const DICT_CONTENT_CACHE_MAX = 3;
function readDictContent(file) {
  const f = path.basename(String(file || ''));
  if (!f || !/^[A-Za-z0-9._\-]+\.json$/.test(f)) return { ok: false, error: '非法词库文件名' };
  if (dictContentCache.has(f)) {
    const words = dictContentCache.get(f);
    return { ok: true, file: f, words, total: words.length, cached: true };
  }
  let arr = null;
  let source = 'asar';
  try {
    const updatePath = path.join(UPDATE_DIR, f);
    if (fs.existsSync(updatePath)) {
      arr = JSON.parse(fs.readFileSync(updatePath, 'utf-8'));
      source = 'update';
    } else {
      arr = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/dicts', f), 'utf-8'));
    }
  } catch (e) {
    logError('dict-read', e);
    return { ok: false, error: '读取词库失败：' + String(e.message || e) };
  }
  if (!Array.isArray(arr)) return { ok: false, error: '词库格式异常（不是数组）' };
  const words = [];
  const seen = new Set();
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const name = String(it.name || it.word || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    let trans = it.trans != null ? it.trans : (it.translation != null ? it.translation : '');
    if (Array.isArray(trans)) trans = trans.join('；');
    const phone = String(it.usphone || it.ukphone || '').trim();
    words.push({ name, trans: String(trans == null ? '' : trans).trim(), phone });
  }
  if (!words.length) return { ok: false, error: '词库为空' };
  if (dictContentCache.size >= DICT_CONTENT_CACHE_MAX) {
    const firstKey = dictContentCache.keys().next().value;
    dictContentCache.delete(firstKey);
  }
  dictContentCache.set(f, words);
  logRenderer('dict-read', `${f} total=${arr.length} unique=${words.length} source=${source}`);
  return { ok: true, file: f, words, total: words.length, source };
}

function gitBlobSha(buf) {
  const h = crypto.createHash('sha1');
  h.update('blob ' + buf.length + '\u0000');
  h.update(buf);
  return h.digest('hex');
}
function localDictSha(file) {
  const cached = dictShaCache.get(file);
  if (cached) return cached;
  try {
    const p = path.join(__dirname, '../build/dicts', file);
    const buf = fs.readFileSync(p);
    const info = { size: buf.length, sha: gitBlobSha(buf) };
    dictShaCache.set(file, info);
    return info;
  } catch { return null; }
}
async function checkDictUpdates() {
  try {
    const res = await fetch(DICT_GH_API, {
      headers: { 'user-agent': FREE_UA, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('GitHub API HTTP ' + res.status);
    const arr = await res.json();
    if (!Array.isArray(arr)) throw new Error('GitHub 返回格式异常');
    const files = arr.filter((x) => x && x.type === 'file' && /\.json$/i.test(String(x.name || '')));
    const changes = [];
    for (const item of files) {
      const name = String(item.name);
      const local = localDictSha(name);
      const remoteSize = Number(item.size) || 0;
      const remoteSha = String(item.sha || '');
      if (!local) {
        changes.push({ name, status: 'new', remoteSize, localSize: 0, downloadUrl: item.download_url || RAW_BASE + encodeURIComponent(name) });
      } else if ((remoteSha && remoteSha !== local.sha) || (!remoteSha && remoteSize && remoteSize !== local.size)) {
        changes.push({ name, status: 'updated', remoteSize, localSize: local.size, downloadUrl: item.download_url || RAW_BASE + encodeURIComponent(name) });
      }
    }
    logRenderer('dict-update', `check done: remote=${files.length} changes=${changes.length}`);
    return { ok: true, remoteTotal: files.length, newCount: changes.filter((c) => c.status === 'new').length, updatedCount: changes.filter((c) => c.status === 'updated').length, changes };
  } catch (e) {
    logError('dict-update-check', e);
    return { ok: false, error: '检查失败：' + String(e.message || e), changes: [] };
  }
}
async function fetchDictFile(url, timeout = 25000) {
  const res = await fetch(url, { headers: { 'user-agent': FREE_UA }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('空文件');
  const json = JSON.parse(buf.toString('utf-8'));
  if (!Array.isArray(json) || !json.length) throw new Error('JSON 不是有效词库数组');
  return buf;
}
async function downloadDictUpdate(name, downloadUrl) {
  try {
    const file = path.basename(String(name || ''));
    if (!/^[A-Za-z0-9._\-]+\.json$/.test(file)) return { ok: false, error: '非法文件名' };
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const urls = [downloadUrl || RAW_BASE + encodeURIComponent(file), JSDELIVR_BASE + encodeURIComponent(file)];
    let lastErr = null;
    for (const url of urls) {
      try {
        const buf = await fetchDictFile(url);
        const target = path.join(UPDATE_DIR, file);
        fs.writeFileSync(target, buf);
        logRenderer('dict-download', `${file} <- ${url} (${buf.length} B)`);
        return { ok: true, file, path: target, size: buf.length, url };
      } catch (e) { lastErr = e; }
    }
    return { ok: false, error: String((lastErr && lastErr.message) || lastErr || '下载失败') };
  } catch (e) {
    logError('dict-download', e);
    return { ok: false, error: String(e.message || e) };
  }
}
function dictOverrideExists(name) {
  try {
    const file = path.basename(String(name || ''));
    if (!/^[A-Za-z0-9._\-]+\.json$/.test(file)) return false;
    const p = path.join(UPDATE_DIR, file);
    if (!fs.existsSync(p)) return false;
    const st = fs.statSync(p);
    return st.size > 10;
  } catch { return false; }
}
function dictUpdateInfo() {
  try {
    const files = fs.readdirSync(UPDATE_DIR).filter((f) => /\.json$/i.test(f));
    const list = files.map((file) => {
      const p = path.join(UPDATE_DIR, file);
      let count = 0;
      try { const arr = JSON.parse(fs.readFileSync(p, 'utf-8')); count = Array.isArray(arr) ? arr.length : 0; } catch { /* ignore */ }
      return { file, size: fs.statSync(p).size, count, mtime: fs.statSync(p).mtimeMs };
    }).sort((a, b) => b.mtime - a.mtime);
    return { ok: true, dir: UPDATE_DIR, files: list };
  } catch (e) { return { ok: false, error: String(e.message || e), files: [] }; }
}

// ---------------------------------------------------------------------------
// v5：整词库发音预缓存（主进程下载，复用 qzcache 音频缓存目录）
// ---------------------------------------------------------------------------
const PRECACHE_CONCURRENCY = 4;
let precacheJob = null;
function pronUrlFor(word, type) {
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(word || '').trim()) + '&type=' + (type === 'uk' ? 1 : 2);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function precacheSnapshot() {
  if (!precacheJob) return null;
  const j = precacheJob;
  return {
    ok: true, id: j.id, dictFile: j.dictFile, type: j.type, total: j.total, done: j.ok + j.fail,
    okCount: j.ok, failCount: j.fail, skipped: j.skipped, paused: j.paused, cancelled: j.cancelled,
    finished: j.finished, failures: j.failures.slice(0, 20), startedAt: j.startedAt,
  };
}
function sendPrecache() {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('pron:precache-progress', precacheSnapshot()); } catch { /* ignore */ }
}
async function downloadAudioToCache(url) {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error('返回音频过小');
  fs.writeFileSync(audioCachePath(url), buf);
  return buf.length;
}
function pumpPrecache() {
  const j = precacheJob;
  if (!j) return;
  if (j.paused || j.cancelled) { if (j.active === 0) { if (j.index >= j.tasks.length) j.finished = true; sendPrecache(); } return; }
  while (j.active < PRECACHE_CONCURRENCY && j.index < j.tasks.length && !j.paused && !j.cancelled) {
    const task = j.tasks[j.index++];
    j.active++;
    (async () => {
      try {
        await downloadAudioToCache(task.url);
        j.ok++;
      } catch (e) {
        try {
          await sleep(250);
          await downloadAudioToCache(task.url);
          j.ok++;
        } catch (e2) {
          j.fail++;
          if (j.failures.length < 20) j.failures.push({ word: task.word, error: String((e2 && e2.message) || e2) });
        }
      } finally {
        j.active--;
        sendPrecache();
        pumpPrecache();
      }
    })();
  }
  if (j.active === 0 && (j.index >= j.tasks.length || j.cancelled)) { j.finished = true; sendPrecache(); }
}
async function startPrecache(opts) {
  try {
    if (precacheJob && !precacheJob.finished) return { ok: false, error: '已有预缓存任务进行中，请先完成或取消' };
    const dictFile = path.basename(String((opts && opts.dictFile) || ''));
    if (!/^[A-Za-z0-9._\-]+\.json$/.test(dictFile)) return { ok: false, error: '无效词库文件' };
    const type = opts && opts.type === 'uk' ? 'uk' : 'us';
    const limit = Math.max(0, Math.min(50000, Number(opts && opts.limit) || 0));
    const p = fs.existsSync(path.join(UPDATE_DIR, dictFile)) ? path.join(UPDATE_DIR, dictFile) : path.join(__dirname, '../build/dicts', dictFile);
    if (!fs.existsSync(p)) return { ok: false, error: '词库文件不存在' };
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const words = [...new Set((Array.isArray(arr) ? arr : []).map((e) => String((e && e.name) || '').trim()).filter(Boolean))];
    const limited = limit > 0 ? words.slice(0, limit) : words;
    const tasks = [];
    let skipped = 0;
    for (const w of limited) {
      const url = pronUrlFor(w, type);
      if (fs.existsSync(audioCachePath(url))) { skipped++; continue; }
      tasks.push({ word: w, url });
    }
    if (!tasks.length) {
      return { ok: true, total: 0, skipped, finished: true, message: skipped ? '所选范围已全部缓存' : '词库为空' };
    }
    precacheJob = {
      id: Date.now(), dictFile, type, tasks, total: tasks.length, skipped,
      index: 0, active: 0, ok: 0, fail: 0, failures: [], paused: false, cancelled: false,
      finished: false, startedAt: Date.now(),
    };
    logRenderer('precache', `start ${dictFile} type=${type} tasks=${tasks.length} skipped=${skipped}`);
    sendPrecache();
    pumpPrecache();
    return { ok: true, total: tasks.length, skipped };
  } catch (e) {
    logError('precache-start', e);
    return { ok: false, error: String(e.message || e) };
  }
}
function precachePause() { if (precacheJob && !precacheJob.finished) { precacheJob.paused = true; sendPrecache(); } return precacheSnapshot(); }
function precacheResume() {
  if (!precacheJob) return { ok: false, error: '没有任务' };
  if (precacheJob.finished) return { ok: false, error: '任务已结束' };
  precacheJob.paused = false;
  sendPrecache();
  pumpPrecache();
  return precacheSnapshot();
}
function precacheCancel() {
  if (precacheJob && !precacheJob.finished) {
    precacheJob.cancelled = true;
    precacheJob.finished = true;
    logRenderer('precache', `cancelled after ok=${precacheJob.ok} fail=${precacheJob.fail}`);
    sendPrecache();
  }
  return precacheSnapshot();
}

// ---------------------------------------------------------------------------
// B4' 免费释义 / 整句翻译数据链（免 Key，带缓存 + 超时 + 离线降级）
//   中文短释义：有道 suggest（免注册）
//   英英释义/例句/音标/同义词：api.dictionaryapi.dev（免注册）
//   整句翻译：MyMemory（免注册，失败时尝试 Google 翻译公共端点）
//   本地优先：应用内词典 JSON（trans/usphone/ukphone）
// ---------------------------------------------------------------------------
const WORD_CACHE_FILE = path.join(CACHE_DIR, 'word-cache.json');
const TRANS_CACHE_FILE = path.join(CACHE_DIR, 'trans-cache.json');
const FREE_UA = 'QwertyLearnerPlus/1.1 (Electron desktop; free dictionary chain)';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const YD_SUGGEST = 'https://dict.youdao.com/suggest?num=1&doctype=json&q=';
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const GOOGLE_TR = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=';

function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
let wordCache = loadJsonSafe(WORD_CACHE_FILE, {});
let transCache = loadJsonSafe(TRANS_CACHE_FILE, {});
let cacheSaveTimer = null;
function pruneCache(obj, max) {
  const keys = Object.keys(obj);
  if (keys.length <= max) return;
  const old = keys.map((k) => [k, (obj[k] && obj[k].ts) || 0]).sort((a, b) => a[1] - b[1]);
  for (const [k] of old.slice(0, keys.length - max)) delete obj[k];
}
function scheduleCacheSave() {
  if (cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    try {
      pruneCache(wordCache, 3000);
      pruneCache(transCache, 2000);
      fs.writeFileSync(WORD_CACHE_FILE, JSON.stringify(wordCache), 'utf-8');
      fs.writeFileSync(TRANS_CACHE_FILE, JSON.stringify(transCache), 'utf-8');
    } catch (e) { logError('free-cache-save', e); }
  }, 1500);
}

// —— 本地词库（id → 文件映射由构建脚本从 build JS 提取，见 enhance/dict-map.json）——
let dictMap = null;
const dictDataCache = new Map();
function getDictMap() {
  if (!dictMap) dictMap = loadJsonSafe(path.join(__dirname, 'enhance/dict-map.json'), {});
  return dictMap;
}
function loadDictFile(file) {
  if (dictDataCache.has(file)) return dictDataCache.get(file);
  let idx = new Map();
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../build/dicts', file), 'utf-8');
    const arr = JSON.parse(raw);
    for (const e of arr) {
      const k = String((e && e.name) || '').trim().toLowerCase();
      if (k && !idx.has(k)) idx.set(k, e);
    }
  } catch (e) { logError('local-dict', `${file}: ${e.message}`); }
  if (dictDataCache.size > 6) dictDataCache.delete(dictDataCache.keys().next().value);
  dictDataCache.set(file, idx);
  return idx;
}
function parseDictId(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  try {
    const j = JSON.parse(s);
    if (typeof j === 'string') s = j;
    else if (j && typeof j === 'object') s = j.id || j.dict || j.value || '';
  } catch { /* 原样使用 */ }
  return String(s || '').slice(0, 80);
}
// 本地例句库 / 英英释义库（4000 Essential English Words 词库，应用自带）
let sentenceDictMap = null;
let meaningDictMap = null;
function loadWordMapFile(file) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/dicts', file), 'utf-8'));
    const m = new Map();
    for (const e of arr) {
      const k = String((e && e.name) || '').trim().toLowerCase();
      if (k && !m.has(k)) m.set(k, e);
    }
    return m;
  } catch (e) { logError('local-extra-dict', `${file}: ${e.message}`); return new Map(); }
}
function getSentenceDict() {
  if (!sentenceDictMap) sentenceDictMap = loadWordMapFile('4000_Essential_English_Words-sentence.json');
  return sentenceDictMap;
}
function getMeaningDict() {
  if (!meaningDictMap) meaningDictMap = loadWordMapFile('4000_Essential_English_Words-meaning.json');
  return meaningDictMap;
}
function localExtraForWord(word) {
  const k = word.toLowerCase();
  const out = { examples: [], defs: [] };
  const s = getSentenceDict().get(k);
  if (s && Array.isArray(s.trans) && s.trans[0]) out.examples = [String(s.trans[0]).trim()];
  const m = getMeaningDict().get(k);
  if (m && Array.isArray(m.trans) && m.trans[0]) out.defs = [{ pos: '', def: String(m.trans[0]).trim() }];
  return out;
}
function localDictLookup(word, dictId) {
  const map = getDictMap();
  const id = parseDictId(dictId);
  const file = map[id] || map['google-10000-english'] || 'google-10000-english.json';
  const dict = loadDictFile(file);
  const hit = dict.get(word.toLowerCase());
  if (!hit) return null;
  const trans = Array.isArray(hit.trans) ? hit.trans.filter((t) => typeof t === 'string') : (hit.trans ? [String(hit.trans)] : []);
  return {
    dictId: id || 'google-10000-english',
    dictFile: file,
    trans,
    usphone: hit.usphone || '',
    ukphone: hit.ukphone || '',
    phonetic: hit.usphone || hit.ukphone || '',
  };
}

async function httpJson(url, timeout = 6000) {
  const res = await fetch(url, {
    headers: { 'user-agent': FREE_UA, accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error('返回非 JSON'); }
}

async function youdaoSuggest(word) {
  const json = await httpJson(YD_SUGGEST + encodeURIComponent(word), 5000);
  const data = json && json.data;
  const first = data && Array.isArray(data.entries) && data.entries[0];
  if (!first || !first.explain) return null;
  return { explain: String(first.explain).trim(), entry: first.entry || word };
}

function parseDictionaryApi(json) {
  const arr = Array.isArray(json) ? json : [];
  const first = arr[0] || {};
  const phonetics = Array.isArray(first.phonetics) ? first.phonetics : [];
  let phonetic = '', audio = '';
  for (const p of phonetics) {
    if (!phonetic && p && p.text) phonetic = p.text;
    if (!audio && p && p.audio) audio = p.audio;
  }
  if (!phonetic && first.phonetic) phonetic = first.phonetic;
  const defs = [], examples = [], synonyms = new Set();
  for (const m of (first.meanings || []).slice(0, 3)) {
    const pos = m.partOfSpeech || '';
    for (const d of (m.definitions || []).slice(0, 2)) {
      if (d.definition) defs.push({ pos, def: d.definition });
      if (d.example) examples.push(String(d.example).trim());
      for (const s of (d.synonyms || []).slice(0, 3)) synonyms.add(s);
    }
    for (const s of (m.synonyms || []).slice(0, 5)) synonyms.add(s);
  }
  return {
    phonetic, audio,
    defs: defs.slice(0, 4),
    examples: [...new Set(examples)].filter(Boolean).slice(0, 3),
    synonyms: [...synonyms].slice(0, 8),
  };
}

function buildWordResult(word, local, yd, dictApi, meta) {
  const zhLines = [];
  for (const t of (local && local.trans) || []) {
    const s = String(t || '').trim();
    if (s) zhLines.push({ text: s, source: '本地词库' });
  }
  if (yd && yd.explain) {
    const s = String(yd.explain).trim();
    if (s && !zhLines.some((x) => x.text === s || x.text.includes(s) || s.includes(x.text))) {
      zhLines.push({ text: s, source: '有道' });
    }
  }
  const sources = [];
  if (local) sources.push('本地词库');
  if (yd) sources.push('有道');
  if (dictApi) sources.push('dictionaryapi');
  // 例句/英英释义兜底：应用自带 4000 Essential 词库（完全离线）
  let examples = (dictApi && dictApi.examples) || [];
  let examplesSource = examples.length ? 'dictionaryapi' : '';
  let defs = (dictApi && dictApi.defs) || [];
  if (!examples.length || !defs.length) {
    const extra = localExtraForWord(word);
    if (!examples.length && extra.examples.length) { examples = extra.examples; examplesSource = '本地例句库'; sources.push('本地例句库'); }
    if (!defs.length && extra.defs.length) { defs = extra.defs; sources.push('本地释义库'); }
  }
  return {
    ok: zhLines.length > 0 || defs.length > 0,
    word,
    phonetic: (dictApi && dictApi.phonetic) || (local && local.phonetic) || '',
    usphone: (local && local.usphone) || '',
    ukphone: (local && local.ukphone) || '',
    audio: (dictApi && dictApi.audio) || '',
    zhLines,
    defs,
    examples,
    examplesSource,
    synonyms: (dictApi && dictApi.synonyms) || [],
    sources,
    offline: !!meta.offline,
    cached: !!meta.cached,
    ts: Date.now(),
  };
}

async function lookupWordFree(rawWord, rawDictId) {
  const word = String(rawWord || '').trim().slice(0, 60).replace(/\s+/g, ' ');
  if (!word) return { ok: false, error: '请输入要查询的单词' };
  const key = word.toLowerCase();
  const cached = wordCache[key];
  if (!settings.onlineLookup) {
    if (cached && cached.data) return { ...cached.data, cached: true, offline: true };
    const localOffline = localDictLookup(word, rawDictId);
    if (localOffline) return buildWordResult(word, localOffline, null, null, { offline: true });
    return { ok: false, offline: true, error: '离线模式：本地词库未收录该词，且没有缓存' };
  }
  if (cached && cached.data && Date.now() - (cached.ts || 0) < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, offline: false };
  }
  const local = localDictLookup(word, rawDictId);
  const settled = await Promise.allSettled([
    youdaoSuggest(word).catch((e) => { logRenderer('free-youdao', String(e.message || e)); return null; }),
    httpJson(DICT_API + encodeURIComponent(word), 7000).then(parseDictionaryApi).catch((e) => { logRenderer('free-dictapi', String(e.message || e)); return null; }),
  ]);
  const yd = settled[0].status === 'fulfilled' ? settled[0].value : null;
  const dictApi = settled[1].status === 'fulfilled' ? settled[1].value : null;
  const result = buildWordResult(word, local, yd, dictApi, { offline: false });
  if (result.ok) {
    if (yd || dictApi) {
      wordCache[key] = { ts: Date.now(), data: { ...result, cached: false } };
      scheduleCacheSave();
    }
    return result;
  }
  if (cached && cached.data) return { ...cached.data, cached: true, offline: true };
  if (local) return buildWordResult(word, local, null, null, { offline: true });
  return { ok: false, offline: true, error: '未找到该词的释义（本地词库未收录，在线接口暂时不可用）' };
}

async function translateSentenceFree(rawText) {
  const text = String(rawText || '').trim().slice(0, 600);
  if (!text) return { ok: false, error: '句子为空' };
  const key = text.toLowerCase();
  const cached = transCache[key];
  if (!settings.onlineLookup) {
    if (cached && cached.text) return { ok: true, text: cached.text, source: cached.source || 'cache', cached: true, offline: true };
    return { ok: false, offline: true, error: '离线模式：暂无该句缓存' };
  }
  if (cached && cached.text && Date.now() - (cached.ts || 0) < CACHE_TTL_MS) {
    return { ok: true, text: cached.text, source: cached.source || 'cache', cached: true, offline: false };
  }
  // 1) MyMemory
  try {
    const url = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=en|zh-CN`;
    const json = await httpJson(url, 8000);
    const rd = json && json.responseData;
    let tr = rd && rd.translatedText ? String(rd.translatedText).trim() : '';
    const quota = !!(json && json.quotaFinished);
    if (tr && /[\u3400-\u9fff]/.test(tr) && !quota) {
      transCache[key] = { ts: Date.now(), text: tr, source: 'MyMemory' };
      scheduleCacheSave();
      return { ok: true, text: tr, source: 'MyMemory' };
    }
    if (quota) logRenderer('free-mymemory', 'quota finished');
  } catch (e) { logRenderer('free-mymemory', String(e.message || e)); }
  // 2) 降级：Google 翻译公共端点（无需 Key）
  try {
    const json = await httpJson(GOOGLE_TR + encodeURIComponent(text), 8000);
    const parts = Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
    const tr = parts.map((p) => (Array.isArray(p) ? p[0] : '')).join('').trim();
    if (tr && /[\u3400-\u9fff]/.test(tr)) {
      transCache[key] = { ts: Date.now(), text: tr, source: 'Google' };
      scheduleCacheSave();
      return { ok: true, text: tr, source: 'Google' };
    }
  } catch (e) { logRenderer('free-google', String(e.message || e)); }
  if (cached && cached.text) return { ok: true, text: cached.text, source: cached.source || 'cache', cached: true, offline: true };
  return { ok: false, offline: true, error: '整句翻译失败（网络不可用或接口限流），请稍后重试' };
}

const hoverLocalCache = new Map();
async function hoverTranslateFree(rawWord, rawDictId) {
  const word = String(rawWord || '').trim().replace(/[^A-Za-z'’-]/g, '').slice(0, 40);
  if (!word) return { ok: false, error: '无效单词' };
  const key = word.toLowerCase();
  const cachedHover = hoverLocalCache.get(key);
  if (cachedHover) return { ok: true, word, text: cachedHover.text, source: cachedHover.source, cached: true, offline: !settings.onlineLookup };
  // 1) 本地词库（当前词典）优先：即时、离线可用
  const local = localDictLookup(word, rawDictId);
  if (local && local.trans.length) {
    const text = local.trans.join('；');
    hoverLocalCache.set(key, { text, source: '本地词库' });
    return { ok: true, word, text, source: '本地词库', cached: false, offline: !settings.onlineLookup };
  }
  const cached = wordCache[key];
  const shortFromCache = cached && cached.data && cached.data.zhLines && cached.data.zhLines.length
    ? cached.data.zhLines.map((x) => x.text).join('；')
    : '';
  if (shortFromCache) {
    hoverLocalCache.set(key, { text: shortFromCache, source: cached.data.sources.join('+') });
    return { ok: true, word, text: shortFromCache, source: cached.data.sources.join('+'), cached: true, offline: !settings.onlineLookup };
  }
  if (!settings.onlineLookup) {
    return { ok: false, offline: true, error: '离线' };
  }
  try {
    const yd = await youdaoSuggest(word);
    if (yd && yd.explain) {
      hoverLocalCache.set(key, { text: yd.explain, source: '有道' });
      return { ok: true, word, text: yd.explain, source: '有道' };
    }
  } catch (e) { logRenderer('free-hover', String(e.message || e)); }
  return { ok: false, offline: true, error: '暂无该词释义' };
}

function freeCacheStats() {
  try {
    const w = Object.keys(wordCache).length, t = Object.keys(transCache).length;
    let bytes = 0;
    for (const f of [WORD_CACHE_FILE, TRANS_CACHE_FILE]) { try { bytes += fs.statSync(f).size; } catch { /* ignore */ } }
    return { ok: true, words: w, sentences: t, bytes };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
function freeCacheClear() {
  try {
    wordCache = {}; transCache = {};
    fs.rmSync(WORD_CACHE_FILE, { force: true });
    fs.rmSync(TRANS_CACHE_FILE, { force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---------------------------------------------------------------------------
// 主窗口
// ---------------------------------------------------------------------------
function createWindow() {
  const saved = loadWindowState();
  const visible = isVisibleOnSomeDisplay(saved);

  mainWindow = new BrowserWindow({
    width: visible ? Math.max(900, saved.width) : 1280,
    height: visible ? Math.max(600, saved.height) : 800,
    x: visible ? saved.x : undefined,
    y: visible ? saved.y : undefined,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1e293b',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
    },
  });

  if (saved && saved.maximized) mainWindow.maximize();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    const candidates = [
      path.join(__dirname, 'build/index.html'),
      path.join(__dirname, '../build/index.html'),
    ];
    const existsInfo = candidates.map((p) => { try { return fs.existsSync(p); } catch (e) { return 'err:' + e.message; } });
    logRenderer('paths', `dirname=${__dirname} appPath=${app.getAppPath()} resources=${process.resourcesPath}`);
    logRenderer('paths', `candidates=${JSON.stringify(candidates)} exists=${JSON.stringify(existsInfo)}`);
    const target = existsInfo[1] === true ? candidates[1] : candidates[0];
    logRenderer('paths', `target=${target}`);
    try {
      mainWindow.loadURL(require('url').pathToFileURL(target).href).catch((e) => logError('loadURL', e));
    } catch (e) {
      logError('loadURL-sync', e);
    }
  }

  mainWindow.once('ready-to-show', () => {
    // 应用持久化的窗口增强设置
    try { mainWindow.setAlwaysOnTop(!!settings.alwaysOnTop); } catch { /* ignore */ }
    try { if (settings.opacity && settings.opacity < 1) mainWindow.setOpacity(settings.opacity); } catch { /* ignore */ }
    try { if (settings.zoom && settings.zoom !== 1) mainWindow.webContents.setZoomFactor(settings.zoom); } catch { /* ignore */ }
    if (!startHidden) mainWindow.show();
    else if (tray) tray.setToolTip('Qwerty Learner Plus（已最小化到托盘）');
  });

  // 页面加载完成后注入增强 UI
  mainWindow.webContents.on('dom-ready', () => {
    setTimeout(() => injectEnhance(mainWindow), 120);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    logRenderer('did-finish-load', mainWindow.webContents.getURL());
    setTimeout(() => injectEnhance(mainWindow), 300);
    setTimeout(() => sendEvent('settings', publicSettings()), 600);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logError('did-fail-load', `${code} ${desc} ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logError('render-process-gone', JSON.stringify(details));
    if (details && details.reason !== 'clean-exit') {
      try { mainWindow && mainWindow.reload(); } catch { /* ignore */ }
    }
  });
  mainWindow.webContents.on('console-message', (_e, a, b, c, d) => {
    // 兼容新老 Electron 事件签名：旧版 (event, level, message, line, sourceId)，新版 (event, details)
    let level, message, sourceId, line;
    if (a && typeof a === 'object') {
      level = Number(a.level);
      message = String(a.message || '');
      sourceId = String(a.sourceId || '');
      line = a.lineNumber;
    } else {
      level = Number(a);
      message = String(b || '');
      line = c;
      sourceId = d;
    }
    if (level >= 2) {
      const key = message.slice(0, 120);
      if (seenConsoleErrors.has(key)) return;
      seenConsoleErrors.add(key);
      logRenderer(level === 3 ? 'console-error' : 'console-warning', `${message} (${sourceId}:${line})`);
    }
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    logError('preload-error', `${preloadPath} ${error && error.stack || error}`);
  });

  // 外链用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(url); } catch { /* ignore */ }
    return { action: 'deny' };
  });

  // 窗口变化时持久化位置尺寸
  const save = () => saveWindowState(mainWindow);
  mainWindow.on('resize', save);
  mainWindow.on('move', save);
  mainWindow.on('close', (e) => {
    save();
    if (!isQuitting && settings.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    if (clipboardWin && !clipboardWin.isDestroyed()) clipboardWin.destroy();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (clipboardWin && !clipboardWin.isDestroyed()) clipboardWin.destroy();
  });
  mainWindow.on('focus', () => {
    // 主窗口获得焦点时暂停剪贴板弹窗
    if (clipboardWin && !clipboardWin.isDestroyed()) clipboardWin.hide();
  });
}

// ---------------------------------------------------------------------------
// 快捷键 / 自启 / IPC
// ---------------------------------------------------------------------------
function registerShortcuts() {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  const reg = (accel, fn, label) => {
    if (!accel) return;
    try {
      const ok = globalShortcut.register(accel, fn);
      logRenderer('shortcut', `${label} ${accel} registered=${ok}`);
      if (!ok) logRenderer('shortcut', `register failed: ${accel} (${label})`);
    } catch (e) { logError('shortcut-' + label, e); }
  };
  reg(settings.shortcutToggle || 'CommandOrControl+Alt+Q', () => toggleMainWindow(), 'toggle');
  reg(settings.shortcutMini || 'CommandOrControl+Alt+M', () => {
    setMiniMode(!settings.miniMode);
    updateTrayMenu();
  }, 'mini');
}

function setAutoStart(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: ['--hidden'],
    });
    const actual = app.getLoginItemSettings().openAtLogin;
    settings.autoStart = !!actual;
    saveSettings();
    return { ok: true, autoStart: settings.autoStart, requested: !!on };
  } catch (e) { logError('autostart', e); return { ok: false, error: String(e.message || e) }; }
}

function registerIpc() {
  ipcMain.handle('app:getSettings', () => publicSettings());
  ipcMain.handle('app:updateSettings', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      const allowed = Object.keys(DEFAULT_SETTINGS);
      for (const k of Object.keys(patch)) {
        if (!allowed.includes(k)) continue;
        settings[k] = patch[k];
      }
      saveSettings();
      // 即时生效的设置
      if (typeof patch.opacity === 'number' && mainWindow) { try { mainWindow.setOpacity(Math.min(1, Math.max(0.3, patch.opacity))); } catch { /* ignore */ } }
      if (typeof patch.zoom === 'number' && mainWindow) { try { mainWindow.webContents.setZoomFactor(Math.min(1.6, Math.max(0.6, patch.zoom))); } catch { /* ignore */ } }
      if (typeof patch.alwaysOnTop === 'boolean') setAlwaysOnTop(patch.alwaysOnTop);
      if (typeof patch.miniMode === 'boolean') setMiniMode(patch.miniMode);
      if (typeof patch.autoStart === 'boolean') setAutoStart(patch.autoStart);
      if (typeof patch.shortcutToggle === 'string' || typeof patch.shortcutMini === 'string') registerShortcuts();
      if (patch.pronCache !== undefined) { /* 拦截器读取 settings，实时生效 */ }
      sendEvent('settings', publicSettings());
      updateTrayMenu();
    }
    return publicSettings();
  });
  ipcMain.handle('win:setTop', (_e, v) => { const r = setAlwaysOnTop(!!v); updateTrayMenu(); return r; });
  ipcMain.handle('win:setMini', (_e, v) => { const r = setMiniMode(!!v); updateTrayMenu(); return r; });
  ipcMain.handle('win:setOpacity', (_e, v) => {
    const val = Math.min(1, Math.max(0.3, Number(v) || 1));
    try { mainWindow && mainWindow.setOpacity(val); } catch (e) { logError('opacity', e); }
    settings.opacity = val; saveSettings(); return { ok: true, opacity: val };
  });
  ipcMain.handle('win:setZoom', (_e, v) => {
    const val = Math.min(1.6, Math.max(0.6, Number(v) || 1));
    try { mainWindow && mainWindow.webContents.setZoomFactor(val); } catch (e) { logError('zoom', e); }
    settings.zoom = val; saveSettings(); return { ok: true, zoom: val };
  });
  ipcMain.handle('win:setAutoStart', (_e, v) => setAutoStart(!!v));
  ipcMain.handle('win:setCloseToTray', (_e, v) => { settings.closeToTray = !!v; saveSettings(); return { ok: true, closeToTray: settings.closeToTray }; });
  ipcMain.handle('win:setClipboardWatch', (_e, v) => { settings.clipboardWatch = !!v; saveSettings(); return { ok: true, clipboardWatch: settings.clipboardWatch }; });
  ipcMain.handle('stats:update', (_e, stats) => {
    if (!stats || typeof stats !== 'object') return { ok: false };
    const safe = {
      date: String(stats.date || ''),
      words: Number(stats.words) || 0,
      goal: Number(stats.goal) || settings.dailyGoal,
      streak: Number(stats.streak) || 0,
      ratio: Math.min(1, Math.max(0, Number(stats.ratio) || 0)),
    };
    settings.todayStats = safe;
    saveSettings();
    // A9: 托盘 tooltip + 任务栏进度
    try {
      if (tray) tray.setToolTip(`Qwerty Plus · 今日 ${safe.words}/${safe.goal} 词 · 连续 ${safe.streak} 天`);
      if (mainWindow) mainWindow.setProgressBar(safe.goal > 0 ? safe.ratio : -1);
    } catch (e) { logError('tray-progress', e); }
    try { updateTrayMenu(); } catch { /* ignore */ }
    // 今日目标达成提醒（每天一次）
    const today = new Date().toISOString().slice(0, 10);
    if (safe.goal > 0 && safe.words >= safe.goal && settings.goalNotifiedDate !== today) {
      settings.goalNotifiedDate = today;
      saveSettings();
      try {
        if (Notification.isSupported()) new Notification({ title: '🎉 今日目标达成', body: `今天已练习 ${safe.words} 词，连续打卡 ${safe.streak} 天！` }).show();
      } catch { /* ignore */ }
    }
    return { ok: true };
  });
  ipcMain.handle('backup:now', () => runBackup('manual-panel'));
  ipcMain.handle('app:openPath', (_e, which) => {
    const map = {
      backup: BACKUP_DIR, log: LOG_DIR, plus: PLUS_DIR, data: USER_DATA, cache: CACHE_DIR,
      dictupdate: UPDATE_DIR, exports: EXPORTS_DIR,
    };
    const p = map[which];
    if (!p) return { ok: false };
    shell.openPath(p);
    return { ok: true, path: p };
  });
  ipcMain.handle('app:relaunch', () => {
    try { isQuitting = true; app.relaunch(); app.exit(0); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('app:notify', (_e, title, body) => {
    try {
      if (Notification.isSupported()) new Notification({ title: String(title || 'Qwerty Learner Plus'), body: String(body || ''), icon: appIconPath() }).show();
      return { ok: true };
    } catch (e) { logError('notify', e); return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); });
  ipcMain.handle('clipboard:get', () => { try { return clipboard.readText(); } catch { return ''; } });
  ipcMain.handle('clipboard:close', (e) => {
    if (clipboardWin && !clipboardWin.isDestroyed() && e.sender === clipboardWin.webContents) clipboardWin.hide();
    return { ok: true };
  });
  // U4：CSV 快速导出（自动保存到 文档\QwertyLearnerPlus\exports，不再弹保存框）
  ipcMain.handle('file:saveCSV', async (_e, defaultName, content) => {
    try {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
      const safe = String(defaultName || 'qwerty-export.csv').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
      const base = safe.replace(/\.csv$/i, '');
      let filePath = path.join(EXPORTS_DIR, base + '.csv');
      if (fs.existsSync(filePath)) filePath = path.join(EXPORTS_DIR, `${base}-${Date.now()}.csv`);
      fs.writeFileSync(filePath, '\ufeff' + String(content || ''), 'utf-8');
      return { ok: true, path: filePath, dir: EXPORTS_DIR, autoSaved: true };
    } catch (e) { logError('save-csv', e); return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('file:openExports', () => {
    try { fs.mkdirSync(EXPORTS_DIR, { recursive: true }); shell.openPath(EXPORTS_DIR); return { ok: true, path: EXPORTS_DIR }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.handle('file:exportJSON', async (_e, defaultName, content) => {
    try {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: '导出 JSON',
        defaultPath: path.join(app.getPath('documents'), defaultName || 'qwerty-export.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }],
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      fs.writeFileSync(filePath, String(content || ''), 'utf-8');
      return { ok: true, path: filePath };
    } catch (e) { logError('export-json', e); return { ok: false, error: String(e.message || e) }; }
  });
  // —— 免费释义 / 翻译（免 Key）——
  ipcMain.handle('free:lookup', (_e, word, dictId) => lookupWordFree(word, dictId));
  ipcMain.handle('free:translate', (_e, text) => translateSentenceFree(text));
  ipcMain.handle('free:hover', (_e, word, dictId) => hoverTranslateFree(word, dictId));
  ipcMain.handle('free:stats', () => freeCacheStats());
  ipcMain.handle('free:clear', () => freeCacheClear());
  ipcMain.handle('free:ecdict', () => ({
    ok: false,
    disabled: true,
    error: 'ECDICT 离线词典（约 80MB）下载在当前版本未启用；免费在线释义已可用，不影响查词/翻译。',
  }));
  ipcMain.handle('pron:stats', () => {
    try {
      const files = fs.readdirSync(AUDIO_CACHE_DIR).filter((f) => f.endsWith('.audio'));
      let bytes = 0;
      for (const f of files) { try { bytes += fs.statSync(path.join(AUDIO_CACHE_DIR, f)).size; } catch { /* ignore */ } }
      return { ok: true, count: files.length, bytes };
    } catch { return { ok: false }; }
  });
  ipcMain.handle('pron:clear', () => {
    try {
      if (precacheJob && !precacheJob.finished) return { ok: false, error: '请先暂停/取消预缓存任务再清理' };
      for (const f of fs.readdirSync(AUDIO_CACHE_DIR)) fs.rmSync(path.join(AUDIO_CACHE_DIR, f), { force: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  // —— v5：词库管理 ——
  ipcMain.handle('dicts:list', () => listBuiltinDicts());
  // —— v6：整本词库读取（记忆曲线）——
  ipcMain.handle('dicts:read', (_e, file) => readDictContent(file));
  ipcMain.handle('dicts:checkUpdates', () => checkDictUpdates());
  ipcMain.handle('dicts:downloadUpdate', (_e, name, url) => downloadDictUpdate(name, url));
  ipcMain.handle('dicts:override', (_e, name) => dictOverrideExists(name));
  ipcMain.handle('dicts:updateInfo', () => dictUpdateInfo());
  ipcMain.handle('dicts:openUpdateDir', () => { try { shell.openPath(UPDATE_DIR); return { ok: true, path: UPDATE_DIR }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
  ipcMain.handle('dicts:clearUpdates', () => {
    try {
      for (const f of fs.readdirSync(UPDATE_DIR)) fs.rmSync(path.join(UPDATE_DIR, f), { force: true, recursive: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  // —— v5：发音预缓存 ——
  ipcMain.handle('pron:precacheStart', (_e, opts) => startPrecache(opts));
  ipcMain.handle('pron:precachePause', () => precachePause());
  ipcMain.handle('pron:precacheResume', () => precacheResume());
  ipcMain.handle('pron:precacheCancel', () => precacheCancel());
  ipcMain.handle('pron:precacheStatus', () => precacheSnapshot());
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
const gotLock = process.env.QZ_ALLOW_MULTI === '1' ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    isQuitting = true;
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
    if (clipboardTimer) clearInterval(clipboardTimer);
    if (backupTimer) clearInterval(backupTimer);
  });

  app.whenReady().then(() => {
    loadSettings();
    settings.miniMode = false; // 迷你模式不跨启动保持（窗口尺寸本身已记忆）
    startHidden = process.argv.includes('--hidden');
    Menu.setApplicationMenu(null);
    registerAudioCache();
    createWindow();
    createTray();
    registerShortcuts();
    registerIpc();
    startClipboardWatch();
    scheduleDailyBackup();
    logRenderer('startup', `v${APP_VERSION} started. userData=${USER_DATA} plusDir=${PLUS_DIR} hidden=${startHidden} pronCache=${settings.pronCache}`);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });  });
}
