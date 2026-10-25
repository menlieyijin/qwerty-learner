import type React from 'react'

export default function Layout({ children }: { children: React.ReactNode }) {
  // v7：去掉底部社交/备案/版本信息，保持界面简洁
  return <main className="flex h-screen w-full flex-col items-center pb-4">{children}</main>
}
