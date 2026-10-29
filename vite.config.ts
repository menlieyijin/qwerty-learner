import react from '@vitejs/plugin-react'
import { getLastCommit } from 'git-last-commit'
import jotaiDebugLabel from 'jotai/babel/plugin-debug-label'
import jotaiReactRefresh from 'jotai/babel/plugin-react-refresh'
import path from 'node:path'
import { visualizer } from 'rollup-plugin-visualizer'
import Icons from 'unplugin-icons/vite'
import { defineConfig } from 'vite'
import type { PluginOption } from 'vite'

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  // v9.16（dsh，M4-003）：非 git 环境下（Docker 构建、下载的源码包）getLastCommit 会回调 err。
  // 原实现写成 `err ? 'unknown' : resolve(...)`，err 分支只是「取值为 'unknown'」，Promise 永不 resolve，
  // 于是 defineConfig 永远不返回 —— vite build 静默退出（退出码 0、无任何输出、不产出 build/），
  // Dockerfile 里的 `COPY --from=build /app/build` 随之失败。这里两个分支都显式 resolve。
  const latestCommitHash = await new Promise<string>((resolve) => {
    getLastCommit((err, commit) => {
      if (err || !commit) {
        resolve('unknown')
        return
      }
      resolve(commit.shortHash)
    })
  })
  return {
    plugins: [
      react({ babel: { plugins: [jotaiDebugLabel, jotaiReactRefresh] } }),
      visualizer() as PluginOption,
      Icons({
        compiler: 'jsx',
        jsx: 'react',
      }),
    ],
    build: {
      minify: true,
      outDir: 'build',
      sourcemap: false,
      // v9.5（dsh，L-07 分包）：把体积大且不常变的第三方依赖拆成独立 chunk。
      // 目标：首屏主 chunk 从 ~1.55MB 降到 < 1MB，并让 xlsx/echarts 这类大库能被浏览器单独缓存。
      // 约束（保证不改变运行行为）：只对 node_modules 里的库分组，vendor chunk 之间可以互相 import，
      // 但绝不回指 app 代码（避免 chunk 循环导致运行时 TDZ）；入口与 app 源码仍由 rollup 决定。
      // 注意：core-js / react-app-polyfill 这类 polyfill 必须最先执行，故意留在入口 chunk，不单独拆。
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return
            if (/node_modules\/(echarts|zrender)\//.test(id)) return 'vendor-echarts'
            if (/node_modules\/(xlsx|ssf)\//.test(id)) return 'vendor-xlsx'
            if (/node_modules\/(dexie|dexie-export-import|dexie-react-hooks)\//.test(id)) return 'vendor-db'
            if (/node_modules\/(mixpanel-browser|@vercel\/analytics)\//.test(id)) return 'vendor-analytics'
            if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) {
              return 'vendor-react'
            }
            if (
              /node_modules\/(@radix-ui|@headlessui|@floating-ui|lucide-react|classnames|clsx|tailwind-merge|react-tooltip|embla-carousel|@tanstack|react-activity-calendar)\//.test(
                id,
              )
            ) {
              return 'vendor-ui'
            }
            if (/node_modules\/(howler|use-sound|pako|file-saver|canvas-confetti|html-to-image)\//.test(id)) {
              return 'vendor-media'
            }
            return undefined
          },
        },
      },
    },
    esbuild: {
      drop: mode === 'development' ? [] : ['console', 'debugger'],
    },
    define: {
      REACT_APP_DEPLOY_ENV: JSON.stringify(process.env.REACT_APP_DEPLOY_ENV),
      LATEST_COMMIT_HASH: JSON.stringify(latestCommitHash + (process.env.NODE_ENV === 'production' ? '' : ' (dev)')),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
  }
})
