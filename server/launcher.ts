// Starting Wiener Lens without a terminal, on macOS. Both pieces run the same command: the
// published package through npx, in the background, so it stays up to date and never opens a
// browser tab of its own.
//
// - The launcher: a small app in ~/Library/Application Support/Wiener Lens that answers
//   wiener-lens:// links. The installed dashboard's "not running" page has a button that opens one.
//   On by default; Settings turns it off, which removes the app.
// - Start at login: a LaunchAgent in ~/Library/LaunchAgents. Off by default; Settings turns it on.
//
// Neither touches ~/.claude. Each can be removed again from Settings.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PACKAGE } from '../shared/product.ts'
import type { StartupSettings } from '../shared/types.ts'
import { dataDir } from './paths.ts'

export const SCHEME = 'wiener-lens'
const LABEL = 'xyz.wienerlabs.lens'
const APP_NAME = 'Wiener Lens Launcher'

export const supported = (): boolean => process.platform === 'darwin'

const appPath = () => path.join(os.homedir(), 'Library', 'Application Support', 'Wiener Lens', `${APP_NAME}.app`)
const agentPath = () => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const prefsFile = () => path.join(dataDir(), 'startup.json')
const logFile = () => path.join(dataDir(), 'server.log')
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/**
 * The folder with node and npx, so the command works without the person's shell profile. A stable
 * one first: Homebrew's versioned folder is gone after the next upgrade.
 */
function nodeBin(): string {
  const has = (dir: string) => fs.existsSync(path.join(dir, 'node')) && fs.existsSync(path.join(dir, 'npx'))
  return ['/opt/homebrew/bin', '/usr/local/bin', path.dirname(process.execPath)].find(has) ?? path.dirname(process.execPath)
}

/**
 * The shell command both pieces run: the latest package, in the background, logging to our folder.
 * Started from the app's button it may close again once the app's windows are gone (Settings
 * decides); started at login it stays up.
 */
export function startCommand(quitWhenClosed = true): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  // WIENER_LAUNCHER_PACKAGE points at a local tarball while developing; people get the published package.
  const pkg = process.env.WIENER_LAUNCHER_PACKAGE || PACKAGE
  const bin = nodeBin()
  // A data folder set for this run goes along, so the started dashboard reads the same index.
  const data = process.env.WIENER_DATA_DIR ? `WIENER_DATA_DIR=${q(path.resolve(dataDir()))} ` : ''
  return `mkdir -p ${q(dataDir())} && ${data}PATH=${q(bin)}:"$PATH" ${q(path.join(bin, 'npx'))} -y --package=${q(pkg)} ${PACKAGE} --background${quitWhenClosed ? ' --quit-when-closed' : ''} >> ${q(logFile())} 2>&1`
}

function readPrefs(): Partial<StartupSettings> {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as Partial<StartupSettings>
  } catch {
    return {}
  }
}

function writePrefs(prefs: Partial<StartupSettings>): void {
  fs.mkdirSync(dataDir(), { recursive: true })
  fs.writeFileSync(prefsFile(), `${JSON.stringify({ ...readPrefs(), ...prefs }, null, 2)}\n`)
}

/** On unless turned off: what someone who quits the app with Cmd+Q expects. */
export const quitWhenClosedPref = (): boolean => readPrefs().quitWhenClosed !== false

export function startupSettings(): StartupSettings & { supported: boolean } {
  return {
    supported: supported(),
    launcher: supported() && fs.existsSync(appPath()),
    autostart: supported() && fs.existsSync(agentPath()),
    quitWhenClosed: quitWhenClosedPref(),
  }
}

// ---- the launcher app ------------------------------------------------------------------------

const run = (file: string, args: string[]) => execFileSync(file, args, { stdio: 'ignore', timeout: 30_000 })

/** The AppleScript the launcher runs, for a double click and for a wiener-lens:// link alike. */
function launcherScript(): string {
  const command = `(${startCommand()}) > /dev/null 2>&1 &`.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [`on run`, `  do shell script "${command}"`, `end run`, `on open location u`, `  do shell script "${command}"`, `end open location`].join('\n')
}

export function installLauncher(): void {
  const target = appPath()
  const script = launcherScript()
  const stamp = path.join(target, 'Contents', 'Resources', 'wiener-lens.txt')
  // Already there with the same command (the node or npx path can change between installs).
  try {
    if (fs.readFileSync(stamp, 'utf8') === script) return
  } catch {
    // Not installed yet.
  }
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'wiener-launcher-'))
  try {
    const source = path.join(build, 'launcher.applescript')
    const app = path.join(build, `${APP_NAME}.app`)
    fs.writeFileSync(source, script)
    run('/usr/bin/osacompile', ['-o', app, source])
    const plist = path.join(app, 'Contents', 'Info.plist')
    const set = (key: string, type: string, value: string) => {
      try {
        run('/usr/bin/plutil', ['-replace', key, type, value, plist])
      } catch {
        run('/usr/bin/plutil', ['-insert', key, type, value, plist])
      }
    }
    set('CFBundleIdentifier', '-string', `${LABEL}.launcher`)
    set('CFBundleName', '-string', APP_NAME)
    // No Dock icon: it starts the server and quits.
    set('LSUIElement', '-bool', 'YES')
    set('CFBundleURLTypes', '-json', JSON.stringify([{ CFBundleURLName: 'Wiener Lens', CFBundleURLSchemes: [SCHEME] }]))
    fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'wiener-lens.txt'), script)
    // The edited Info.plist no longer matches the bundle's seal; sign it again, ad hoc.
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(app, target)
    run(LSREGISTER, ['-f', target])
  } finally {
    fs.rmSync(build, { recursive: true, force: true })
  }
}

export function removeLauncher(): void {
  const target = appPath()
  if (!fs.existsSync(target)) return
  try {
    run(LSREGISTER, ['-u', target])
  } catch {
    // Already unknown to Launch Services.
  }
  fs.rmSync(target, { recursive: true, force: true })
}

// ---- start at login ----------------------------------------------------------------------------

function agentPlist(): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${esc(startCommand(false))}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`
}

const gui = () => `gui/${process.getuid?.() ?? 501}`

export function enableAutostart(): void {
  const file = agentPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, agentPlist())
  try {
    run('/bin/launchctl', ['bootout', `${gui()}/${LABEL}`])
  } catch {
    // Not loaded.
  }
  // Loading runs it once now; with the dashboard already up, that run sees it and exits.
  run('/bin/launchctl', ['bootstrap', gui(), file])
}

export function disableAutostart(): void {
  try {
    run('/bin/launchctl', ['bootout', `${gui()}/${LABEL}`])
  } catch {
    // Not loaded.
  }
  fs.rmSync(agentPath(), { force: true })
}

// ---- settings -----------------------------------------------------------------------------------

/** At startup: the launcher is on unless the person turned it off; kept current with this node and npx. */
export function setUpLauncher(): void {
  if (!supported() || readPrefs().launcher === false) return
  try {
    installLauncher()
  } catch {
    // Without osacompile or a writable Library the dashboard still works; the page shows the command.
  }
}

export function updateStartup(patch: Partial<StartupSettings>): StartupSettings & { supported: boolean } {
  if (!supported()) return startupSettings()
  if (patch.launcher !== undefined) {
    if (patch.launcher) installLauncher()
    else removeLauncher()
    writePrefs({ launcher: patch.launcher })
  }
  if (patch.autostart !== undefined) {
    if (patch.autostart) enableAutostart()
    else disableAutostart()
  }
  // Read by the running server when its last window closes, so it applies right away.
  if (patch.quitWhenClosed !== undefined) writePrefs({ quitWhenClosed: patch.quitWhenClosed })
  return startupSettings()
}
