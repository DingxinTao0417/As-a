"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react"

type Language = "ar" | "en"

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (ar: string, en: string) => string
  isRTL: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("ar")
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      const savedLanguage = window.localStorage.getItem("language")
      if (savedLanguage === "ar" || savedLanguage === "en") setLanguage(savedLanguage)
    } catch {
      // Storage may be disabled by browser privacy settings.
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      window.localStorage.setItem("language", language)
    } catch {
      // Language switching still works when persistent storage is unavailable.
    }

    const html = document.documentElement
    html.lang = language
    html.dir = language === "ar" ? "rtl" : "ltr"
  }, [language, restored])

  const t = useCallback((ar: string, en: string) => {
    return language === "ar" ? ar : en
  }, [language])

  const isRTL = language === "ar"

  const value = useMemo(() => ({ language, setLanguage, t, isRTL }), [language, t, isRTL])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}
