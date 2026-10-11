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

export interface FrameWrite {
	// Renderable bone.
	bone: number
	// Frame of `poses` the values come from.
	pose: number
	// Ticks the interpolation to the pose takes.
	duration: number
}

// The writes of each frame function, bones in order. f/0 writes every bone. A loop's last frame shows the pose of
// frame 0, and the next tick plays f/1. Each bone's run from frame k to j (`ends`, every frame by default) is one
// write at frame k + 1 with the pose of frame j, left out when the bone already has that pose.
export function planFrames(loop: Loop, poses: Poses, ends?: (bone: number) => number[]): FrameWrite[][] {
	const last = poses.length - 1
	const at = (f: number) => (f === last && loop === 'loop' ? 0 : f)
	const frames: FrameWrite[][] = poses.map(() => [])
	const bones = poses[0]?.length ?? 0
	for (let bone = 0; bone < bones; bone++) {
		frames[0]!.push({ bone, pose: 0, duration: 1 })
		const runs = ends?.(bone) ?? poses.map((_, f) => f)
		for (let i = 1; i < runs.length; i++) {
			const k = runs[i - 1]!
			const j = runs[i]!
			if (poses[at(j)]![bone] !== poses[at(k)]![bone]) frames[k + 1]!.push({ bone, pose: at(j), duration: j - k })
		}
	}
	return frames
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
