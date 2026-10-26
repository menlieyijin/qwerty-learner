import logo from '@/assets/logo.svg'
import type { PropsWithChildren } from 'react'
import type React from 'react'

const Header: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <header className="container z-20 mx-auto w-full px-10 py-6">
      <div className="flex w-full flex-col items-center justify-between space-y-3 lg:flex-row lg:space-y-0">
        {/* PAGES-011：LOGO 原本用 react-router NavLink 指向外链，HashRouter 下会被当成应用内路径，
            点击后命中 /* → Navigate to="/"，实际不会打开官网。改为普通 a 标签，保持“打开官网”语义。 */}
        <a
          className="flex shrink-0 items-center whitespace-nowrap text-2xl font-bold text-indigo-500 no-underline hover:no-underline lg:text-3xl"
          href="https://qwerty.kaiyi.cool/"
          target="_blank"
          rel="noreferrer"
        >
          <img src={logo} className="mr-3 h-16 w-16" alt="Qwerty Learner Logo" />
          <h1>Qwerty Learner</h1>
        </a>
        <nav className="my-card on element flex w-auto content-center items-center justify-end space-x-3 rounded-xl bg-white p-4 transition-colors duration-300 dark:bg-gray-800">
          {children}
        </nav>
      </div>
    </header>
  )
}

export default Header
