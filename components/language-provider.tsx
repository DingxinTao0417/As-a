"use client"

import type React from "react"
import { createContext, useContext, useState, useEffect } from "react"

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

  useEffect(() => {
    const savedLanguage = localStorage.getItem("language") as Language | null
    if (savedLanguage) {
      setLanguage(savedLanguage)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem("language", language)

    const html = document.documentElement
    html.lang = language
    html.dir = language === "ar" ? "rtl" : "ltr"
  }, [language])

  const t = (ar: string, en: string) => {
    return language === "ar" ? ar : en
  }

  const isRTL = language === "ar"

  return <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider")
  }
  return context
}
