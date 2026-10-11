import { isRigelProject } from '../easing/keyframes'
import { variantAt } from './keys'
import { DEFAULT_VARIANT_ID } from './settings'
import { vue } from './vue'

export const VARIANT_CHANNEL = 'variant'

interface Effects {
	variant?: BBKeyframe[]
	muted: Record<string, boolean>
	addToTimeline(endOfList?: boolean): void
	createKeyframe(value: object, time: number, channel: string, undo: boolean, select: boolean): BBKeyframe
}
type Point = { variant?: unknown }

const effectsOf = (animation: BBAnimation): Effects | undefined => (animation.animators as unknown as Record<string, Effects | undefined>).effects

// The variant keyframes of an animation, earliest first. They live in the animation's effects animator.
export function variantKeyframes(animation: BBAnimation): BBKeyframe[] {
	return [...(effectsOf(animation)?.variant ?? [])].sort((a, b) => a.time - b.time)
}

// The uuid of the variant a keyframe shows; DEFAULT_VARIANT_ID for the original model.
export function keyframeVariant(keyframe: BBKeyframe): string {
	const id = (keyframe.data_points[0] as unknown as Point | undefined)?.variant
	return typeof id === 'string' && id ? id : DEFAULT_VARIANT_ID
}

// The variant the animation's keyframes show at its playhead; undefined when it has none, or they are muted.
export function keyframeVariantNow(animation: BBAnimation): string | undefined {
	if (effectsOf(animation)?.muted.variant) return undefined
	return variantAt(variantKeyframes(animation).map((kf) => ({ time: kf.time, variant: keyframeVariant(kf) })), animation.time)
}

// The keyframes that do not show the variant yet.
export function notShowing(keyframes: BBKeyframe[], variant: string): BBKeyframe[] {
	return keyframes.filter((kf) => keyframeVariant(kf) !== variant)
}

export function selectedVariantKeyframes(): BBKeyframe[] {
	return Modes.animate ? Timeline.selected.filter((kf) => kf.channel === VARIANT_CHANNEL) : []
}

// One undo step.
export function setKeyframeVariants(keyframes: BBKeyframe[], variant: string): void {
	Undo.initEdit({ keyframes })
	for (const kf of keyframes) (kf.data_points[0] as unknown as Point).variant = variant
	Undo.finishEdit('Change variant keyframe')
	Animator.preview()
}

// Puts a keyframe for the variant at the playhead, or changes the one there. It is not selected, so that picking
// the next variant in the panel does not change it.
export function placeVariantKeyframe(variant: string): void {
	const animation = BBAnimation.selected
	if (!animation) return
	const effects = effectsOf(animation) ?? ((animation.animators as unknown as Record<string, unknown>).effects = new EffectAnimator(animation)) as unknown as Effects
	effects.addToTimeline()
	const time = Timeline.snapTime(Timeline.time)
	const there = (effects.variant ?? []).find((kf) => Math.abs(kf.time - time) <= Timeline.getStep() / 2)
	if (there) {
		const changing = notShowing([there], variant)
		if (changing.length > 0) setKeyframeVariants(changing, variant)
	} else effects.createKeyframe({ variant }, time, VARIANT_CHANNEL, true, false)
	Animator.preview()
}

// The timeline shows the effects animator only once someone asks for it; with variant keyframes in it, it is asked for.
export function showVariantTrack(): void {
	const animation = BBAnimation.selected
	const effects = animation && effectsOf(animation)
	if (effects?.variant?.length && !Timeline.animators.includes(effects as never)) effects.addToTimeline(true)
}

let property: Deletable | undefined

// defaultVariant: the variant a new keyframe starts with.
export function registerVariantKeyframes(defaultVariant: () => string): void {
	;(EffectAnimator as unknown as { addChannel(channel: string, options: object): void }).addChannel(VARIANT_CHANNEL, { name: 'Variant', mutable: true, max_data_points: 1, condition: () => isRigelProject() })
	property = new Property(KeyframeDataPoint, 'string', VARIANT_CHANNEL, {
		exposed: false,
		condition: (point: { keyframe: BBKeyframe }) => point.keyframe.channel === VARIANT_CHANNEL,
		default: defaultVariant,
	})
	// Blockbench makes the lists for animators made from now on only.
	for (const project of ModelProject.all)
		for (const animation of project.animations) {
			const effects = effectsOf(animation)
			if (effects && !effects.variant) {
				vue.set(effects, VARIANT_CHANNEL, [])
				vue.set(effects.muted, VARIANT_CHANNEL, false)
			}
		}
}

export function unregisterVariantKeyframes(): void {
	property?.delete()
	property = undefined
	delete (EffectAnimator.prototype.channels as Record<string, unknown>)[VARIANT_CHANNEL]
}
