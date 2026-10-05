// Synthetic data packs for the 1.20.4 benchmarks. Every experiment shares one pack (namespace rbench):
// its tick function dispatches on the score #mode rb, so the harness can alternate the baseline
// (mode 0, nothing runs) with the measured variants without reloading.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TARGET } from './target'

export const NS = 'rbench'
export const fn = (name: string) => `data/${NS}/${TARGET.functions}/${name}.mcfunction`

export type Files = Record<string, string>

export interface Experiment {
	name: string
	// Labels of the measured modes; mode 0 is always the idle baseline and is not listed here.
	modes: string[]
	files: Files
	// Function run once after /reload (summon entities, fill storage).
	setup: string
	// Bone entities the setup must have summoned; checked before measuring.
	bones: number
}

// [I; a, b, c, d] as the hyphenated form commands accept.
export function uuidString(ints: readonly [number, number, number, number]): string {
	const hex = (n: number, width: number) => (n >>> 0).toString(16).padStart(8, '0').slice(8 - width)
	const [a, b, c, d] = ints
	return `${hex(a, 8)}-${hex(b >>> 16, 4)}-${hex(b, 4)}-${hex(c >>> 16, 4)}-${hex(c, 4)}${hex(d, 8)}`
}

export function boneUuid(rig: number, bone: number): [number, number, number, number] {
	return [0x72626e63, rig + 1, 0, bone + 1]
}

export function rootUuid(rig: number): [number, number, number, number] {
	return [0x72626e63, rig + 1, 0, 0]
}

const intArray = (ints: readonly number[]) => `[I;${ints.join(',')}]`

// Packs a transformation the way the data pack writes it: floats with the f suffix.
export function transformation(t: readonly number[], scale = [1, 1, 1]): string {
	const f = (v: number) => `${Number(v.toFixed(4))}f`
	const list = (vs: readonly number[]) => `[${vs.map(f).join(',')}]`
	return `{translation:${list(t)},left_rotation:${list([0, 0, 0, 1])},scale:${list(scale)},right_rotation:${list([0, 0, 0, 1])}}`
}

export interface RigOptions {
	rigs: number
	bones: number
	tags: number
	item?: { model: boolean; name?: string }
	// false: bones are summoned on their own at the root's position instead of riding it
	ride?: boolean
	// Extra NBT appended to each bone, e.g. its transformation
	boneExtra?: (rig: number, bone: number) => string
}

// One root item_display per rig with its bones as passengers, all with fixed UUIDs, spaced along x.
export function summonRigs({ rigs, bones, tags, item = { model: true }, ride = true, boneExtra }: RigOptions): string {
	const boneTags = ['rb', 'rb.bone', ...Array.from({ length: tags }, (_, i) => `rb.t${i}`)].map((t) => `"${t}"`).join(',')
	const boneNbt = (r: number, b: number) =>
		`UUID:${intArray(boneUuid(r, b))},Tags:[${boneTags}],interpolation_duration:1,item:${TARGET.item(item)}${boneExtra ? `,${boneExtra(r, b)}` : ''}`
	const lines: string[] = []
	for (let r = 0; r < rigs; r++) {
		const root = `UUID:${intArray(rootUuid(r))},Tags:["rb","rb.root"]`
		if (ride) {
			const passengers = Array.from({ length: bones }, (_, b) => `{id:"minecraft:item_display",${boneNbt(r, b)}}`).join(',')
			lines.push(`summon item_display ${r * 4} -60 0 {${root},Passengers:[${passengers}]}`)
		} else {
			lines.push(`summon item_display ${r * 4} -60 0 {${root}}`)
			for (let b = 0; b < bones; b++) lines.push(`summon item_display ${r * 4} -60 0 {${boneNbt(r, b)}}`)
		}
	}
	return lines.join('\n')
}

function common(load: string): Files {
	return {
		'pack.mcmeta': JSON.stringify(TARGET.packMeta),
		[`data/minecraft/tags/${TARGET.functions}/load.json`]: JSON.stringify({ values: [`${NS}:load`] }),
		[`data/minecraft/tags/${TARGET.functions}/tick.json`]: JSON.stringify({ values: [`${NS}:tick`] }),
		[fn('load')]: [
			'scoreboard objectives add rb dummy',
			'scoreboard objectives add rb.bone dummy',
			'scoreboard players set #mode rb 0',
			'scoreboard players set #p rb 0',
			`say ${load}`,
		].join('\n'),
		[fn('clear')]: 'kill @e[tag=rb]',
	}
}

// Writes the pack into the world's datapacks folder, replacing the previous one. `load` is the text the
// load function prints, so the harness can tell when this version of the pack has been loaded.
export function writePack(world: string, experiment: Experiment, load: string): void {
	const root = join(world, 'datapacks', NS)
	rmSync(root, { recursive: true, force: true })
	const files: Files = {
		...common(load),
		...experiment.files,
		[fn('setup')]: experiment.setup,
	}
	for (const [path, content] of Object.entries(files)) {
		const file = join(root, path)
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`)
	}
}

// Runs `a` on even ticks and `b` on odd ticks while #mode is `mode`, so every write changes the value.
function alternate(mode: number, a: string, b: string): string {
	return [
		`execute if score #mode rb matches ${mode} if score #p rb matches 0 run function ${a}`,
		`execute if score #mode rb matches ${mode} if score #p rb matches 1 run function ${b}`,
	].join('\n')
}

const TOGGLE = ['scoreboard players add #p rb 1', 'execute if score #p rb matches 2 run scoreboard players set #p rb 0'].join('\n')

// E1: the cost of one write. Every bone of every rig gets `data merge entity <uuid>` each tick with a
// value that differs from the previous tick, so each write saves, compares and reloads the entity.
export function e1WriteCost(rig: RigOptions): Experiment {
	const write = (frame: number) => {
		const lines: string[] = []
		for (let r = 0; r < rig.rigs; r++)
			for (let b = 0; b < rig.bones; b++)
				lines.push(`data merge entity ${uuidString(boneUuid(r, b))} {transformation:${transformation([0, frame * 0.1, b * 0.01])},start_interpolation:0}`)
		return lines.join('\n')
	}
	return {
		name: 'e1',
		modes: ['write'],
		setup: summonRigs(rig),
		bones: rig.rigs * rig.bones,
		files: {
			[fn('tick')]: [alternate(1, `${NS}:e1/a`, `${NS}:e1/b`), TOGGLE].join('\n'),
			[fn('e1/a')]: write(0),
			[fn('e1/b')]: write(1),
		},
	}
}
