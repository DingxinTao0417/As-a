import nextEnv from "@next/env"
import { validateEnvironment } from "./environment.mjs"

nextEnv.loadEnvConfig(process.cwd())
const production = process.argv.includes("--production")
const errors = validateEnvironment(process.env, { production })
if (errors.length) {
  console.error(`Environment validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`)
  process.exitCode = 1
} else {
  console.log(`Environment configuration validated (${production ? "production" : "build"}). No services were contacted.`)
}
