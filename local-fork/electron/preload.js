// Qwerty Learner Plus — 安全预加载脚本（contextIsolation: true）
// 通过 contextBridge 只暴露白名单 API，渲染进程不接触 Node。
const { contextBridge, ipcRenderer } = require('electron');

function onEvent(cb) {
  if (typeof cb !== 'function') return;
  const handler = (_e, payload) => { try { cb(payload); } catch { /* ignore */ } };
  ipcRenderer.on('enhance:event', handler);
}
function onClipboardWord(cb) {
  if (typeof cb !== 'function') return;
  const handler = (_e, word) => { try { cb(word); } catch { /* ignore */ } };
  ipcRenderer.on('clipboard:word', handler);
}

contextBridge.exposeInMainWorld('qwertyEnhance', {
  version: '1.0.0-enhanced-v8.7',
  platform: process.platform,
  // —— 设置 ——
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  updateSettings: (patch) => ipcRenderer.invoke('app:updateSettings', patch),
  onSettings: (cb) => { if (typeof cb === 'function') ipcRenderer.on('app:settings', (_e, s) => cb(s)); },
  // —— 事件（迷你模式 / 打开面板 / 设置）——
  onEvent,
  // —— A 层窗口控制 ——
  setAlwaysOnTop: (v) => ipcRenderer.invoke('win:setTop', v),
  setMiniMode: (v) => ipcRenderer.invoke('win:setMini', v),
  setOpacity: (v) => ipcRenderer.invoke('win:setOpacity', v),
  setZoom: (v) => ipcRenderer.invoke('win:setZoom', v),
  setAutoStart: (v) => ipcRenderer.invoke('win:setAutoStart', v),
  setCloseToTray: (v) => ipcRenderer.invoke('win:setCloseToTray', v),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  openPath: (which) => ipcRenderer.invoke('app:openPath', which),
  notify: (title, body) => ipcRenderer.invoke('app:notify', title, body),
  quit: () => ipcRenderer.invoke('app:quit'),
  // —— A9 状态上报 ——
  sendStats: (stats) => ipcRenderer.invoke('stats:update', stats),
  // —— 免费释义 / 翻译（免 Key）——
  freeLookup: (word, dictId) => ipcRenderer.invoke('free:lookup', word, dictId),
  freeTranslate: (text) => ipcRenderer.invoke('free:translate', text),
  freeHover: (word, dictId) => ipcRenderer.invoke('free:hover', word, dictId),
  freeStats: () => ipcRenderer.invoke('free:stats'),
  freeClear: () => ipcRenderer.invoke('free:clear'),
  freeEcdict: () => ipcRenderer.invoke('free:ecdict'),
  // —— 文件 ——
  saveCSV: (name, content) => ipcRenderer.invoke('file:saveCSV', name, content),
  openExports: () => ipcRenderer.invoke('file:openExports'),
  exportJSON: (name, content) => ipcRenderer.invoke('file:exportJSON', name, content),
  // —— v5：词库管理（列表 / 在线更新）——
  dictList: () => ipcRenderer.invoke('dicts:list'),
  // v6：读取整本词库（记忆曲线用；不分章节）
  dictRead: (file) => ipcRenderer.invoke('dicts:read', file),
  dictCheckUpdates: () => ipcRenderer.invoke('dicts:checkUpdates'),
  dictDownloadUpdate: (name, url) => ipcRenderer.invoke('dicts:downloadUpdate', name, url),
  dictOverride: (name) => ipcRenderer.invoke('dicts:override', name),
  dictUpdateInfo: () => ipcRenderer.invoke('dicts:updateInfo'),
  dictOpenUpdateDir: () => ipcRenderer.invoke('dicts:openUpdateDir'),
  dictClearUpdates: () => ipcRenderer.invoke('dicts:clearUpdates'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  // —— v5：发音预缓存 ——
  precacheStart: (opts) => ipcRenderer.invoke('pron:precacheStart', opts),
  precachePause: () => ipcRenderer.invoke('pron:precachePause'),
  precacheResume: () => ipcRenderer.invoke('pron:precacheResume'),
  precacheCancel: () => ipcRenderer.invoke('pron:precacheCancel'),
  precacheStatus: () => ipcRenderer.invoke('pron:precacheStatus'),
  onPrecacheProgress: (cb) => {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('pron:precache-progress', (_e, payload) => { try { cb(payload); } catch { /* ignore */ } });
  },
  // —— 剪贴板 / 发音缓存 ——
  getClipboard: () => ipcRenderer.invoke('clipboard:get'),
  closeClipboard: () => ipcRenderer.invoke('clipboard:close'),
  onClipboardWord,
  pronStats: () => ipcRenderer.invoke('pron:stats'),
  clearPronCache: () => ipcRenderer.invoke('pron:clear'),
  setClipboardWatch: (v) => ipcRenderer.invoke('win:setClipboardWatch', v),
});

// v5：在页面脚本执行前安装 fetch 包装，让「在线更新词库」下载的文件优先于 asar 内置文件。
// 仅当主进程确认更新目录存在对应文件时才改写 URL（qzcache://dict/<file>），否则原样放行。
try {
  if (typeof contextBridge.executeInMainWorld === 'function') {
    contextBridge.executeInMainWorld({
      func: () => {
        try {
          if (window.__QZ_DICT_PATCH__) return;
          window.__QZ_DICT_PATCH__ = true;
          const origFetch = window.fetch ? window.fetch.bind(window) : null;
          if (!origFetch) return;
          window.fetch = function (input, init) {
            try {
              const url = typeof input === 'string' ? input : (input && input.url) || '';
              const m = /(?:^|\/)dicts\/([^/?#]+\.json)(?:[?#]|$)/.exec(url);
              if (m && window.qwertyEnhance && window.qwertyEnhance.dictOverride) {
                return window.qwertyEnhance.dictOverride(m[1]).then(function (has) {
                  return has ? origFetch('qzcache://dict/' + encodeURIComponent(m[1]), init) : origFetch(input, init);
                }).catch(function () { return origFetch(input, init); });
              }
            } catch (e) { /* ignore */ }
            return origFetch(input, init);
          };
        } catch (e) { /* ignore */ }
      },
    });
  }
} catch { /* 旧版 Electron 不支持 executeInMainWorld 时，由 enhance.js 注入后再安装一次 */ }

