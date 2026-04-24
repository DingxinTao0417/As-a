"use client"

import dynamic from "next/dynamic"

export const GlobalCustomerServiceLoader = dynamic(
  () => import("@/components/global-customer-service").then((mod) => mod.GlobalCustomerService),
  { ssr: false }
)