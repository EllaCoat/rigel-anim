import type { Loop } from './types'

const BASE_DIGITS = 4

// Rows 0–2 of a bone entity's matrix: the column-major bone matrix, half a turn about y to undo the one
// item_display adds, and the scale k the item model was shrunk by.
export function entityValues(m: ArrayLike<number>, at: number, k: number): number[] {
	const v: number[] = []
	for (let r = 0; r < 3; r++) v.push(-k * m[at + r]!, k * m[at + 4 + r]!, -k * m[at + 8 + r]!, m[at + 12 + r]!)
	return v
}

export function digitsFor(k: number): number {
	return BASE_DIGITS + (k > 1 ? String(Math.floor(k)).length : 0)
}

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

// Display entities draw from their own origin without the item model's half turn: the bone matrix times the display's scale.
export function displayPoseString(m: ArrayLike<number>, at: number, scale: readonly number[]): string {
	const digits = digitsFor(Math.max(...scale.map(Math.abs)))
	const v: number[] = []
	for (let r = 0; r < 3; r++) v.push(scale[0]! * m[at + r]!, scale[1]! * m[at + 4 + r]!, scale[2]! * m[at + 8 + r]!, m[at + 12 + r]!)
	return v.map((x) => formatFloat(x, digits)).join(',')
}

// x,y,z in blocks without a type suffix; the rig's frame maps to ^x ^y ^z unchanged.
export function locatorString(p: ArrayLike<number>, at: number): string {
	return [0, 1, 2].map((i) => formatFloat(p[at + i]!, BASE_DIGITS).slice(0, -1)).join(',')
}

// poses[f][b]: the 12 values of renderable bone b at frame f.
export type Poses = string[][]

export interface FrameWrite {
	bone: number
	pose: number
	duration: number
}

// ends: the frames runs end at, from 0 to the last frame; snaps: the ends of runs written without interpolating.
export interface Runs {
	ends: number[]
	snaps: number[]
}

// A run from frame k to j is one write at frame k + 1 with the pose of frame j, left out when the bone already has
// that pose. A loop's last frame shows the pose of frame 0.
export function planFrames(loop: Loop, poses: Poses, runs?: (bone: number) => Runs): FrameWrite[][] {
	const last = poses.length - 1
	const at = (f: number) => (f === last && loop === 'loop' ? 0 : f)
	const frames: FrameWrite[][] = poses.map(() => [])
	const bones = poses[0]?.length ?? 0
	for (let bone = 0; bone < bones; bone++) {
		frames[0]!.push({ bone, pose: 0, duration: 1 })
		const { ends, snaps } = runs?.(bone) ?? { ends: poses.map((_, f) => f), snaps: [] }
		for (let i = 1; i < ends.length; i++) {
			const k = ends[i - 1]!
			const j = ends[i]!
			if (poses[at(j)]![bone] !== poses[at(k)]![bone]) frames[k + 1]!.push({ bone, pose: at(j), duration: snaps.includes(j) ? 0 : j - k })
		}
	}
	return frames
}

export interface WarmItem {
	animation: number
	frame: number
	lines: number
}

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
