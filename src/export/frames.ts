import type { Loop } from './types'

const BASE_DIGITS = 4

// The first 12 values (rows 0–2) of the matrix a bone entity gets, from a column-major bone matrix:
// the bone's transform, half a turn about y to undo the one item_display adds before it draws the item,
// and the scale k the item model was shrunk by.
export function entityValues(m: ArrayLike<number>, at: number, k: number): number[] {
	const v: number[] = []
	for (let r = 0; r < 3; r++) v.push(-k * m[at + r]!, k * m[at + 4 + r]!, -k * m[at + 8 + r]!, m[at + 12 + r]!)
	return v
}

// Shrunk bones get as many extra digits as k has before the point.
export function digitsFor(k: number): number {
	return BASE_DIGITS + (k > 1 ? String(Math.floor(k)).length : 0)
}

// SNBT float with the leading 0 and trailing zeros dropped: 0.5 → .5f, -0.25 → -.25f, 1 → 1f.
export function formatFloat(value: number, digits: number): string {
	let s = value.toFixed(digits)
	if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
	if (s === '-0') s = '0'
	return `${s.replace(/^(-?)0\./, '$1.')}f`
}

export function poseString(m: ArrayLike<number>, at: number, k: number): string {
	const digits = digitsFor(k)
	return entityValues(m, at, k).map((v) => formatFloat(v, digits)).join(',')
}

// poses[f][b]: the 12 values of renderable bone b at frame f.
export type Poses = string[][]

export interface FramePlan {
	// Renderable bones the frame function writes.
	writes: number[]
	// Frame of `poses` the values come from.
	pose: number
}

// f/0 writes every bone; later frames write the bones that changed since the frame before. A loop's
// last frame goes back to the pose of frame 0, and the next tick plays f/1.
export function planFrames(loop: Loop, poses: Poses): FramePlan[] {
	const last = poses.length - 1
	const changed = (from: number, to: number) => poses[to]!.flatMap((p, b) => (p === poses[from]![b] ? [] : [b]))
	return poses.map((pose, f) => {
		if (f === 0) return { writes: pose.map((_, b) => b), pose: 0 }
		if (f === last && loop === 'loop') return { writes: changed(f - 1, 0), pose: 0 }
		return { writes: changed(f - 1, f), pose: f }
	})
}

export interface WarmItem {
	animation: number
	frame: number
	lines: number
}

// Consecutive items whose lines add up to at most `limit`; an item longer than that gets a chunk of its own.
export function planChunks(items: WarmItem[], limit: number): WarmItem[][] {
	const chunks: WarmItem[][] = []
	let current: WarmItem[] = []
	let lines = 0
	for (const item of items) {
		if (current.length > 0 && lines + item.lines > limit) {
			chunks.push(current)
			current = []
			lines = 0
		}
		current.push(item)
		lines += item.lines
	}
	if (current.length > 0) chunks.push(current)
	return chunks
}
