// Blockbench 5.2.1's interpolation rules that easing depends on, on plain data so they can be tested without Blockbench.
import { ease, type EasingCurve } from './curves'

export type SegmentKind = 'step' | 'linear' | 'catmullrom' | 'bezier'

interface Interpolated {
	interpolation: string
}

export function segmentKind(before: Interpolated, after: Interpolated): SegmentKind | undefined {
	if (before.interpolation === 'step') return 'step'
	if (before.interpolation === 'linear' && (after.interpolation === 'linear' || after.interpolation === 'step')) return 'linear'
	if (before.interpolation === 'catmullrom' || after.interpolation === 'catmullrom') return 'catmullrom'
	if (before.interpolation === 'bezier' || after.interpolation === 'bezier') return 'bezier'
	return undefined
}

// Looping animations wrap around, skipping the last keyframe, which normally repeats the first.
export function catmullromNeighbours<K>(sorted: readonly K[], index: number, loop: boolean): { before?: K; after?: K } {
	let before = sorted[index - 1]
	let after = sorted[index + 2]
	if (loop && sorted.length >= 3) {
		before ??= sorted.at(-2)
		after ??= sorted[1]
	}
	return { before, after }
}

export interface SegmentContext {
	kind: SegmentKind | undefined
	hasBefore: boolean
	hasAfter: boolean
	discontinuous: boolean
}

// Linear segments extend the line and béziers stop at their end values themselves. Blockbench's catmullrom spline
// reaches one segment past each end where that keyframe exists, but past neither end when an end keyframe has two
// values, so overshoot is kept within the spline.
export function easedProgress(curve: EasingCurve, t: number, context: SegmentContext): number {
	const e = ease(curve, t)
	if (context.kind !== 'catmullrom' || (e >= 0 && e <= 1)) return e
	if (context.discontinuous) return Math.min(1 - 1e-9, Math.max(0, e))
	return Math.min(context.hasAfter ? 2 : 1, Math.max(context.hasBefore ? -1 : 0, e))
}
