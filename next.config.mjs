import bundleAnalyzer from "@next/bundle-analyzer"

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
})

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null
const isProduction = process.env.NODE_ENV === "production"
const analyticsEnabled = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true"
const smokeBuild = process.env.ASAA_BUILD_TARGET === "smoke"
const contentSecurityPolicy = [
  "default-src 'self'",
  // App Router hydration contains inline scripts. Do not add unsafe-eval in production.
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}${analyticsEnabled ? " https://va.vercel-scripts.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self'${supabaseUrl ? ` ${supabaseUrl.origin} ${supabaseUrl.origin.replace(/^http/, "ws")}` : ""}${analyticsEnabled ? " https://vitals.vercel-insights.com" : ""}${isProduction ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16.3's Vercel adapter skips root NFT files required by standalone.
  // Vercel packages Functions itself; Docker and local smoke builds need standalone.
  output: process.env.VERCEL === "1" && !smokeBuild ? undefined : "standalone",
  distDir: smokeBuild ? ".next-smoke" : ".next",
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: smokeBuild ? "tsconfig.smoke.json" : "tsconfig.json",
  },
  images: {
    remotePatterns: supabaseUrl ? [
      {
        protocol: supabaseUrl.protocol.replace(":", ""),
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port,
        pathname: "/storage/v1/object/public/**",
      },
    ] : [],
    maximumRedirects: 0,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
          { key: "X-XSS-Protection", value: "0" },
        ],
      },
    ]
  },
}

export default withBundleAnalyzer(nextConfig)
