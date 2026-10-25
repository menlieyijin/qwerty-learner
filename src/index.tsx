import Loading from './components/Loading'
import './index.css'
import { ErrorBook } from './pages/ErrorBook'
import { FriendLinks } from './pages/FriendLinks'
import MobilePage from './pages/Mobile'
import TypingPage from './pages/Typing'
import { isOpenDarkModeAtom } from '@/store'
import 'animate.css'
import { useAtomValue } from 'jotai'
import mixpanel from 'mixpanel-browser'
import process from 'process'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import 'react-app-polyfill/stable'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'

const AnalysisPage = lazy(() => import('./pages/Analysis'))
const GalleryPage = lazy(() => import('./pages/Gallery-N'))

if (process.env.NODE_ENV === 'production') {
  // for prod
  mixpanel.init('bdc492847e9340eeebd53cc35f321691')
} else {
  // for dev
  mixpanel.init('5474177127e4767124c123b2d7846e2a', { debug: true })
}

function Root() {
  const darkMode = useAtomValue(isOpenDarkModeAtom)
  useEffect(() => {
    darkMode ? document.documentElement.classList.add('dark') : document.documentElement.classList.remove('dark')
  }, [darkMode])

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600)

  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth <= 600
      if (!isMobile) {
        // v8.6 修复：官方原代码用 window.location.href = '/'，在 Electron file:// 下会解析成
        // file:///D:/（盘符根目录），窗口直接白屏且 IndexedDB 被拒。改为 HashRouter 的 hash 导航。
        try {
          if (window.location.hash && window.location.hash !== '#/' && window.location.hash !== '#') {
            window.location.hash = '#/'
          }
        } catch {
          /* ignore */
        }
      }
      setIsMobile(isMobile)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <React.StrictMode>
      <HashRouter>
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
