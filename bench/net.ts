// Benchmark of the packets exported rigs send to players. Protocol-only players (net-client/) join the bench server
// near the rigs; with no rigs, the rigs placed and the rigs playing, the server's flight recorder (/jfr) and the
// players count what is sent over whole animation cycles, at the normal tick rate.
//
//   bun bench/net.ts <spec.json>
//
// The spec is described in rig-spec.ts; the players stand at x 24, y -60, z -16, so the spawns place the rigs within the
// view distance (4 chunks) of there. Needs Node.js and npm: the client's pinned packages are installed under the bench
// root on first use. RIGEL_NET_PLAYERS sets the number of players (1), RIGEL_NET_CYCLES the cycles each mode is measured
// over (4).
//
// Per tick and player: wirePerTick is what a player reads from its socket (framed, compressed when large);
// packets[name].bytes the packet with its ID, uncompressed; jfr.bytesPerTick the server's payloads without the ID.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MC_VERSION, Output, ROOT, SERVER_DIR, Server } from './mc'
import { benchPack, loadMarker, MODES, readSpec, RESULTS, setMode, warmChunks } from './rig-spec'

const WORLD_NAME = 'net-bench'
const CLIENT_DIR = join(ROOT, 'net-client')
const PLAYERS = Number(process.env.RIGEL_NET_PLAYERS ?? 1)
const CYCLES = Number(process.env.RIGEL_NET_CYCLES ?? 4)
const STAND = '24 -60 -16'
const TICK_MS = 50
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Counts = { wire: number; packets: Record<string, { count: number; bytes: number }> }[]

// Installs the client's pinned packages under the bench root when they are missing or the lockfile changed.
function clientLibrary(): string {
	const here = join(import.meta.dir, 'net-client')
	const lib = join(CLIENT_DIR, 'node_modules', 'minecraft-protocol')
	const installed = join(CLIENT_DIR, 'package-lock.json')
	if (existsSync(lib) && existsSync(installed) && readFileSync(installed, 'utf8') === readFileSync(join(here, 'package-lock.json'), 'utf8')) return lib
	mkdirSync(CLIENT_DIR, { recursive: true })
	for (const f of ['package.json', 'package-lock.json']) cpSync(join(here, f), join(CLIENT_DIR, f))
	const npm = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: CLIENT_DIR, shell: true, encoding: 'utf8' })
	if (npm.status !== 0) throw new Error(`npm ci failed:\n${npm.stdout}${npm.stderr}`)
	return lib
}

// Names of the play packets the server sends, by ID: /jfr reports the obfuscated class names.
function packetNames(): Record<number, string> {
	const data = join(CLIENT_DIR, 'node_modules', 'minecraft-data', 'minecraft-data', 'data')
	const path = JSON.parse(readFileSync(join(data, 'dataPaths.json'), 'utf8')).pc[MC_VERSION].protocol
	const protocol = JSON.parse(readFileSync(join(data, path, 'protocol.json'), 'utf8'))
	const mappings: Record<string, string> = protocol.play.toClient.types.packet[1][0].type[1].mappings
	return Object.fromEntries(Object.entries(mappings).map(([id, name]) => [Number(id), name]))
}

function serverPort(): number {
	const props = readFileSync(join(SERVER_DIR, 'server.properties'), 'utf8')
	return Number(/^server-port=(\d+)/m.exec(props)?.[1] ?? 25565)
}

class Players {
	private proc: ChildProcessWithoutNullStreams
	private output: Output

	constructor(lib: string, readonly names: string[]) {
		this.proc = spawn('node', [join(import.meta.dir, 'net-client', 'client.cjs'), lib, String(serverPort()), ...names])
		this.output = new Output(this.proc, 'net-client')
	}

	async joined(): Promise<void> {
		await Promise.all(this.names.map((n) => this.output.waitFor(new RegExp(`^READY ${n}$`), 120_000)))
	}

	async mark(label: string): Promise<Counts> {
		const marked = this.output.waitFor(new RegExp(`^MARK ${label} (.*)$`))
		this.proc.stdin.write(`mark ${label}\n`)
		return JSON.parse((await marked)[1]!)
	}

	get ended(): string[] {
		return this.output.lines.filter((l) => l.startsWith('END '))
	}

	async close(): Promise<void> {
		this.proc.stdin.end()
		await this.output.exited
	}
}

// What each player received between two marks, per tick: socket bytes, and count and bytes per packet name.
function received(a: Counts, b: Counts, ticks: number) {
	const players = b.map((p, i) => {
		const packets: Record<string, { count: number; bytes: number }> = {}
		for (const [name, c] of Object.entries(p.packets)) {
			const was = a[i]!.packets[name] ?? { count: 0, bytes: 0 }
			if (c.count > was.count) packets[name] = { count: (c.count - was.count) / ticks, bytes: (c.bytes - was.bytes) / ticks }
		}
		return { wire: (p.wire - a[i]!.wire) / ticks, packets }
	})
	const names = [...new Set(players.flatMap((p) => Object.keys(p.packets)))]
	const mean = (f: (p: (typeof players)[number]) => number) => players.reduce((t, p) => t + f(p), 0) / players.length
	const packets = Object.fromEntries(
		names
			.map((n) => [n, { count: round(mean((p) => p.packets[n]?.count ?? 0)), bytes: round(mean((p) => p.packets[n]?.bytes ?? 0)) }] as const)
			.sort(([, x], [, y]) => y.bytes - x.bytes),
	)
	return { wirePerTick: round(mean((p) => p.wire)), wireSpread: round(Math.max(...players.map((p) => p.wire)) - Math.min(...players.map((p) => p.wire))), packets }
}

const round = (x: number) => Number(x.toFixed(2))

async function main(): Promise<void> {
	const [specArg] = process.argv.slice(2)
	if (!specArg) throw new Error('usage: bun bench/net.ts <spec.json>')
	const { spec, packs } = readSpec(specArg)
	const lib = clientLibrary()
	const names = packetNames()

	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	benchPack(join(world, 'datapacks', 'rbench_rig'), spec)
	const server = await Server.start(WORLD_NAME)
	const result: Record<string, unknown> = { label: spec.label, players: PLAYERS, cycles: CYCLES, cycle: spec.cycle }
	const from = server.log.length
	let players: Players | undefined
	try {
		for (const pack of packs) cpSync(pack, join(world, 'datapacks', basename(pack)), { recursive: true })
		const chunks = warmChunks(spec, packs)
		loadMarker(join(world, 'datapacks', 'rbench_rig'), spec, 'rbench-net-loaded')
		const loaded = server.waitFor(/rbench-net-loaded$/, 600_000)
		const sprinted = chunks > 0 ? server.waitFor(/Sprint completed with/, 600_000) : undefined
		server.send(chunks > 0 ? `reload\ntick sprint ${chunks + 1}` : 'reload')
		await loaded
		await sprinted
		if (chunks > 0) {
			const left = await server.run('scoreboard players get $Rigel.Warm Rigel.Warming', /has (-?\d+) \[|Can't get value/)
			if (left[1] !== '0') throw new Error(`the warm-up had not finished after ${chunks + 1} ticks`)
		}

		players = new Players(lib, Array.from({ length: PLAYERS }, (_, i) => `rbench${i + 1}`))
		await players.joined()
		for (const name of players.names) server.send(`tp ${name} ${STAND}`)
		await server.sync()
		await sleep(100 * TICK_MS)

		const gametime = async () => Number((await server.run('time query gametime', /The time is (\d+)/))[1])
		const modes: Record<string, unknown> = {}
		for (let mode = 0; mode < MODES.length; mode++) {
			await setMode(server, spec, mode)
			if (mode === 1) {
				// A spawn that failed in the console logs no warning.
				const displays = Number((await server.run('execute if entity @e[type=item_display]', /Test passed, count: (\d+)|Test failed/))[1] ?? 0)
				if (displays === 0) throw new Error('no item_display after the spawn commands')
				result.displays = displays
			}
			await sleep(spec.cycle * TICK_MS)
			// The recording spans the ticks between the two gametime queries (give or take one at each end); its own
			// durationMs counts from the first recording of the server.
			await server.run('jfr start', /JFR profiling started/)
			const t0 = await gametime()
			const a = await players.mark(`${mode}a`)
			const started = performance.now()
			await sleep(CYCLES * spec.cycle * TICK_MS)
			const b = await players.mark(`${mode}b`)
			const seconds = (performance.now() - started) / 1000
			const ticks = (await gametime()) - t0
			const [, report] = await server.run('jfr stop', /Dumped recording summary to (.+\.json)$/, 300_000)
			const reportPath = join(SERVER_DIR, report!.trim())
			const jfr = JSON.parse(readFileSync(reportPath, 'utf8'))
			rmSync(reportPath)
			rmSync(join(dirname(reportPath), basename(reportPath).replace(/^jfr-report-(.*)\.json$/, '$1.jfr')), { force: true })
			const sent = jfr.network.sent
			const perPlayerTick = (x: number) => round(x / ticks / PLAYERS)
			modes[MODES[mode]!] = {
				ticks,
				tps: round(ticks / seconds),
				...received(a, b, ticks),
				jfr: {
					bytesPerTick: perPlayerTick(sent.totalBytes),
					packetsPerTick: perPlayerTick(sent.count),
					top: sent.topContributors.slice(0, 5).map((c: { packetId: number; totalBytes: number; count: number }) => ({
						name: names[c.packetId] ?? c.packetId,
						bytesPerTick: perPlayerTick(c.totalBytes),
						countPerTick: perPlayerTick(c.count),
					})),
					serverTick: jfr.serverTick,
				},
			}
		}
		result.modes = modes
		const none = modes.none as { wirePerTick: number }
		const playing = modes.playing as { wirePerTick: number }
		result.playingWirePerTick = round(playing.wirePerTick - none.wirePerTick)
		result.playingWirePerSecond = Math.round((playing.wirePerTick - none.wirePerTick) * 20)
		result.disconnected = players.ended
		const problems = server.log.slice(from).filter((l) => /\/(ERROR|WARN)\]/.test(l) && !/Can't keep up!/.test(l))
		result.logProblems = problems.slice(0, 10)
	} finally {
		await players?.close()
		await server.stop()
		rmSync(world, { recursive: true, force: true })
	}
	mkdirSync(RESULTS, { recursive: true })
	const file = join(RESULTS, `net-${spec.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
	writeFileSync(file, JSON.stringify(result, null, 1))
	console.log(JSON.stringify(result))
}

await main()
