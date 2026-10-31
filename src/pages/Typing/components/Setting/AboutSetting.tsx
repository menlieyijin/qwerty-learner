import styles from './index.module.css'
import { IS_MAC_OS } from '@/utils'
import IconBrandGithub from '~icons/tabler/brand-github'
import IconExternalLink from '~icons/tabler/external-link'
import IconTool from '~icons/tabler/tool'

/**
 * 「关于」页（v10.7，dsh）。
 *
 * 为什么要有：原来增强面板里塞了一屏「版本 + 逐版本功能清单 + 已知限制」（十几段文字），
 * 用户想看的是版本号和链接。这里只保留 4 行事实 + 2 个链接 + 1 个入口，其余删掉。
 *
 * 版本号来自构建期常量 `APP_VERSION`（`vite.config.ts` 从 `local-fork/package.json` 读取），
 * 不在前端硬编码，避免和文档各写一份。
 */

const REPO_URL = 'https://github.com/menlieyijin/qwerty-learner'
const UPSTREAM_URL = 'https://github.com/RealKai42/qwerty-learner'

/** 是否运行在桌面壳里（增强工具依赖 Electron 注入，浏览器版没有） */
const isDesktopShell = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

export default function AboutSetting() {
  const openEnhance = () => window.dispatchEvent(new CustomEvent('qz-open-enhance'))

  return (
    <div className={styles.tabContent}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>版本</span>
        <div className={styles.block}>
          <span className="font-mono text-sm text-gray-700 dark:text-gray-200">{APP_VERSION}</span>
          <span className={styles.sectionDescription}>
            提交 <span className="font-mono">{LATEST_COMMIT_HASH}</span>
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>来源</span>
        <div className={styles.block}>
          <span className={styles.sectionDescription}>
            基于{' '}
            <a className="underline" href={UPSTREAM_URL} target="_blank" rel="noreferrer">
              Qwerty Learner
            </a>
            （commit 1182426）· GPL-3.0
          </span>
          <a
            className="inline-flex items-center gap-1 text-sm text-indigo-500 hover:underline"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            <IconBrandGithub className="h-4 w-4" />
            本分支仓库
            <IconExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {isDesktopShell() && (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>桌面端</span>
          <div className={styles.block}>
            <button
              className="inline-flex items-center gap-1 rounded-md bg-indigo-500 px-3 py-1.5 text-sm text-white hover:bg-indigo-400 focus:outline-none"
              onClick={openEnhance}
            >
              <IconTool className="h-4 w-4" />
              打开增强工具
            </button>
            <span className={styles.sectionDescription}>
              词库管理、备份、发音缓存、统计{IS_MAC_OS ? '；快捷键 ⌘' : '；快捷键 Ctrl'} 见工具页
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
