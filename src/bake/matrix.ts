// 4x4 matrices are column-major (the layout of THREE.Matrix4.elements); 3x3 matrices are row-major.
// Quaternions are [x, y, z, w], the component order of JOML and of display-entity NBT.
export type Mat4 = ArrayLike<number>
export type Mat3 = number[]
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1]

export function linearPart(m: Mat4): Mat3 {
	return [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!]
}

export function translationPart(m: Mat4): Vec3 {
	return [m[12]!, m[13]!, m[14]!]
}

export function column(a: Mat3, c: number): Vec3 {
	return [a[c]!, a[3 + c]!, a[6 + c]!]
}

export function fromColumns(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
	return [c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]]
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function length(a: Vec3): number {
	return Math.sqrt(dot(a, a))
}

export function scaleVec(a: Vec3, s: number): Vec3 {
	return [a[0] * s, a[1] * s, a[2] * s]
}

export function det3(a: Mat3): number {
	return dot(column(a, 0), cross(column(a, 1), column(a, 2)))
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
	const out: Mat3 = new Array(9).fill(0)
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
	return out
}

export function transpose3(a: Mat3): Mat3 {
	return [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!]
}

// Same terms as JOML's Matrix4f.rotate(Quaternionfc): the quaternion is not normalized, so a
// non-unit quaternion (e.g. after quantization) also scales by its squared length, exactly as in Minecraft.
export function quatToMat3([x, y, z, w]: Quat): Mat3 {
	const x2 = x * x, y2 = y * y, z2 = z * z, w2 = w * w
	const xy = 2 * x * y, xz = 2 * x * z, yz = 2 * y * z, xw = 2 * x * w, yw = 2 * y * w, zw = 2 * z * w
	return [w2 + x2 - y2 - z2, xy - zw, xz + yw, xy + zw, w2 - x2 + y2 - z2, yz - xw, xz - yw, yz + xw, w2 - x2 - y2 + z2]
}

export function quatFromMat3(r: Mat3): Quat {
	const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = r as [number, number, number, number, number, number, number, number, number]
	let q: Quat
	const trace = m00 + m11 + m22
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2
		q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2
		q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2
		q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2
		q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
	}
	return normalizeQuat(q)
}

export function quatDot(a: Quat, b: Quat): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

export function normalizeQuat(q: Quat): Quat {
	const n = Math.sqrt(quatDot(q, q))
	return n === 0 ? [...IDENTITY_QUAT] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

export function negateQuat(q: Quat): Quat {
	return [-q[0], -q[1], -q[2], -q[3]]
}

// Angle of the rotation between two unit quaternions, in radians.
export function quatAngle(a: Quat, b: Quat): number {
	return 2 * Math.acos(Math.min(1, Math.abs(quatDot(a, b))))
}

// Shortest-path slerp, as JOML's Quaternionf.slerp used by the display-entity interpolation.
export function slerp(a: Quat, b: Quat, t: number): Quat {
	const cos = quatDot(a, b)
	const absCos = Math.abs(cos)
	let s0 = 1 - t
	let s1 = t
	if (1 - absCos > 1e-6) {
		const omega = Math.acos(absCos)
		const sin = Math.sin(omega)
		s0 = Math.sin((1 - t) * omega) / sin
		s1 = Math.sin(t * omega) / sin
	}
	if (cos < 0) s1 = -s1
	return [s0 * a[0] + s1 * b[0], s0 * a[1] + s1 * b[1], s0 * a[2] + s1 * b[2], s0 * a[3] + s1 * b[3]]
}

// Translation · left rotation · scale · right rotation, the order of Minecraft's Transformation.
export function compose(translation: Vec3, left: Quat, scale: Vec3, right: Quat): number[] {
	const l = quatToMat3(left)
	const r = quatToMat3(right)
	const ls = [l[0]! * scale[0], l[1]! * scale[1], l[2]! * scale[2], l[3]! * scale[0], l[4]! * scale[1], l[5]! * scale[2], l[6]! * scale[0], l[7]! * scale[1], l[8]! * scale[2]]
	const a = mul3(ls, r)
	return [a[0]!, a[3]!, a[6]!, 0, a[1]!, a[4]!, a[7]!, 0, a[2]!, a[5]!, a[8]!, 0, translation[0], translation[1], translation[2], 1]
}

// Eigenvalues and eigenvectors (columns) of a symmetric matrix, by Jacobi rotations.
export function symmetricEigen(symmetric: Mat3): { values: Vec3; vectors: Mat3 } {
	const b = [...symmetric]
	let v: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
	for (let sweep = 0; sweep < 64; sweep++) {
		const off = b[1]! * b[1]! + b[2]! * b[2]! + b[5]! * b[5]!
		const diagonal = b[0]! * b[0]! + b[4]! * b[4]! + b[8]! * b[8]!
		if (off <= 1e-30 * diagonal || off < 1e-300) break
		for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
			const bpq = b[p * 3 + q]!
			if (Math.abs(bpq) < 1e-300) continue
			const theta = (b[q * 3 + q]! - b[p * 3 + p]!) / (2 * bpq)
			const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
			const c = 1 / Math.sqrt(t * t + 1)
			const s = t * c
			const rot: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
			rot[p * 3 + p] = c
			rot[q * 3 + q] = c
			rot[p * 3 + q] = s
			rot[q * 3 + p] = -s
			const nb = mul3(mul3(transpose3(rot), b), rot)
			for (let i = 0; i < 9; i++) b[i] = nb[i]!
			v = mul3(v, rot)
		}
	}
	return { values: [b[0]!, b[4]!, b[8]!], vectors: v }
}

export function mulVec(a: Mat3, x: Vec3): Vec3 {
	return [a[0]! * x[0] + a[1]! * x[1] + a[2]! * x[2], a[3]! * x[0] + a[4]! * x[1] + a[5]! * x[2], a[6]! * x[0] + a[7]! * x[1] + a[8]! * x[2]]
}

export function perpendicular(a: Vec3): Vec3 {
	const axis: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
	const p = cross(a, axis)
	return scaleVec(p, 1 / length(p))
}
