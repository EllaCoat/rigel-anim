// Easing stored on keyframes and applied while Blockbench interpolates.
import { FORMAT_ID } from '../format'
import { isEasing, type Easing } from './curves'
import { catmullromNeighbours, easedProgress, segmentKind, type SegmentContext } from './segments'

/** Keyframe property holding the easing of the segment that starts at the keyframe; {} when none. */
export const EASING_PROPERTY = 'rigel_easing'

type EasedKeyframe = BBKeyframe & { [EASING_PROPERTY]?: unknown }

export function getEasing(keyframe: BBKeyframe): Easing | undefined {
	const value = (keyframe as EasedKeyframe)[EASING_PROPERTY]
	return isEasing(value) ? value : undefined
}

export function setEasing(keyframe: BBKeyframe, easing: Easing | undefined): void {
	;(keyframe as EasedKeyframe)[EASING_PROPERTY] = easing ? structuredClone(easing) : {}
}

export function isRigelProject(): boolean {
	return Format?.id === FORMAT_ID
}

/** The keyframes of the keyframe's channel in time order, as Blockbench sorts them for catmullrom. */
export function channelKeyframes(keyframe: BBKeyframe): BBKeyframe[] {
	const animator = keyframe.animator as unknown as Record<string, BBKeyframe[]>
	return [...(animator[keyframe.channel] ?? [])].sort((a, b) => a.time - b.time)
}

export function isLooping(keyframe: BBKeyframe): boolean {
	return (keyframe.animator as unknown as { animation?: { loop?: string } }).animation?.loop === 'loop'
}

export function segmentContext(sorted: BBKeyframe[], index: number, loop: boolean): SegmentContext {
	const before = sorted[index]!
	const after = sorted[index + 1]!
	const neighbours = catmullromNeighbours(sorted, index, loop)
	return {
		kind: segmentKind(before, after),
		hasBefore: !!neighbours.before,
		hasAfter: !!neighbours.after,
		discontinuous: before.data_points.length > 1 || after.data_points.length > 1,
	}
}

/** The progress Blockbench should use between before and after at raw progress t. */
export function progressFor(easing: Easing, t: number, before: BBKeyframe, after: BBKeyframe, linearPath: boolean): number {
	if (linearPath) return easedProgress(easing.curve, t, { kind: 'linear', hasBefore: false, hasAfter: false, discontinuous: false })
	const sorted = channelKeyframes(before)
	const index = sorted.indexOf(before)
	if (sorted[index + 1] !== after) {
		// Not neighbours in time order (keyframes at equal times); keep Blockbench's own progress range.
		return Math.min(1, Math.max(0, easedProgress(easing.curve, t, { kind: 'linear', hasBefore: false, hasAfter: false, discontinuous: false })))
	}
	return easedProgress(easing.curve, t, segmentContext(sorted, index, isLooping(before)))
}

type InterpolateEvent = BlockbenchEventMap['interpolate_keyframes']

function onInterpolate(event: InterpolateEvent): { t: number } | undefined {
	const easing = getEasing(event.keyframe_before)
	if (!easing) return undefined
	// Quaternion slerp and the no_interpolations flag do not go through the catmullrom spline.
	const linearPath = event.use_quaternions || !!Blockbench.hasFlag('no_interpolations')
	return { t: progressFor(easing, event.t, event.keyframe_before, event.keyframe_after, linearPath) }
}

let property: Deletable | undefined
let listener: Deletable | undefined

export function registerEasingKeyframes(): void {
	property = new Property(BBKeyframe, 'object', EASING_PROPERTY, { condition: () => isRigelProject() })
	listener = Blockbench.on('interpolate_keyframes', onInterpolate)
}

export function unregisterEasingKeyframes(): void {
	listener?.delete()
	listener = undefined
	property?.delete()
	property = undefined
}
