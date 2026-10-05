import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layouts, Q, syntheticAnim, VALUES, writeCompound } from '../bench/anim'
import { dispatch, loadStep, pipelines } from '../bench/experiments'
import { boneUuid, e1WriteCost, NS, summonRigs, uuidString, writePack } from '../bench/gen'

describe('uuidString', () => {
	test('matches the int-array layout Minecraft uses (most significant int first)', () => {
		expect(uuidString([0x72626e63, 1, 0, 1])).toBe('72626e63-0000-0001-0000-000000000001')
		expect(uuidString([-1, 0x12345678, 0x9abcdef0, -2])).toBe('ffffffff-1234-5678-9abc-def0fffffffe')
	})

	test('gives every bone of every rig its own UUID', () => {
		const all = new Set<string>()
		for (let r = 0; r < 3; r++) for (let b = 0; b < 250; b++) all.add(uuidString(boneUuid(r, b)))
		expect(all.size).toBe(750)
	})
})

describe('syntheticAnim', () => {
	const anim = syntheticAnim(4, 3)

	test('is deterministic and changes every frame', () => {
		expect(syntheticAnim(4, 3).values).toEqual(anim.values)
		for (let f = 1; f < anim.frames; f++)
			for (let b = 0; b < anim.bones; b++) {
				const at = (frame: number) => Array.from(anim.values.subarray((frame * anim.bones + b) * VALUES, (frame * anim.bones + b + 1) * VALUES))
				expect(at(f)).not.toEqual(at(f - 1))
			}
	})

	test('stores unit quaternions for the rotation', () => {
		for (let i = 0; i < anim.frames * anim.bones; i++) {
			const q = Array.from(anim.values.subarray(i * VALUES + 3, i * VALUES + 7), (v) => v / Q)
			expect(Math.hypot(...q)).toBeCloseTo(1, 3)
		}
	})
})

describe('layouts', () => {
	const anim = syntheticAnim(2, 3)

	test('frameInts holds one int array per frame with every bone', () => {
		const arrays = layouts.frameInts(anim).match(/\[I;[^\]]*\]/g)!
		expect(arrays).toHaveLength(2)
		expect(arrays[1]).toBe(`[I;${Array.from(anim.values.subarray(3 * VALUES, 6 * VALUES)).join(',')}]`)
	})

	test('boneInts holds one int array per bone with every frame', () => {
		const arrays = layouts.boneInts(anim).match(/\[I;[^\]]*\]/g)!
		expect(arrays).toHaveLength(3)
		expect(arrays[0]!.split(',')).toHaveLength(2 * VALUES)
	})

	test('frameWrites holds the compound written to each bone', () => {
		expect(layouts.frameWrites(anim).match(/start_interpolation:0/g)).toHaveLength(6)
		expect(writeCompound([10000, -5000, 1, 0, 0, 0, 10000, 10000, 20000, 15000])).toBe(
			'{transformation:{translation:[1f,-0.5f,0.0001f],left_rotation:[0f,0f,0f,1f],scale:[1f,2f,1.5f]},start_interpolation:0}',
		)
	})

	test('frameNamed and fork key every cell', () => {
		expect(layouts.frameNamed(anim).match(/b\d+:\{a:/g)).toHaveLength(6)
		expect(layouts.fork(anim).match(/"\d+":\[/g)).toHaveLength(6)
	})
})

describe('data packs', () => {
	test('summonRigs puts every bone on its rig root', () => {
		const lines = summonRigs({ rigs: 2, bones: 5, tags: 2 }).split('\n')
		expect(lines).toHaveLength(2)
		for (const line of lines) expect(line.match(/id:"minecraft:item_display"/g)).toHaveLength(5)
		expect(lines[0]).toContain('"rb.t1"')
	})

	test('every mode of an experiment has a tick function', () => {
		for (const experiment of [e1WriteCost({ rigs: 1, bones: 2, tags: 0 }), pipelines(1, 2, 3), dispatch(1, 3), loadStep([{ form: 'fork', cells: 2 }])]) {
			const tick = experiment.files[`data/${NS}/functions/tick.mcfunction`]!
			experiment.modes.forEach((_, i) => {
				expect(tick).toContain(`matches ${i + 1} `)
			})
		}
	})

	test('writePack replaces the previous pack and adds the load marker', () => {
		const world = mkdtempSync(join(tmpdir(), 'rbench-'))
		try {
			const experiment = e1WriteCost({ rigs: 1, bones: 2, tags: 0 })
			writePack(world, { ...experiment, files: { ...experiment.files, 'data/rbench/functions/stale.mcfunction': 'say old' } }, 'first')
			writePack(world, experiment, 'second')
			const pack = join(world, 'datapacks', NS)
			expect(JSON.parse(readFileSync(join(pack, 'pack.mcmeta'), 'utf8')).pack.pack_format).toBe(26)
			expect(readFileSync(join(pack, 'data/rbench/functions/load.mcfunction'), 'utf8')).toContain('say second')
			expect(() => readFileSync(join(pack, 'data/rbench/functions/stale.mcfunction'))).toThrow()
		} finally {
			rmSync(world, { recursive: true, force: true })
		}
	})
})
