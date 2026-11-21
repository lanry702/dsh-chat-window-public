/**
 * Chat Focus — host half.
 *
 * Opens the chat in a window of its own. Two routes to that window, in order:
 *
 * 1. A window this process creates, when the host reaches the Electron API. It
 *    carries whatever icon we hand over.
 * 2. A browser in app mode (`--app=`), which renders one page with no tab strip,
 *    no address bar and no harness chrome. Chromium builds that window's icon
 *    from a 32 px favicon and upscales it, so the taskbar button is soft on a
 *    scaled display; `icon-apply.ps1` replaces it on every launch.
 *
 * Either way the window loads a wrapper page rather than /webchat/ directly: the
 * wrapper carries the icon links and a window title (the chat bundle ships
 * neither, so the title bar showed a generic globe), and it fills the window
 * edge to edge, which is what makes it read as one surface.
 *
 * Children are started through `ctx.subprocess`, not `child_process`: direct
 * spawns from a Host plugin are wrapped and never run in this build. The service
 * also owns them, so closing the harness takes the window with it.
 *
 * The open route only opens a local window, so it demands a marker header: a
 * cross-origin page cannot send that header without a CORS preflight, which this
 * route never approves.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export const name = 'chat-focus'
export const inject = ['webServer', 'subprocess']

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const ICON_PATH = fileURLToPath(new URL('./icon.png', import.meta.url))
const ICON_32_PATH = fileURLToPath(new URL('./icon-32.png', import.meta.url))
const ICO_PATH = fileURLToPath(new URL('./favicon.ico', import.meta.url))
const APPLY_SCRIPT = fileURLToPath(new URL('./icon-apply.ps1', import.meta.url))

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DeepSeek</title>
<link rel="icon" type="image/png" sizes="512x512" href="/chat-focus/icon.png?v=11">
<link rel="icon" type="image/png" sizes="32x32" href="/chat-focus/icon-32.png?v=11">
<link rel="apple-touch-icon" href="/chat-focus/icon.png?v=11">
<style>
  html, body { height: 100%; margin: 0; padding: 0; background: #fff; overflow: hidden; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  /* Only shown in kiosk mode: without a title bar there is no other way out. */
  #exit {
    position: fixed; right: 18px; bottom: 18px; z-index: 9;
    height: 30px; padding: 0 14px; border-radius: 15px; cursor: pointer;
    border: 1px solid rgba(0,0,0,.14); background: rgba(255,255,255,.95);
    box-shadow: 0 2px 10px rgba(0,0,0,.12); color: #3a3a3a;
    font: 13px/28px system-ui, sans-serif; opacity: .55;
  }
  #exit:hover { opacity: 1; }
</style>
</head>
<body>
<iframe id="chat" src="/webchat/" title="DeepSeek Chat" allow="clipboard-write"></iframe>
<script>
  (function () {
    var button = document.createElement('button');
    button.id = 'exit';
    button.type = 'button';
    button.textContent = '\u9000\u51fa Chat \u00b7 Esc';
    button.addEventListener('click', function () { window.close(); });
    document.body.appendChild(button);
    var onKey = function (event) {
      if (event.key === 'Escape') { event.preventDefault(); window.close(); }
    };
    window.addEventListener('keydown', onKey, true);
    var frame = document.getElementById('chat');
    frame.addEventListener('load', function () {
      try { frame.contentWindow.addEventListener('keydown', onKey, true); } catch (e) {}
    });
  })();
</script>
</body>
</html>`

function pickBrowser() {
  return BROWSERS.find((candidate) => {
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  })
}

// undefined = not probed yet, null = the host does not expose Electron.
let probedElectron
const nativeWindows = []
const children = []

function electronApi() {
  if (probedElectron !== undefined) return probedElectron
  probedElectron = null
  try {
    const requireFromApp = createRequire(process.execPath)
    const electron = requireFromApp('electron')
    if (typeof electron?.BrowserWindow === 'function') probedElectron = electron
  } catch {
    // Not the desktop shell; the browser route below still works.
  }
  return probedElectron
}

function openNativeWindow(electron, target) {
  const { BrowserWindow } = electron
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'DeepSeek',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: ICO_PATH,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  window.setMenuBarVisibility?.(false)
  nativeWindows.push(window)
  window.on('closed', () => {
    const at = nativeWindows.indexOf(window)
    if (at !== -1) nativeWindows.splice(at, 1)
  })
  void window.loadURL(target)
  return window
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length === 0 ? {} : JSON.parse(raw)
}

function serveIcon(res, file = ICON_PATH, type = 'image/png') {
  let bytes
  try {
    bytes = fs.readFileSync(file)
  } catch {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'public, max-age=86400',
    'content-length': bytes.length,
  })
  res.end(bytes)
}

/** Start a child the Host owns, so the window cannot outlive the harness. */
function spawnManaged(ctx, argv, options = {}) {
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: options.cwd ?? os.homedir(),
    stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
    graceMs: options.graceMs ?? 2000,
  })
  if (options.keep !== false) children.push(handle)
  return handle
}

function openWindow(ctx, body, req, res) {
  // Derive the target from the request's own Host header: the page's
  // `location.origin` proved unreliable through the desktop shell, and a
  // loopback Host is all this route needs in order to be safe.
  const host = String(req.headers.host ?? '')
  const origin = /^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host)
    ? `http://${host}`
    : String(body.origin ?? '').replace(/\/+$/u, '')
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(origin)) {
    sendJson(res, { ok: false, error: `unexpected origin: ${origin || '(empty)'}` }, 400)
    return
  }
  const target = `${origin}/chat-focus/window`

  const electron = electronApi()
  if (electron !== undefined) {
    try {
      openNativeWindow(electron, target)
      console.log(`[chat-focus] opened ${target} in a native window`)
      sendJson(res, { ok: true, window: 'native', target })
      return
    } catch (error) {
      console.error('[chat-focus] native window failed, using a browser:', error)
    }
  }

  const browser = pickBrowser()
  if (browser === undefined) {
    sendJson(res, { ok: false, error: 'no native window and no Edge or Chrome' }, 500)
    return
  }
  // A dedicated profile is what makes --window-size stick: with the user's main
  // profile, Edge restores the app window's last geometry and ignores the flag.
  // It also keeps this window's chat history out of the user's normal browsing
  // profile, and starts with an empty favicon cache.
  let profileDir
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    profileDir = path.join(home, 'chat-focus-profile')
    fs.mkdirSync(profileDir, { recursive: true })
  } catch {
    profileDir = undefined
  }

  try {
    const args = [
      `--app=${target}`,
      '--window-size=1280,820',
      '--no-first-run',
      '--no-default-browser-check',
    ]
    if (profileDir !== undefined) args.push(`--user-data-dir=${profileDir}`)
    spawnManaged(ctx, [browser, ...args])
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
    return
  }

  // Only on this route: the browser never asked what its icon should be, so the
  // real .ico has to go into both icon slots once the window exists.
  if (profileDir !== undefined) {
    try {
      spawnManaged(ctx, [
        'powershell.exe',
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', APPLY_SCRIPT,
        '-ProfileMarker', profileDir,
        '-Icon', ICO_PATH,
        '-LogPath', path.join(path.dirname(ICO_PATH), 'apply.log'),
      ], { cwd: path.dirname(ICO_PATH), graceMs: 30000 })
    } catch (error) {
      console.error('[chat-focus] icon apply failed to start:', error)
    }
  }

  console.log(`[chat-focus] opened ${target} in ${browser}`)
  sendJson(res, { ok: true, browser, target })
}

export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/chat-focus',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = url.pathname.replace(/\/+$/u, '')
      const method = (req.method ?? 'GET').toUpperCase()

      if (pathname === '/chat-focus/open') {
        if (method !== 'POST') {
          sendJson(res, { ok: false, error: 'POST only' }, 405)
          return
        }
        if (req.headers['x-chat-focus'] !== '1') {
          sendJson(res, { ok: false, error: 'marker header required' }, 403)
          return
        }
        let body = {}
        try {
          body = await readJson(req)
        } catch {
          sendJson(res, { ok: false, error: 'bad json' }, 400)
          return
        }
        openWindow(ctx, body, req, res)
        return
      }

      if (pathname === '/chat-focus/window' && (method === 'GET' || method === 'HEAD')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(PAGE),
        })
        res.end(method === 'HEAD' ? undefined : PAGE)
        return
      }

      if (pathname === '/chat-focus/icon.png') {
        serveIcon(res)
        return
      }

      if (pathname === '/chat-focus/favicon.ico') {
        serveIcon(res, ICO_PATH, 'image/x-icon')
        return
      }

      if (pathname === '/chat-focus/icon-32.png') {
        serveIcon(res, ICON_32_PATH)
        return
      }

      res.writeHead(404).end('not found')
    },
  }), 'chat-focus.routes')

  ctx.effect(() => () => {
    for (const window of nativeWindows.splice(0)) {
      try { window.destroy() } catch {}
    }
    // The browser is the window's owner; nothing else would end it when the
    // harness goes away.
    for (const child of children.splice(0)) {
      try { child.terminate() } catch {}
    }
  }, 'chat-focus.windows')
}
