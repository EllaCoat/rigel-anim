import { describe, expect, test } from 'bun:test'
import { bakeTracks } from '../src/bake/bake'
import { decomposeTrack, valueCount } from '../src/bake/decompose'
import { compose, IDENTITY_QUAT, mul3, normalizeQuat, quatAngle, quatDot, quatToMat3, type Quat, type Vec3 } from '../src/bake/matrix'
import { QUANTUM, reconstruct, STRIDE } from '../src/bake/quantize'
import { TOLERANCES, writeStats } from '../src/bake/stats'

function axisAngle(axis: Vec3, angle: number): Quat {
	const n = Math.hypot(...axis)
	const s = Math.sin(angle / 2) / n
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]
}

// Deterministic pseudo-random numbers so failures reproduce.
function random(seed: number): () => number {
	let x = seed
	return () => {
		x = (x * 1103515245 + 12345) % 2147483648
		return x / 2147483648
	}
}

function randomQuat(next: () => number): Quat {
	return normalizeQuat([next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5])
}

// Translation · rotation · scale · rotation as a column-major matrix.
function matrix(t: Vec3, left: Quat, scale: Vec3, right: Quat = IDENTITY_QUAT): number[] {
	return compose(t, left, scale, right)
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let d = 0
	for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i]! - b[i]!))
	return d
}

function roundTrip(matrices: number[][]): number {
	const { frames } = decomposeTrack(matrices)
	return Math.max(...frames.map((f, i) => maxDiff(compose(f.translation, f.left, f.scale, f.right), matrices[i]!)))
}

describe('decompose', () => {
	const next = random(7)

	test('rigid transforms need 7 values and round-trip', () => {
		const ms = Array.from({ length: 50 }, () => matrix([next() * 10, next() * 10, next() * 10], randomQuat(next), [1, 1, 1]))
		for (const m of ms) expect(valueCount(m)).toBe(7)
		expect(roundTrip(ms)).toBeLessThan(1e-9)
	})

	test('scale along the bone axes needs 10 values, including mirroring and zero scale', () => {
		const scales: Vec3[] = [[2, 1, 0.5], [-1, 1, 1], [1, -2, 3], [0, 1, 1], [0, 0, 1], [0, 0, 0]]
		for (const s of scales) {
			const m = matrix([1, 2, 3], randomQuat(next), s)
			expect(valueCount(m)).toBe(10)
			expect(roundTrip([m])).toBeLessThan(1e-9)
		}
	})

	test('sheared transforms need 14 values and round-trip', () => {
		const ms = Array.from({ length: 50 }, () => matrix([next(), next(), next()], randomQuat(next), [0.5 + next() * 2, 0.5 + next(), 0.2 + next()], randomQuat(next)))
		for (const m of ms) expect(valueCount(m)).toBe(14)
		expect(roundTrip(ms)).toBeLessThan(1e-9)
	})

	test('a bone squashed almost flat keeps an orthonormal left rotation', () => {
		// All three axes collapse onto one direction, with float noise in the others.
		const m = [0.00001, 1.04615, 0, 0, 0, -0.81904, -0.00001, 0, 0, 3.79299, 0, 0, -0.125, 2.47869, 0.01813, 1]
		expect(valueCount(m)).toBe(14)
		const { frames } = decomposeTrack([m])
		expect(Math.abs(Math.hypot(...frames[0]!.left) - 1)).toBeLessThan(1e-9)
		expect(roundTrip([m])).toBeLessThan(1e-4)
	})

	test('rotations stay continuous when a uniform scale becomes uneven and back', () => {
		// A child turning 0.1 rad per tick under a parent whose scale is uneven, then uniform for a while
		// (the rotation split is free there), then uneven again.
		const stretch = (t: number) => (t < 5 ? 1.3 : t <= 15 ? 1 : 1 + (t - 15) * 0.05)
		const ms = Array.from({ length: 30 }, (_, t) => {
			const a = mul3([stretch(t), 0, 0, 0, 1, 0, 0, 0, 1], quatToMat3(axisAngle([0.3, 0.2, 1], t * 0.1)))
			return [a[0]!, a[3]!, a[6]!, 0, a[1]!, a[4]!, a[7]!, 0, a[2]!, a[5]!, a[8]!, 0, 0, 0, 0, 1]
		})
		const { count, frames } = decomposeTrack(ms)
		expect(count).toBe(14)
		expect(roundTrip(ms)).toBeLessThan(1e-9)
		for (let i = 1; i < frames.length; i++) {
			expect(quatAngle(frames[i]!.left, frames[i - 1]!.left)).toBeLessThan(0.25)
			expect(quatAngle(frames[i]!.right, frames[i - 1]!.right)).toBeLessThan(0.25)
		}
		// Uniform from the start, uneven later: the free leading ticks follow the first fixed one.
		const late = ms.map((_, t) => {
			const a = mul3([t < 10 ? 1 : 1 + (t - 10) * 0.05, 0, 0, 0, 1, 0, 0, 0, 1], quatToMat3(axisAngle([0.3, 0.2, 1], t * 0.1)))
			return [a[0]!, a[3]!, a[6]!, 0, a[1]!, a[4]!, a[7]!, 0, a[2]!, a[5]!, a[8]!, 0, 0, 0, 0, 1]
		})
		const lateFrames = decomposeTrack(late).frames
		for (let i = 1; i < lateFrames.length; i++) expect(quatAngle(lateFrames[i]!.right, lateFrames[i - 1]!.right)).toBeLessThan(0.25)
	})

	test('a hidden bone switches its rotation while invisible, not while shrinking or growing', () => {
		const a = randomQuat(next)
		const b = randomQuat(next)
		// Blockbench draws a zero scale as 1e-5.
		const zero = matrix([0, 0, 0], randomQuat(next), [1e-5, 1e-5, 1e-5])
		for (const shear of [false, true]) {
			const right = shear ? randomQuat(next) : IDENTITY_QUAT
			const scale: Vec3 = shear ? [1, 2, 3] : [1, 2, 2]
			const { frames } = decomposeTrack([matrix([0, 0, 0], a, scale, right), zero, zero, zero, matrix([0, 0, 0], b, scale, right)])
			expect(quatAngle(frames[1]!.left, frames[0]!.left)).toBeLessThan(1e-9)
			expect(quatAngle(frames[3]!.left, frames[4]!.left)).toBeLessThan(1e-9)
			expect(quatAngle(frames[3]!.right, frames[4]!.right)).toBeLessThan(1e-9)
		}
		const leading = decomposeTrack([zero, zero, matrix([0, 0, 0], b, [1, 2, 2])]).frames
		expect(quatAngle(leading[0]!.left, leading[2]!.left)).toBeLessThan(1e-9)
	})

	test('float noise on a vanished bone does not turn it', () => {
		const left = randomQuat(next)
		const right = randomQuat(next)
		const noise = [1e-17, -2e-17, 0, 0, 3e-18, 1e-17, -1e-17, 0, 0, 2e-17, 1e-18, 0, 0, 0, 0, 1]
		const { count, frames } = decomposeTrack([matrix([0, 0, 0], left, [-0.05, 0.05, 0.04], right), noise])
		expect(count).toBe(14)
		expect(quatAngle(frames[1]!.left, frames[0]!.left)).toBeLessThan(1e-9)
		expect(quatAngle(frames[1]!.right, frames[0]!.right)).toBeLessThan(1e-9)
	})

	test('a track takes the form of its most demanding tick', () => {
		const sheared = matrix([0, 0, 0], randomQuat(next), [2, 1, 0.5], randomQuat(next))
		const ms = [matrix([0, 0, 0], IDENTITY_QUAT, [1, 1, 1]), sheared, matrix([0, 1, 0], randomQuat(next), [1, 1, 1])]
		const { count } = decomposeTrack(ms)
		expect(count).toBe(14)
		expect(roundTrip(ms)).toBeLessThan(1e-9)
	})

	test('quaternion signs stay continuous over a full turn', () => {
		const ms = Array.from({ length: 73 }, (_, i) => matrix([0, 0, 0], axisAngle([0, 0, 1], (i * 10 * Math.PI) / 180), [1, 1, 1]))
		const { frames } = decomposeTrack(ms)
		for (let i = 1; i < frames.length; i++) expect(quatDot(frames[i]!.left, frames[i - 1]!.left)).toBeGreaterThan(0)
	})

	test('a slowly changing sheared track changes its rotations slowly', () => {
		// A child rotating under a parent with non-uniform scale: the sheared case of a real rig.
		const parent = quatToMat3(IDENTITY_QUAT).map((v, i) => v * ([2, 1, 1][i % 3] ?? 1))
		const ms = Array.from({ length: 40 }, (_, i) => {
			const a = mul3(parent, quatToMat3(axisAngle([0.3, 0.2, 1], i * 0.05)))
			return [a[0]!, a[3]!, a[6]!, 0, a[1]!, a[4]!, a[7]!, 0, a[2]!, a[5]!, a[8]!, 0, 0, 0, 0, 1]
		})
		const { count, frames } = decomposeTrack(ms)
		expect(count).toBe(14)
		expect(roundTrip(ms)).toBeLessThan(1e-9)
		for (let i = 1; i < frames.length; i++) {
			expect(quatAngle(frames[i]!.left, frames[i - 1]!.left)).toBeLessThan(0.2)
			expect(quatAngle(frames[i]!.right, frames[i - 1]!.right)).toBeLessThan(0.2)
		}
	})
})

describe('quantize', () => {
	test('the matrix Minecraft rebuilds from the ints stays within the quantization error', () => {
		const next = random(11)
		for (let i = 0; i < 200; i++) {
			const s: Vec3 = [0.1 + next() * 3, 0.1 + next() * 3, 0.1 + next() * 3]
			const m = matrix([(next() - 0.5) * 100, (next() - 0.5) * 100, (next() - 0.5) * 100], randomQuat(next), s, randomQuat(next))
			const { values } = bakeTracks(Float64Array.from(m), 1, 1)
			for (const v of values) expect(Number.isInteger(v)).toBe(true)
			const rebuilt = reconstruct(values, 0)
			for (let k = 12; k < 15; k++) expect(Math.abs(rebuilt[k]! - m[k]!)).toBeLessThanOrEqual(0.5 / QUANTUM)
			const linear = [0, 1, 2, 4, 5, 6, 8, 9, 10].map((k) => Math.abs(rebuilt[k]! - m[k]!))
			expect(Math.max(...linear)).toBeLessThan(2e-3 * Math.max(...s))
		}
	})
})

describe('writeStats', () => {
	// One renderable bone per track; tracks are lists of matrices per tick.
	function stats(tracks: number[][][], renderable = tracks.map(() => true)) {
		const frames = tracks[0]!.length
		const matrices = new Float64Array(frames * tracks.length * 16)
		tracks.forEach((track, b) => track.forEach((m, f) => matrices.set(m, (f * tracks.length + b) * 16)))
		const { values } = bakeTracks(matrices, frames, tracks.length)
		expect(values.length).toBe(frames * tracks.length * STRIDE)
		return writeStats(values, frames - 1, tracks.length, renderable)
	}
	const still = Array.from({ length: 21 }, () => matrix([1, 0, 0], IDENTITY_QUAT, [1, 1, 1]))
	const linear = Array.from({ length: 21 }, (_, i) => matrix([i * 0.05, 0, 0], IDENTITY_QUAT, [1, 1, 1]))
	const turning = Array.from({ length: 21 }, (_, i) => matrix([0, 0, 0], axisAngle([1, 1, 0], i * 0.1), [1, 1, 1]))
	const swinging = Array.from({ length: 41 }, (_, i) => matrix([Math.sin((i / 40) * 2 * Math.PI), 0, 0], IDENTITY_QUAT, [1, 1, 1]))

	test('a still bone needs no writes', () => {
		const s = stats([still])
		expect(s.changed).toBe(0)
		expect(s.thinned).toEqual([0, 0, 0])
	})

	test('linear motion and constant-speed rotation need one interpolated write', () => {
		expect(stats([linear]).changed).toBe(20)
		expect(stats([linear]).thinned).toEqual([1, 1, 1])
		expect(stats([turning]).thinned).toEqual([1, 1, 1])
	})

	test('curved motion needs more writes the tighter the tolerance', () => {
		const s = stats([swinging])
		expect(s.changed).toBe(40)
		expect(s.thinned[0]!).toBeGreaterThan(1)
		expect(s.thinned[0]!).toBeGreaterThanOrEqual(s.thinned[1]!)
		expect(s.thinned[1]!).toBeGreaterThanOrEqual(s.thinned[2]!)
		expect(s.thinned[0]!).toBeLessThanOrEqual(40)
		expect(TOLERANCES).toHaveLength(3)
	})

	test('only renderable bones are counted, and the peak is per tick', () => {
		const s = stats([linear, linear, swinging.slice(0, 21)], [true, true, false])
		expect(s.bones).toBe(2)
		expect(s.changed).toBe(40)
		expect(s.changedPeak).toBe(2)
	})
})
