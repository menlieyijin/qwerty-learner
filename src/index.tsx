import Loading from './components/Loading'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'
import { LEGACY_FONT_SIZE_LIMIT, LEGACY_FONT_SIZE_REPAIR } from '@/constants'
import { ErrorBook } from './pages/ErrorBook'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import { initTelemetry } from '@/utils/telemetry'
import 'animate.css'
import { useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

const AnalysisPage = lazy(() => import('./pages/Analysis'))
const GalleryPage = lazy(() => import('./pages/Gallery-N'))

// PRIV-001 / Batch2（v9.5）：遥测改为按环境初始化。
// - 网页版保持原有行为（继续上报）；
// - 桌面 Electron 默认不初始化 mixpanel / 不上报（本地优先、可离线应用，不应默认向第三方发送使用统计）；
//   需要时用户显式执行 `localStorage['qzTelemetryOptIn'] = '1'`（或控制台 `qzTelemetry.optIn()`）后再启动即生效。
// 关闭状态下所有 track 调用都是安全 no-op（见 src/utils/telemetry.ts）。
initTelemetry()

function Root() {
  const darkMode = useAtomValue(isOpenDarkModeAtom)
  useEffect(() => {
    darkMode ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')
  }, [darkMode])

  // v9.8（Batch5b）：删除 Mobile 营销落地页后不再有移动/桌面双路由，
  // 窄窗口也渲染完整桌面应用；原先的 isMobile 状态与 resize 重定向逻辑一并移除，
  // 因此“普通 resize 不得改变当前路由”的语义天然成立。
  return (
    <React.StrictMode>
      <HashRouter>
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route index element={<TypingPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/error-book" element={<ErrorBook />} />
              <Route path="/*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </HashRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

// v7 简洁布局：首次升级时把旧版过大的字号收敛到合适大小（之后仍可在设置里调整）
// 阈值与落值统一取自 @/constants（数值与原先的裸字面量逐字相同，行为不变）
try {
  if (!localStorage.getItem('v7FontAdjusted')) {
    const raw = localStorage.getItem('fontsize')
    if (raw) {
      const f = JSON.parse(raw)
      if (
        f &&
        (Number(f.translateFont) > LEGACY_FONT_SIZE_LIMIT.translateFont ||
          Number(f.foreignFont) > LEGACY_FONT_SIZE_LIMIT.foreignFont)
      ) {
        localStorage.setItem('fontsize', JSON.stringify(LEGACY_FONT_SIZE_REPAIR))
      }
    }
    localStorage.setItem('v7FontAdjusted', '1')
  }
} catch {
  /* ignore */
}

container && createRoot(container).render(<Root />)
