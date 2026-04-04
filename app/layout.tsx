import type React from "react"
import type { Metadata } from "next"
import { Cairo } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { LanguageProvider } from "@/components/language-provider"
import { GlobalCustomerService } from "@/components/global-customer-service"
import "./globals.css"

const cairo = Cairo({
  subsets: ["latin", "arabic"],
  weight: ["300", "400", "600", "700"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "أسعى - As'aa | Professional Services Platform",
  description: "أسعى.. والباقي علينا - Connect with skilled professionals in Saudi Arabia",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${cairo.className} font-sans antialiased`}>
        <LanguageProvider>{children}</LanguageProvider>
        <GlobalCustomerService />
        <Analytics />
      </body>
    </html>
  )
}
