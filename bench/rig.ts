// Benchmark of exported rigs: /reload time, the warm-up of rigel's frame functions, MSPT with no rigs, the rigs placed
// and the rigs playing, the data pack size, and the heap the loaded (and warmed) packs keep.
//
//   bun bench/rig.ts <spec.json>
//
// The spec is described in rig-spec.ts. The server loads a world of its own, made anew each run. RIGEL_BENCH_TICKS and
// RIGEL_BENCH_REPEATS shorten the sprints.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { heapUsedKiB, SERVER_DIR, Server } from './mc'
import { benchPack, folderSize, loadMarker, MODES, readSpec, RESULTS, setMode, warmChunks } from './rig-spec'

const WORLD_NAME = 'rig-bench'
const SPRINT_REPORT = /Sprint completed with (\d+) ticks per second, or ([\d.]+) ms per tick/
const WARMUP_TICKS = 600
const SPRINT_TICKS = Number(process.env.RIGEL_BENCH_TICKS ?? 600)
const REPEATS = Number(process.env.RIGEL_BENCH_REPEATS ?? 5)
const RELOADS = 3

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

async function main(): Promise<void> {
	const [specArg] = process.argv.slice(2)
	if (!specArg) throw new Error('usage: bun bench/rig.ts <spec.json>')
	const { spec, packs } = readSpec(specArg)

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
		const chunks = warmChunks(spec, packs)
		// The marker is said by a load function, which runs on the first tick after the reload, as does the first chunk of the
		// warm-up. /reload holds the server thread until it is done, so a sprint sent with it starts on that tick.
		const sprintWarm = chunks > 0
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

		const sprint = async (ticks: number) => Number((await server.run(`tick sprint ${ticks}`, SPRINT_REPORT, 1_800_000))[2])
		for (let mode = 0; mode < MODES.length; mode++) {
			await setMode(server, spec, mode)
			await sprint(WARMUP_TICKS)
		}
		// A spawn that failed in the console logs no warning.
		const displays = Number((await server.run('execute if entity @e[type=item_display]', /Test passed, count: (\d+)|Test failed/))[1] ?? 0)
		if (displays === 0) throw new Error('no item_display after the spawn commands')
		result.displays = displays
		const samples = MODES.map(() => [] as number[])
		for (let r = 0; r < REPEATS; r++)
			for (let mode = 0; mode < MODES.length; mode++) {
				await setMode(server, spec, mode)
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
