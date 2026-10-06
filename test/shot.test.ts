import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { blockbenchCamera, EYE_HEIGHT, lookDirection, parseSpec, teleportArgs } from '../scripts/shot-spec'

const view = { name: 'front', eye: [0, 1.2, 3.5], yaw: 180, pitch: 10 }

describe('parseSpec', () => {
	test('fills in the optional fields', () => {
		const spec = parseSpec({ origin: [0, -60, 0], views: [view] })
		expect(spec).toEqual({ origin: [0, -60, 0], views: [view as any], setup: [], datapacks: [], resourcePacks: [], model: undefined, settleMs: 1500 })
	})

	test.each([
		[{ origin: [0, 0, 0], views: [] }, 'views must list at least one view'],
		[{ origin: [0, 0], views: [view] }, 'origin must be three numbers'],
		[{ origin: [0, 0, 0], views: [{ ...view, pitch: 90 }] }, 'views[0].pitch must be between -90 and 90'],
		[{ origin: [0, 0, 0], views: [{ ...view, name: 'a b' }] }, 'views[0].name must be letters'],
		[{ origin: [0, 0, 0], views: [view, view] }, 'view names must be unique'],
		[{ origin: [0, 0, 0], views: [view], model: 'rig.ajblueprint' }, 'model must be a .bbmodel path'],
		[{ origin: [0, 0, 0], views: [view], setup: 'say hi' }, 'setup must be a list of strings'],
	])('rejects %j', (input, message) => {
		expect(() => parseSpec(input)).toThrow(message)
	})

	test('accepts the example spec, whose packs and model exist', () => {
		const path = join(import.meta.dir, '..', 'scripts', 'shots', 'cube.json')
		const spec = parseSpec(JSON.parse(readFileSync(path, 'utf8')))
		for (const file of [...spec.datapacks, ...spec.resourcePacks, spec.model!]) expect(existsSync(resolve(dirname(path), file))).toBe(true)
	})
})

describe('cameras', () => {
	test('yaw 0 looks south (+Z), 90 west (−X); positive pitch looks down', () => {
		const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 12))
		close(lookDirection(0, 0), [0, 0, 1])
		close(lookDirection(90, 0), [-1, 0, 0])
		close(lookDirection(180, 0), [0, 0, -1])
		close(lookDirection(0, 90), [0, -1, 0])
	})

	test('teleports the feet so the eye lands on the view, with decimal points so /tp does not centre them', () => {
		const spec = parseSpec({ origin: [10, -60, -4], views: [{ ...view, eye: [0, EYE_HEIGHT, 3] }] })
		expect(teleportArgs(spec, spec.views[0]!)).toBe('10.0000 -60.0000 -1.0000 180.0000 10.0000')
	})

	test('places the Blockbench camera at the eye in 16 units per block, looking the same way', () => {
		const { position, target } = blockbenchCamera({ name: 'corner', eye: [2.5, 2.5, 2.5], yaw: 135, pitch: 30 })
		expect(position).toEqual([40, 40, 40])
		const d = lookDirection(135, 30)
		target.forEach((v, i) => expect(v - position[i]!).toBeCloseTo(d[i]! * 16, 12))
	})
})
