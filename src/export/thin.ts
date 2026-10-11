// Thinning: per bone, one write that the display-entity interpolation carries over several ticks, as long as every
// tick in between stays within a tolerance of the pose it should show.
import { compose, slerp, type Quat, type Vec3 } from '../bake/matrix'
import type { Poses } from './frames'
import type { Loop, Tolerance } from './types'

// The parts Minecraft splits a written matrix into; clients interpolate them separately (Transformation.slerp).
export interface Split {
	translation: Vec3
	left: Quat
	scale: Vec3
	right: Quat
}

// Minecraft 1.20.4's split (Transformation.ensureDecomposed → MatrixUtil.svdDecompose), step for step in float, so that
// the interpolation can be predicted where the split is not unique. 3×3 matrices are column-major like JOML's fields:
// m[c * 3 + r] is m{c}{r}, column c and row r. JOML's fma is a plain multiply and add unless it is told otherwise.
const f = Math.fround
type M3 = number[]

function mul(a: M3, b: M3): M3 {
	const out: M3 = new Array(9)
	for (let c = 0; c < 3; c++)
		for (let r = 0; r < 3; r++) out[c * 3 + r] = f(f(a[r]! * b[c * 3]!) + f(f(a[3 + r]! * b[c * 3 + 1]!) + f(a[6 + r]! * b[c * 3 + 2]!)))
	return out
}

const transpose = (m: M3): M3 => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!]

function rotation([x, y, z, w]: Quat): M3 {
	const w2 = f(w * w), x2 = f(x * x), y2 = f(y * y), z2 = f(z * z)
	const zw = f(z * w), xy = f(x * y), xz = f(x * z), yw = f(y * w), yz = f(y * z), xw = f(x * w)
	const dzw = f(zw + zw), dxy = f(xy + xy), dxz = f(xz + xz), dyw = f(yw + yw), dyz = f(yz + yz), dxw = f(xw + xw)
	return [f(f(f(w2 + x2) - z2) - y2), f(dxy + dzw), f(dxz - dyw), f(dxy - dzw), f(f(f(y2 - z2) + w2) - x2), f(dyz + dxw), f(dyw + dxz), f(dyz - dxw), f(f(f(z2 - y2) - x2) + w2)]
}

function qmul([x, y, z, w]: Quat, [qx, qy, qz, qw]: Quat): Quat {
	return [
		f(f(w * qx) + f(f(x * qw) + f(f(y * qz) + f(-z * qy)))),
		f(f(w * qy) + f(f(-x * qz) + f(f(y * qw) + f(z * qx)))),
		f(f(w * qz) + f(f(x * qy) + f(f(-y * qx) + f(z * qw)))),
		f(f(w * qw) + f(f(-x * qx) + f(f(-y * qy) + f(-z * qz)))),
	]
}

function normalize([x, y, z, w]: Quat): Quat {
	const n = f(1 / f(Math.sqrt(f(f(x * x) + f(f(y * y) + f(f(z * z) + f(w * w)))))))
	return [f(x * n), f(y * n), f(z * n), f(w * n)]
}

// sinHalf and cosHalf of a rotation by an angle.
type Givens = [number, number]

function fromUnnormalized(a: number, b: number): Givens {
	const n = f(1 / f(Math.sqrt(f(f(a * a) + f(b * b)))))
	return [f(n * a), f(n * b)]
}

const PI_4: Givens = (() => {
	const sin = f(Math.sin(f(f(Math.PI / 4) / 2)))
	return [sin, f(Math.sqrt(f(1 - f(sin * sin))))]
})()
const G = f(3 + f(2 * f(Math.sqrt(2))))
const SMALL = f(1e-6)

const cos = ([s, c]: Givens) => f(f(c * c) - f(s * s))
const sin = ([s, c]: Givens) => f(f(2 * s) * c)
const aroundX = (g: Givens): M3 => [1, 0, 0, 0, cos(g), sin(g), 0, -sin(g), cos(g)]
const aroundY = (g: Givens): M3 => [cos(g), 0, -sin(g), 0, 1, 0, sin(g), 0, cos(g)]
const aroundZ = (g: Givens): M3 => [cos(g), sin(g), 0, -sin(g), cos(g), 0, 0, 0, 1]

function approxGivens(a11: number, a12: number, a22: number): Givens {
	const d = f(2 * f(a11 - a22))
	return f(f(G * a12) * a12) < f(d * d) ? fromUnnormalized(a12, d) : PI_4
}

function qrGivens(a: number, b: number): Givens {
	const p = f(Math.hypot(a, b))
	let s = p > SMALL ? b : 0
	let c = f(Math.abs(a) + Math.max(p, SMALL))
	if (a < 0) [s, c] = [c, s]
	return fromUnnormalized(s, c)
}

// One sweep of the Jacobi rotations that diagonalize the symmetric matrix b, accumulated in q.
function stepJacobi(b: M3, q: Quat): [M3, Quat] {
	const similar = (m: M3, r: M3) => mul(transpose(r), mul(m, r))
	if (f(f(b[1]! * b[1]!) + f(b[3]! * b[3]!)) > SMALL) {
		const g = approxGivens(b[0]!, f(0.5 * f(b[1]! + b[3]!)), b[4]!)
		q = qmul(q, [0, 0, g[0], g[1]])
		b = similar(b, aroundZ(g))
	}
	if (f(f(b[2]! * b[2]!) + f(b[6]! * b[6]!)) > SMALL) {
		const [s, c] = approxGivens(b[0]!, f(0.5 * f(b[2]! + b[6]!)), b[8]!)
		const g: Givens = [-s, c]
		q = qmul(q, [0, g[0], 0, g[1]])
		b = similar(b, aroundY(g))
	}
	if (f(f(b[5]! * b[5]!) + f(b[7]! * b[7]!)) > SMALL) {
		const g = approxGivens(b[4]!, f(0.5 * f(b[5]! + b[7]!)), b[8]!)
		q = qmul(q, [g[0], 0, 0, g[1]])
		b = similar(b, aroundX(g))
	}
	return [b, q]
}

// values: the 12 numbers of `transformation` as written (rows of the 3×4 matrix).
export function split(values: ArrayLike<number>): Split {
	const v = Array.from({ length: 12 }, (_, i) => f(values[i]!))
	const a: M3 = [v[0]!, v[4]!, v[8]!, v[1]!, v[5]!, v[9]!, v[2]!, v[6]!, v[10]!]
	let b = mul(transpose(a), a)
	let q: Quat = [0, 0, 0, 1]
	for (let i = 0; i < 5; i++) [b, q] = stepJacobi(b, q)
	q = normalize(q)
	const flat0 = b[0]! < 1e-6
	const flat1 = b[4]! < 1e-6
	const av = mul(a, rotation(q))
	let left: Quat = [0, 0, 0, 1]
	let g = flat0 ? qrGivens(av[4]!, -av[3]!) : qrGivens(av[0]!, av[1]!)
	left = qmul(left, [0, 0, g[0], g[1]])
	const r1 = mul(transpose(aroundZ(g)), av)
	g = flat0 ? qrGivens(r1[8]!, -r1[6]!) : qrGivens(r1[0]!, r1[2]!)
	g = [-g[0], g[1]]
	left = qmul(left, [0, g[0], 0, g[1]])
	const r2 = mul(transpose(aroundY(g)), r1)
	g = flat1 ? qrGivens(r2[8]!, -r2[7]!) : qrGivens(r2[4]!, r2[5]!)
	left = qmul(left, [g[0], 0, 0, g[1]])
	const r3 = mul(transpose(aroundX(g)), r2)
	return { translation: [v[3]!, v[7]!, v[11]!], left, scale: [r3[0]!, r3[4]!, r3[8]!], right: [-q[0], -q[1], -q[2], q[3]] }
}

const DEGREE = Math.PI / 180
// Columns shorter than this (a block of the model drawn a thousandth of a block long) count as vanished.
const VANISH = 1e-3

// Whether the client's interpolation from a to b at progress t shows the written matrix `truth`: each axis (column)
// within `rotation` radians of its length, which bounds both its turn and its stretch, and the translation within
// `position` unless every axis has vanished and the bone cannot be seen.
function within(a: Split, b: Split, t: number, truth: ArrayLike<number>, position: number, rotation: number): boolean {
	const lerp = (x: Vec3, y: Vec3): Vec3 => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]
	const m = compose(lerp(a.translation, b.translation), slerp(a.left, b.left, t), lerp(a.scale, b.scale), slerp(a.right, b.right, t))
	let hidden = true
	for (let c = 0; c < 3; c++) {
		const length = Math.hypot(truth[c]!, truth[4 + c]!, truth[8 + c]!)
		const off = Math.hypot(m[c * 4]! - truth[c]!, m[c * 4 + 1]! - truth[4 + c]!, m[c * 4 + 2]! - truth[8 + c]!)
		if (off > rotation * Math.max(length, VANISH)) return false
		if (length >= VANISH) hidden = false
	}
	return hidden || Math.hypot(m[12]! - truth[3]!, m[13]! - truth[7]!, m[14]! - truth[11]!) <= position
}

// How far one matrix is from another, in the measures of `within`: the largest column change relative to the column's
// length, and the translation change.
function change(a: ArrayLike<number>, b: ArrayLike<number>): { rotation: number; position: number } {
	let rotation = 0
	for (let c = 0; c < 3; c++) {
		const length = Math.hypot(b[c]!, b[4 + c]!, b[8 + c]!)
		rotation = Math.max(rotation, Math.hypot(a[c]! - b[c]!, a[4 + c]! - b[4 + c]!, a[8 + c]! - b[8 + c]!) / Math.max(length, VANISH))
	}
	return { rotation, position: Math.hypot(a[3]! - b[3]!, a[7]! - b[7]!, a[11]! - b[11]!) }
}

// Writes of up to this many ticks that reach a client between two of its ticks (a frame over 100 ms, a server catching
// up) keep the pose right: the client applies only the last of them.
const MERGED = 3

// Frames where one bone's runs end, from 0 to the last frame. The run from k to j is one write at frame k + 1 with the
// pose of frame j, interpolated over j − k ticks, and covers at most `span` ticks. poses: each frame's written values.
// When the writes of the one-tick runs right before it are lost, the client starts the run from where they started. The
// run then has to hold from there too, give or take its own largest change in a tick for each lost write, so that a bone
// hidden or moved at once is not shown going there over the whole run. The first runs, whose start is the pose before
// play or the end of the loop, last one tick.
export function runEnds(poses: ArrayLike<number>[], tolerance: Tolerance, span: number): number[] {
	const radians = tolerance.rotation * DEGREE
	const splits = poses.map(split)
	const steps = poses.slice(1).map((pose, m) => change(poses[m]!, pose))
	const last = poses.length - 1
	const holds = (from: number, k: number, j: number, position: number, rotation: number) => {
		for (let m = k + 1; m < j; m++) if (!within(splits[from]!, splits[j]!, (m - k) / (j - k), poses[m]!, position, rotation)) return false
		return true
	}
	const ends = [0]
	let k = 0
	while (k < last) {
		const starts: number[] = []
		for (let i = ends.length - 1; i > 0 && starts.length < MERGED - 1 && ends[i]! - ends[i - 1]! === 1; i--) starts.push(ends[i - 1]!)
		let j = k + 1
		let fastest = steps[k]!
		while (k >= MERGED - 1 && j < last && j + 1 - k <= span) {
			fastest = { rotation: Math.max(fastest.rotation, steps[j]!.rotation), position: Math.max(fastest.position, steps[j]!.position) }
			if (!holds(k, k, j + 1, tolerance.position, radians)) break
			const lost = (from: number) => holds(from, k, j + 1, tolerance.position + (k - from) * fastest.position, radians + (k - from) * fastest.rotation)
			if (!starts.every(lost)) break
			j++
		}
		ends.push(j)
		k = j
	}
	return ends
}

// Run ends of each bone of an animation, for planFrames. A loop's last frame shows the pose of frame 0.
export function animationRunEnds(loop: Loop, poses: Poses, tolerance: Tolerance, span: number): (bone: number) => number[] {
	const last = poses.length - 1
	const values = poses.map((frame) => frame.map((pose) => pose.split(',').map((v) => Number.parseFloat(v))))
	return (bone) => runEnds(poses.map((_, f) => values[f === last && loop === 'loop' ? 0 : f]![bone]!), tolerance, span)
}
