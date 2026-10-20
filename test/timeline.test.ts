import { describe, expect, test } from 'bun:test'
import { nearestTick, snapToTick } from '../src/bake/sample'
import { rowVisible, type RowFacts, type RowFilter } from '../src/timeline/rows'
import { clampOnionRange, DEFAULT_ONION_RANGE, jumpTarget, loopBack, loopLabel, onionFade, onionFrames, storedOnionRange } from '../src/timeline/ticks'
import { keepTransforms } from '../src/timeline/transforms'

const row = (facts: Partial<RowFacts> = {}): RowFacts => ({ name: 'Left Arm', hasKeyframes: true, selected: false, effects: false, ...facts })
const filter = (rest: Partial<RowFilter> = {}): RowFilter => ({ query: '', keyframesOnly: false, onlySelected: false, ...rest })

describe('tick rounding', () => {
	test('a time goes to the nearest tick, and stays inside the animation when it was inside', () => {
		expect(nearestTick(0.52)).toBe(10)
		expect(nearestTick(0.53)).toBe(11)
		expect(snapToTick(0.52, 2)).toBe(0.5)
		expect(snapToTick(0.53, 0.53)).toBe(0.53)
		expect(snapToTick(2.03, 2)).toBeCloseTo(2.05, 10)
	})
})

describe('rows of the Timeline', () => {
	test('every row stays without a filter', () => {
		expect(rowVisible(row(), filter())).toBe(true)
		expect(rowVisible(row({ hasKeyframes: false, effects: true }), filter())).toBe(true)
	})

	test('the name is searched without regard to case or the spaces around the query, in the Effects row too', () => {
		expect(rowVisible(row(), filter({ query: ' arm ' }))).toBe(true)
		expect(rowVisible(row(), filter({ query: 'leg' }))).toBe(false)
		expect(rowVisible(row({ name: 'Effects', effects: true }), filter({ query: 'EFFECT' }))).toBe(true)
		expect(rowVisible(row({ name: 'Effects', effects: true }), filter({ query: 'arm' }))).toBe(false)
	})

	test('keyframes of any channel keep a row, so the Effects row stays with only variant keyframes', () => {
		expect(rowVisible(row({ hasKeyframes: false }), filter({ keyframesOnly: true }))).toBe(false)
		expect(rowVisible(row({ hasKeyframes: true, effects: true }), filter({ keyframesOnly: true }))).toBe(true)
		expect(rowVisible(row({ hasKeyframes: false, effects: true }), filter({ keyframesOnly: true }))).toBe(false)
	})

	test('only the selected rows stay, and the Effects row is not hidden for not being selected', () => {
		expect(rowVisible(row({ selected: true }), filter({ onlySelected: true }))).toBe(true)
		expect(rowVisible(row({ selected: false }), filter({ onlySelected: true }))).toBe(false)
		expect(rowVisible(row({ effects: true }), filter({ onlySelected: true }))).toBe(true)
	})

	test('the filters all have to agree', () => {
		const all = filter({ query: 'arm', keyframesOnly: true, onlySelected: true })
		expect(rowVisible(row({ selected: true }), all)).toBe(true)
		expect(rowVisible(row({ selected: true, hasKeyframes: false }), all)).toBe(false)
		expect(rowVisible(row({ selected: true, name: 'Head' }), all)).toBe(false)
		expect(rowVisible(row({ effects: true, name: 'Effects' }), all)).toBe(false)
	})
})

describe('jumping between keyframes', () => {
	const times = [1, 0, 0.5, 0.52, 0.8]

	test('goes to the next keyframe after the playhead, or the previous one before it, as the tick it rounds to', () => {
		expect(jumpTarget(times, 0, 2, 1)).toBe(0.5)
		expect(jumpTarget(times, 0.8, 2, 1)).toBe(1)
		expect(jumpTarget(times, 1, 2, -1)).toBe(0.8)
		expect(jumpTarget(times, 0.8, 2, -1)).toBe(0.5)
		expect(jumpTarget([0.53], 0, 2, 1)).toBeCloseTo(0.55, 10)
	})

	test('passes over a keyframe on the same tick as the playhead, whichever side of the tick the playhead is', () => {
		expect(jumpTarget(times, 0.5, 2, 1)).toBe(0.8)
		expect(jumpTarget(times, 0.52, 2, 1)).toBe(0.8)
		expect(jumpTarget(times, 0.51, 2, -1)).toBe(0)
		expect(jumpTarget([0.5, 1], 0.504, 2, 1)).toBe(1)
	})

	test('stays at the end when there is nothing further, and finds nothing without keyframes', () => {
		expect(jumpTarget(times, 1, 2, 1)).toBeUndefined()
		expect(jumpTarget(times, 0, 2, -1)).toBeUndefined()
		expect(jumpTarget([], 0.3, 2, 1)).toBeUndefined()
	})

	test('does not go past the end of the animation when the nearest tick would', () => {
		expect(jumpTarget([0.53], 0, 0.53, 1)).toBe(0.53)
		expect(jumpTarget([2.03], 0, 2, 1)).toBeCloseTo(2.05, 10)
	})
})

describe('A-B loop', () => {
	test('goes back to A once B is passed, and not before', () => {
		expect(loopBack(1.01, 0.96, { a: 10, b: 20 })).toBe(0.5)
		expect(loopBack(1, 0.95, { a: 10, b: 20 })).toBeUndefined()
		expect(loopBack(0.3, 0.25, { a: 10, b: 20 })).toBeUndefined()
	})

	test('goes back to A when B is at the end and Blockbench has wrapped the playhead to the start', () => {
		expect(loopBack(0, 1.98, { a: 10, b: 40 })).toBe(0.5)
		expect(loopBack(0, undefined, { a: 10, b: 40 })).toBeUndefined()
		expect(loopBack(0, 1.98, { a: 0, b: 40 })).toBeUndefined()
	})

	test('leaves a move back that stays inside the range alone', () => {
		expect(loopBack(0.7, 1.5, { a: 10, b: 40 })).toBeUndefined()
	})

	test('does nothing with an end missing, or with A not before B', () => {
		expect(loopBack(5, 4.95, { a: 10 })).toBeUndefined()
		expect(loopBack(5, 4.95, { b: 20 })).toBeUndefined()
		expect(loopBack(5, 4.95, {})).toBeUndefined()
		expect(loopBack(5, 4.95, { a: 20, b: 20 })).toBeUndefined()
		expect(loopBack(0, 4.95, { a: 30, b: 20 })).toBeUndefined()
	})

	test('the ends are shown in ticks', () => {
		expect(loopLabel({})).toBe('—')
		expect(loopLabel({ a: 10, b: 20 })).toBe('A:10t B:20t')
		expect(loopLabel({ b: 20 })).toBe('A:— B:20t')
	})
})

describe('onion skin', () => {
	test('shows the ticks before the playhead, then the ticks after it, a tick apart', () => {
		const frames = onionFrames(1, 2)
		expect(frames.map((f) => `${f.direction}${f.distance}`)).toEqual(['past1', 'past2', 'future1', 'future2'])
		expect(frames.map((f) => Number(f.time.toFixed(9)))).toEqual([0.95, 0.9, 1.05, 1.1])
	})

	test('has no pose before the start: the ticks that fall before it are left out, and the one at the start stays', () => {
		expect(onionFrames(0, 3).map((f) => `${f.direction}${f.distance}`)).toEqual(['future1', 'future2', 'future3'])
		const frames = onionFrames(0.1, 5)
		expect(frames.filter((f) => f.direction === 'past').map((f) => f.distance)).toEqual([1, 2])
		expect(frames.find((f) => f.direction === 'past' && f.distance === 2)!.time).toBe(0)
		expect(frames.filter((f) => f.direction === 'future')).toHaveLength(5)
	})

	test('covers the whole allowed range, 1 to 5 ticks each way', () => {
		for (const range of [1, 2, 3, 4, 5]) expect(onionFrames(10, range)).toHaveLength(range * 2)
	})

	test('a ghost fades by the distance, and not at all with a range of 1', () => {
		expect(onionFade(1, 1)).toBe(1)
		expect(onionFade(1, 5)).toBe(1)
		expect(onionFade(5, 5)).toBeCloseTo(0.2, 10)
		expect(onionFade(3, 4)).toBe(0.5)
	})

	test('the range is a whole number from 1 to 5, and what is not a number is left out', () => {
		expect(clampOnionRange(3)).toBe(3)
		expect(clampOnionRange(3.9)).toBe(3)
		expect(clampOnionRange(0)).toBe(1)
		expect(clampOnionRange(-4)).toBe(1)
		expect(clampOnionRange(9)).toBe(5)
		expect(clampOnionRange(Number.NaN)).toBeUndefined()
		expect(clampOnionRange(Number.POSITIVE_INFINITY)).toBeUndefined()
	})

	test('a stored range is read back, and a missing or broken one is the default', () => {
		expect(storedOnionRange('4')).toBe(4)
		expect(storedOnionRange('99')).toBe(5)
		expect(storedOnionRange(null)).toBe(DEFAULT_ONION_RANGE)
		expect(storedOnionRange('')).toBe(DEFAULT_ONION_RANGE)
		expect(storedOnionRange('NaN')).toBe(DEFAULT_ONION_RANGE)
	})
})

describe('onion skin', () => {
	class Vec {
		constructor(public v: number[]) {}
		clone() {
			return new Vec([...this.v])
		}
		copy(other: Vec) {
			this.v = [...other.v]
			return this
		}
	}
	const placed = (n: number) => ({ position: new Vec([n, 0, 0]), quaternion: new Vec([0, 0, 0, 1]), scale: new Vec([1, 1, 1]) })

	test('after posing the other ticks and the playhead again, the bones get back the pose another plugin had put on them', () => {
		const tail = placed(1)
		tail.quaternion.v = [0.1, 0, 0, 0.995]
		const restore = keepTransforms([tail] as never)
		tail.position.v = [9, 9, 9]
		tail.quaternion.v = [0, 0, 0, 1]
		tail.scale.v = [2, 2, 2]
		restore()
		expect([tail.position.v, tail.quaternion.v, tail.scale.v]).toEqual([[1, 0, 0], [0.1, 0, 0, 0.995], [1, 1, 1]])
	})
})
