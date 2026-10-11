import { DEFAULT_VARIANT_ID } from './settings'

export const VARIANT_CHANNEL = 'variant'

type Effects = { variant?: BBKeyframe[] }

// The variant keyframes of an animation, earliest first. They live in the animation's effects animator.
export function variantKeyframes(animation: BBAnimation): BBKeyframe[] {
	const effects = (animation.animators as unknown as Record<string, Effects | undefined>).effects
	return [...(effects?.variant ?? [])].sort((a, b) => a.time - b.time)
}

// The uuid of the variant a keyframe shows; DEFAULT_VARIANT_ID for the original model.
export function keyframeVariant(keyframe: BBKeyframe): string {
	const id = (keyframe.data_points[0] as unknown as { variant?: unknown } | undefined)?.variant
	return typeof id === 'string' && id ? id : DEFAULT_VARIANT_ID
}
