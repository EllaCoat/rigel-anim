import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { blockbenchCamera, EYE_HEIGHT, lookDirection, parseSpec, poseCommands, teleportArgs } from '../scripts/shot-spec'

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
		[{ origin: [0, 0, 0], views: [{ ...view, pose: { animation: 'walk', tick: 1.5 } }] }, 'views[0].pose must be'],
		[{ origin: [0, 0, 0], views: [{ ...view, pose: { animation: 'walk', tick: 1 } }], model: 'rig.bbmodel' }, 'rig must name the rig'],
		[{ origin: [0, 0, 0], rig: 'axia', views: [{ ...view, pose: { animation: 'walk', tick: 1 } }] }, 'model is needed'],
	])('rejects %j', (input, message) => {
		expect(() => parseSpec(input)).toThrow(message)
	})

	test('accepts the example spec, whose packs and model exist', () => {
		const path = join(import.meta.dir, '..', 'scripts', 'shots', 'cube.json')
		const spec = parseSpec(JSON.parse(readFileSync(path, 'utf8')))
		for (const file of [...spec.datapacks, ...spec.resourcePacks, spec.model!]) expect(existsSync(resolve(dirname(path), file))).toBe(true)
	})
})

describe('poses', () => {
	const spec = parseSpec({ origin: [0, 0, 0], rig: 'axia', model: 'rig.bbmodel', views: [view, { ...view, name: 'walk', pose: { animation: 'walk', tick: 2 } }, { ...view, name: 'late', pose: { animation: 'walk', tick: 99 } }] })
	const animations = [{ name: 'idle', length: 1 }, { name: 'walk', length: 0.12 }]
	const frame = (f: number) => `function rigel:axia/frames/1/${f} with storage rigel:const FrameArgs`

	test('a view with a pose calls the frames up to its tick, and one without returns to the rest pose', () => {
		expect(poseCommands(spec, animations, spec.views[0]!)).toEqual(['function rigel:axia/rest'])
		expect(poseCommands(spec, animations, spec.views[1]!)).toEqual([frame(0), frame(1), frame(2)])
	})

	test('a tick past the end stops at the last frame', () => {
		expect(poseCommands(spec, animations, spec.views[2]!).at(-1)).toBe(frame(3))
	})

	test('an animation the model does not have is reported', () => {
		expect(() => poseCommands(spec, [], spec.views[1]!)).toThrow('the model has no animation "walk"')
	})

	test('a played pose steps a frozen server to the tick, and a pause holds, restarts and steps on', () => {
		const played = parseSpec({
			origin: [0, 0, 0],
			rig: 'axia',
			model: 'rig.bbmodel',
			views: [
				{ ...view, name: 'played', pose: { animation: 'idle', tick: 12, play: true } },
				{ ...view, name: 'held', pose: { animation: 'idle', tick: 12, play: true, pause: { at: 12, hold: 5 } } },
				{ ...view, name: 'resumed', pose: { animation: 'idle', tick: 15, play: true, pause: { at: 12, hold: 5 } } },
			],
		})
		const start = ['tick freeze', 'function rigel:axia/stop', 'function rigel:axia/play {ID:0}']
		const settle = ['scoreboard players set $Rigel.axia Rigel.Playing 0', 'tick step 1']
		const caughtUp = [...settle, 'scoreboard players set $Rigel.axia Rigel.Playing 1']
		expect(poseCommands(played, animations, played.views[0]!)).toEqual([...start, 'tick step 13', ...settle])
		expect(poseCommands(played, animations, played.views[1]!)).toEqual([...start, 'tick step 13', ...caughtUp, 'function rigel:axia/pause', 'tick step 5', ...settle])
		expect(poseCommands(played, animations, played.views[2]!)).toEqual([...start, 'tick step 13', ...caughtUp, 'function rigel:axia/pause', 'tick step 5', 'function rigel:axia/restart', 'function rigel:axia/tick', 'tick step 2', ...settle])
	})

	test('with a played view in the spec, the other views unfreeze the server and stop first', () => {
		const mixed = parseSpec({ ...spec, views: [...spec.views, { ...view, name: 'played', pose: { animation: 'walk', tick: 1, play: true } }] })
		const thaw = ['tick unfreeze', 'function rigel:axia/stop']
		expect(poseCommands(mixed, animations, mixed.views[0]!)).toEqual([...thaw, 'function rigel:axia/rest'])
		expect(poseCommands(mixed, animations, mixed.views[1]!)).toEqual([...thaw, frame(0), frame(1), frame(2)])
		expect(poseCommands(mixed, animations, mixed.views[3]!)[0]).toBe('tick freeze')
	})

	test('a restart one frame before the tick writes that frame without a step', () => {
		const next = parseSpec({ ...spec, views: [{ ...view, name: 'next', pose: { animation: 'idle', tick: 13, play: true, pause: { at: 12, hold: 0 } } }] })
		expect(poseCommands(next, animations, next.views[0]!).slice(-5)).toEqual([
			'function rigel:axia/pause',
			'function rigel:axia/restart',
			'function rigel:axia/tick',
			'scoreboard players set $Rigel.axia Rigel.Playing 0',
			'tick step 1',
		])
	})

	test('a pause past the last frame pauses there', () => {
		const late = parseSpec({ ...spec, views: [{ ...view, name: 'late', pose: { animation: 'walk', tick: 99, play: true, pause: { at: 50, hold: 2 } } }] })
		expect(poseCommands(late, animations, late.views[0]!).slice(3)).toEqual(['tick step 4', 'scoreboard players set $Rigel.axia Rigel.Playing 0', 'tick step 1', 'scoreboard players set $Rigel.axia Rigel.Playing 1', 'function rigel:axia/pause', 'tick step 2', 'scoreboard players set $Rigel.axia Rigel.Playing 0', 'tick step 1'])
	})

	test.each([
		[{ animation: 'idle', tick: 2, pause: { at: 1, hold: 1 } }],
		[{ animation: 'idle', tick: 2, play: true, pause: { at: 3, hold: 1 } }],
		[{ animation: 'idle', tick: 2, play: 'yes' }],
	])('rejects the pose %j', (pose) => {
		expect(() => parseSpec({ origin: [0, 0, 0], rig: 'axia', model: 'rig.bbmodel', views: [{ ...view, pose }] })).toThrow('views[0].pose.p')
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
