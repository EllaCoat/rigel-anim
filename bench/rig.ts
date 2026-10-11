// Benchmark of exported rigs: /reload time, the warm-up of rigel's frame functions, MSPT with no rigs, the rigs placed
// and the rigs playing, the data pack size, and the heap the loaded (and warmed) packs keep.
//
//   bun bench/rig.ts <spec.json>
//
// spec.json, paths relative to it:
//   datapacks  folders copied into the world's datapacks
//   rigs       per rig: spawn (run once, places it), play (starts the animation), kill (removes it)
//   cycle      ticks between plays while playing, so animations that end start again
//   warm       true for rigel packs: after each reload, sprint through the warm-up and check that it finished
//   label      name of the result file under .bench-results/
// The server loads a world of its own, made anew each run. RIGEL_BENCH_TICKS and RIGEL_BENCH_REPEATS shorten the sprints.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { heapUsedKiB, SERVER_DIR, Server } from './mc'

const WORLD_NAME = 'rig-bench'
const SPRINT_REPORT = /Sprint completed with (\d+) ticks per second, or ([\d.]+) ms per tick/
const WARMUP_TICKS = 600
const SPRINT_TICKS = Number(process.env.RIGEL_BENCH_TICKS ?? 600)
const REPEATS = Number(process.env.RIGEL_BENCH_REPEATS ?? 5)
const RELOADS = 3
const RESULTS = join(import.meta.dir, '..', '.bench-results')
const MODES = ['none', 'placed', 'playing'] as const

interface Spec {
	label: string
	datapacks: string[]
	rigs: { spawn: string; play: string; kill: string }[]
	cycle: number
	warm: boolean
}

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function folderSize(dir: string): { files: number; bytes: number } {
	let files = 0
	let bytes = 0
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue
		files++
		bytes += statSync(join(entry.parentPath, entry.name)).size
	}
	return { files, bytes }
}

// The load function says marker, so each reload can be told apart from the ones before.
function loadMarker(dir: string, spec: Spec, marker: string): void {
	const file = join(dir, 'data/rbench_rig/functions/load.mcfunction')
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, `scoreboard objectives add rbench dummy\nscoreboard players set #cycle rbench ${spec.cycle}\nsay ${marker}\n`)
}

// The bench's own pack: replays the animations every `cycle` ticks while #mode is 2, and logs a marker on load.
function benchPack(dir: string, spec: Spec): void {
	const fn = (name: string, lines: string[]) => {
		const file = join(dir, 'data/rbench_rig/functions', `${name}.mcfunction`)
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, `${lines.join('\n')}\n`)
	}
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 26, description: 'rig bench' } }))
	const tag = (name: string, value: string) => {
		const file = join(dir, 'data/minecraft/tags/functions', `${name}.json`)
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, JSON.stringify({ values: [value] }))
	}
	tag('load', 'rbench_rig:load')
	tag('tick', 'rbench_rig:tick')
	loadMarker(dir, spec, 'rbench-rig-started')
	fn('tick', ['execute if score #mode rbench matches 2 run function rbench_rig:cycle'])
	fn('cycle', ['scoreboard players add #t rbench 1', 'execute if score #t rbench >= #cycle rbench run function rbench_rig:play'])
	fn('play', ['scoreboard players set #t rbench 0', ...spec.rigs.map((r) => r.play)])
}

async function main(): Promise<void> {
	const [specArg] = process.argv.slice(2)
	if (!specArg) throw new Error('usage: bun bench/rig.ts <spec.json>')
	const specPath = resolve(specArg)
	const raw = JSON.parse(readFileSync(specPath, 'utf8'))
	const spec: Spec = { label: raw.label ?? basename(specPath, '.json'), datapacks: raw.datapacks, rigs: raw.rigs, cycle: raw.cycle, warm: raw.warm === true }
	const packs = spec.datapacks.map((d) => resolve(dirname(specPath), d))

	const world = join(SERVER_DIR, WORLD_NAME)
	rmSync(world, { recursive: true, force: true })
	benchPack(join(world, 'datapacks', 'rbench_rig'), spec)
	const server = await Server.start(WORLD_NAME)
	const result: Record<string, unknown> = { label: spec.label, sizes: Object.fromEntries(packs.map((p) => [basename(p), folderSize(p)])) }
	const from = server.log.length
	try {
		const empty = heapUsedKiB(server.pid)

		// Reload with the packs, then again: each reload parses every function and (rigel) warms the frames anew.
		for (const pack of packs) cpSync(pack, join(world, 'datapacks', basename(pack)), { recursive: true })
		const reloads: number[] = []
		const warms: { mspt: number; ticks: number }[] = []
		const chunks = spec.warm ? packs.reduce((n, p) => n + readdirSync(p, { recursive: true }).filter((f) => /[\\/]warm[\\/](xhigh|high|low)[\\/]\d+\.mcfunction$/.test(String(f))).length, 0) : 0
		// The marker is said by a load function, which runs on the first tick after the reload, as does the first chunk of the
		// warm-up. /reload holds the server thread until it is done, so a sprint sent with it starts on that tick.
		const sprintWarm = spec.warm && chunks > 0
		for (let r = 0; r < RELOADS; r++) {
			loadMarker(join(world, 'datapacks', 'rbench_rig'), spec, `rbench-rig-loaded-${r}`)
			const loaded = server.waitFor(new RegExp(`rbench-rig-loaded-${r}$`), 600_000)
			const sprinted = sprintWarm ? server.waitFor(SPRINT_REPORT, 600_000) : undefined
			const started = performance.now()
			server.send(sprintWarm ? `reload\ntick sprint ${chunks + 1}` : 'reload')
			await loaded
			reloads.push(performance.now() - started)
			if (sprinted) {
				const [, , mspt] = await sprinted
				const left = await server.run('scoreboard players get $Rigel.Warm Rigel.Warming', /has (-?\d+) \[|Can't get value/)
				if (left[1] !== '0') throw new Error(`the warm-up had not finished after ${chunks + 1} ticks`)
				warms.push({ mspt: Number(mspt), ticks: chunks + 1 })
			}
		}
		result.reloadMs = { samples: reloads.map(Math.round), median: Math.round(median(reloads)) }
		if (spec.warm) result.warm = { chunks, ticks: chunks + 1, msptSamples: warms.map((w) => w.mspt), msptMedian: median(warms.map((w) => w.mspt)) }
		result.heapMiB = Number(((heapUsedKiB(server.pid) - empty) / 1024).toFixed(1))
		result.heapEmptyMiB = Number((empty / 1024).toFixed(1))

		const setMode = async (mode: number) => {
			for (const rig of spec.rigs) server.send(rig.kill)
			if (mode >= 1) for (const rig of spec.rigs) server.send(rig.spawn)
			server.send(`scoreboard players set #mode rbench ${mode}`)
			if (mode === 2) server.send('function rbench_rig:play')
			await server.sync()
		}
		const sprint = async (ticks: number) => Number((await server.run(`tick sprint ${ticks}`, SPRINT_REPORT, 1_800_000))[2])
		for (let mode = 0; mode < MODES.length; mode++) {
			await setMode(mode)
			await sprint(WARMUP_TICKS)
		}
		// A spawn that failed in the console logs no warning.
		const displays = Number((await server.run('execute if entity @e[type=item_display]', /Test passed, count: (\d+)|Test failed/))[1] ?? 0)
		if (displays === 0) throw new Error('no item_display after the spawn commands')
		result.displays = displays
		const samples = MODES.map(() => [] as number[])
		for (let r = 0; r < REPEATS; r++)
			for (let mode = 0; mode < MODES.length; mode++) {
				await setMode(mode)
				samples[mode]!.push(await sprint(SPRINT_TICKS))
			}
		const base = median(samples[0]!)
		result.mspt = Object.fromEntries(MODES.map((m, i) => [m, { samples: samples[i], median: median(samples[i]!), delta: Number((median(samples[i]!) - base).toFixed(3)) }]))
		const problems = server.log.slice(from).filter((l) => /\/(ERROR|WARN)\]/.test(l) && !/Can't keep up!/.test(l))
		result.logProblems = problems.slice(0, 10)
	} finally {
		await server.stop()
		rmSync(world, { recursive: true, force: true })
	}
	mkdirSync(RESULTS, { recursive: true })
	const file = join(RESULTS, `rig-${spec.label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
	writeFileSync(file, JSON.stringify(result, null, 1))
	console.log(JSON.stringify(result))
}

await main()
