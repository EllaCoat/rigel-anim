import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, promises, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compose, normalizeQuat, quatToMat3, type Quat, type Vec3 } from '../src/bake/matrix'
import { buildExport, ExportError, normalizeItem, settingsProblems } from '../src/export/build'
import { commonPack, rigPack, uuidString, type RigPackInput } from '../src/export/datapack'
import { formatFloat, planChunks, planFrames, poseString } from '../src/export/frames'
import { boneScale, itemModel } from '../src/export/item-model'
import { mergeItemModel } from '../src/export/resource-pack'
import type { AnimationSource, BoneSource, Files, RigSettings, RigSource, TextureSource } from '../src/export/types'
import { exportRig, type ExportFs } from '../src/export/write'

const text = (files: Files, path: string) => {
	const content = files.get(path)
	if (typeof content !== 'string') throw new Error(`no text file ${path}`)
	return content
}
const lines = (files: Files, path: string) => text(files, path).trimEnd().split('\n')

function axisAngle(axis: Vec3, degrees: number): Quat {
	const n = Math.hypot(...axis)
	const s = Math.sin((degrees * Math.PI) / 360) / n
	return normalizeQuat([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((degrees * Math.PI) / 360)])
}

const TEXTURE: TextureSource = { name: 'skin.png', png: new Uint8Array([137, 80, 78, 71]), uvWidth: 32, uvHeight: 32 }

function cube(from: Vec3, to: Vec3, extra: Partial<BoneSource['cubes'][number]> = {}): BoneSource['cubes'][number] {
	return {
		name: 'cube',
		from,
		to,
		inflate: 0,
		origin: [0, 0, 0],
		rotation: [0, 0, 0],
		shade: true,
		faces: { north: { uv: [0, 0, 8, 8], texture: 0, rotation: 0, tint: -1 } },
		...extra,
	}
}

describe('number format', () => {
	test('drops the leading zero and trailing zeros', () => {
		expect(formatFloat(0.5, 4)).toBe('.5f')
		expect(formatFloat(-0.25, 4)).toBe('-.25f')
		expect(formatFloat(1, 4)).toBe('1f')
		expect(formatFloat(0, 4)).toBe('0f')
		expect(formatFloat(-0.00001, 4)).toBe('0f')
		expect(formatFloat(12.345678, 4)).toBe('12.3457f')
		expect(formatFloat(-10, 4)).toBe('-10f')
		expect(formatFloat(0.1234567, 6)).toBe('.123457f')
	})
})

// Minecraft draws an item_display's model at transformation · (half a turn about y) · (model/16 − 0.5).
function drawn(pose: string, modelPoint: Vec3): Vec3 {
	const v = pose.split(',').map((s) => Number.parseFloat(s))
	const p: Vec3 = [-(modelPoint[0] / 16 - 0.5), modelPoint[1] / 16 - 0.5, -(modelPoint[2] / 16 - 0.5)]
	return [0, 1, 2].map((r) => v[r * 4]! * p[0] + v[r * 4 + 1]! * p[1] + v[r * 4 + 2]! * p[2] + v[r * 4 + 3]!) as Vec3
}

// Blockbench draws a cube corner at bone matrix · ((corner − pivot)/16), translation in blocks.
function blockbench(m: number[], pivot: Vec3, corner: Vec3): Vec3 {
	const e = corner.map((c, i) => (c - pivot[i]!) / 16)
	return [0, 1, 2].map((r) => m[r]! * e[0]! + m[4 + r]! * e[1]! + m[8 + r]! * e[2]! + m[12 + r]!) as Vec3
}

describe('item model and entity matrix', () => {
	const bone = (cubes: BoneSource['cubes']): BoneSource => ({ name: 'arm', pivot: [4, 12, -2], cubes })
	const corners = (from: Vec3, to: Vec3): Vec3[] => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? to[0] : from[0], i & 2 ? to[1] : from[1], i & 4 ? to[2] : from[2]])

	for (const [label, from, to] of [
		['within reach', [2, 4, -4], [6, 12, 0]],
		['shrunk to fit', [-40, 4, -4], [6, 60, 0]],
	] as [string, Vec3, Vec3][]) {
		test(`a drawn corner lands where Blockbench draws it (${label})`, () => {
			const b = bone([cube(from, to)])
			const errors: string[] = []
			const { json, scale } = itemModel(b, [TEXTURE], () => 'rigel:t/skin', errors)
			expect(errors).toEqual([])
			const element = (json as { elements: { from: Vec3; to: Vec3 }[] }).elements[0]!
			for (const v of [...element.from, ...element.to]) expect(Math.abs(v - 8)).toBeLessThanOrEqual(24 + 1e-9)
			const m = compose([1.5, -0.25, 2], axisAngle([1, 2, 3], 70), [1.2, 0.8, 1], axisAngle([0, 1, 0], 15))
			const pose = poseString(m, 0, scale)
			const modelCorners = corners(element.from, element.to)
			corners(from, to).forEach((corner, i) => {
				const a = drawn(pose, modelCorners[i]!)
				const e = blockbench(m, b.pivot, corner)
				for (let k = 0; k < 3; k++) expect(Math.abs(a[k]! - e[k]!)).toBeLessThan(1e-3)
			})
		})
	}

	test('k is the farthest cube end from the pivot over 24 px', () => {
		expect(boneScale(bone([cube([0, 0, 0], [8, 8, 8])]))).toBe(1)
		expect(boneScale(bone([cube([4, 12, -2], [4 + 48, 13, -1])]))).toBe(2)
		expect(boneScale(bone([cube([-20, 12, -2], [4, 13, -1], { inflate: 4 })]))).toBe(28 / 24)
	})

	test('UV is scaled to 16, and rotations Minecraft rejects are reported', () => {
		const errors: string[] = []
		const { json } = itemModel(
			bone([cube([0, 0, 0], [1, 1, 1], { rotation: [0, 30, 0] }), cube([0, 0, 0], [1, 1, 1], { name: 'two', rotation: [22.5, 22.5, 0] })]),
			[TEXTURE],
			() => 'rigel:t/skin',
			errors,
		)
		expect(errors.length).toBe(2)
		const faces = (json as { elements: { faces: { north: { uv: number[]; texture: string } } }[] }).elements[0]!.faces
		expect(faces.north).toEqual({ uv: [0, 0, 4, 4], texture: '#0' })
		expect((json as { textures: Record<string, string> }).textures).toEqual({ 0: 'rigel:t/skin', particle: 'rigel:t/skin' })
	})
})

describe('frames', () => {
	const poses = [
		['a', 'b', 'c'],
		['a', 'B', 'c'],
		['A', 'B', 'c'],
	]

	test('f/0 writes every bone and later frames only the changed ones', () => {
		expect(planFrames('hold', poses)).toEqual([
			{ writes: [0, 1, 2], pose: 0 },
			{ writes: [1], pose: 1 },
			{ writes: [0], pose: 2 },
		])
	})

	test("a loop's last frame goes back to frame 0", () => {
		expect(planFrames('loop', poses)[2]).toEqual({ writes: [1], pose: 0 })
	})

	test('chunks hold whole frames up to the line limit', () => {
		const items = (sizes: number[]) => sizes.map((lines, frame) => ({ animation: 0, frame, lines }))
		expect(planChunks(items([250, 250, 250, 250, 250, 250]), 1000).map((c) => c.length)).toEqual([4, 2])
		expect(planChunks(items([250, 100, 100, 100, 100, 100, 100, 100, 100]), 1000).map((c) => c.length)).toEqual([8, 1])
		expect(planChunks(items([10, 1200, 10]), 1000).map((c) => c.length)).toEqual([1, 1, 1])
	})
})

describe('data pack', () => {
	const input = (overrides: Partial<RigPackInput> = {}): RigPackInput => ({
		rig: 'axia',
		id: 0x1a2b3c4d,
		item: 'minecraft:white_dye',
		chunkLines: 3,
		bones: [
			{ cmd: 4, rest: 'r0' },
			{ cmd: 5, rest: 'r1' },
		],
		animations: [
			{ name: 'idle', loop: 'loop', priority: 'high', poses: [['a', 'b'], ['a', 'B'], ['A', 'B']] },
			{ name: 'swing', loop: 'once', priority: 'xhigh', poses: [['c', 'd'], ['C', 'd']] },
			{ name: 'down', loop: 'hold', priority: 'high', poses: [['e', 'f']] },
		],
		...overrides,
	})
	const fn = (path: string) => `data/rigel/functions/axia/${path}.mcfunction`
	const files = rigPack(input())

	test('frame functions write the changed bones and end each loop mode', () => {
		const warm = 'execute if score $Rigel.axia Rigel.Warming matches 1 run return 0'
		const write = (n: number, values: string) => `$data merge entity 1a2b3c4d-0-0-0-${n} {transformation:[${values}$(_)`
		expect(lines(files, fn('frames/0/0'))).toEqual([warm, write(1, 'a'), write(2, 'b')])
		expect(lines(files, fn('frames/0/1'))).toEqual([warm, write(2, 'B')])
		expect(lines(files, fn('frames/0/2'))).toEqual([warm, write(2, 'b'), 'scoreboard players set $Rigel.axia Rigel.Frame 0'])
		expect(lines(files, fn('frames/1/1'))).toEqual([warm, write(1, 'C')])
		expect(lines(files, fn('frames/1/2'))).toEqual([warm, 'function rigel:axia/rest', 'scoreboard players set $Rigel.axia Rigel.Playing 0'])
		expect(lines(files, fn('frames/2/0'))).toEqual([warm, write(1, 'e'), write(2, 'f'), 'scoreboard players set $Rigel.axia Rigel.Playing 0'])
	})

	test('warm chunks follow priority, f/0 first, and register in load', () => {
		const call = (a: number, f: number) => `function rigel:axia/frames/${a}/${f} with storage rigel:const FrameArgs`
		expect(lines(files, fn('warm/xhigh/0'))).toEqual([
			'scoreboard players set $Rigel.axia Rigel.Warming 1',
			call(1, 0),
			call(1, 1),
			'scoreboard players set $Rigel.axia Rigel.Warming 0',
			'data remove storage rigel:warm XHigh[0]',
			'return 1',
		])
		const high = [0, 1, 2].map((c) => lines(files, fn(`warm/high/${c}`)))
		expect(high.flatMap((chunk) => chunk.filter((l) => l.startsWith('function ')))).toEqual([call(0, 0), call(2, 0), call(0, 1), call(0, 2)])
		expect(high[0]).toContain('data modify storage rigel:warm High[0].Chunk set value 1')
		expect(high[2]).toContain('data remove storage rigel:warm High[0]')
		expect(files.has(fn('warm/high/3'))).toBe(false)
		expect(files.has(fn('warm/low/0'))).toBe(false)
		const load = lines(files, fn('load'))
		expect(load).toContain('data modify storage rigel:warm XHigh append value {Rig:"axia",Tier:"xhigh",Chunk:0}')
		expect(load).toContain('data modify storage rigel:warm High append value {Rig:"axia",Tier:"high",Chunk:0}')
		expect(load.some((l) => l.includes('Low append'))).toBe(false)
		expect(load.at(-1)).toBe('scoreboard players set $Rigel.Warm Rigel.Warming 1')
	})

	test('play checks the ID range and writes f/0 on the same tick', () => {
		const play = lines(files, fn('play'))
		expect(play.slice(0, 3)).toEqual(['# 0: idle', '# 1: swing', '# 2: down'])
		expect(play).toContain('execute unless score $Rigel.ID Rigel.Temp matches 0..2 run return fail')
		expect(play.at(-1)).toBe('$function rigel:axia/frames/$(ID)/0 with storage rigel:const FrameArgs')
	})

	test('spawn summons the root with every bone riding it', () => {
		const spawn = lines(files, fn('spawn'))
		expect(spawn[0]).toBe('execute if entity 1a2b3c4d-0-0-0-0 run return fail')
		expect(spawn[1]).toContain('UUID:[I;439041101,0,0,0]')
		expect(spawn[1]).toContain('UUID:[I;439041101,0,0,2],Tags:["rigel","rigel.axia"],item:{id:"minecraft:white_dye",Count:1b,tag:{CustomModelData:5}},interpolation_duration:1,transformation:[r1,0f,0f,0f,1f]}')
		expect(lines(files, fn('tp'))).toEqual(['tp 1a2b3c4d-0-0-0-0 ~ ~ ~ ~ ~', 'execute as 1a2b3c4d-0-0-0-0 on passengers run tp @s ~ ~ ~ ~ ~'])
	})

	test('negative IDs keep the hex form', () => {
		expect(uuidString(0xfedcba98, 255)).toBe('fedcba98-0-0-0-ff')
		expect(lines(rigPack(input({ id: 0xfedcba98 })), fn('spawn'))[1]).toContain(`UUID:[I;${0xfedcba98 | 0},0,0,0]`)
	})

	test('the common pack drops a registration whose chunk cannot be called', () => {
		const common = commonPack()
		expect(lines(common, 'data/rigel/functions/core/warm/high.mcfunction')).toEqual([
			'scoreboard players set $Rigel.Done Rigel.Temp 0',
			'execute store result score $Rigel.Done Rigel.Temp run function rigel:core/warm/call with storage rigel:warm High[0]',
			'execute if score $Rigel.Done Rigel.Temp matches 0 run data remove storage rigel:warm High[0]',
		])
	})
})

describe('resource pack', () => {
	test('a new item model gets the flat item parent', () => {
		const { json, cmds } = mergeItemModel(undefined, 'minecraft:white_dye', 'axia', ['rigel:axia/a', 'rigel:axia/b'])
		expect(cmds).toEqual([1, 2])
		expect(JSON.parse(json)).toEqual({
			parent: 'minecraft:item/generated',
			textures: { layer0: 'minecraft:item/white_dye' },
			overrides: [
				{ predicate: { custom_model_data: 1 }, model: 'rigel:axia/a' },
				{ predicate: { custom_model_data: 2 }, model: 'rigel:axia/b' },
			],
		})
	})

	test("only this rig's overrides are replaced, with the smallest free numbers", () => {
		const existing = JSON.stringify({
			parent: 'x',
			overrides: [
				{ predicate: { custom_model_data: 1 }, model: 'rigel:other/a' },
				{ predicate: { custom_model_data: 2 }, model: 'rigel:axia/old' },
				{ predicate: { custom_model_data: 4 }, model: 'mypack:thing' },
			],
		})
		const { json, cmds } = mergeItemModel(existing, 'minecraft:white_dye', 'axia', ['rigel:axia/a', 'rigel:axia/b'])
		expect(cmds).toEqual([2, 3])
		expect(JSON.parse(json).overrides.map((o: { model: string }) => o.model)).toEqual(['rigel:other/a', 'rigel:axia/a', 'rigel:axia/b', 'mypack:thing'])
	})

	test('overrides with other predicates keep their order', () => {
		const existing = JSON.stringify({
			overrides: [
				{ predicate: { custom_model_data: 1 }, model: 'mypack:plain' },
				{ predicate: { pulling: 1 }, model: 'mypack:pulling' },
			],
		})
		const { json } = mergeItemModel(existing, 'minecraft:bow', 'axia', ['rigel:axia/a'])
		expect(JSON.parse(json).overrides.map((o: { model: string }) => o.model)).toEqual(['mypack:plain', 'mypack:pulling', 'rigel:axia/a'])
	})
})

describe('settings', () => {
	const settings = (s: Partial<RigSettings>): RigSettings => ({ rig: 'axia', id: 1, item: 'minecraft:white_dye', chunkLines: 500, ...s })
	test('reserved and malformed values are reported', () => {
		expect(settingsProblems(settings({}))).toEqual([])
		for (const rig of ['core', 'const', 'warm', 'rigel', 'Axia', 'a-b', '']) expect(settingsProblems(settings({ rig })).length).toBe(1)
		expect(settingsProblems(settings({ item: 'white dye' })).length).toBe(1)
		expect(settingsProblems(settings({ chunkLines: 0 })).length).toBe(1)
		expect(normalizeItem(' white_dye ')).toBe('minecraft:white_dye')
	})
})

// One bone with a cube, an identity rest pose and a two-tick loop that moves it up.
function source(): RigSource {
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
	const moved = (y: number) => identity.map((v, i) => (i === 13 ? y : v))
	const animation: AnimationSource = { name: 'bob', loop: 'loop', ticks: 2, priority: 'high', matrices: Float64Array.from([...moved(0), ...moved(0.5), ...moved(0)]) }
	return {
		bones: [{ name: 'Body', pivot: [0, 0, 0], cubes: [cube([-4, 0, -4], [4, 8, 4])] }],
		textures: [TEXTURE],
		rest: Float64Array.from(identity),
		animations: [animation],
	}
}

describe('export', () => {
	const settings: RigSettings = { rig: 'axia', id: 0x1a2b3c4d, item: 'minecraft:white_dye', chunkLines: 500 }

	test('matrices become the values written each frame', () => {
		const result = buildExport(source(), settings, undefined)
		expect(text(result.rigPack, 'data/rigel/functions/axia/frames/0/1.mcfunction')).toContain('{transformation:[-1f,0f,0f,0f,0f,1f,0f,.5f,0f,0f,-1f,0f$(_)')
		expect([...result.resources.keys()]).toEqual(['assets/rigel/models/axia/body.json', 'assets/rigel/textures/item/axia/skin.png'])
		expect(result.itemModel.path).toBe('assets/minecraft/models/item/white_dye.json')
	})

	test('problems are collected before anything is built', () => {
		expect(() => buildExport({ ...source(), bones: [{ name: 'empty', pivot: [0, 0, 0], cubes: [] }] }, { ...settings, rig: 'core' }, undefined)).toThrow(ExportError)
	})

	const nodeFs: ExportFs = {
		existsSync,
		readdirSync: (p) => readdirSync(p),
		readFileSync: (p, e) => readFileSync(p, e),
		writeFileSync,
		mkdirSync: (p, o) => mkdirSync(p, o),
		promises: { rm: (p, o) => promises.rm(p, o) },
	}
	const target = (root: string) => ({ datapacks: { fs: nodeFs, dir: join(root, 'datapacks') }, resourcePack: { fs: nodeFs, dir: join(root, 'resources') } })

	test('writes both packs and keeps other rigs in the shared resource pack', async () => {
		const root = mkdtempSync(join(tmpdir(), 'rigel-export-'))
		try {
			await exportRig(target(root), source(), settings)
			await exportRig(target(root), source(), { ...settings, rig: 'beta', id: 2 })
			await exportRig(target(root), source(), settings)
			expect(existsSync(join(root, 'datapacks/axia/data/rigel/functions/axia/spawn.mcfunction'))).toBe(true)
			expect(existsSync(join(root, 'datapacks/rigel/data/rigel/functions/core/tick.mcfunction'))).toBe(true)
			expect(existsSync(join(root, 'resources/pack.mcmeta'))).toBe(true)
			const item = JSON.parse(readFileSync(join(root, 'resources/assets/minecraft/models/item/white_dye.json'), 'utf8'))
			expect(item.overrides).toEqual([
				{ predicate: { custom_model_data: 1 }, model: 'rigel:axia/body' },
				{ predicate: { custom_model_data: 2 }, model: 'rigel:beta/body' },
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	test('refuses folders it did not write, and rigs of another project', async () => {
		const root = mkdtempSync(join(tmpdir(), 'rigel-export-'))
		try {
			mkdirSync(join(root, 'datapacks/axia'), { recursive: true })
			writeFileSync(join(root, 'datapacks/axia/mine.txt'), 'keep')
			await expect(exportRig(target(root), source(), settings)).rejects.toThrow(ExportError)
			expect(readFileSync(join(root, 'datapacks/axia/mine.txt'), 'utf8')).toBe('keep')

			rmSync(join(root, 'datapacks/axia'), { recursive: true })
			await exportRig(target(root), source(), settings)
			await expect(exportRig(target(root), source(), { ...settings, id: 99 })).rejects.toThrow(/別のプロジェクト/)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
