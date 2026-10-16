import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Chakra_Petch, Azeret_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { ThemeProvider } from 'next-themes'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { THEME_IDS } from '@/lib/themes'
import { ThemeBackground } from '@/components/ui/theme-background'
import { AuthExpiredListener } from '@/components/auth-expired-listener'
import './globals.css'
import './core.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const chakra = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
})

const azeret = Azeret_Mono({
  subsets: ['latin'],
  variable: '--font-azeret',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

function resolveMetadataBase(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.MC_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.MISSION_CONTROL_PUBLIC_URL,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    try {
      return new URL(candidate)
    } catch {
      // Ignore invalid URL values and continue fallback chain.
    }
  }

  // Prevent localhost fallback in production metadata when env is unset.
  return new URL('https://mission-control.local')
}

const metadataBase = resolveMetadataBase()

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Mission Control — AI Agent Orchestration Dashboard',
  description: 'Open-source dashboard for AI agent orchestration. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows. Self-hosted, zero dependencies, SQLite-powered.',
  metadataBase,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '256x256' },
      { url: '/brand/mc-logo-128.png', type: 'image/png', sizes: '128x128' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icon.png'],
  },
  openGraph: {
    title: 'Mission Control — AI Agent Orchestration Dashboard',
    description: 'Open-source dashboard for AI agent orchestration. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows.',
    images: [{ url: '/brand/mc-logo-512.png', width: 512, height: 512, alt: 'Mission Control — open-source AI agent orchestration dashboard' }],
    type: 'website',
    siteName: 'Mission Control',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mission Control — AI Agent Orchestration Dashboard',
    description: 'Open-source dashboard for AI agent orchestration. Manage agent fleets, dispatch tasks, track costs, and coordinate multi-agent workflows.',
    images: ['/brand/mc-logo-512.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mission Control',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const nonce = (await headers()).get('x-nonce') || undefined
  const locale = await getLocale()
  const messages = await getMessages()

  // Debug log retained (commented) for future CSP/nonce flow troubleshooting.
  // console.log('[DEBUG csp] layout nonce from x-nonce header:', nonce ? `${nonce.slice(0, 8)}...` : '(MISSING)')

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="dark" suppressHydrationWarning>
      <head>
        {/* Blocking script to set 'dark' class before first paint, preventing FOUC.
            Content is a static string literal — no user input, no XSS vector. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'safari-core';var light=['light','paper','safari-core'];if(light.indexOf(t)===-1)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
        {/* A phone held sideways gets the real desktop room at 1280px (approved v13 design). Phones only honour a viewport
            width set before first paint, so it is set here, and turning the phone reloads once into the other layout. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var land=matchMedia('(orientation: landscape)');var wide=function(){return Math.min(screen.width,screen.height)<500&&matchMedia('(pointer: coarse)').matches&&land.matches};var was=wide();if(was){var W='width=1280, viewport-fit=cover';var fix=function(){document.querySelectorAll('meta[name="viewport"]').forEach(function(m){if(m.content!==W)m.content=W})};fix();new MutationObserver(fix).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content']})}land.addEventListener('change',function(){if(wide()!==was)location.reload()})}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${chakra.variable} ${azeret.variable} font-sans antialiased`} suppressHydrationWarning>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="safari-core"
            themes={THEME_IDS}
            enableSystem={false}
            disableTransitionOnChange
            nonce={nonce}
          >
            <ThemeBackground />
            <AuthExpiredListener />
            <div className="h-screen overflow-hidden bg-background text-foreground">
              {children}
            </div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
