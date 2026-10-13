import { nearestTick, snapToTick, TICKS_PER_SECOND } from '../bake/sample'

// The time to jump to from the playhead, or undefined when no keyframe lies that way. Keyframes are compared by the
// tick they round to, so one on the playhead's own tick is passed over; the target is that tick's time.
export function jumpTarget(times: readonly number[], playhead: number, length: number, direction: 1 | -1): number | undefined {
	const here = nearestTick(playhead)
	const ahead = times.filter((time) => (nearestTick(time) - here) * direction > 0).sort((a, b) => (a - b) * direction)
	return ahead.length > 0 ? snapToTick(ahead[0]!, length) : undefined
}

// The ends of the A-B loop, in ticks.
export interface LoopRange {
	a?: number
	b?: number
}

// Where playback goes back to once it is past B; undefined while the loop has no valid range (A before B) or B is not passed.
export function loopBack(time: number, range: LoopRange): number | undefined {
	const { a, b } = range
	if (a === undefined || b === undefined || a >= b) return undefined
	return time > b / TICKS_PER_SECOND ? a / TICKS_PER_SECOND : undefined
}

export function loopLabel(range: LoopRange): string {
	if (range.a === undefined && range.b === undefined) return '—'
	const show = (tick: number | undefined) => (tick === undefined ? '—' : `${tick}t`)
	return `A:${show(range.a)} B:${show(range.b)}`
}

export const DEFAULT_ONION_RANGE = 1
export const MIN_ONION_RANGE = 1
export const MAX_ONION_RANGE = 5

// A whole number of ticks inside the allowed range; undefined for what is not a number.
export function clampOnionRange(value: number): number | undefined {
	return Number.isFinite(value) ? Math.max(MIN_ONION_RANGE, Math.min(MAX_ONION_RANGE, Math.floor(value))) : undefined
}

export function storedOnionRange(text: string | null): number {
	return clampOnionRange(Number.parseInt(text ?? '', 10)) ?? DEFAULT_ONION_RANGE
}

export interface OnionFrame {
	direction: 'past' | 'future'
	// Ticks from the playhead.
	distance: number
	time: number
}

const EPSILON = 1e-9

// The poses around the playhead: `range` ticks before it, then `range` ticks after it. There is no pose before time 0.
export function onionFrames(now: number, range: number): OnionFrame[] {
	const frames: OnionFrame[] = []
	for (let distance = 1; distance <= range; distance++) {
		const time = now - distance / TICKS_PER_SECOND
		if (time >= -EPSILON) frames.push({ direction: 'past', distance, time: Math.max(0, time) })
	}
	for (let distance = 1; distance <= range; distance++) frames.push({ direction: 'future', distance, time: now + distance / TICKS_PER_SECOND })
	return frames
}

// How much of the base opacity a ghost keeps: all of it next to the playhead, less the farther it is.
export function onionFade(distance: number, range: number): number {
	return 1 - (distance - 1) / range
}
