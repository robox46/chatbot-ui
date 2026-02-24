#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer'

function getArg(flag, fallback) {
  const index = process.argv.indexOf(flag)
  if (index === -1 || index === process.argv.length - 1) return fallback
  return process.argv[index + 1]
}

const inputArg = getArg('--input')
const outputArg = getArg('--output', 'output.pdf')
const waitForSelector = getArg('--wait-for-selector')
const timeoutMs = Number(getArg('--timeout', '30000'))

if (!inputArg) {
  console.error('Uso: node scripts/render-html-to-pdf.mjs --input <ruta-html-o-url> [--output salida.pdf] [--wait-for-selector .selector] [--timeout 30000]')
  process.exit(1)
}

const resolvedInput = /^https?:\/\//i.test(inputArg)
  ? inputArg
  : pathToFileURL(path.resolve(process.cwd(), inputArg)).toString()

const outputPath = path.resolve(process.cwd(), outputArg)
await fs.mkdir(path.dirname(outputPath), { recursive: true })

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
})

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(timeoutMs)

  await page.goto(resolvedInput, { waitUntil: ['domcontentloaded', 'networkidle0'] })

  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: timeoutMs })
  }

  await page.evaluate(async () => {
    await document.fonts.ready

    const images = Array.from(document.images || [])
    await Promise.all(
      images.map(async (image) => {
        if (image.complete) {
          if (typeof image.decode === 'function') {
            try {
              await image.decode()
            } catch {
              // Ignore decode errors for broken images
            }
          }
          return
        }

        await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', resolve, { once: true })
        })
      })
    )
  })

  await page.waitForFunction(() => {
    const chartJs = window.Chart
    if (!chartJs) return true

    const instances = Object.values(chartJs.instances || {})
    if (instances.length === 0) return true

    return instances.every((chart) => {
      if (!chart || !chart.chartArea) return false
      const { width, height } = chart.chartArea
      if (!width || !height) return false

      if (typeof chart.animating === 'boolean') {
        return chart.animating === false
      }

      return true
    })
  }, { timeout: timeoutMs })

  await page.pdf({
    path: outputPath,
    printBackground: true,
    preferCSSPageSize: true
  })

  console.log(`PDF generado en: ${outputPath}`)
} finally {
  await browser.close()
}
