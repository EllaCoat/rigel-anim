// The vanilla Minecraft client (version from bench/target.ts) for screenshots, kept with the benchmark
// server under ROOT and away from the player's own .minecraft and launcher. The jar, libraries and assets
// come from Mojang's servers, checked against their SHA-1, and the client starts in offline mode straight
// from java. mc-shot.ts drives it through the server's console and keys posted to its window (Windows only).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { dlopen, FFIType, ptr } from 'bun:ffi'
import { fetchVerified, javaPath, MC_VERSION, Output, ROOT } from '../bench/mc'

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const RESOURCES = 'https://resources.download.minecraft.net'

export const CLIENT_DIR = join(ROOT, `client-${MC_VERSION}`)
export const GAME_DIR = join(CLIENT_DIR, 'game')
const LIBRARIES = join(CLIENT_DIR, 'libraries')
const ASSETS = join(CLIENT_DIR, 'assets')
const NATIVES = join(CLIENT_DIR, 'natives')
const VERSION_JSON = join(CLIENT_DIR, `${MC_VERSION}.json`)
const CLIENT_JAR = join(CLIENT_DIR, `${MC_VERSION}.jar`)
export const PLAYER = 'RigelShot'

interface Download {
	url: string
	sha1: string
	path: string
}

interface Library {
	name: string
	downloads: { artifact?: { url: string; sha1: string; path: string } }
	rules?: { action: 'allow' | 'disallow'; os?: { name?: string } }[]
}

interface VersionJson {
	mainClass: string
	assetIndex: { id: string; url: string; sha1: string }
	downloads: { client: { url: string; sha1: string } }
	libraries: Library[]
}

const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex')

async function download({ url, sha1: expected, path }: Download): Promise<void> {
	if (existsSync(path) && sha1(readFileSync(path)) === expected) return
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, await fetchVerified(url, 'sha1', expected))
}

async function downloadAll(items: Download[], parallel = 16): Promise<void> {
	let next = 0
	await Promise.all(Array.from({ length: parallel }, async () => {
		while (next < items.length) await download(items[next++]!)
	}))
}

// Windows x64: the libraries without rules plus those allowed on Windows, minus the arm64 and x86 natives
// (the rules do not tell architectures apart).
function onWindows(library: Library): boolean {
	if (/:natives-windows-(arm64|x86)$/.test(library.name)) return false
	let allowed = !library.rules
	for (const rule of library.rules ?? []) if (!rule.os || rule.os.name === 'windows') allowed = rule.action === 'allow'
	return allowed
}

function readVersion(): VersionJson {
	if (!existsSync(VERSION_JSON)) throw new Error(`no client in ${CLIENT_DIR}; run \`bun scripts/mc-shot.ts setup\``)
	return JSON.parse(readFileSync(VERSION_JSON, 'utf8'))
}

const libraryJars = (version: VersionJson) =>
	version.libraries.filter(onWindows).flatMap((l) => (l.downloads.artifact ? [l.downloads.artifact] : []))

export async function setupClient(): Promise<void> {
	const manifest = await (await fetch(VERSION_MANIFEST)).json()
	const entry = manifest.versions.find((v: { id: string }) => v.id === MC_VERSION)
	if (!entry) throw new Error(`${MC_VERSION} is not in the version manifest`)
	await download({ url: entry.url, sha1: entry.sha1, path: VERSION_JSON })
	const version = readVersion()
	await download({ ...version.downloads.client, path: CLIENT_JAR })
	await downloadAll(libraryJars(version).map((a) => ({ ...a, path: join(LIBRARIES, a.path) })))

	const indexPath = join(ASSETS, 'indexes', `${version.assetIndex.id}.json`)
	await download({ ...version.assetIndex, path: indexPath })
	const objects: Record<string, { hash: string }> = JSON.parse(readFileSync(indexPath, 'utf8')).objects
	// Sounds are most of the download (about 550 of 655 MB for 1.20.4) and a screenshot needs none; the
	// client logs a warning for each missing file and plays nothing.
	const wanted = Object.entries(objects).filter(([name]) => !name.startsWith('minecraft/sounds/'))
	await downloadAll(wanted.map(([, { hash }]) => ({
		url: `${RESOURCES}/${hash.slice(0, 2)}/${hash}`,
		sha1: hash,
		path: join(ASSETS, 'objects', hash.slice(0, 2), hash),
	})))
	mkdirSync(GAME_DIR, { recursive: true })
	console.log(JSON.stringify({ client: CLIENT_DIR, libraries: libraryJars(version).length, assets: wanted.length }))
}

// Written before every launch, so a run never depends on what an earlier one left. The FOV and its effects
// are fixed so the vertical field of view is exactly FOV (shot-spec.ts); the rest keeps first-run screens,
// pausing and sounds out of the way.
function writeOptions(resourcePacks: string[]): void {
	const options = {
		version: 3700,
		lang: 'en_us',
		fov: 0.0, // stored as (fov - 70) / 40
		fovEffectScale: 0.0,
		screenEffectScale: 0.0,
		bobView: false,
		pauseOnLostFocus: false,
		onboardAccessibility: false,
		tutorialStep: 'none',
		joinedFirstServer: true,
		skipMultiplayerWarning: true,
		realmsNotifications: false,
		narrator: 0,
		soundCategory_master: 0.0,
		resourcePacks: JSON.stringify(['vanilla', ...resourcePacks.map((p) => `file/${p}`)]),
	}
	writeFileSync(join(GAME_DIR, 'options.txt'), Object.entries(options).map(([k, v]) => `${k}:${v}`).join('\n') + '\n')
}

const WM_CLOSE = 0x0010
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
export const KEY_F1 = { vk: 0x70, scancode: 0x3b }
export const KEY_F2 = { vk: 0x71, scancode: 0x3c }

const user32 = dlopen('user32.dll', {
	FindWindowExW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
	GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
	PostMessageW: { args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64], returns: FFIType.i32 },
})
const GLFW_CLASS = Buffer.from('GLFW30\0', 'utf16le')

function findWindow(pid: number) {
	const owner = new Uint32Array(1)
	let hwnd = null
	while ((hwnd = user32.symbols.FindWindowExW(null, hwnd, ptr(GLFW_CLASS), null))) {
		user32.symbols.GetWindowThreadProcessId(hwnd, ptr(owner))
		if (owner[0] === pid) return hwnd
	}
	return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class Client {
	private proc: ChildProcessWithoutNullStreams
	readonly output: Output
	private window: ReturnType<typeof findWindow> = null

	private constructor(args: string[]) {
		this.proc = spawn(javaPath(), args, { cwd: GAME_DIR })
		this.output = new Output(this.proc, 'client')
	}

	// `server` is host:port; `resourcePacks` are folder names under GAME_DIR/resourcepacks.
	static launch(options: { server: string; width: number; height: number; resourcePacks: string[] }): Client {
		const version = readVersion()
		writeOptions(options.resourcePacks)
		const classpath = [...libraryJars(version).map((a) => join(LIBRARIES, a.path)), CLIENT_JAR].join(delimiter)
		return new Client([
			'-Xmx2G',
			`-Djava.library.path=${NATIVES}`,
			`-Dorg.lwjgl.system.SharedLibraryExtractPath=${NATIVES}`,
			`-Djna.tmpdir=${NATIVES}`,
			`-Dio.netty.native.workdir=${NATIVES}`,
			'-cp', classpath,
			version.mainClass,
			'--username', PLAYER,
			'--version', MC_VERSION,
			'--gameDir', GAME_DIR,
			'--assetsDir', ASSETS,
			'--assetIndex', version.assetIndex.id,
			'--accessToken', '0',
			'--versionType', 'release',
			'--width', String(options.width),
			'--height', String(options.height),
			'--quickPlayMultiplayer', options.server,
		])
	}

	// GLFW reads key messages from its queue whether or not the window has focus, so posting them needs
	// neither the foreground nor a real keyboard.
	async press(key: { vk: number; scancode: number }): Promise<void> {
		this.window ??= findWindow(this.proc.pid!)
		if (!this.window) throw new Error('the client window was not found')
		const lParam = 1 | (key.scancode << 16)
		user32.symbols.PostMessageW(this.window, WM_KEYDOWN, key.vk, lParam)
		await sleep(100)
		user32.symbols.PostMessageW(this.window, WM_KEYUP, key.vk, lParam | (1 << 30) | 2 ** 31)
	}

	// F2 makes the client save its frame to GAME_DIR/screenshots and say so in the chat, which it also logs.
	async screenshot(): Promise<string> {
		const saved = this.output.waitFor(/Saved screenshot as (\S+\.png)/, 30_000)
		await this.press(KEY_F2)
		return join(GAME_DIR, 'screenshots', (await saved)[1]!)
	}

	// Closing the window lets the client shut down as when the person closes it; it is killed if that hangs.
	async stop(): Promise<void> {
		if (this.window) user32.symbols.PostMessageW(this.window, WM_CLOSE, 0, 0)
		else this.proc.kill()
		let timer: Timer | undefined
		const timeout = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), 30_000)))
		const exited = await Promise.race([this.output.exited.then(() => true), timeout])
		clearTimeout(timer)
		if (!exited) {
			this.proc.kill()
			await this.output.exited
		}
	}
}
