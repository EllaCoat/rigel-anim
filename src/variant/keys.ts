import { DEFAULT_VARIANT_ID } from './settings'

export interface TimedVariant {
	time: number
	variant: string
}

// Seconds of slack for a playhead that a snap left a hair before its keyframe.
const EPSILON = 1e-4

// The variant the animation shows at `time`: the last keyframe at or before it. Before the first keyframe, the last
// one stands in, as the model still wears what it set when the animation looped. undefined when there are none.
export function variantAt(keys: readonly TimedVariant[], time: number): string | undefined {
	if (keys.length === 0) return undefined
	const sorted = [...keys].sort((a, b) => a.time - b.time)
	const before = sorted.filter((k) => k.time <= time + EPSILON).at(-1)
	return (before ?? sorted.at(-1))!.variant
}

// The variant each bone wears at `time`. A variant is applied only to the bones it does not exclude, so a bone wears
// the last keyframe at or before `time` that applies to it, and the original model comes from `default`. Where no
// keyframe up to `time` applies to a bone, the last one in the animation does, as in variantAt. A bone no keyframe
// applies to wears `fallback`, the variant chosen in the panel, unless that one excludes it.
// excluded: the bones each variant leaves alone, by variant uuid; every keyframe names `default` or one of them.
export function variantPerBone(
	keys: readonly TimedVariant[],
	time: number,
	bones: readonly string[],
	excluded: ReadonlyMap<string, ReadonlySet<string>>,
	fallback: string,
): Map<string, string> {
	const ordered = [...keys].sort((a, b) => a.time - b.time)
	const upTo = ordered.filter((k) => k.time <= time + EPSILON)
	const out = new Map<string, string>()
	for (const bone of bones) {
		const applies = (variant: string) => variant === DEFAULT_VARIANT_ID || !excluded.get(variant)?.has(bone)
		const key = upTo.filter((k) => applies(k.variant)).at(-1) ?? ordered.filter((k) => applies(k.variant)).at(-1)
		out.set(bone, key?.variant ?? (applies(fallback) ? fallback : DEFAULT_VARIANT_ID))
	}
	return out
}

export interface ViewInput {
	// The paint view draws the project's own textures, which are what painting writes to.
	painting: boolean
	keys: readonly TimedVariant[]
	time: number
	bones: readonly string[]
	excluded: ReadonlyMap<string, ReadonlySet<string>>
	// The variant chosen in the panel.
	chosen: string
}

export interface ViewPlan {
	byBone: Map<string, string>
	// For cubes outside every bone.
	other: string
	// The variant the panel marks as shown: the keyframe at the playhead, or the chosen one.
	headline: string
}

// What the viewport draws. A keyframe or a choice that names a variant that does not exist draws the original model.
export function viewPlan({ painting, keys, time, bones, excluded, chosen }: ViewInput): ViewPlan {
	const known = (variant: string) => (variant === DEFAULT_VARIANT_ID || excluded.has(variant) ? variant : DEFAULT_VARIANT_ID)
	if (painting) return { byBone: new Map(bones.map((b) => [b, DEFAULT_VARIANT_ID])), other: DEFAULT_VARIANT_ID, headline: DEFAULT_VARIANT_ID }
	const timeline = keys.map((k) => ({ time: k.time, variant: known(k.variant) }))
	const headline = variantAt(timeline, time) ?? known(chosen)
	return { byBone: variantPerBone(timeline, time, bones, excluded, known(chosen)), other: headline, headline }
}
