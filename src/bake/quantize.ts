import type { Decomposed } from './decompose'
import { compose, type Quat, type Vec3 } from './matrix'

// Values are stored as int at 4 decimal places (1.2345 → 12345) and the data pack restores the digits.
export const QUANTUM = 10_000

// Per bone and tick: translation (3), left rotation (4), scale (3), right rotation (4). Tracks that need
// fewer values still store all 14 here; their scale is 1 and their right rotation is the identity.
export const STRIDE = 14

export function quantizeInto(d: Decomposed, out: Int32Array, offset: number): void {
	const values = [...d.translation, ...d.left, ...d.scale, ...d.right]
	for (let i = 0; i < STRIDE; i++) out[offset + i] = Math.round(values[i]! * QUANTUM)
}

export function dequantize(values: ArrayLike<number>, offset: number): Decomposed {
	const at = (i: number) => values[offset + i]! / QUANTUM
	return {
		translation: [at(0), at(1), at(2)] as Vec3,
		left: [at(3), at(4), at(5), at(6)] as Quat,
		scale: [at(7), at(8), at(9)] as Vec3,
		right: [at(10), at(11), at(12), at(13)] as Quat,
	}
}

// The matrix Minecraft builds from the stored values (quaternions are used without normalizing).
export function reconstruct(values: ArrayLike<number>, offset: number): number[] {
	const d = dequantize(values, offset)
	return compose(d.translation, d.left, d.scale, d.right)
}
