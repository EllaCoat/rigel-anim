// Synthetic animation values and the SNBT layouts the benchmarks compare. A cell is one bone in one
// frame: 10 values (translation 3, left rotation 4, scale 3) quantized at 4 decimal places.
export const Q = 10_000
export const VALUES = 10

export interface Anim {
	frames: number
	bones: number
	// frames × bones × VALUES, value v of bone b in frame f at (f * bones + b) * VALUES + v.
	values: Int32Array
}

// Deterministic values that change every frame, so every write differs from the previous one.
export function syntheticAnim(frames: number, bones: number, seed = 1): Anim {
	let state = seed >>> 0
	const random = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0
		return state / 2 ** 32
	}
	const values = new Int32Array(frames * bones * VALUES)
	for (let i = 0; i < frames * bones; i++) {
		const o = i * VALUES
		for (let v = 0; v < 3; v++) values[o + v] = Math.round((random() * 4 - 2) * Q)
		const q = [random() - 0.5, random() - 0.5, random() - 0.5, random() - 0.5]
		const n = Math.hypot(...q)
		for (let v = 0; v < 4; v++) values[o + 3 + v] = Math.round((q[v]! / n) * Q)
		for (let v = 0; v < 3; v++) values[o + 7 + v] = Math.round((0.5 + random()) * Q)
	}
	return { frames, bones, values }
}

const cell = (a: Anim, f: number, b: number) => a.values.subarray((f * a.bones + b) * VALUES, (f * a.bones + b + 1) * VALUES)
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const float = (v: number) => `${Number((v / Q).toFixed(4))}f`
const floats = (vs: ArrayLike<number>) => `[${Array.from(vs, float).join(',')}]`

// The transformation compound. Merged into an entity it may leave out right_rotation (the entity keeps its
// own); written with `set` it must be complete, or the entity fails to read it and logs an error.
export function transformationCompound(c: ArrayLike<number>, withRight = false): string {
	const v = Array.from(c)
	return `{translation:${floats(v.slice(0, 3))},left_rotation:${floats(v.slice(3, 7))},scale:${floats(v.slice(7, 10))}${withRight ? ',right_rotation:[0f,0f,0f,1f]' : ''}}`
}

// What one entity write merges: the transformation and start_interpolation:0, so the client interpolates
// from the current pose. start_interpolation is not saved with the entity, so it is written every time.
export function writeCompound(c: ArrayLike<number>): string {
	return `{transformation:${transformationCompound(c)},start_interpolation:0}`
}

// One frame of frameWrites: [{transformation:…,start_interpolation:0}, … per bone]
export const frameWrite = (a: Anim, f: number) => `[${range(a.bones).map((b) => writeCompound(cell(a, f, b))).join(',')}]`

export const NAMED_KEYS = 'abcdefghij'.split('')

export const layouts = {
	// [[I; frame 0, all bones], [I; frame 1, ...], ...]
	frameInts: (a: Anim) => `[${range(a.frames).map((f) => `[I;${a.values.subarray(f * a.bones * VALUES, (f + 1) * a.bones * VALUES).join(',')}]`).join(',')}]`,
	// [[I; bone 0, all frames], ...]
	boneInts: (a: Anim) => `[${range(a.bones).map((b) => `[I;${range(a.frames).flatMap((f) => Array.from(cell(a, f, b))).join(',')}]`).join(',')}]`,
	// [{b0:{a:..,j:..},b1:..}, ...] per frame, read with `function … with storage … cur.b<n>`
	frameNamed: (a: Anim) => `[${range(a.frames).map((f) => `{${range(a.bones).map((b) => `b${b}:{${Array.from(cell(a, f, b), (v, i) => `${NAMED_KEYS[i]}:${v}`).join(',')}}`).join(',')}}`).join(',')}]`,
	// [[{transformation:…,start_interpolation:0}, … per bone], … per frame]: written to entities as is
	frameWrites: (a: Anim) => `[${range(a.frames).map((f) => frameWrite(a, f)).join(',')}]`,
	// [[{translation:…,left_rotation:…,scale:…}, … per bone], … per frame]: copied into a work compound
	// that already holds start_interpolation:0, then written
	frameTransforms: (a: Anim) => `[${range(a.frames).map((f) => `[${range(a.bones).map((b) => transformationCompound(cell(a, f, b))).join(',')}]`).join(',')}]`,
	// Same with right_rotation, complete enough to be written with `set`
	frameTransformsFull: (a: Anim) => `[${range(a.frames).map((f) => `[${range(a.bones).map((b) => transformationCompound(cell(a, f, b), true)).join(',')}]`).join(',')}]`,
	// The fork's layout: {"<bone>":{"<frame>":[10 floats]}}
	fork: (a: Anim) => `{${range(a.bones).map((b) => `"${b}":{${range(a.frames).map((f) => `"${f}":${floats(cell(a, f, b))}`).join(',')}}`).join(',')}}`,
}

export type Layout = keyof typeof layouts
