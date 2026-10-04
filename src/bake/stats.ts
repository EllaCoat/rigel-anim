import type { Decomposed } from './decompose'
import { normalizeQuat, quatAngle, slerp } from './matrix'
import { dequantize, STRIDE } from './quantize'

// position in blocks; rotation in radians, also used as the allowed relative scale error (a point at
// distance r moves by about r·angle under a rotation error and by r·Δs under a scale error).
export interface Tolerance {
	position: number
	rotation: number
}

const DEGREE = Math.PI / 180
export const TOLERANCES: Tolerance[] = [
	{ position: 0.002, rotation: 0.25 * DEGREE },
	{ position: 0.01, rotation: 1 * DEGREE },
	{ position: 0.03, rotation: 3 * DEGREE },
]

export interface WriteStats {
	bones: number
	ticks: number
	// Writes when only bones whose values changed since the previous tick are written.
	changed: number
	changedPeak: number
	// Writes when each write interpolates over several ticks (interpolation_duration) and the ticks the
	// display-entity interpolation reproduces within the tolerance are skipped, one entry per tolerance.
	thinned: number[]
	thinnedPeak: number[]
}

// Writes to play ticks 1..N of the renderable bones; the pose at tick 0 is set when the animation starts.
export function writeStats(values: Int32Array, ticks: number, bones: number, renderable: boolean[], tolerances = TOLERANCES): WriteStats {
	const frames = ticks + 1
	const changedAt = new Int32Array(frames)
	const thinnedAt = tolerances.map(() => new Int32Array(frames))
	let count = 0
	for (let b = 0; b < bones; b++) {
		if (!renderable[b]) continue
		count++
		const at = (f: number) => (f * bones + b) * STRIDE
		for (let f = 1; f < frames; f++) if (!same(values, at(f), at(f - 1))) changedAt[f]!++
		const track = Array.from({ length: frames }, (_, f) => unit(dequantize(values, at(f))))
		tolerances.forEach((tolerance, t) => {
			let k = 0
			while (k < ticks) {
				let j = k + 1
				while (j < ticks && reproduces(track, k, j + 1, tolerance)) j++
				if (!same(values, at(j), at(k))) thinnedAt[t]![k + 1]!++
				k = j
			}
		})
	}
	return {
		bones: count,
		ticks,
		changed: sum(changedAt),
		changedPeak: Math.max(0, ...changedAt),
		thinned: thinnedAt.map(sum),
		thinnedPeak: thinnedAt.map((a) => Math.max(0, ...a)),
	}
}

// Whether one write at tick `from` targeting the pose of tick `to` reproduces every tick in between.
function reproduces(track: Decomposed[], from: number, to: number, tolerance: Tolerance): boolean {
	const a = track[from]!
	const b = track[to]!
	for (let m = from + 1; m < to; m++) {
		const alpha = (m - from) / (to - from)
		const actual = track[m]!
		let dp = 0
		let ds = 0
		for (let i = 0; i < 3; i++) {
			dp += (a.translation[i]! + (b.translation[i]! - a.translation[i]!) * alpha - actual.translation[i]!) ** 2
			ds = Math.max(ds, Math.abs(a.scale[i]! + (b.scale[i]! - a.scale[i]!) * alpha - actual.scale[i]!))
		}
		if (Math.sqrt(dp) > tolerance.position || ds > tolerance.rotation) return false
		if (quatAngle(slerp(a.left, b.left, alpha), actual.left) > tolerance.rotation) return false
		if (quatAngle(slerp(a.right, b.right, alpha), actual.right) > tolerance.rotation) return false
	}
	return true
}

function unit(d: Decomposed): Decomposed {
	return { ...d, left: normalizeQuat(d.left), right: normalizeQuat(d.right) }
}

function same(values: Int32Array, a: number, b: number): boolean {
	for (let i = 0; i < STRIDE; i++) if (values[a + i] !== values[b + i]) return false
	return true
}

function sum(a: Int32Array): number {
	let total = 0
	for (const v of a) total += v
	return total
}
