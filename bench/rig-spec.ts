// The spec of a rig benchmark (bench/rig.ts, bench/net.ts) and the bench's own data pack.
//
// spec.json, paths relative to it:
//   datapacks  folders copied into the world's datapacks
//   rigs       per rig: spawn (run once, places it), play (starts the animation), kill (removes it)
//   cycle      ticks between plays while playing, so animations that end start again
//   warm       true for rigel packs: after each reload, sprint through the warm-up and check that it finished
//   label      name of the result file under .bench-results/
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { Server } from './mc'

export interface Spec {
	label: string
	datapacks: string[]
	rigs: { spawn: string; play: string; kill: string }[]
	cycle: number
	warm: boolean
}

export const RESULTS = join(import.meta.dir, '..', '.bench-results')
export const MODES = ['none', 'placed', 'playing'] as const

// The spec and its data packs as absolute paths.
export function readSpec(specArg: string): { spec: Spec; packs: string[] } {
	const specPath = resolve(specArg)
	const raw = JSON.parse(readFileSync(specPath, 'utf8'))
	const spec: Spec = { label: raw.label ?? basename(specPath, '.json'), datapacks: raw.datapacks, rigs: raw.rigs, cycle: raw.cycle, warm: raw.warm === true }
	return { spec, packs: spec.datapacks.map((d) => resolve(dirname(specPath), d)) }
}

export function folderSize(dir: string): { files: number; bytes: number } {
	let files = 0
	let bytes = 0
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue
		files++
		bytes += statSync(join(entry.parentPath, entry.name)).size
	}
	return { files, bytes }
}

// The warm-up chunks of the rigel packs: a reload warms one per tick.
export function warmChunks(spec: Spec, packs: string[]): number {
	if (!spec.warm) return 0
	return packs.reduce((n, p) => n + readdirSync(p, { recursive: true }).filter((f) => /[\\/]warm[\\/](xhigh|high|low)[\\/]\d+\.mcfunction$/.test(String(f))).length, 0)
}

// The load function says marker, so each reload can be told apart from the ones before.
export function loadMarker(dir: string, spec: Spec, marker: string): void {
	const file = join(dir, 'data/rbench_rig/functions/load.mcfunction')
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, `scoreboard objectives add rbench dummy\nscoreboard players set #cycle rbench ${spec.cycle}\nsay ${marker}\n`)
}

// The bench's own pack: replays the animations every `cycle` ticks while #mode is 2, and logs a marker on load.
export function benchPack(dir: string, spec: Spec): void {
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

// Removes the rigs, then (mode 1) places them or (mode 2) places and plays them.
export async function setMode(server: Server, spec: Spec, mode: number): Promise<void> {
	for (const rig of spec.rigs) server.send(rig.kill)
	if (mode >= 1) for (const rig of spec.rigs) server.send(rig.spawn)
	server.send(`scoreboard players set #mode rbench ${mode}`)
	if (mode === 2) server.send('function rbench_rig:play')
	await server.sync()
}
