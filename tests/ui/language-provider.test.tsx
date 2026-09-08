import { fireEvent, render, screen, cleanup } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useEffect, useState } from "react"
import { LanguageProvider, useLanguage } from "@/components/language-provider"
import { installBrowserStorage } from "./browser-storage"

const translatedEffect = vi.fn()
function Consumer() {
  const { language, t, setLanguage } = useLanguage()
  const [count, setCount] = useState(0)
  useEffect(() => { translatedEffect() }, [t])
  return <><p>{language}</p><button onClick={() => setCount(count + 1)}>Render {count}</button><button onClick={() => setLanguage("en")}>English</button></>
}
beforeEach(() => { installBrowserStorage(); translatedEffect.mockClear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it("ignores unsupported saved language values", () => {
  window.localStorage.setItem("language", "not-a-language")
  render(<LanguageProvider><Consumer /></LanguageProvider>)
  expect(screen.getByText("ar")).toBeVisible()
})

it("restores and persists a supported language", () => {
  window.localStorage.setItem("language", "en")
  render(<LanguageProvider><Consumer /></LanguageProvider>)
  expect(screen.getByText("en")).toBeVisible()
  expect(document.documentElement.dir).toBe("ltr")
  expect(window.localStorage.getItem("language")).toBe("en")
})

it("keeps translation-dependent effects stable on unrelated renders", () => {
  render(<LanguageProvider><Consumer /></LanguageProvider>)
  const calls = translatedEffect.mock.calls.length
  fireEvent.click(screen.getByRole("button", { name: "Render 0" }))
  expect(translatedEffect).toHaveBeenCalledTimes(calls)
  fireEvent.click(screen.getByRole("button", { name: "English" }))
  expect(translatedEffect).toHaveBeenCalledTimes(calls + 1)
})

it("works when the browser denies storage access", () => {
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new DOMException("Denied") })
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Denied") })
  render(<LanguageProvider><Consumer /></LanguageProvider>)
  fireEvent.click(screen.getByRole("button", { name: "English" }))
  expect(screen.getByText("en")).toBeVisible()
})
