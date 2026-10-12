import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { blockbenchCamera, EYE_HEIGHT, lookDirection, parseSpec, poseCommands, teleportArgs } from '../scripts/shot-spec'
import { callVariant, viewCalls, type Worn } from '../scripts/shot-variants'

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
		[{ origin: [0, 0, 0], views: [{ ...view, variant: 'alt' }], model: 'rig.bbmodel' }, 'rig must name the rig'],
		[{ origin: [0, 0, 0], rig: 'axia', views: [{ ...view, variant: 'Alt Skin' }], model: 'rig.bbmodel' }, 'views[0].variant must be a variant name'],
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

	test('a view with a variant applies it before the pose and its own commands', () => {
		const withVariant = parseSpec({ origin: [0, 0, 0], rig: 'axia', model: 'rig.bbmodel', views: [{ ...view, variant: 'alt', commands: ['say hi'] }] })
		expect(poseCommands(withVariant, animations, withVariant.views[0]!)).toEqual(['function rigel:axia/variant/alt', 'function rigel:axia/rest', 'say hi'])
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

	test('a tweened pose plays the animation it starts from, tweens on the frozen server and steps on', () => {
		const tweened = parseSpec({ ...spec, views: [{ ...view, name: 'tweened', pose: { animation: 'walk', tick: 2, play: true, tween: { from: 'idle', at: 7, ticks: 4, frame: 1, after: 5 } } }] })
		expect(poseCommands(tweened, animations, tweened.views[0]!)).toEqual([
			'tick freeze',
			'function rigel:axia/stop',
			'function rigel:axia/play {ID:0}',
			'tick step 8',
			'scoreboard players set $Rigel.axia Rigel.Playing 0',
			'tick step 1',
			'scoreboard players set $Rigel.axia Rigel.Playing 1',
			'function rigel:axia/tween {ID:1,ticks:4,frame:1}',
			'tick step 5',
			'scoreboard players set $Rigel.axia Rigel.Playing 0',
			'tick step 1',
		])
		const unknown = parseSpec({ ...spec, views: [{ ...view, name: 'unknown', pose: { animation: 'walk', tick: 2, play: true, tween: { from: 'run', at: 0, ticks: 1, frame: 0, after: 0 } } }] })
		expect(() => poseCommands(unknown, animations, unknown.views[0]!)).toThrow('the model has no animation "run"')
	})

	test('a tween paused while it waits holds, then restarts for the steps left', () => {
		const tween = { from: 'idle', at: 7, ticks: 6, frame: 1, after: 6, pause: { at: 2, hold: 3 } }
		const paused = parseSpec({ ...spec, views: [{ ...view, name: 'paused', pose: { animation: 'walk', tick: 1, play: true, tween } }] })
		expect(poseCommands(paused, animations, paused.views[0]!).slice(7)).toEqual([
			'function rigel:axia/tween {ID:1,ticks:6,frame:1}',
			'tick step 2',
			'function rigel:axia/pause',
			'tick step 3',
			'function rigel:axia/restart',
			'tick step 4',
			'scoreboard players set $Rigel.axia Rigel.Playing 0',
			'tick step 1',
		])
		const held = parseSpec({ ...spec, views: [{ ...view, name: 'held', pose: { animation: 'walk', tick: 1, play: true, tween: { ...tween, after: 2 } } }] })
		expect(poseCommands(held, animations, held.views[0]!).slice(8, -2)).toEqual(['tick step 2', 'function rigel:axia/pause', 'tick step 3'])
	})

	test.each([
		[{ animation: 'idle', tick: 2, tween: { from: 'walk', at: 0, ticks: 2, frame: 0, after: 0 } }],
		[{ animation: 'idle', tick: 2, play: true, tween: { from: 'walk', at: 0, ticks: 0, frame: 0, after: 0 } }],
		[{ animation: 'idle', tick: 2, play: true, pause: { at: 1, hold: 1 }, tween: { from: 'walk', at: 0, ticks: 2, frame: 0, after: 0 } }],
		[{ animation: 'idle', tick: 2, play: true, tween: { from: 'walk', at: 0, ticks: 2, frame: 0, after: 3, pause: { at: 0, hold: 1 } } }],
		[{ animation: 'idle', tick: 2, play: true, tween: { from: 'walk', at: 0, ticks: 2, frame: 0, after: 3, pause: { at: 4, hold: 1 } } }],
	])('rejects the tween %j', (pose) => {
		expect(() => parseSpec({ origin: [0, 0, 0], rig: 'axia', model: 'rig.bbmodel', views: [{ ...view, pose }] })).toThrow('views[0].pose.tween')
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

describe('variants a view leaves on the rig', () => {
	const bones = ['body', 'arm', 'hand', 'tail', 'tailtip', 'gem']
	const excluded = new Map([['alt', new Set(['tail'])], ['tip', new Set(['body', 'arm', 'tail', 'tailtip'])]])
	const wear = (calls: string[], from: Worn = new Map()) => {
		const worn = calls.reduce((w, name) => callVariant(w, name, excluded, bones), from)
		return bones.map((b) => worn.get(b) ?? 'default').join(' ')
	}

	test('a variant goes on the bones it does not exclude and leaves the others as they are', () => {
		expect(wear(['alt'])).toBe('alt alt alt default alt alt')
		expect(wear(['tip'])).toBe('default default tip default default tip')
	})

	test('a variant after another leaves what the other put on the bones it excludes', () => {
		expect(wear(['alt', 'tip'])).toBe('alt alt tip default alt tip')
		expect(wear(['tip', 'alt'])).toBe('alt alt alt default alt alt')
	})

	test('default puts the original model on every bone', () => {
		expect(wear(['alt', 'tip', 'default'])).toBe('default default default default default default')
	})

	test('the view calls its own variant first, then those of the frames up to its tick, in frame order', () => {
		const frames = new Map([[10, 'tip'], [0, 'alt'], [20, 'default']])
		expect(viewCalls({ pose: { tick: 12 } }, frames, 30)).toEqual(['alt', 'tip'])
		expect(viewCalls({ variant: 'default', pose: { tick: 12 } }, frames, 30)).toEqual(['default', 'alt', 'tip'])
		expect(viewCalls({ variant: 'alt' }, frames, 30)).toEqual(['alt'])
		expect(viewCalls({ pose: { tick: 99 } }, frames, 30)).toEqual(['alt', 'tip', 'default'])
		expect(viewCalls({ pose: { tick: 9 } }, frames, 30)).toEqual(['alt'])
		expect(viewCalls({}, frames, 30)).toEqual([])
	})

	test('what one view leaves stays for the views after it, the way the server keeps it', () => {
		const frames = new Map([[0, 'alt'], [10, 'tip']])
		let worn: Worn = new Map()
		for (const name of viewCalls({ pose: { tick: 12 } }, frames, 30)) worn = callVariant(worn, name, excluded, bones)
		for (const name of viewCalls({}, new Map(), 0)) worn = callVariant(worn, name, excluded, bones)
		expect(bones.map((b) => worn.get(b) ?? 'default').join(' ')).toBe('alt alt tip default alt tip')
	})
})
