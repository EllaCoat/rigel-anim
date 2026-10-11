import { describe, expect, test } from 'bun:test'
import type { Vec3 } from '../src/bake/matrix'
import { buildExport, ExportError } from '../src/export/build'
import { blockStateNbt, displayNbt, snbtProblem, textJson, topLevelKeys } from '../src/export/display'
import { DEFAULT_TOLERANCE } from '../src/export/settings'
import type { AnimationSource, BoneSource, DisplaySettings, Files, RigSettings, RigSource, TextureSource } from '../src/export/types'

const settings: RigSettings = { rig: 'axia', id: 0x1a2b3c4d, item: 'minecraft:white_dye', chunkLines: 500, span: 20 }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const fn = (path: string) => `data/rigel/functions/axia/${path}.mcfunction`
const lines = (files: Files, path: string) => {
	const content = files.get(path)
	if (typeof content !== 'string') throw new Error(`no text file ${path}`)
	return content.trimEnd().split('\n')
}
const texture = (name: string, size: number): TextureSource => ({ name, png: new Uint8Array([137, 80, 78, 71]), uvWidth: size, uvHeight: size })
const bone = (name: string, texture?: number, display?: DisplaySettings): BoneSource => ({
	name,
	pivot: [0, 0, 0],
	cubes:
		texture === undefined
			? []
			: [{ name: 'c', from: [-2, 0, -2], to: [2, 4, 2], inflate: 0, origin: [0, 0, 0], rotation: [0, 0, 0], shade: true, faces: { north: { uv: [0, 0, 4, 4], texture, rotation: 0, tint: -1 } } }],
	display,
})
const still = (bones: number, locators: number[][] = [[]]): AnimationSource => ({
	name: 'idle',
	loop: 'loop',
	ticks: locators.length - 1,
	priority: 'high',
	thin: 'project',
	matrices: Float64Array.from(locators.flatMap(() => Array.from({ length: bones }, () => identity).flat())),
	locators: Float64Array.from(locators.flat()),
})
const rig = (overrides: Partial<RigSource>): RigSource => {
	const bones = overrides.bones ?? [bone('Body', 0)]
	return {
		bones,
		textures: [texture('skin', 32)],
		rest: Float64Array.from(bones.flatMap(() => identity)),
		locators: [],
		locatorRest: new Float64Array(),
		variants: [],
		animations: [still(bones.length)],
		...overrides,
	}
}
const problems = (source: RigSource) => {
	try {
		buildExport(source, settings, undefined)
		return []
	} catch (error) {
		if (error instanceof ExportError) return error.problems
		throw error
	}
}

test('thinning starts from a tolerance of 0', () => {
	expect(DEFAULT_TOLERANCE).toEqual({ position: 0, rotation: 0 })
})

describe('variant', () => {
	const textures = [texture('skin', 32), texture('skin_alt', 32), texture('eye', 16), texture('eye_closed', 16), texture('tiny', 8)]
	const source = rig({
		bones: [bone('Body', 0), bone('Head', 2)],
		textures,
		variants: [
			{ name: 'blink', textures: [[2, 3]], excluded: [], onApply: 'demo:blink' },
			{ name: 'dark', textures: [[0, 1]], excluded: [1], onApply: '' },
		],
	})
	const result = buildExport(source, settings, undefined)
	const merge = (n: number, cmd: number) => `data merge entity 1a2b3c4d-0-0-0-${n} {item:{tag:{CustomModelData:${cmd}}}}`

	test('a variant model keeps the parent and overrides only the replaced textures', () => {
		expect(JSON.parse(result.resources.get('assets/rigel/models/axia/blink/head.json') as string)).toEqual({
			parent: 'rigel:axia/head',
			textures: { '2': 'rigel:item/axia/eye_closed', particle: 'rigel:item/axia/eye_closed' },
		})
		expect(result.resources.has('assets/rigel/models/axia/blink/body.json')).toBe(false)
		expect(JSON.parse(result.itemModel.json).overrides.map((o: { model: string }) => o.model)).toEqual(['rigel:axia/body', 'rigel:axia/head', 'rigel:axia/blink/head', 'rigel:axia/dark/body'])
	})

	test('a variant writes every bone some variant changes, except the ones it excludes, then calls its function', () => {
		const root = 'execute unless entity 1a2b3c4d-0-0-0-0 run return fail'
		expect(lines(result.rigPack, fn('variant/blink'))).toEqual([root, merge(1, 1), merge(2, 3), 'function demo:blink'])
		expect(lines(result.rigPack, fn('variant/dark'))).toEqual([root, merge(1, 4)])
		expect(lines(result.rigPack, fn('variant/default'))).toEqual([root, merge(1, 1), merge(2, 2)])
	})

	test('no variants, no variant functions', () => {
		expect([...buildExport(rig({}), settings, undefined).rigPack.keys()].some((k) => k.includes('/variant/'))).toBe(false)
	})

	test('names, texture sizes and the function are checked', () => {
		const bad = (v: RigSource['variants'][number]) => problems({ ...source, variants: [v] })
		expect(bad({ name: 'default', textures: [], excluded: [], onApply: '' })).toHaveLength(1)
		expect(bad({ name: 'Blink', textures: [], excluded: [], onApply: '' })).toHaveLength(1)
		expect(bad({ name: 'small', textures: [[0, 4]], excluded: [], onApply: '' })).toHaveLength(1)
		expect(bad({ name: 'call', textures: [], excluded: [], onApply: 'not a function' })).toHaveLength(1)
		expect(problems({ ...source, variants: [source.variants[0]!, source.variants[0]!] })).toHaveLength(1)
	})
})

describe('locator', () => {
	const source = rig({
		locators: [{ name: 'Hand' }, { name: 'hit', entity: { type: 'slime', nbt: '{NoAI:1b}' } }],
		locatorRest: Float64Array.from([0, 1, 0, 0.5, 0, 0]),
		animations: [
			still(1, [
				[0, 1, 0, 0.5, 0, 0],
				[0, 1.5, 0, 0.5, 0, 0],
				[0, 1.5, 0, 0.5, 0, 0],
			]),
		],
	})
	const pack = buildExport(source, settings, undefined).rigPack
	const hand = (y: string) => `data modify storage rigel:axia Locators.hand set value {x:0d,y:${y}d,z:0d}`
	const hit = ['data modify storage rigel:axia Locators.hit set value {x:.5d,y:0d,z:0d}', 'execute at 1a2b3c4d-0-0-0-0 run tp 1a2b3c4d-0-0-0-3 ^.5 ^0 ^0 ~ ~']

	test('frames write a locator only when it moves, and a loop shows frame 0 last', () => {
		expect(lines(pack, fn('frames/0/0')).filter((l) => !l.startsWith('$') && !l.startsWith('execute if score'))).toEqual([hand('1'), ...hit])
		expect(lines(pack, fn('frames/0/1'))).toContain(hand('1.5'))
		expect(lines(pack, fn('frames/0/1')).some((l) => l.includes('hit'))).toBe(false)
		expect(lines(pack, fn('frames/0/2'))).toContain(hand('1'))
	})

	test('spawn places the locators and summons the entity ones, which tp and kill follow', () => {
		const spawn = lines(pack, fn('spawn'))
		expect(spawn).toContain('data modify storage rigel:axia Locators set value {hand:{x:0d,y:1d,z:0d},hit:{x:.5d,y:0d,z:0d}}')
		expect(spawn).toContain('execute at 1a2b3c4d-0-0-0-0 run summon minecraft:slime ~ ~ ~ {UUID:[I;439041101,0,0,3],NoAI:1b}')
		expect(spawn).toContain('tag 1a2b3c4d-0-0-0-3 add rigel.axia.hit')
		expect(spawn.indexOf('function rigel:axia/tp')).toBeGreaterThan(spawn.indexOf('tag 1a2b3c4d-0-0-0-3 add rigel.axia.hit'))
		expect(lines(pack, fn('tp')).at(-1)).toBe('function rigel:axia/locator/hit/place with storage rigel:axia Locators.hit')
		expect(lines(pack, fn('locator/hit/place'))).toEqual(['$execute at 1a2b3c4d-0-0-0-0 run tp 1a2b3c4d-0-0-0-3 ^$(x) ^$(y) ^$(z) ~ ~'])
		expect(lines(pack, fn('kill'))).toContain('kill 1a2b3c4d-0-0-0-3')
		expect(pack.has(fn('locator/hand/place'))).toBe(false)
		expect(lines(pack, fn('rest'))).toEqual(expect.arrayContaining([hand('1'), ...hit]))
	})

	test('at_locator runs the function at the locator with the rig facing', () => {
		expect(lines(pack, fn('at_locator/hand'))).toEqual([
			'data modify storage rigel:axia At set from storage rigel:axia Locators.hand',
			'$data modify storage rigel:axia At.function set value "$(function)"',
			'function rigel:axia/locator/at with storage rigel:axia At',
		])
		expect(lines(pack, fn('locator/at'))).toEqual(['$execute at 1a2b3c4d-0-0-0-0 positioned ^$(x) ^$(y) ^$(z) run function $(function)'])
	})

	test('entity types and summon NBT are checked', () => {
		expect(problems({ ...source, locators: [{ name: 'a', entity: { type: 'Slime!', nbt: '' } }] })).toHaveLength(1)
		expect(problems({ ...source, locators: [{ name: 'a', entity: { type: 'marker', nbt: '{Tags:[a}' } }] })).toHaveLength(1)
		expect(problems({ ...source, locators: [{ name: 'a', entity: { type: 'marker', nbt: '{UUID:[I;1,2,3,4]}' } }] })).toHaveLength(1)
	})
})

describe('display', () => {
	const common = { scale: [1, 1, 1] as Vec3, nbt: '' }
	const item: DisplaySettings = { ...common, kind: 'item', item: 'iron_axe', tag: '{CustomModelData:5}', mode: 'thirdperson_righthand', scale: [2, 2, 2], nbt: '{brightness:{block:15,sky:15}}' }
	const text: DisplaySettings = { ...common, kind: 'text', text: "It's", lineWidth: 120, background: 0x80ff0000, defaultBackground: false, textOpacity: 200, shadow: true, seeThrough: false, alignment: 'left' }
	const block: DisplaySettings = { ...common, kind: 'block', block: 'oak_stairs[facing=east, half=top]' }

	test('settings become the summon keys', () => {
		expect(displayNbt(item)).toBe('id:"minecraft:item_display",item:{id:"minecraft:iron_axe",Count:1b,tag:{CustomModelData:5}},item_display:"thirdperson_righthand",brightness:{block:15,sky:15}')
		expect(displayNbt(block)).toBe('id:"minecraft:block_display",block_state:{Name:"minecraft:oak_stairs",Properties:{facing:"east",half:"top"}}')
		expect(displayNbt(text)).toBe(
			`id:"minecraft:text_display",text:'"It\\'s"',line_width:120,background:${0x80ff0000 | 0},text_opacity:-56b,alignment:"left",shadow:1b,see_through:0b,default_background:0b`,
		)
	})

	test('text that is not JSON becomes a JSON string, and JSON is kept', () => {
		expect(textJson('hello')).toBe('"hello"')
		expect(textJson('{"text":"a", "color":"red"}')).toBe('{"text":"a","color":"red"}')
		expect(blockStateNbt('stone[bad]')).toBeUndefined()
	})

	test('SNBT is checked for one balanced compound', () => {
		expect(snbtProblem('{a:1,b:[1,2],c:"}"}')).toBeUndefined()
		for (const s of ['a:1', '{a:[1}', '{a:1}{b:2}', "{a:'x}"]) expect(snbtProblem(s)).toBeString()
		expect(topLevelKeys('{brightness:{block:15,sky:15},"Tags":["a,b:c"],view_range:2f}')).toEqual(['brightness', 'Tags', 'view_range'])
	})

	test('extra NBT may not set the keys the summon writes', () => {
		expect(problems(rig({ bones: [bone('Body', 0), bone('Ice', undefined, { ...block, nbt: '{Tags:["x"],brightness:{block:15,sky:15}}' })] }))).toHaveLength(1)
	})

	test('a display rides the root with its name as a tag, posed by its group and its scale', () => {
		const result = buildExport(rig({ bones: [bone('Body', 0), bone('Sword', undefined, item)] }), settings, undefined)
		const spawn = lines(result.rigPack, fn('spawn'))[1]!
		expect(spawn).toContain(
			'{id:"minecraft:item_display",item:{id:"minecraft:iron_axe",Count:1b,tag:{CustomModelData:5}},item_display:"thirdperson_righthand",brightness:{block:15,sky:15},UUID:[I;439041101,0,0,2],Tags:["rigel","rigel.axia","rigel.axia.sword"],interpolation_duration:1,transformation:[2f,0f,0f,0f,0f,2f,0f,0f,0f,0f,2f,0f,0f,0f,0f,1f]}',
		)
		expect(result.resources.has('assets/rigel/models/axia/sword.json')).toBe(false)
	})

	test('a display group must not hold cubes, and its settings are checked', () => {
		expect(problems(rig({ bones: [bone('Sword', 0, item)] }))).toHaveLength(1)
		expect(problems(rig({ bones: [bone('Body', 0), bone('Ice', undefined, { ...block, block: 'Ice Block' })] }))).toHaveLength(1)
	})
})
