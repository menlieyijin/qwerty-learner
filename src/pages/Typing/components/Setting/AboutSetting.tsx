import styles from './index.module.css'
import IconBrandGithub from '~icons/tabler/brand-github'
import IconExternalLink from '~icons/tabler/external-link'

/**
 * 关于页（v11）：只回答「这是哪个版本、来自哪里」。功能入口都在左侧页签，不再有「打开增强工具」这类跳板。
 */

const REPO_URL = 'https://github.com/menlieyijin/qwerty-learner'
const UPSTREAM_URL = 'https://github.com/RealKai42/qwerty-learner'

export default function AboutSetting() {
  return (
    <div className={styles.tabContent}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>版本</span>
        <div className={styles.block}>
          <span className="font-mono text-sm text-gray-700 dark:text-gray-200">{APP_VERSION}</span>
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{LATEST_COMMIT_HASH}</span>
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
    </div>
  )
}
