import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ScheduleProvider } from '@/lib/schedule-store'
import { ToastProvider } from '@/components/ui/toast'
import { AppNav } from '@/components/app-nav'
import prisma from '@/lib/prisma'
import './globals.css'

const _geistSans = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Dayframe — Daily Scheduler',
  description:
    'A minimalist daily scheduling app with context tabs, an active target, and a foraging pool.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  let initialTabs = await prisma.customTab.findMany({ orderBy: { position: 'asc' } })

  if (initialTabs.length === 0) {
    const defaultTab = await prisma.customTab.create({
      data: { title: 'Project Alpha', position: 0 },
    })
    initialTabs = [defaultTab]
  }

  const initialTasks = await prisma.task.findMany()

  const serializedTasks = initialTasks.map((t) => ({
    ...t,
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  }))

  return (
    <html lang="en" className="light bg-background">
      <body className="font-sans antialiased">
        <ToastProvider>
          <ScheduleProvider initialTabs={initialTabs} initialTasks={serializedTasks as any}>
            <AppNav />
            <main className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 md:px-6">
              {children}
            </main>
          </ScheduleProvider>
        </ToastProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
