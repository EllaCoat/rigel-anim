import { describe, expect, test } from 'bun:test'
import { DEFAULT_VARIANT_ID, readVariants, writeVariants, type StoredVariant } from '../src/variant/settings'

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
})
