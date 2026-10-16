#!/usr/bin/env node
/**
 * 截取本机运行中的 DSH Web GUI 里模型选择器的真实截图。
 *
 * 用途：插件改版后重新生成 README 的预览图，保证图与实际界面一致。
 *
 * 认证说明（重要）：
 *   `dsh web` 的访问令牌只在启动时打印到终端，脚本无法获取；但它用于签发
 *   浏览器 cookie 的长期密钥存放在本机凭据文件里（~/.dsh/.credentials.yaml
 *   的 client-connection/browser-session 记录）。本脚本读取该密钥，按
 *   packages/client/connection/src/browser-auth.ts 的算法在本地签一个
 *   合法 cookie，仅用于访问本机 127.0.0.1 的 GUI。
 *
 *   密钥不会离开本机、不会被写入任何文件，也不会被发送到外部地址。
 *   由于读取该文件本身就要求本机访问权限，脚本不带来额外权限。
 *   如不需要重新生成截图，可直接删除本脚本。
 *
 * 前置条件：
 *   1. `dsh web` 正在运行（默认 http://127.0.0.1:3080）
 *   2. 已启动带 CDP 的无头 Chrome：
 *        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *          --headless=new --disable-gpu --hide-scrollbars \
 *          --remote-debugging-port=9222 --remote-allow-origins='*' \
 *          --user-data-dir=/tmp/dsh-shot-profile --window-size=1440,940 about:blank
 *
 * 用法：
 *   node docs/capture-screenshot.mjs [输出路径] [dark]
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const AUTHORITY = process.env.DSH_AUTHORITY ?? '127.0.0.1:3080'
const CDP = process.env.DSH_CDP ?? 'http://127.0.0.1:9222'
const BASE = `http://${AUTHORITY}/`
const OUT = process.argv[2] ?? '/tmp/gui-shot.png'
const DARK = process.argv[3] === 'dark'

/* ---------- 1) 用本机持久密钥自签一个合法 cookie ---------- */
const yaml = readFileSync(`${process.env.HOME}/.dsh/.credentials.yaml`, 'utf8')
const matched = yaml.match(
  /client-connection\/browser-session:\s*\n\s+kind: grant\s*\n\s+payload:\s*\n\s+version: 1\s*\n\s+secret:\s*(\S+)/,
)
if (matched === null) throw new Error('凭据文件里未找到 browser-session secret')
const secret = Buffer.from(matched[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')

const b64 = (value) => Buffer.from(value).toString('base64')
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const issuedAt = Date.now()
const body = b64(Buffer.from(JSON.stringify({
  version: 1,
  authority: AUTHORITY,
  issuedAt,
  expiresAt: issuedAt + 30 * 24 * 3600 * 1000,
}), 'utf8'))
const cookieValue = `v1.${body}.${b64(createHmac('sha256', secret).update(body).digest())}`
const cookieName = `dsh-auth-${b64(createHash('sha256').update(AUTHORITY).digest())}`

/* ---------- 2) 极简 CDP 客户端 ---------- */
const version = await (await fetch(`${CDP}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })

let seq = 0
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id === undefined || !pending.has(msg.id)) return
  const { resolve, reject, timer } = pending.get(msg.id)
  pending.delete(msg.id)
  clearTimeout(timer)
  if (msg.error) reject(new Error(JSON.stringify(msg.error)))
  else resolve(msg.result)
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq
  // 每个调用都设超时，避免单个无响应的请求挂住整个脚本
  const timer = setTimeout(() => {
    pending.delete(id)
    reject(new Error(`CDP 调用超时: ${method}`))
  }, 30000)
  pending.set(id, { resolve, reject, timer })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------- 3) 建页面、注入 cookie ---------- */
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const call = (method, params) => send(method, params, sessionId)
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.result?.value
}

await call('Network.enable')
await call('Page.enable')
await call('Runtime.enable')
await call('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 940, deviceScaleFactor: 2, mobile: false,
})
if (DARK) {
  await call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
}
await call('Network.setCookie', {
  name: cookieName, value: cookieValue, url: BASE, path: '/', httpOnly: true, sameSite: 'Strict',
})

/* ---------- 4) 打开 GUI ---------- */
await call('Page.navigate', { url: BASE })
await sleep(7000)
if (DARK) {
  // DSH 用 body[data-ds-dark-theme] 表达深色主题，必要时手动设置
  await evaluate(`document.body.setAttribute('data-ds-dark-theme','')`)
  await sleep(600)
}

/* ---------- 5) 展开模型下拉 ---------- */
const clicked = await evaluate(`(() => {
  const trigger = document.querySelector('.mss-trigger')
  if (trigger === null) return 'no-trigger'
  trigger.click()
  return 'clicked'
})()`)
console.log('展开下拉 ->', clicked)
await sleep(3000)

/* ---------- 6) 计算裁剪区域：菜单 + 触发器 ---------- */
const clipJson = await evaluate(`(() => {
  const menu = document.querySelector('.mss-menu')
  const trigger = document.querySelector('.mss-trigger')
  if (menu === null || trigger === null) return null
  const a = menu.getBoundingClientRect()
  const b = trigger.getBoundingClientRect()
  const pad = 26
  const x = Math.max(0, Math.min(a.left, b.left) - pad)
  const y = Math.max(0, Math.min(a.top, b.top) - pad)
  const right = Math.min(innerWidth, Math.max(a.right, b.right) + pad)
  const bottom = Math.min(innerHeight, Math.max(a.bottom, b.bottom) + pad)
  return JSON.stringify({
    x: Math.round(x), y: Math.round(y),
    width: Math.round(right - x), height: Math.round(bottom - y),
    groups: document.querySelectorAll('.mss-group-name').length,
    rows: document.querySelectorAll('.mss-row').length,
  })
})()`)
if (clipJson === null || clipJson === undefined) {
  console.log('诊断 ->', await evaluate(`JSON.stringify({
    url: location.href,
    trigger: document.querySelector('.mss-trigger') !== null,
    menu: document.querySelector('.mss-menu') !== null,
  })`))
  throw new Error('未能定位菜单或触发器：确认插件已加载且下拉可以打开')
}
const box = JSON.parse(clipJson)
console.log('分组数 ->', box.groups, '/ 模型行数 ->', box.rows)

/* ---------- 7) 截图（裁剪到聚焦区域） ---------- */
const shot = await call('Page.captureScreenshot', {
  format: 'png',
  clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
})
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(`已保存 ${OUT}（${box.width}x${box.height} @2x）`)

ws.close()
process.exit(0)
