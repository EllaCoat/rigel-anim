// 4x4 matrices are column-major (the layout of THREE.Matrix4.elements); 3x3 matrices are row-major.
// Quaternions are [x, y, z, w], the component order of JOML and of display-entity NBT.
export type Mat4 = ArrayLike<number>
export type Mat3 = number[]
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1]

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function length(a: Vec3): number {
	return Math.sqrt(dot(a, a))
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
	const out: Mat3 = new Array(9).fill(0)
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
	return out
}

// Same terms as JOML's Matrix4f.rotate(Quaternionfc): the quaternion is not normalized, so a
// non-unit quaternion also scales by its squared length, exactly as in Minecraft.
export function quatToMat3([x, y, z, w]: Quat): Mat3 {
	const x2 = x * x, y2 = y * y, z2 = z * z, w2 = w * w
	const xy = 2 * x * y, xz = 2 * x * z, yz = 2 * y * z, xw = 2 * x * w, yw = 2 * y * w, zw = 2 * z * w
	return [w2 + x2 - y2 - z2, xy - zw, xz + yw, xy + zw, w2 - x2 + y2 - z2, yz - xw, xz - yw, yz + xw, w2 - x2 - y2 + z2]
}

export function quatDot(a: Quat, b: Quat): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

export function normalizeQuat(q: Quat): Quat {
	const n = Math.sqrt(quatDot(q, q))
	return n === 0 ? [...IDENTITY_QUAT] : [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
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
