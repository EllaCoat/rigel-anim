import { describe, expect, test } from 'bun:test'
import { compose, normalizeQuat, quatAngle, quatToMat3, type Quat, type Vec3 } from '../src/bake/matrix'
import { animationRunEnds, runEnds, split } from '../src/export/thin'

const DEGREE = Math.PI / 180

function axisAngle(axis: Vec3, degrees: number): Quat {
	const n = Math.hypot(...axis)
	const s = Math.sin((degrees * DEGREE) / 2) / n
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos((degrees * DEGREE) / 2)]
}

// The 12 written values (rows of the 3×4 matrix) of translation · rotation · scale, optionally sheared.
function values(t: Vec3, q: Quat, s: Vec3 = [1, 1, 1], shear = 0): number[] {
	const r = quatToMat3(q)
	const a = [0, 1, 2].map((row) => [r[row * 3]! * s[0], r[row * 3 + 1]! * s[1] + shear * r[row * 3]! * s[0], r[row * 3 + 2]! * s[2]])
	return [0, 1, 2].flatMap((row) => [a[row]![0]!, a[row]![1]!, a[row]![2]!, t[row]!])
}

// The rows of the matrix a split composes back to.
function rows(s: ReturnType<typeof split>): number[] {
	const m = compose(s.translation, s.left, s.scale, s.right)
	return [0, 1, 2].flatMap((r) => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!])
}

const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i]!)))
const tolerance = { position: 0.01, rotation: 1 }

describe('split', () => {
	test('a rotation with a positive scale along its axes splits into that rotation and scale', () => {
		const q = axisAngle([0.3, 1, -0.2], 130)
		const s = split(values([1, 2, 3], q, [2, 0.5, 27]))
		expect(maxDiff(s.translation, [1, 2, 3])).toBeLessThan(1e-6)
		expect(maxDiff(s.scale, [2, 0.5, 27])).toBeLessThan(1e-4)
		expect(quatAngle(normalizeQuat(s.left), q)).toBeLessThan(1e-4)
		expect(quatAngle(s.right, [0, 0, 0, 1])).toBe(0)
	})

	test('sheared and mirrored matrices split into parts that compose back', () => {
		const q = axisAngle([1, 1, 0], 40)
		for (const v of [values([0, 1, 0], q, [1, 2, 1], 0.3), values([0, 0, 0], q, [-1, 1, 1]), values([0, 0, 0], q, [1.01, 0.99, 1], 0.02)]) {
			expect(maxDiff(rows(split(v)), v)).toBeLessThan(1e-3)
		}
	})

	test('a vanished bone splits without NaN', () => {
		const s = split(values([1, 0, 0], axisAngle([0, 1, 0], 30), [0, 0, 0]))
		expect([...s.translation, ...s.left, ...s.scale, ...s.right].every(Number.isFinite)).toBe(true)
	})
})

describe('runEnds', () => {
	const track = (frames: number, pose: (f: number) => number[]) => Array.from({ length: frames }, (_, f) => pose(f))

	// The first three runs last one tick: their start is the pose before play.
	test('straight motion at a steady speed is one run as long as the span allows', () => {
		const moving = track(41, (f) => values([f * 0.05, 0, 0], axisAngle([0, 0, 1], 0)))
		expect(runEnds(moving, tolerance, 20).ends).toEqual([0, 1, 2, 3, 23, 40])
		expect(runEnds(moving, tolerance, 100).ends).toEqual([0, 1, 2, 3, 40])
	})

	test('turning at a steady speed follows the slerp', () => {
		const turning = track(25, (f) => values([0, 0, 0], axisAngle([1, 2, 0], f * 6)))
		expect(runEnds(turning, tolerance, 30).ends).toEqual([0, 1, 2, 3, 24])
	})

	test('curved motion needs more runs the tighter the tolerance, and every frame stays within it', () => {
		const angle = (f: number) => 30 * Math.sin((f / 40) * 2 * Math.PI)
		const swinging = track(41, (f) => values([Math.sin((f / 40) * 2 * Math.PI), 0, 0], axisAngle([0, 1, 0], angle(f))))
		const tight = runEnds(swinging, { position: 0.002, rotation: 0.25 }, 20).ends
		const loose = runEnds(swinging, { position: 0.03, rotation: 3 }, 20).ends
		expect(tight.length).toBeGreaterThan(loose.length)
		expect(loose.length).toBeGreaterThan(2)
		for (let i = 1; i < loose.length; i++) {
			const [k, j] = [loose[i - 1]!, loose[i]!]
			for (let m = k + 1; m < j; m++) {
				const t = (m - k) / (j - k)
				expect(Math.abs(swinging[k]![3]! + (swinging[j]![3]! - swinging[k]![3]!) * t - swinging[m]![3]!)).toBeLessThanOrEqual(0.03)
				expect(Math.abs(angle(k) + (angle(j) - angle(k)) * t - angle(m))).toBeLessThanOrEqual(3)
			}
		}
	})

	test('a still bone is one run per span', () => {
		const still = track(45, () => values([1, 0, 0], axisAngle([0, 1, 0], 10)))
		expect(runEnds(still, tolerance, 20).ends).toEqual([0, 1, 2, 3, 23, 43, 44])
	})

	test('a hidden bone that moves is one run, and showing it again is written on time', () => {
		const q = axisAngle([0, 1, 0], 10)
		const hidden = track(21, (f) => (f < 15 ? values([f * 0.3, Math.sin(f), 0], q, [0, 0, 0]) : values([f * 0.3, 0, 0], q)))
		expect(runEnds(hidden, tolerance, 20)).toEqual({ ends: [0, 1, 2, 3, 14, 15, 16, 17, 18, 20], snaps: [1, 2, 3] })
	})

	// A client draws a one-tick run partway before it applies the next write, and starts that one from there. Hiding and
	// the three one-tick runs after it are shown at once, so the run after them starts hidden even when the client takes
	// in the writes of up to four ticks together.
	test('hiding a bone and the runs after it stay one tick and are shown at once', () => {
		const q = axisAngle([0, 1, 0], 10)
		const hiding = track(31, (f) => (f < 10 ? values([1, 0, 0], q) : values([1 + f * 0.1, 0, 0], q, [0, 0, 0])))
		expect(runEnds(hiding, tolerance, 20)).toEqual({ ends: [0, 1, 2, 3, 9, 10, 11, 12, 13, 30], snaps: [10, 11, 12, 13] })
	})

	// The client draws the shrinking run partway too: the three runs after it stay one tick and are shown at once.
	test('a bone that shrinks away over a run keeps one-tick runs after it', () => {
		// Unturned, so that the vanished matrix splits into the same rotation and the shrinking is one run.
		const q = axisAngle([0, 0, 1], 0)
		const shrinking = track(31, (f) => {
			const s = f <= 8 ? 1 : f >= 10 ? 0 : (10 - f) / 2
			return values([1 + f * 0.1, 0, 0], q, [s, s, s])
		})
		expect(runEnds(shrinking, tolerance, 20)).toEqual({ ends: [0, 1, 2, 3, 8, 10, 11, 12, 13, 30], snaps: [11, 12, 13] })
	})

	// The run at 10 is cut short: starting three ticks back, the client would be further behind than three of its
	// ticks. The runs after it are cut only where a slerp would turn the short way round (past 180°).
	test('runs after one-tick runs in fast motion still span several ticks, and none is shown at once', () => {
		const angle = (f: number) => (f < 10 ? 2 * f * f : 200 + 25 * (f - 10))
		const { ends, snaps } = runEnds(track(31, (f) => values([0, 0, 0], axisAngle([0, 0, 1], angle(f)))), tolerance, 20)
		expect(ends).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 20, 27, 30])
		expect(snaps).toEqual([])
	})

	test('a slightly sheared bone turning at a steady speed is still one run', () => {
		const turning = track(21, (f) => values([0, 0, 0], axisAngle([0, 0, 1], f * 3), [1.02, 0.99, 1], 0.01))
		expect(runEnds(turning, tolerance, 20).ends).toEqual([0, 1, 2, 3, 20])
	})
})

describe('animationRunEnds', () => {
	const pose = (x: number) => values([x, 0, 0], axisAngle([0, 0, 1], 0)).map((v) => `${v}f`).join(',')

	test("reads the written values, and a loop's last frame takes the pose of frame 0", () => {
		const poses = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((x) => [pose(x)])
		expect(animationRunEnds('hold', poses, tolerance, 20)(0).ends).toEqual([0, 1, 2, 3, 7])
		// Looping back from 0.6 to 0 breaks the straight line at frame 6.
		expect(animationRunEnds('loop', poses, tolerance, 20)(0).ends).toEqual([0, 1, 2, 3, 6, 7])
	})

	test('a bone hidden by looping back to frame 0 is hidden at once, and so are the first runs after it', () => {
		const showing = (f: number) => values([f * 0.1, 0, 0], axisAngle([0, 0, 1], 0), f < 10 ? [0, 0, 0] : [1, 1, 1])
		const poses = Array.from({ length: 31 }, (_, f) => [showing(f).map((v) => `${v}f`).join(',')])
		expect(animationRunEnds('loop', poses, tolerance, 20)(0)).toEqual({ ends: [0, 1, 2, 3, 9, 10, 11, 12, 13, 29, 30], snaps: [1, 2, 3, 30] })
	})
})
