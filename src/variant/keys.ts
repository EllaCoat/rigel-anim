import { TICKS_PER_SECOND } from '../bake/sample'
import type { Loop } from '../export/types'
import { variantCalls } from '../export/variant-keys'
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
	painting: boolean
	keys: readonly TimedVariant[]
	loop: Loop
	length: number
	ticks: number
	time: number
	bones: readonly string[]
	excluded: ReadonlyMap<string, ReadonlySet<string>>
	chosen: string
}

export interface ViewPlan {
	byBone: Map<string, string>
	other: string
	shown: Set<string>
}

export function viewPlan({ painting, keys, loop, length, ticks, time, bones, excluded, chosen }: ViewInput): ViewPlan {
	const known = (variant: string) => (variant === DEFAULT_VARIANT_ID || excluded.has(variant) ? variant : DEFAULT_VARIANT_ID)
	if (painting) return { byBone: new Map(bones.map((b) => [b, DEFAULT_VARIANT_ID])), other: DEFAULT_VARIANT_ID, shown: new Set([DEFAULT_VARIANT_ID]) }
	const calls = variantCalls(loop, ticks, keys.map((k) => ({ time: k.time, variant: known(k.variant) })))
	const timeline = [...calls].map(([tick, variant]) => ({ time: Math.min(tick / TICKS_PER_SECOND, length), variant }))
	const other = variantAt(timeline, time) ?? known(chosen)
	const byBone = variantPerBone(timeline, time, bones, excluded, known(chosen))
	return { byBone, other, shown: new Set(byBone.size > 0 ? byBone.values() : [other]) }
}
