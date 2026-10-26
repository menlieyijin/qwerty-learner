import Loading from './components/Loading'
import ErrorBoundary from '@/components/ErrorBoundary'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import { initTelemetry } from '@/utils/telemetry'
import 'animate.css'
import { useAtomValue } from 'jotai'
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
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

  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600)
  // L-02：记录上一次的断点状态，只有 mobile→desktop 跃迁才需要把路由复位到首页；
  // 普通桌面窗口 resize（拖动边缘/最大化切换）绝不能改变用户当前所在路由。
  const wasMobileRef = useRef(isMobile)

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth <= 600
      const wasMobile = wasMobileRef.current
      wasMobileRef.current = nextIsMobile

      if (wasMobile && !nextIsMobile) {
        // v8.6 修复：官方原代码用 window.location.href = '/'，在 Electron file:// 下会解析成
        // file:///D:/（盘符根目录），窗口直接白屏且 IndexedDB 被拒。改为 HashRouter 的 hash 导航。
        // 仅在“从移动布局切回桌面布局”时复位，因为 /mobile 在桌面路由表里没有对应页面。
        try {
          if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') {
            window.location.hash = '#/'
          }
        } catch {
          /* ignore */
        }
      }
      setIsMobile(nextIsMobile)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <React.StrictMode>
      <HashRouter>
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Routes>
              {isMobile ? (
                <Route path="/*" element={<Navigate to="/mobile" />} />
              ) : (
                <>
                  <Route index element={<TypingPage />} />
                  <Route path="/gallery" element={<GalleryPage />} />
                  <Route path="/analysis" element={<AnalysisPage />} />
                  <Route path="/error-book" element={<ErrorBook />} />
                  <Route path="/friend-links" element={<FriendLinks />} />
                  <Route path="/*" element={<Navigate to="/" />} />
                </>
              )}
              <Route path="/mobile" element={<MobilePage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </HashRouter>
    </React.StrictMode>
  )
}

const container = document.getElementById('root')

// v7 简洁布局：首次升级时把旧版过大的字号收敛到合适大小（之后仍可在设置里调整）
try {
  if (!localStorage.getItem('v7FontAdjusted')) {
    const raw = localStorage.getItem('fontsize')
    if (raw) {
      const f = JSON.parse(raw)
      if (f && (Number(f.translateFont) > 30 || Number(f.foreignFont) > 80)) {
        localStorage.setItem('fontsize', JSON.stringify({ foreignFont: 64, translateFont: 22 }))
      }
    }
    localStorage.setItem('v7FontAdjusted', '1')
  }
} catch {
  /* ignore */
}

container && createRoot(container).render(<Root />)
