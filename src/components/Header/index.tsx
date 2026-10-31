import logo from '@/assets/logo.svg'
import type { PropsWithChildren } from 'react'

function Header({ children }: PropsWithChildren) {
  return (
    <header className="container z-20 mx-auto w-full px-10 py-6">
      <div className="flex w-full flex-col items-center justify-between space-y-3 lg:flex-row lg:space-y-0">
        {/* 本地 fork：LOGO 仅作品牌标识，不再外链官网（避免与学习无关的推广跳转）。 */}
        <div className="flex shrink-0 items-center whitespace-nowrap text-2xl font-bold text-indigo-500 lg:text-3xl">
          <img src={logo} className="mr-3 h-16 w-16" alt="Qwerty Learner Logo" />
          <h1>Qwerty Learner</h1>
        </div>
        <nav className="my-card on element flex w-auto content-center items-center justify-end space-x-3 rounded-xl bg-white p-4 transition-colors duration-300 dark:bg-gray-800">
          {children}
        </nav>
      </div>
    </header>
  )
}

export default Header
