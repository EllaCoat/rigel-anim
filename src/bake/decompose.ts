import {
	column,
	cross,
	det3,
	dot,
	fromColumns,
	IDENTITY_QUAT,
	length,
	linearPart,
	mul3,
	mulVec,
	negateQuat,
	normalizeQuat,
	perpendicular,
	quatAngle,
	quatDot,
	quatFromMat3,
	quatToMat3,
	scaleVec,
	slerp,
	symmetricEigen,
	translationPart,
	transpose3,
	type Mat3,
	type Mat4,
	type Quat,
	type Vec3,
} from './matrix'

// Values a bone track needs per tick: translation and one rotation (7), plus a scale along the
// bone's own axes (10), or left rotation · scale · right rotation when the bone is sheared (14).
export type ValueCount = 7 | 10 | 14

export interface Decomposed {
	translation: Vec3
	left: Quat
	scale: Vec3
	right: Quat
}

const EPSILON = 1e-5
// Scales below this quantize to 0, so the axes they belong to carry no direction. Blockbench itself
// draws a zero scale as 1e-5.
const VANISHING = 5e-5

export function valueCount(m: Mat4): ValueCount {
	const a = linearPart(m)
	const columns = [column(a, 0), column(a, 1), column(a, 2)]
	const norms = columns.map(length)
	for (const [i, j] of [[0, 1], [0, 2], [1, 2]] as const) {
		const ni = norms[i]!
		const nj = norms[j]!
		if (ni > EPSILON && nj > EPSILON && Math.abs(dot(columns[i]!, columns[j]!)) > EPSILON * ni * nj) return 14
	}
	return norms.every((n) => Math.abs(n - 1) <= EPSILON) && det3(a) > 0 ? 7 : 10
}

// One decomposition per tick. The whole track uses the form of its most demanding tick, and each tick
// picks the equivalent decomposition closest to the previous one, because Minecraft interpolates the
// components separately and a jump between equivalent forms would show as a twist between ticks.
export function decomposeTrack(matrices: Mat4[]): { count: ValueCount; frames: Decomposed[] } {
	const count = matrices.reduce<ValueCount>((c, m) => Math.max(c, valueCount(m)) as ValueCount, 7)
	let frames: Decomposed[]
	if (count === 14) frames = decomposeShearedTrack(matrices)
	else {
		let previous: Decomposed | undefined
		frames = matrices.map((m) => (previous = decomposeAligned(m, count, previous)))
	}
	if (count !== 7) reorientHidden(frames)
	for (let k = 0; k < frames.length; k++) frames[k] = alignSigns(frames[k]!, frames[k - 1])
	return { count, frames }
}

// Where equal scales leave the rotations free, following the previous tick only moves the jump to the
// first tick that fixes them again. A run of freer ticks between two more fixed ones therefore takes
// the rotations closest to an even blend of the ticks around it (a leading run takes the following
// tick's). Ticks with two equal scales (free within a plane) are blended between fully fixed ticks
// first, then ticks with uniform scale (fully free) between the ticks around them.
// ponytail: near-equal scales that swap order between two ticks turn the exact decomposition quickly, and the in-between pose deviates by up to ~1% of the scale (1.2e-2 on real rigs); blend across such swaps if it shows.
function decomposeShearedTrack(matrices: Mat4[]): Decomposed[] {
	const frames: Decomposed[] = []
	const freedom: number[] = []
	for (const m of matrices) {
		const result = decomposeSheared(m, frames[frames.length - 1])
		frames.push(result.decomposed)
		freedom.push(result.freedom)
	}
	for (const level of [1, 3]) {
		for (let start = 0; start < frames.length; start++) {
			if (freedom[start]! < level) continue
			let end = start
			while (end + 1 < frames.length && freedom[end + 1]! >= level) end++
			const before = frames[start - 1]
			const after = frames[end + 1]
			if (after) {
				for (let k = start; k <= end; k++) {
					const t = before ? (k - start + 1) / (end - start + 2) : 1
					const guide: Decomposed = before
						? {
								translation: after.translation,
								left: normalizeQuat(slerp(before.left, after.left, t)),
								scale: before.scale.map((s, i) => s + (after.scale[i]! - s) * t) as Vec3,
								right: normalizeQuat(slerp(before.right, after.right, t)),
							}
						: after
					frames[k] = decomposeSheared(matrices[k]!, guide).decomposed
				}
			}
			start = end
		}
	}
	return frames
}

// A bone scaled to zero has no orientation of its own. Within a hidden run the rotation switches to the
// one the bone reappears with, between two invisible ticks, so neither shrinking (which keeps the
// previous rotation) nor growing back spins the bone. A single hidden tick keeps the previous rotation.
function reorientHidden(frames: Decomposed[]): void {
	const hidden = (d: Decomposed) => d.scale.every((s) => Math.abs(s) < VANISHING)
	for (let start = 0; start < frames.length; start++) {
		if (!hidden(frames[start]!)) continue
		let end = start
		while (end + 1 < frames.length && hidden(frames[end + 1]!)) end++
		const next = frames[end + 1]
		const from = start === 0 ? 0 : end > start ? end : end + 1
		if (next) for (let k = from; k <= end; k++) frames[k] = { ...frames[k]!, left: next.left, right: next.right }
		start = end
	}
}

function decomposeAligned(m: Mat4, count: 7 | 10, previous: Decomposed | undefined): Decomposed {
	const translation = translationPart(m)
	const a = linearPart(m)
	if (count === 7) return { translation, left: quatFromMat3(a), scale: [1, 1, 1], right: [...IDENTITY_QUAT] }

	const columns = [column(a, 0), column(a, 1), column(a, 2)]
	const scale = columns.map(length) as Vec3
	const fallback = previous ? quatToMat3(previous.left) : [1, 0, 0, 0, 1, 0, 0, 0, 1]
	const axes = columns.map((c, i) => (scale[i]! > VANISHING ? scaleVec(c, 1 / scale[i]!) : undefined))
	completeAxes(axes, fallback)
	const candidates = [axes as Vec3[]]
	if (det3(fromColumns(...(axes as [Vec3, Vec3, Vec3]))) < 0) {
		// Mirrored: one axis gets a negative scale. Which one is free, so keep the previous tick's choice.
		candidates.length = 0
		for (let k = 0; k < 3; k++) candidates.push(axes.map((v, i) => (i === k ? scaleVec(v!, -1) : v!)))
	}
	let best: Decomposed | undefined
	let bestCost = Infinity
	candidates.forEach((cand, k) => {
		const s = scale.map((v, i) => (candidates.length > 1 && i === k ? -v : v)) as Vec3
		const d: Decomposed = { translation, left: quatFromMat3(fromColumns(...(cand as [Vec3, Vec3, Vec3]))), scale: s, right: [...IDENTITY_QUAT] }
		const cost = previous ? distance(d, previous) : k
		if (cost < bestCost) {
			bestCost = cost
			best = d
		}
	})
	return best!
}

// Axes of a zero-scaled column carry no information; they are filled so the frame stays a rotation
// and, where possible, matches the previous tick.
function completeAxes(axes: (Vec3 | undefined)[], fallback: Mat3): void {
	const present = [0, 1, 2].filter((i) => axes[i])
	if (present.length === 3) return
	if (present.length === 0) {
		for (let i = 0; i < 3; i++) axes[i] = column(fallback, i)
		return
	}
	if (present.length === 1) {
		const i = present[0]!
		const j = (i + 1) % 3
		const base = axes[i]!
		const hint = column(fallback, j)
		const projected: Vec3 = [hint[0] - base[0] * dot(hint, base), hint[1] - base[1] * dot(hint, base), hint[2] - base[2] * dot(hint, base)]
		const n = length(projected)
		axes[j] = n > 1e-6 ? scaleVec(projected, 1 / n) : perpendicular(base)
	}
	const k = [0, 1, 2].find((i) => !axes[i])!
	axes[k] = cross(axes[(k + 1) % 3]!, axes[(k + 2) % 3]!)
}

const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]

// a = U · diag(s) · Wᵀ (left = U, right = Wᵀ), with W the singular vectors closest to the guide's
// (the previous tick, or the identity at the first tick). Equal singular values leave the basis of
// their plane free; the closest basis there is taken. freedom: 0 when W is fixed (up to the discrete
// choices), 1 when two scales are equal (a rotation within a plane), 3 when all three are equal.
function decomposeSheared(m: Mat4, guide: Decomposed | undefined): { decomposed: Decomposed; freedom: number } {
	const translation = translationPart(m)
	const a = linearPart(m)
	const { values, vectors } = symmetricEigen(mul3(transpose3(a), a))
	const singular = values.map((x) => Math.sqrt(Math.max(0, x)))
	const target = guide ? transpose3(quatToMat3(guide.right)) : IDENTITY3
	const clusters = clusterEqual(singular)
	const visible = clusters.filter((c) => singular[c[0]!]! >= VANISHING).map((c) => c.length)
	const freedom = visible.includes(3) ? 3 : visible.includes(2) ? 1 : 0
	let best: { w: Vec3[]; s: number[] } | undefined
	let bestScore = -Infinity
	for (const perm of PERMUTATIONS) {
		const w: Vec3[] = []
		const s: number[] = []
		for (const cluster of clusters) {
			const ks = [0, 1, 2].filter((k) => cluster.includes(perm[k]!))
			const fitted = closestBasis(
				cluster.map((i) => column(vectors, i)),
				ks.map((k) => column(target, k)),
			)
			const value = cluster.reduce((t, i) => t + singular[i]!, 0) / cluster.length
			ks.forEach((k, c) => {
				w[k] = fitted[c]!
				s[k] = value
			})
		}
		const fit = w.map((v, k) => dot(v, column(target, k)))
		let score = fit.reduce((t, x) => t + x, 0)
		if (det3(fromColumns(w[0]!, w[1]!, w[2]!)) < 0) {
			const k = fit.indexOf(Math.min(...fit))
			w[k] = scaleVec(w[k]!, -1)
			score -= 2 * fit[k]!
		}
		if (score > bestScore) {
			bestScore = score
			best = { w, s }
		}
	}
	const { w, s } = best!
	// Left axes from the largest singular value down, each made orthogonal to the ones before: a·w/s
	// alone loses its direction when s is tiny (a bone squashed almost flat).
	const tiny = Math.max(Math.max(...s) * 1e-9, VANISHING)
	const u: (Vec3 | undefined)[] = [undefined, undefined, undefined]
	for (const k of [0, 1, 2].sort((i, j) => s[j]! - s[i]!)) {
		if (!(s[k]! > tiny)) continue
		let x = mulVec(a, w[k]!)
		for (const done of u) if (done) x = subtract(x, scaleVec(done, dot(x, done)))
		const n = length(x)
		if (n > s[k]! * 1e-3) u[k] = scaleVec(x, 1 / n)
	}
	const scale = [...s] as Vec3
	if (u.every(Boolean) && det3(fromColumns(u[0]!, u[1]!, u[2]!)) < 0) {
		const negative = guide ? guide.scale.findIndex((x) => x < 0) : -1
		const k = negative >= 0 ? negative : s.indexOf(Math.min(...s))
		u[k] = scaleVec(u[k]!, -1)
		scale[k] = -scale[k]!
	}
	completeAxes(u, guide ? quatToMat3(guide.left) : IDENTITY3)
	const decomposed: Decomposed = {
		translation,
		left: quatFromMat3(fromColumns(u[0]!, u[1]!, u[2]!)),
		scale,
		right: quatFromMat3(transpose3(fromColumns(w[0]!, w[1]!, w[2]!))),
	}
	return { decomposed, freedom }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

// Vanishing singular values count as equal too: their directions are noise, so they follow the previous tick.
function clusterEqual(s: number[]): number[][] {
	const tolerance = Math.max(1e-7 * Math.max(...s), VANISHING)
	const order = [0, 1, 2].sort((i, j) => s[i]! - s[j]!)
	const clusters: number[][] = [[order[0]!]]
	for (const i of order.slice(1)) {
		const last = clusters[clusters.length - 1]!
		if (s[i]! - s[last[last.length - 1]!]! <= tolerance) last.push(i)
		else clusters.push([i])
	}
	return clusters
}

// The orthonormal basis of span(basis), one vector per goal, that best matches the goals (orthogonal
// Procrustes, reflections allowed; the caller fixes the handedness of the full frame).
function closestBasis(basis: Vec3[], goals: Vec3[]): Vec3[] {
	if (basis.length === 3) return goals.map((g) => [...g] as Vec3)
	if (basis.length === 1) return [scaleVec(basis[0]!, dot(basis[0]!, goals[0]!) < 0 ? -1 : 1)]
	const [e0, e1] = basis as [Vec3, Vec3]
	const [g0, g1] = goals as [Vec3, Vec3]
	const m00 = dot(e0, g0), m01 = dot(e0, g1), m10 = dot(e1, g0), m11 = dot(e1, g1)
	const rotation = Math.hypot(m00 + m11, m10 - m01)
	const reflection = Math.hypot(m00 - m11, m01 + m10)
	let q: [number, number, number, number]
	if (rotation >= reflection) {
		const t = Math.atan2(m10 - m01, m00 + m11)
		q = [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)]
	} else {
		const t = Math.atan2(m01 + m10, m00 - m11)
		q = [Math.cos(t), Math.sin(t), Math.sin(t), -Math.cos(t)]
	}
	const combine = (a: number, b: number): Vec3 => [e0[0] * a + e1[0] * b, e0[1] * a + e1[1] * b, e0[2] * a + e1[2] * b]
	return [combine(q[0], q[2]), combine(q[1], q[3])]
}

function distance(a: Decomposed, b: Decomposed): number {
	const ds = Math.abs(a.scale[0] - b.scale[0]) + Math.abs(a.scale[1] - b.scale[1]) + Math.abs(a.scale[2] - b.scale[2])
	return quatAngle(a.left, b.left) + quatAngle(a.right, b.right) + ds
}

// q and -q are the same rotation; keep the sign continuous so interpolation and change detection see
// the real motion.
function alignSigns(d: Decomposed, previous: Decomposed | undefined): Decomposed {
	const flip = (q: Quat, p: Quat | undefined) => ((p ? quatDot(q, p) < 0 : q[3] < 0) ? negateQuat(q) : q)
	return { ...d, left: flip(d.left, previous?.left), right: flip(d.right, previous?.right) }
}
