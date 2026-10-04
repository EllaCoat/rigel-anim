// How Blockbench 5.2.1 interpolates between two keyframes of a channel, as far as easing depends on
// it. Plain data in, so it can be tested without Blockbench.
import { ease, type EasingCurve } from './curves'

export type SegmentKind = 'step' | 'linear' | 'catmullrom' | 'bezier'

interface Interpolated {
	interpolation: string
}

/** The interpolation Blockbench applies between two keyframes, checked in its order of precedence. */
export function segmentKind(before: Interpolated, after: Interpolated): SegmentKind | undefined {
	if (before.interpolation === 'step') return 'step'
	if (before.interpolation === 'linear' && (after.interpolation === 'linear' || after.interpolation === 'step')) return 'linear'
	if (before.interpolation === 'catmullrom' || after.interpolation === 'catmullrom') return 'catmullrom'
	if (before.interpolation === 'bezier' || after.interpolation === 'bezier') return 'bezier'
	return undefined
}

/**
 * The keyframes outside the segment [index, index + 1] that a catmullrom segment also passes through.
 * Looping animations wrap around, skipping the last keyframe, which normally repeats the first.
 */
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
	/** a keyframe at either end has separate values before and after it */
	discontinuous: boolean
}

/**
 * The progress handed to Blockbench for an eased segment. Overshooting easings (back, elastic) leave
 * [0, 1]: linear segments extend the line and catmullrom segments continue along the neighbouring
 * segment's curve. Blockbench's catmullrom spline holds only one segment beyond each side, and only
 * where that keyframe exists, and reads a missing point beyond it, so the progress is kept within
 * the spline there; at keyframes with two values the spline is laid out differently, so overshoot is
 * cut off. Bézier segments stop at their end values by themselves.
 */
export function easedProgress(curve: EasingCurve, t: number, context: SegmentContext): number {
	const e = ease(curve, t)
	if (context.kind !== 'catmullrom' || (e >= 0 && e <= 1)) return e
	if (context.discontinuous) return Math.min(1 - 1e-9, Math.max(0, e))
	return Math.min(context.hasAfter ? 2 : 1, Math.max(context.hasBefore ? -1 : 0, e))
}
