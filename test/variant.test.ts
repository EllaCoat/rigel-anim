import { describe, expect, test } from 'bun:test'
import { variantCalls, variantCuts } from '../src/export/variant-keys'
import { DEFAULT_VARIANT_ID, freeName, newVariant, readVariants, writeVariants, type StoredVariant } from '../src/variant/settings'

const project = (rigel_variants: unknown) => ({ rigel_variants, saved: true }) as unknown as ModelProject
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('stored variants', () => {
	test('a variant saved before uuids existed gets one, and keeps it on every later read', () => {
		const p = project([{ name: 'blink', textures: [['a', 'b']], excluded: ['g'], onApply: 'demo:blink' }])
		const [first] = readVariants(p)
		expect(first!.uuid).toMatch(UUID)
		expect(first).toMatchObject({ name: 'blink', textures: [['a', 'b']], excluded: ['g'], onApply: 'demo:blink' })
		expect(readVariants(p)[0]!.uuid).toBe(first!.uuid)
	})

	test('a uuid that is taken, or is the original look, is replaced', () => {
		const p = project([
			{ uuid: 'one', name: 'a' },
			{ uuid: 'one', name: 'b' },
			{ uuid: DEFAULT_VARIANT_ID, name: 'c' },
		])
		const uuids = readVariants(p).map((v) => v.uuid)
		expect(uuids[0]).toBe('one')
		expect(new Set(uuids).size).toBe(3)
		expect(uuids).not.toContain(DEFAULT_VARIANT_ID)
	})

	test('malformed entries and fields are dropped or emptied', () => {
		const p = project([null, 4, { uuid: 'x', name: 3, textures: [['a'], ['b', 'c'], 'd'], excluded: ['g', 5], onApply: null }])
		expect(readVariants(p)).toEqual([{ uuid: 'x', name: '', textures: [['b', 'c']], excluded: ['g'], onApply: '' }])
		expect(readVariants(project(undefined))).toEqual([])
	})

	test('writing copies the lists and marks the project unsaved', () => {
		const p = project([])
		const v: StoredVariant = { uuid: 'u', name: 'smile', textures: [], excluded: [], onApply: '' }
		writeVariants(p, [v])
		v.textures.push(['a', 'b'])
		v.excluded.push('g')
		expect(readVariants(p)).toEqual([{ uuid: 'u', name: 'smile', textures: [], excluded: [], onApply: '' }])
		expect((p as unknown as { saved: boolean }).saved).toBe(false)
	})

	test('free names count up from the second', () => {
		const taken = [newVariant('face'), newVariant('face_2')]
		expect(freeName('face', [])).toBe('face')
		expect(freeName('face', taken)).toBe('face_3')
		expect(newVariant('a').uuid).not.toBe(newVariant('a').uuid)
	})
})

describe('variant calls', () => {
	const key = (time: number, variant: string) => ({ time, variant })

	test('a keyframe lands on the nearest tick, and the later of two on one tick wins', () => {
		expect([...variantCalls('hold', 20, [key(0.075, 'a'), key(0.5, 'b'), key(0.52, 'c'), key(0.49, 'd')])]).toEqual([
			[2, 'a'],
			[10, 'c'],
		])
		expect([...variantCalls('once', 20, [key(0.52, 'c'), key(0.49, 'd')])]).toEqual([[10, 'c']])
	})

	test('a time past the last tick lands on it', () => {
		expect([...variantCalls('hold', 20, [key(1.2, 'a')])]).toEqual([[20, 'a']])
	})

	test("a loop applies tick 0's variant on its last tick, and a keyframe there counts as one on tick 0", () => {
		expect([...variantCalls('loop', 20, [key(0, 'a'), key(0.5, 'b')])]).toEqual([[0, 'a'], [10, 'b'], [20, 'a']])
		expect([...variantCalls('loop', 20, [key(1, 'z')])]).toEqual([[0, 'z'], [20, 'z']])
		expect([...variantCalls('loop', 20, [key(0, 'a'), key(1, 'z')])]).toEqual([[0, 'z'], [20, 'z']])
		expect([...variantCalls('loop', 0, [key(0, 'a')])]).toEqual([[0, 'a']])
	})

	test('only bones a variant rewrites are cut, the tick before it is applied', () => {
		const cuts = variantCuts(new Map([[0, 'a'], [10, 'a'], [20, 'b']]), (variant) => new Set(variant === 'a' ? [0, 1] : [1]))
		expect(cuts(0)).toEqual([9])
		expect(cuts(1)).toEqual([9, 19])
		expect(cuts(2)).toEqual([])
	})
})
