"use client"

import Link from "next/link"
import { useLanguage } from "@/components/language-provider"

export function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="bg-secondary text-secondary-foreground">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <div className="text-2xl font-bold text-primary">أسعى</div>
            <p className="text-sm opacity-90">{t("أسعى.. والباقي علينا", "You strive.. and the rest is on us")}</p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">{t("روابط سريعة", "Quick Links")}</h3>
            <ul className="space-y-2 text-sm opacity-90">
              <li>
                <Link href="/services/seeker" className="hover:text-primary transition-colors">
                  {t("تصفح الخدمات", "Browse Services")}
                </Link>
              </li>
              <li>
                <Link href="/register/provider" className="hover:text-primary transition-colors">
                  {t("سجّل كمحترف", "Register as Professional")}
                </Link>
              </li>
            </ul>
          </div>

          {/* About */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">{t("عن أسعى", "About As'aa")}</h3>
            <ul className="space-y-2 text-sm opacity-90">
              <li>
                <Link href="/about" className="hover:text-primary transition-colors">
                  {t("من نحن", "About Us")}
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">{t("الدعم", "Support")}</h3>
            <ul className="space-y-2 text-sm opacity-90">
              <li>
                <Link href="/terms" className="hover:text-primary transition-colors">
                  {t("الشروط والأحكام", "Terms & Conditions")}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-primary transition-colors">
                  {t("سياسة الخصوصية", "Privacy Policy")}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-secondary-foreground/20 text-center text-sm opacity-75">
          <p>© {new Date().getFullYear()} {t("أسعى. جميع الحقوق محفوظة", "As'aa. All rights reserved")}</p>
        </div>
      </div>
    </footer>
  )
}
