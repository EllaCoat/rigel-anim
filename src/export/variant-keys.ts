import { TICKS_PER_SECOND } from '../bake/sample'
import type { Loop } from './types'

// The variant each frame function applies: frame → variant name. A keyframe lands on the tick nearest its time, and the
// later of two on one tick wins. A loop shows frame 0's pose on its last tick without running frame 0 again, so a
// keyframe on the last tick counts as one on tick 0 unless tick 0 has its own, and tick 0's variant is applied again
// on the last tick.
export function variantCalls(loop: Loop, ticks: number, keys: readonly { time: number; variant: string }[]): Map<number, string> {
	const calls = new Map<number, string>()
	const looping = loop === 'loop' && ticks > 0
	let last: string | undefined
	for (const key of [...keys].sort((a, b) => a.time - b.time)) {
		const tick = Math.min(Math.round(key.time * TICKS_PER_SECOND + 1e-9), ticks)
		if (looping && tick === ticks) last = key.variant
		else calls.set(tick, key.variant)
	}
	if (looping && last !== undefined && !calls.has(0)) calls.set(0, last)
	const first = calls.get(0)
	if (looping && first !== undefined) calls.set(ticks, first)
	return calls
}

// A client that gets a new item restarts the bone's interpolation from the pose it shows, but keeps the progress of the
// run it was in. So every bone a variant rewrites must have no run going on when the variant is applied at frame f: its
// run ends at f - 1, and the next run starts with a write at frame f. Frame 0 writes every bone anyway.
export function variantCuts(calls: ReadonlyMap<number, string>, rewritten: (variant: string) => ReadonlySet<number>): (bone: number) => number[] {
	return (bone) => [...calls].filter(([frame, variant]) => frame > 0 && rewritten(variant).has(bone)).map(([frame]) => frame - 1)
}
