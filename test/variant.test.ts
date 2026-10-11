import { describe, expect, test } from 'bun:test'
import { variantCalls, variantCuts } from '../src/export/variant-keys'
import { notShowing } from '../src/variant/keyframes'
import { variantAt, variantsByBone, viewPlan } from '../src/variant/keys'
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

	test("a loop applies tick 0's variant on its last tick, and a keyframe there counts as one on tick 0 only where tick 0 has none", () => {
		expect([...variantCalls('loop', 20, [key(0, 'a'), key(0.5, 'b')])]).toEqual([[0, 'a'], [10, 'b'], [20, 'a']])
		expect([...variantCalls('loop', 20, [key(1, 'z')])]).toEqual([[0, 'z'], [20, 'z']])
		expect([...variantCalls('loop', 20, [key(0, 'a'), key(1, 'z')])]).toEqual([[0, 'a'], [20, 'a']])
		expect([...variantCalls('loop', 20, [key(1, 'z'), key(0.02, 'b'), key(0, 'a')])]).toEqual([[0, 'b'], [20, 'b']])
		expect([...variantCalls('loop', 20, [key(0.5, 'b'), key(1, 'z')])]).toEqual([[10, 'b'], [0, 'z'], [20, 'z']])
		expect([...variantCalls('loop', 0, [key(0, 'a')])]).toEqual([[0, 'a']])
	})

	test('only bones a variant rewrites are cut, the tick before it is applied', () => {
		const cuts = variantCuts(new Map([[0, 'a'], [10, 'a'], [20, 'b']]), (variant) => new Set(variant === 'a' ? [0, 1] : [1]))
		expect(cuts(0)).toEqual([9])
		expect(cuts(1)).toEqual([9, 19])
		expect(cuts(2)).toEqual([])
	})
})

describe('variant at a time', () => {
	const keys = [{ time: 1, variant: 'b' }, { time: 0.5, variant: 'a' }, { time: 2, variant: 'c' }]

	test('is the last keyframe at or before the time', () => {
		expect(variantAt(keys, 0.5)).toBe('a')
		expect(variantAt(keys, 0.99)).toBe('a')
		expect(variantAt(keys, 1)).toBe('b')
		expect(variantAt(keys, 5)).toBe('c')
	})

	test('a playhead a hair before a keyframe counts as on it', () => {
		expect(variantAt(keys, 1 - 1e-6)).toBe('b')
		expect(variantAt(keys, 1 - 1e-3)).toBe('a')
	})

	test('before the first keyframe it is still what the last one set, and with none there is nothing', () => {
		expect(variantAt(keys, 0)).toBe('c')
		expect(variantAt([], 3)).toBeUndefined()
	})

	test('keyframes at one time give the later in the list', () => {
		expect(variantAt([{ time: 1, variant: 'x' }, { time: 1, variant: 'y' }], 1)).toBe('y')
	})
})

describe('keyframes that change', () => {
	const keyframe = (variant?: string) => ({ data_points: [{ variant }] }) as unknown as BBKeyframe

	test('a keyframe that already shows the variant is left out, so that setting it adds no undo step', () => {
		const [a, b, none] = [keyframe('x'), keyframe('y'), keyframe(undefined)]
		expect(notShowing([a!, b!], 'x')).toEqual([b!])
		expect(notShowing([a!], 'x')).toEqual([])
		expect(notShowing([none!], 'default')).toEqual([])
	})
})

describe('variants by bone', () => {
	const bones = ['body', 'face']
	// bodyV leaves the face alone, faceV leaves the body alone.
	const excluded = new Map([['bodyV', new Set(['face'])], ['faceV', new Set(['body'])]])
	const key = (time: number, variant: string) => ({ time, variant })
	const wear = (keys: ReturnType<typeof key>[], time: number, chosen = 'default') => Object.fromEntries(variantsByBone(keys, time, bones, excluded, chosen))

	test('a variant that leaves a bone out does not undo what an earlier keyframe gave that bone', () => {
		const keys = [key(0, 'bodyV'), key(1, 'faceV')]
		expect(wear(keys, 0.5)).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear(keys, 1.5)).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear([key(0, 'faceV'), key(1, 'bodyV')], 1.5)).toEqual({ body: 'bodyV', face: 'faceV' })
	})

	test('a later keyframe replaces the ones before it only on the bones it applies to', () => {
		expect(wear([key(0, 'bodyV'), key(1, 'faceV'), key(2, 'bodyV')], 2.5)).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear([key(0, 'bodyV'), key(1, 'faceV'), key(2, 'default')], 1.5)).toEqual({ body: 'bodyV', face: 'faceV' })
	})

	test('default applies to every bone', () => {
		expect(wear([key(0, 'bodyV'), key(1, 'default')], 1.5)).toEqual({ body: 'default', face: 'default' })
		expect(wear([key(0, 'default'), key(1, 'faceV')], 1.5)).toEqual({ body: 'default', face: 'faceV' })
	})

	test('before the first keyframe a bone wears the last keyframe that applies to it, as a loop carries it over', () => {
		const keys = [key(0.5, 'faceV'), key(1, 'bodyV')]
		expect(wear(keys, 0.2)).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear(keys, 0.5)).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear([key(0.5, 'bodyV'), key(1, 'default')], 0.2)).toEqual({ body: 'default', face: 'default' })
	})

	test('a playhead a hair before a keyframe counts as on it', () => {
		expect(wear([key(0, 'bodyV'), key(1, 'default')], 1 - 1e-6)).toEqual({ body: 'default', face: 'default' })
		expect(wear([key(0, 'bodyV'), key(1, 'default')], 1 - 1e-3)).toEqual({ body: 'bodyV', face: 'default' })
	})

	test('keyframes at one time give the later in the list', () => {
		expect(wear([key(1, 'bodyV'), key(1, 'default')], 1)).toEqual({ body: 'default', face: 'default' })
	})

	test('without keyframes, a bone wears the chosen variant unless that one leaves it out', () => {
		expect(wear([], 3, 'bodyV')).toEqual({ body: 'bodyV', face: 'default' })
		expect(wear([], 3, 'faceV')).toEqual({ body: 'default', face: 'faceV' })
		expect(wear([], 3)).toEqual({ body: 'default', face: 'default' })
	})

	test('a bone no keyframe applies to wears the chosen variant, and the others follow their keyframes', () => {
		expect(wear([key(0, 'faceV')], 1, 'bodyV')).toEqual({ body: 'bodyV', face: 'faceV' })
		expect(wear([key(0, 'faceV')], 1, 'faceV')).toEqual({ body: 'default', face: 'faceV' })
	})
})

describe('view plan', () => {
	const bones = ['body', 'face']
	const excluded = new Map([['bodyV', new Set(['face'])], ['faceV', new Set(['body'])]])
	const plan = (input: Partial<Parameters<typeof viewPlan>[0]>) => {
		const { byBone, other, headline } = viewPlan({ painting: false, keys: [], time: 0, bones, excluded, chosen: 'default', ...input })
		return { byBone: Object.fromEntries(byBone), other, headline }
	}

	test('the paint view draws the original model whatever is chosen or keyed', () => {
		const original = { byBone: { body: 'default', face: 'default' }, other: 'default', headline: 'default' }
		expect(plan({ painting: true, chosen: 'bodyV', keys: [{ time: 0, variant: 'faceV' }] })).toEqual(original)
		expect(plan({ painting: false, chosen: 'bodyV' })).not.toEqual(original)
	})

	test('the headline is the keyframe at the playhead, or the chosen variant without keyframes', () => {
		expect(plan({ keys: [{ time: 0, variant: 'bodyV' }, { time: 1, variant: 'faceV' }], time: 1.5, chosen: 'bodyV' }).headline).toBe('faceV')
		expect(plan({ chosen: 'faceV' })).toEqual({ byBone: { body: 'default', face: 'faceV' }, other: 'faceV', headline: 'faceV' })
	})

	test('a keyframe or a choice naming a variant that is gone draws the original model', () => {
		expect(plan({ keys: [{ time: 0, variant: 'gone' }], time: 1 })).toEqual({ byBone: { body: 'default', face: 'default' }, other: 'default', headline: 'default' })
		expect(plan({ chosen: 'gone' }).byBone).toEqual({ body: 'default', face: 'default' })
	})
})
