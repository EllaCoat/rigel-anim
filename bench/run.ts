// Benchmark entry point. Results are printed as Markdown tables and saved under .bench-results/.
//
//   bun bench/run.ts setup         download Java and server.jar, write the server configuration
//   bun bench/run.ts all           run every experiment
//   bun bench/run.ts <name> [...]  run the named experiments (see EXPERIMENTS)
//   bun bench/run.ts show <name>   print the experiment's functions generated at a small size
//
// RIGEL_BENCH_TICKS and RIGEL_BENCH_REPEATS shorten the sprints for trial runs.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dispatch, type LoadForm, loadStep, pipelines, reloadPack, respawn, rootSearch, storageFill, WARM_FILLS, warmFill, warmPlayback, writeForms } from './experiments'
import { e1WriteCost, type Experiment, writePack } from './gen'
import { javaPath, SERVER_DIR, Server, setup, WORLD } from './mc'
import { startRecording, stopRecording, summarize } from './profile'
import { TARGET } from './target'

export const SPRINT_REPORT = /Sprint completed with (\d+) ticks per second, or ([\d.]+) ms per tick/
const WARMUP_TICKS = 600
const SPRINT_TICKS = Number(process.env.RIGEL_BENCH_TICKS ?? 600)
const REPEATS = Number(process.env.RIGEL_BENCH_REPEATS ?? 5)
const RESULTS = join(import.meta.dir, '..', '.bench-results')

interface Case {
	label: string
	experiment: Experiment
	// Work per tick of each measured mode (one number for all modes, or one per mode), to turn the
	// difference from the baseline into a per-unit cost.
	units: number | number[]
	unit: string
}

interface Row {
	experiment: string
	case: string
	mode: string
	samples: number[]
	median: number
	delta?: number
	perUnit?: string
}

const median = (xs: number[]) => {
	const s = [...xs].sort((a, b) => a - b)
	const m = s.length >> 1
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

let loads = 0
// Writes the pack and reloads; fails if Minecraft rejected any function of the pack.
async function reload(server: Server, experiment: Experiment): Promise<number> {
	const marker = `rbench-loaded-${process.pid}-${++loads}`
	writePack(WORLD, experiment, marker)
	const from = server.log.length
	const started = performance.now()
	await server.run('reload', new RegExp(marker), 600_000)
	const elapsed = performance.now() - started
	const errors = server.log.slice(from).filter((l) => /Failed to load function|Couldn't load|Unknown or incomplete command|Expected/.test(l))
	if (errors.length) throw new Error(`${experiment.name}: /reload reported errors:\n${errors.slice(0, 10).join('\n')}`)
	return elapsed
}

async function prepare(server: Server, experiment: Experiment): Promise<void> {
	await reload(server, experiment)
	server.send('function rbench:clear')
	await server.sync()
	server.send('function rbench:setup')
	await server.sync()
	const [, count] = await server.run('execute if entity @e[tag=rb.bone]', /Test (?:passed[,.] [cC]ount: (\d+)|failed)/)
	if (Number(count ?? 0) !== experiment.bones) throw new Error(`${experiment.name}: expected ${experiment.bones} bones, found ${count ?? 0}`)
}

async function sprint(server: Server, mode: number, ticks: number): Promise<number> {
	await server.run(`scoreboard players set #mode rb ${mode}`, new RegExp(`Set \\[rb\\] for #mode to ${mode}$`))
	const [, , mspt] = await server.run(`tick sprint ${ticks}`, SPRINT_REPORT, 1_800_000)
	return Number(mspt)
}

// Alternates the baseline (mode 0) with each measured mode so that slow drift affects all modes alike.
async function measure(server: Server, name: string, c: Case): Promise<Row[]> {
	const modes = [0, ...c.experiment.modes.map((_, i) => i + 1)]
	// A mode whose commands fail still takes time (the failure is logged every tick), so any error the
	// server logs while measuring invalidates the case.
	const from = server.log.length
	const failed = (mode: number) => {
		const error = server.log.slice(from).find((l) => /\/(ERROR|WARN)\]/.test(l) && !/Can't keep up!/.test(l))
		if (error) throw new Error(`${name} ${c.label}, mode ${mode}: the server logged\n${error}`)
	}
	for (const mode of modes) {
		await sprint(server, mode, WARMUP_TICKS)
		failed(mode)
	}
	const samples = modes.map(() => [] as number[])
	for (let r = 0; r < REPEATS; r++) for (const mode of modes) samples[mode]!.push(await sprint(server, mode, SPRINT_TICKS))
	const base = median(samples[0]!)
	return modes.map((mode) => {
		const m = median(samples[mode]!)
		if (mode === 0) return { experiment: name, case: c.label, mode: 'baseline', samples: samples[0]!, median: m }
		const units = Array.isArray(c.units) ? c.units[mode - 1]! : c.units
		const delta = m - base
		return { experiment: name, case: c.label, mode: c.experiment.modes[mode - 1]!, samples: samples[mode]!, median: m, delta, perUnit: `${((delta * 1000) / units).toFixed(3)} µs/${c.unit}` }
	})
}

const RIG = { rigs: 3, bones: 250 }
const LOAD_STEPS: { form: LoadForm; cells: number }[] = [
	...[250, 500, 1000, 2000, 5000].map((cells) => ({ form: 'frameInts' as const, cells })),
	...(['boneInts', 'frameNamed', 'frameWrites', 'frameTransforms', 'fork'] as const).map((form) => ({ form, cells: 1000 })),
	{ form: 'frameWrites', cells: 5000 },
	...([1000, 10000] as const).flatMap((cells) => (['frameInts', 'frameWrites'] as const).map((form) => ({ form, cells, cached: true }))),
]

// Experiments measured with interleaved sprints.
const SPRINTED: Record<string, () => Case[]> = {
	e1: () => [
		...[0, 1, 50].map((tags) => ({ label: `tags ${tags}`, experiment: e1WriteCost({ ...RIG, tags }), units: RIG.rigs * RIG.bones, unit: 'write' })),
		{
			label: 'tags 0, larger item NBT',
			experiment: e1WriteCost({ ...RIG, tags: 0, item: { model: true, name: 'x'.repeat(120) } }),
			units: RIG.rigs * RIG.bones,
			unit: 'write',
		},
	],
	pipelines: () => [{ label: '3 × 250 bones', experiment: pipelines(RIG.rigs, RIG.bones), units: RIG.rigs * RIG.bones, unit: 'bone' }],
	writes: () => [
		{ label: 'riding, item with CustomModelData', experiment: writeForms(RIG.rigs, RIG.bones), units: RIG.rigs * RIG.bones, unit: 'write' },
		{ label: 'riding, item without tag', experiment: writeForms(RIG.rigs, RIG.bones, { model: false }), units: RIG.rigs * RIG.bones, unit: 'write' },
		{ label: 'not riding, item with CustomModelData', experiment: writeForms(RIG.rigs, RIG.bones, { ride: false }), units: RIG.rigs * RIG.bones, unit: 'write' },
	],
	respawn: () => [{ label: '3 × 250 bones', experiment: respawn(RIG.rigs, RIG.bones), units: RIG.rigs * RIG.bones, unit: 'bone' }],
	dispatch: () => [50, 250].map((bones) => ({ label: `3 × ${bones} bones`, experiment: dispatch(RIG.rigs, bones), units: RIG.rigs * bones, unit: 'bone' })),
	roots: () => [0, 1000, 5000].map((others) => ({ label: `${others} other entities`, experiment: rootSearch(RIG.rigs, others), units: RIG.rigs, unit: 'root' })),
	load: () => [{ label: 'one step per tick', experiment: loadStep(LOAD_STEPS), units: LOAD_STEPS.map((s) => s.cells), unit: 'cell' }],
	warm: () => [{ label: '3 × 250 bones', experiment: warmPlayback(RIG.rigs, RIG.bones), units: RIG.rigs * RIG.bones, unit: 'cell' }],
}

function heapUsedKiB(pid: number): number {
	const jcmd = join(dirname(javaPath()), 'jcmd.exe')
	for (let i = 0; i < 2; i++) spawnSync(jcmd, [String(pid), 'GC.run'])
	const out = spawnSync(jcmd, [String(pid), 'GC.heap_info'], { encoding: 'utf8' }).stdout
	const used = out.match(/used (\d+)K/)
	if (!used) throw new Error(`could not read heap usage:\n${out}`)
	return Number(used[1])
}

// E5: heap kept per cell of each layout, measured after the setup's literal is already loaded so only
// the storage copy is counted.
async function memory(server: Server): Promise<Row[]> {
	const cells = 20_000
	const rows: Row[] = []
	for (const form of ['frameInts', 'boneInts', 'frameNamed', 'frameWrites', 'frameTransforms', 'fork'] as const) {
		const samples: number[] = []
		for (let r = 0; r < 3; r++) {
			await reload(server, storageFill(form, cells, 'rbench_anim'))
			server.send('data remove storage rbench_anim:a v')
			await server.sync()
			const before = heapUsedKiB(server.pid)
			server.send('function rbench:setup')
			await server.sync()
			samples.push(((heapUsedKiB(server.pid) - before) * 1024) / cells)
		}
		rows.push({ experiment: 'memory', case: `${cells} cells`, mode: form, samples, median: median(samples), perUnit: `${median(samples).toFixed(0)} B/cell` })
	}
	// A dummy-macro function called with constant arguments keeps its parsed value in the macro cache:
	// heap after the call, and after removing the storage copy again.
	for (const form of ['frameInts', 'frameWrites'] as const) {
		const withStorage: number[] = []
		const cacheOnly: number[] = []
		for (let r = 0; r < 3; r++) {
			await reload(server, storageFill(form, cells, 'rbench_anim', true))
			server.send('data remove storage rbench_anim:a v')
			await server.sync()
			const before = heapUsedKiB(server.pid)
			server.send('function rbench:setup')
			await server.sync()
			withStorage.push(((heapUsedKiB(server.pid) - before) * 1024) / cells)
			server.send('data remove storage rbench_anim:a v')
			await server.sync()
			cacheOnly.push(((heapUsedKiB(server.pid) - before) * 1024) / cells)
		}
		rows.push({ experiment: 'memory', case: `${cells} cells, dummy macro`, mode: `${form}, storage + cache`, samples: withStorage, median: median(withStorage), perUnit: `${median(withStorage).toFixed(0)} B/cell` })
		rows.push({ experiment: 'memory', case: `${cells} cells, dummy macro`, mode: `${form}, storage removed`, samples: cacheOnly, median: median(cacheOnly), perUnit: `${median(cacheOnly).toFixed(0)} B/cell` })
	}
	server.send('data remove storage rbench_anim:a v')
	return rows
}

// E9: save-all with 100,000 cells either in the namespace written every tick or in their own.
async function saving(server: Server): Promise<Row[]> {
	const rows: Row[] = []
	for (const namespace of ['rbench', 'rbench_anim']) {
		await prepare(server, storageFill('frameInts', 100_000, namespace))
		await server.run('save-all flush', /Saved the game/, 300_000)
		const samples: number[] = []
		for (let r = 0; r < 5; r++) {
			await server.run('tick sprint 40', SPRINT_REPORT, 300_000)
			const started = performance.now()
			await server.run('save-all flush', /Saved the game/, 300_000)
			samples.push(performance.now() - started)
		}
		rows.push({ experiment: 'saving', case: '100000 cells', mode: namespace === 'rbench' ? 'same namespace as work values' : 'own namespace', samples, median: median(samples), perUnit: 'ms per save-all flush' })
		server.send(`data remove storage ${namespace}:a v`)
	}
	return rows
}

// E8: wall time of /reload, which includes waiting for the next tick (up to 50 ms).
async function reloading(server: Server): Promise<Row[]> {
	const rows: Row[] = []
	const cells = 100_000
	for (const [mode, experiment] of [['empty', reloadPack(0, true)], ['dummy macro', reloadPack(cells, true)], ['plain lines', reloadPack(cells, false)]] as const) {
		const samples: number[] = []
		for (let r = 0; r < 3; r++) samples.push(await reload(server, experiment))
		rows.push({ experiment: 'reload', case: `${cells} cells in 1000-cell files`, mode, samples, median: median(samples), perUnit: 'ms per /reload' })
	}
	return rows
}

// Breakdown of one entity write (E1, tags 0) by method, from JFR samples.
const sections: string[] = []
async function profile(server: Server): Promise<Row[]> {
	await prepare(server, e1WriteCost({ ...RIG, tags: 0 }))
	await sprint(server, 1, WARMUP_TICKS)
	const file = join(SERVER_DIR, 'rbench-e1.jfr')
	await startRecording(server.pid, file)
	await sprint(server, 1, 3000)
	stopRecording(server.pid)
	sections.push(`### profile: e1 write, ${RIG.rigs} × ${RIG.bones} bones, tags 0\n\n${summarize(file, 40)}`)
	return []
}

// Bytes per class from a class histogram (which runs a full GC first).
function classBytes(pid: number): Map<string, number> {
	const jcmd = join(dirname(javaPath()), 'jcmd.exe')
	const out = spawnSync(jcmd, [String(pid), 'GC.class_histogram'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout
	const bytes = new Map<string, number>()
	for (const m of out.matchAll(/^\s*\d+:\s+\d+\s+(\d+)\s+(\S+)/gm)) bytes.set(m[2]!, Number(m[1]))
	return bytes
}

// Heap of frame functions: the function text kept from /reload (against an empty pack), and the parsed
// functions the macro cache keeps after one call each, with the wall time of that call. For the full
// direct line, also which classes the warmed cache consists of.
async function warmMemory(server: Server): Promise<Row[]> {
	const frames = 80
	const cells = frames * 250
	const rows: Row[] = []
	for (const kind of Object.keys(WARM_FILLS) as (keyof typeof WARM_FILLS)[]) {
		const text: number[] = []
		const cache: number[] = []
		const time: number[] = []
		for (let r = 0; r < 3; r++) {
			await reload(server, reloadPack(0, true))
			const empty = heapUsedKiB(server.pid)
			await reload(server, warmFill(kind, frames))
			const loaded = heapUsedKiB(server.pid)
			const histogram = kind === 'direct' && r === 0
			const before = histogram ? classBytes(server.pid) : undefined
			const started = performance.now()
			server.send('function rbench:setup')
			await server.sync()
			time.push(((performance.now() - started) * 1000) / cells)
			cache.push(((heapUsedKiB(server.pid) - loaded) * 1024) / cells)
			text.push(((loaded - empty) * 1024) / cells)
			if (before) {
				const after = classBytes(server.pid)
				const grown = [...after].map(([name, b]) => [name, (b - (before.get(name) ?? 0)) / cells] as const).filter(([, b]) => b >= 8).sort((a, b) => b[1] - a[1])
				const table = grown.slice(0, 25).map(([n, b]) => `| ${n} | ${b.toFixed(1)} |`)
				sections.push(['### warm-memory: classes added by warming the direct line, per cell', '', '| class | B/cell |', '|---|---|', ...table].join('\n'))
			}
		}
		const row = (mode: string, samples: number[], unit: string) =>
			rows.push({ experiment: 'warm-memory', case: `${cells} cells`, mode: `${kind}, ${mode}`, samples, median: median(samples), perUnit: `${median(samples).toFixed(1)} ${unit}` })
		row('function text after /reload', text, 'B/cell')
		row('macro cache after warming', cache, 'B/cell')
		row('warming wall time (one tick)', time, 'µs/cell')
	}
	return rows
}

const SPECIAL: Record<string, (server: Server) => Promise<Row[]>> = { memory, saving, reload: reloading, profile, 'warm-memory': warmMemory }
const EXPERIMENTS = [...Object.keys(SPRINTED), ...Object.keys(SPECIAL)]

function table(rows: Row[]): string {
	const lines = ['| experiment | case | mode | median | min–max | Δ vs baseline (ms/tick) | per unit |', '|---|---|---|---|---|---|---|']
	const f = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2))
	for (const r of rows)
		lines.push(`| ${r.experiment} | ${r.case} | ${r.mode} | ${f(r.median)} | ${f(Math.min(...r.samples))}–${f(Math.max(...r.samples))} | ${r.delta === undefined ? '' : r.delta.toFixed(2)} | ${r.perUnit ?? ''} |`)
	return lines.join('\n')
}

async function run(names: string[]): Promise<void> {
	const server = await Server.start()
	const rows: Row[] = []
	try {
		server.send('save-off')
		for (const rule of TARGET.quietRules) await server.run(`gamerule ${rule}`, /Game ?rule .* is now set to/i)
		for (const command of TARGET.keepLoaded) server.send(command)
		await server.sync()
		for (const name of names) {
			if (name in SPECIAL) rows.push(...(await SPECIAL[name]!(server)))
			else
				for (const c of SPRINTED[name]!()) {
					await prepare(server, c.experiment)
					rows.push(...(await measure(server, name, c)))
				}
			console.log(`${name} done`)
		}
	} catch (error) {
		console.error(`last server log lines:\n${server.log.slice(-20).join('\n')}`)
		throw error
	} finally {
		await server.stop()
	}
	const report = [
		rows.length ? table(rows) : '',
		`Sprints: ${SPRINT_TICKS} ticks × ${REPEATS} per mode after a ${WARMUP_TICKS}-tick warm-up, baseline interleaved. "median" is ms/tick for sprinted experiments.`,
		...sections,
	].join('\n\n') + '\n'
	console.log(report)
	mkdirSync(RESULTS, { recursive: true })
	const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${TARGET.version}-${names.join('+')}`
	writeFileSync(join(RESULTS, `${stamp}.md`), report)
	writeFileSync(join(RESULTS, `${stamp}.json`), JSON.stringify(rows, null, '\t'))
}

// Prints the functions of an experiment generated at a small size, for reviewing how each mode is written.
const SHOW: Record<string, () => Experiment> = {
	e1: () => e1WriteCost({ rigs: 1, bones: 2, tags: 0 }),
	pipelines: () => pipelines(1, 2, 2),
	writes: () => writeForms(1, 2),
	respawn: () => respawn(1, 2),
	dispatch: () => dispatch(1, 3),
	roots: () => rootSearch(2, 2),
	load: () => loadStep([{ form: 'frameInts', cells: 2 }, { form: 'frameWrites', cells: 2, cached: true }]),
	warm: () => warmPlayback(1, 2),
}
function show(name: string): void {
	const experiment = SHOW[name]!()
	const clip = (text: string) => text.split('\n').map((line) => (line.length > 400 ? `${line.slice(0, 400)} …(${line.length} chars)` : line)).join('\n')
	console.log(`modes: ${experiment.modes.map((m, i) => `${i + 1}=${m}`).join(', ')}\n`)
	for (const [path, content] of Object.entries({ ...experiment.files, 'setup.mcfunction': experiment.setup }))
		console.log(`# ${path}\n${clip(content)}\n`)
}

const args = process.argv.slice(2)
if (args[0] === 'setup') await setup()
else if (args[0] === 'show' && args[1]! in SHOW) show(args[1]!)
else if (args[0] === 'all') await run(EXPERIMENTS)
else if (args.length && args.every((a) => EXPERIMENTS.includes(a))) await run(args)
else {
	console.error(`usage: bun bench/run.ts setup|all|<${EXPERIMENTS.join('|')}> ...`)
	process.exit(2)
}
