// A vanilla dedicated server for benchmarks (version from target.ts), kept outside the repository and
// away from the player's own Minecraft folder. Commands go through the server's stdin and results are
// read from its log lines, so only a server started by this module can be driven.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { TARGET } from './target'

export const MC_VERSION = TARGET.version
// The runtime Mojang's launcher uses for this version.
const JAVA_MAJOR = TARGET.javaMajor
const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const ADOPTIUM = `https://api.adoptium.net/v3/assets/latest/${JAVA_MAJOR}/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse`

export const ROOT = process.env.RIGEL_BENCH_ROOT ?? join(homedir(), '.local', 'state', 'rigel-anim')
export const SERVER_DIR = join(ROOT, `mc-${MC_VERSION}`)
export const WORLD = join(SERVER_DIR, 'world')
const JAVA_DIR = join(ROOT, 'java')
const HEAP = process.env.RIGEL_BENCH_HEAP ?? '4G'

const PROPERTIES = {
	'server-ip': '127.0.0.1',
	'online-mode': 'false',
	'level-type': 'minecraft\\:flat',
	'generate-structures': 'false',
	difficulty: 'peaceful',
	'spawn-monsters': 'false',
	'spawn-animals': 'false',
	'spawn-npcs': 'false',
	'spawn-protection': '0',
	'view-distance': '4',
	'simulation-distance': '4',
	// Long /tick sprint runs would otherwise trip the watchdog.
	'max-tick-time': '-1',
	// 1.21.2+ stops ticking after this many seconds without players unless it is 0.
	'pause-when-empty-seconds': '0',
	'enable-rcon': 'false',
	'enable-query': 'false',
	motd: 'rigel-anim bench',
}

async function fetchVerified(url: string, algorithm: 'sha1' | 'sha256', expected: string): Promise<Buffer> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`download failed: ${url}: HTTP ${response.status}`)
	const bytes = Buffer.from(await response.arrayBuffer())
	const actual = createHash(algorithm).update(bytes).digest('hex')
	if (actual !== expected.toLowerCase()) throw new Error(`${url}: expected ${algorithm} ${expected}, got ${actual}`)
	return bytes
}

export function javaPath(): string {
	if (process.env.RIGEL_BENCH_JAVA) return process.env.RIGEL_BENCH_JAVA
	const jdk = existsSync(JAVA_DIR) ? readdirSync(JAVA_DIR).find((d) => d.startsWith(`jdk-${JAVA_MAJOR}`)) : undefined
	if (!jdk) throw new Error(`no JDK ${JAVA_MAJOR} under ${JAVA_DIR}; run setup or set RIGEL_BENCH_JAVA`)
	return join(JAVA_DIR, jdk, 'bin', 'java.exe')
}

// Downloads Temurin and server.jar (both checked against the published digests) and writes the server
// configuration. The EULA is accepted here; running the benchmark means agreeing to it.
export async function setup(): Promise<void> {
	mkdirSync(SERVER_DIR, { recursive: true })
	const hasJava = existsSync(JAVA_DIR) && readdirSync(JAVA_DIR).some((d) => d.startsWith(`jdk-${JAVA_MAJOR}`))
	if (!process.env.RIGEL_BENCH_JAVA && !hasJava) {
		const assets = await (await fetch(ADOPTIUM)).json()
		const pkg = assets.map((a: { binary: { package: { name: string } } }) => a.binary.package).find((p: { name: string }) => p.name.endsWith('.zip'))
		if (!pkg) throw new Error('no Temurin zip in the Adoptium response')
		const zip = join(ROOT, pkg.name)
		writeFileSync(zip, await fetchVerified(pkg.link, 'sha256', pkg.checksum))
		mkdirSync(JAVA_DIR, { recursive: true })
		const unzip = Bun.spawnSync(['tar', '-xf', zip, '-C', JAVA_DIR])
		rmSync(zip)
		if (unzip.exitCode !== 0) throw new Error(`could not unpack ${pkg.name}: ${unzip.stderr.toString()}`)
	}
	const jar = join(SERVER_DIR, 'server.jar')
	if (!existsSync(jar)) {
		const manifest = await (await fetch(VERSION_MANIFEST)).json()
		const entry = manifest.versions.find((v: { id: string }) => v.id === MC_VERSION)
		const version = await (await fetch(entry.url)).json()
		writeFileSync(jar, await fetchVerified(version.downloads.server.url, 'sha1', version.downloads.server.sha1))
	}
	writeFileSync(join(SERVER_DIR, 'eula.txt'), 'eula=true\n')
	writeFileSync(join(SERVER_DIR, 'server.properties'), Object.entries(PROPERTIES).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

type Waiter = { pattern: RegExp; resolve: (m: RegExpMatchArray) => void; reject: (e: Error) => void; timer: Timer }

export class Server {
	private proc: ChildProcessWithoutNullStreams
	private waiters: Waiter[] = []
	private buffered = ''
	private exited: Promise<number | null>
	readonly log: string[] = []

	private constructor() {
		this.proc = spawn(javaPath(), [`-Xms${HEAP}`, `-Xmx${HEAP}`, '-jar', 'server.jar', 'nogui'], { cwd: SERVER_DIR })
		this.proc.stdout.setEncoding('utf8')
		this.proc.stdout.on('data', (chunk: string) => this.onData(chunk))
		this.proc.stderr.setEncoding('utf8')
		this.proc.stderr.on('data', (chunk: string) => this.onData(chunk))
		this.exited = new Promise((resolve) => this.proc.on('exit', (code) => {
			for (const w of this.waiters.splice(0)) {
				clearTimeout(w.timer)
				w.reject(new Error(`server exited (${code}) while waiting for ${w.pattern}`))
			}
			resolve(code)
		}))
	}

	static async start(): Promise<Server> {
		if (!existsSync(join(SERVER_DIR, 'server.jar'))) throw new Error(`no server.jar in ${SERVER_DIR}; run setup first`)
		const server = new Server()
		await server.waitFor(/Done \([\d.]+s\)! For help/, 300_000)
		return server
	}

	private onData(chunk: string): void {
		this.buffered += chunk
		const lines = this.buffered.split(/\r?\n/)
		this.buffered = lines.pop() ?? ''
		for (const line of lines) {
			this.log.push(line)
			for (const w of [...this.waiters]) {
				const match = line.match(w.pattern)
				if (!match) continue
				clearTimeout(w.timer)
				this.waiters.splice(this.waiters.indexOf(w), 1)
				w.resolve(match)
			}
		}
	}

	// Resolves with the first log line written after this call that matches.
	waitFor(pattern: RegExp, timeoutMs = 60_000): Promise<RegExpMatchArray> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiters.splice(this.waiters.indexOf(waiter), 1)
				reject(new Error(`timed out after ${timeoutMs}ms waiting for ${pattern}`))
			}, timeoutMs)
			const waiter: Waiter = { pattern, resolve, reject, timer }
			this.waiters.push(waiter)
		})
	}

	get pid(): number {
		return this.proc.pid!
	}

	send(command: string): void {
		this.proc.stdin.write(`${command}\n`)
	}

	// Sends a command and waits for the log line it is expected to produce.
	async run(command: string, expect: RegExp, timeoutMs?: number): Promise<RegExpMatchArray> {
		const result = this.waitFor(expect, timeoutMs)
		this.send(command)
		return result
	}

	// Console commands run in order on the server thread, so once this marker is logged every command
	// sent before it (including whole functions) has finished.
	private syncs = 0
	async sync(timeoutMs = 300_000): Promise<void> {
		const marker = `rbench-sync-${++this.syncs}`
		await this.run(`say ${marker}`, new RegExp(`\\b${marker}$`), timeoutMs)
	}

	async stop(): Promise<void> {
		this.send('stop')
		const code = await this.exited
		if (code !== 0) throw new Error(`server exited with ${code}`)
	}
}
