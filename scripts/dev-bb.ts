// Development Blockbench (Windows): the official 5.2.1 release unpacked into its own folder with its
// own data folder, so plugin checks never touch the Blockbench installation used for real work.
// Needs 7-Zip (SEVEN_ZIP overrides its path).
//
//   bun scripts/dev-bb.ts setup [--force]   download the portable build, verify its SHA-256, unpack it, disable its updater
//   bun scripts/dev-bb.ts launch [files...]  start it with a 127.0.0.1-only DevTools port
//   bun scripts/dev-bb.ts install            (re)load dist/rigel.js and report errors logged while loading
//   bun scripts/dev-bb.ts eval "<code>"      evaluate async code in the renderer and print the result
//   bun scripts/dev-bb.ts stop               close it without saving
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const VERSION = '5.2.1'
const ASSET = `Blockbench_${VERSION}_portable.exe`
const SEVEN_ZIP = process.env.SEVEN_ZIP ?? 'C:\\Program Files\\7-Zip\\7z.exe'
const RELEASE_API = `https://api.github.com/repos/JannisX11/blockbench/releases/tags/v${VERSION}`
const DEV_ROOT = process.env.BB_DEV_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'rigel-anim', `blockbench-${VERSION}`)
const APP = join(DEV_ROOT, 'app')
const USER_DATA = join(DEV_ROOT, 'userdata')
const PLUGINS = join(USER_DATA, 'plugins')
const PORT = Number(process.env.BB_DEV_PORT ?? 9467)
const REPO = resolve(import.meta.dir, '..')
const PLUGIN_ID = 'rigel'

function sevenZip(args: string[]): void {
	const result = spawnSync(SEVEN_ZIP, [...args, '-y'], { stdio: ['ignore', 'ignore', 'inherit'] })
	if (result.error || result.status !== 0) throw new Error(`7-Zip failed (${SEVEN_ZIP} ${args.join(' ')}): ${result.error?.message ?? `exit ${result.status}`}`)
}

async function download(): Promise<void> {
	if (!existsSync(SEVEN_ZIP)) throw new Error(`7-Zip not found at ${SEVEN_ZIP}; set SEVEN_ZIP`)
	const release = await (await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })).json()
	const asset = release.assets?.find((a: { name: string }) => a.name === ASSET)
	if (!asset?.digest?.startsWith('sha256:')) throw new Error(`${ASSET} or its sha256 digest is missing from release v${VERSION}`)
	const response = await fetch(asset.browser_download_url)
	if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
	const bytes = Buffer.from(await response.arrayBuffer())
	const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
	if (actual !== asset.digest) throw new Error(`${ASSET}: expected ${asset.digest}, got ${actual}`)

	// The Windows installer would register itself as the same app as the installed Blockbench, so the
	// app is taken from the portable build instead: an NSIS archive that wraps $PLUGINSDIR/app-64.7z.
	const staging = join(DEV_ROOT, 'app.tmp')
	rmSync(staging, { recursive: true, force: true })
	mkdirSync(staging, { recursive: true })
	const portable = join(staging, ASSET)
	writeFileSync(portable, bytes)
	sevenZip(['e', portable, '$PLUGINSDIR/app-64.7z', `-o${staging}`])
	sevenZip(['x', join(staging, 'app-64.7z'), `-o${join(staging, 'app')}`])
	if (!existsSync(join(staging, 'app', 'Blockbench.exe'))) throw new Error(`Blockbench.exe not found in ${ASSET}`)
	rmSync(APP, { recursive: true, force: true })
	renameSync(join(staging, 'app'), APP)
	rmSync(staging, { recursive: true, force: true })
}

async function setup(force: boolean): Promise<void> {
	if (force || !existsSync(join(APP, 'Blockbench.exe'))) await download()
	// Without app-update.yml electron-updater cannot check for, download or install updates.
	rmSync(join(APP, 'resources', 'app-update.yml'), { force: true })
	mkdirSync(PLUGINS, { recursive: true })
	console.log(JSON.stringify({ app: APP, userData: USER_DATA, updaterConfig: existsSync(join(APP, 'resources', 'app-update.yml')) }, null, 1))
}

async function target(): Promise<string> {
	const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
	const page = list.find((t: any) => t.type === 'page' && /index\.html/.test(t.url)) ?? list.find((t: any) => t.type === 'page')
	if (!page) throw new Error('no Blockbench page target')
	return page.webSocketDebuggerUrl
}

async function cdp(url: string, method: string, params: unknown): Promise<any> {
	const socket = new WebSocket(url)
	await new Promise((ok, fail) => {
		socket.onopen = ok
		socket.onerror = () => fail(new Error(`cannot connect to ${url}`))
	})
	try {
		return await new Promise((ok, fail) => {
			socket.onclose = () => fail(new Error('DevTools connection closed before the response'))
			socket.onmessage = (event) => {
				const message = JSON.parse(String(event.data))
				if (message.id !== 1) return
				if (message.error) fail(new Error(message.error.message))
				else ok(message.result)
			}
			socket.send(JSON.stringify({ id: 1, method, params }))
		})
	} finally {
		socket.close()
	}
}

async function evaluate(code: string): Promise<any> {
	const expression = `(async () => { ${code} })()`
	const result = await cdp(await target(), 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
	return result.result.value
}

async function waitReady(timeoutMs = 90_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		try {
			if (await evaluate(`return typeof BarItems === 'object' && !!BarItems.save_project && typeof Plugins === 'object'`)) return
		} catch {
			// DevTools endpoint not up yet.
		}
		await new Promise((r) => setTimeout(r, 500))
	}
	throw new Error('development Blockbench did not become ready')
}

async function launch(files: string[]): Promise<void> {
	if (!existsSync(join(APP, 'Blockbench.exe'))) throw new Error('run `bun scripts/dev-bb.ts setup` first')
	const args = ['--userData', USER_DATA, `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', ...files.map((f) => resolve(f))]
	const child = spawn(join(APP, 'Blockbench.exe'), args, { detached: true, stdio: 'ignore' })
	child.unref()
	await waitReady()
	const version = await evaluate(`return Blockbench.version`)
	console.log(JSON.stringify({ pid: child.pid, port: PORT, version, userData: USER_DATA }))
}

async function install(): Promise<void> {
	const source = join(REPO, 'dist', `${PLUGIN_ID}.js`)
	if (!existsSync(source)) throw new Error(`missing ${source}; run \`bun run build\` first`)
	const file = join(PLUGINS, `${PLUGIN_ID}.js`)
	copyFileSync(source, file)
	const result = await evaluate(`
		const errors = []
		const originalError = console.error
		console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
		const onError = (event) => errors.push(String(event.reason ?? event.message ?? event))
		window.addEventListener('error', onError)
		window.addEventListener('unhandledrejection', onError)
		try {
			// Plugin.reload() does not wait for the new load and then reads about.md next to the file,
			// which logs an error for every file plugin. Uninstalling (keeps the file) and loading again
			// keeps the whole load inside this error capture.
			Plugins.registered[${JSON.stringify(PLUGIN_ID)}]?.uninstall()
			await new BBPlugin().loadFromFile({ path: ${JSON.stringify(file)}, name: ${JSON.stringify(file)}, content: '' }, false)
		} finally {
			console.error = originalError
			window.removeEventListener('error', onError)
			window.removeEventListener('unhandledrejection', onError)
		}
		const plugin = Plugins.registered[${JSON.stringify(PLUGIN_ID)}]
		return { installed: !!plugin?.installed, version: plugin?.version ?? null, disabled: !!plugin?.disabled, errors }
	`)
	console.log(JSON.stringify(result, null, 1))
	if (!result.installed || result.errors.length > 0) process.exitCode = 1
}

async function stop(): Promise<void> {
	// Unsaved projects would open Blockbench's "unsaved work" dialog, which nobody can answer in a
	// hidden session. The development instance only holds throwaway projects, so they are closed without saving.
	const discarded: string[] = await evaluate(`
		if (Dialog.open?.id === 'close') Dialog.open.close()
		const unsaved = ModelProject.all.filter((p) => !p.saved).map((p) => p.name)
		for (const p of ModelProject.all) p.saved = true
		setTimeout(() => window.close(), 50)
		return unsaved
	`)
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 500))
		try {
			await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) })
		} catch {
			console.log(discarded.length ? `closed without saving: ${discarded.join(', ')}` : 'closed')
			return
		}
	}
	throw new Error('development Blockbench is still running')
}

const [command, ...args] = process.argv.slice(2)
try {
	if (command === 'setup') await setup(args.includes('--force'))
	else if (command === 'launch') await launch(args)
	else if (command === 'install') await install()
	else if (command === 'eval') console.log(JSON.stringify(await evaluate(args.join(' ')), null, 1))
	else if (command === 'stop') await stop()
	else {
		console.error('usage: bun scripts/dev-bb.ts setup [--force] | launch [files...] | install | eval "<code>" | stop')
		process.exitCode = 64
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
}
