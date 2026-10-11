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
