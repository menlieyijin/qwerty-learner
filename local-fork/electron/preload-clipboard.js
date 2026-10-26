// Qwerty Learner Plus — 剪贴板查词小窗专用最小 preload（v9.6 / Batch3，SHELL-002 收敛）
// 背景：剪贴板小窗只需要「查词 + 接收剪贴板词 + 关闭」三个能力；此前复用主窗口 preload，
//       等于把 dictDownloadUpdate / openPath / exportJSON / saveCSV 等 40+ 个高风险 IPC 也暴露给一个
//       展示远端词典数据的小窗口。该页已完成远端字段转义 + nonce CSP（v9.4），这里再做一层最小权限。
// 页面自身需要的 navigator.clipboard.writeText 由主进程权限白名单（clipboard-sanitized-write）放行，不经过本文件。
// 注意：新增/删除该页能力时必须同步本文件，避免 clipboard.html 调不到 API。
const { contextBridge, ipcRenderer } = require('electron');

let APP_VERSION = 'unknown';
try {
  const v = ipcRenderer.sendSync('app:version-sync');
  if (v) APP_VERSION = String(v);
} catch { /* 保持 unknown */ }

function onClipboardWord(cb) {
  if (typeof cb !== 'function') return;
  ipcRenderer.on('clipboard:word', (_e, word) => { try { cb(word); } catch { /* ignore */ } });
}

contextBridge.exposeInMainWorld('qwertyEnhance', {
  version: APP_VERSION,
  platform: process.platform,
  // 查词（主进程走本地词库 + 有道 + dictionaryapi，带缓存/超时）
  freeLookup: (word, dictId) => ipcRenderer.invoke('free:lookup', word, dictId),
  // 主进程推送剪贴板命中的英文词
  onClipboardWord,
  // 关闭小窗（主进程校验 sender 必须是 clipboardWin）
  closeClipboard: () => ipcRenderer.invoke('clipboard:close'),
});
