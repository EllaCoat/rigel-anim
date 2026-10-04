import { decomposeTrack, type ValueCount } from './decompose'
import { quantizeInto, STRIDE } from './quantize'
import { sampleAnimation, tickCount } from './sample'

// Version-independent data the output for each Minecraft version is generated from.
export interface BakedBone {
	uuid: string
	name: string
	parent: number
	// Has cubes of its own, so it becomes a display entity. Other bones only carry their children.
	renderable: boolean
}

export interface BakedAnimation {
	name: string
	loop: 'once' | 'loop' | 'hold'
	ticks: number
	counts: ValueCount[]
	// (ticks + 1) frames × bones × STRIDE quantized values; frame i is the pose at tick i.
	values: Int32Array
}

export function describeBones(groups: Group[]): BakedBone[] {
	const index = new Map(groups.map((g, i) => [g, i]))
	return groups.map((g) => ({
		uuid: g.uuid,
		name: g.name,
		parent: g.parent instanceof Group ? index.get(g.parent)! : -1,
		renderable: g.children.some((c) => c instanceof Cube),
	}))
}

export function bakeAnimation(animation: BBAnimation, groups: Group[], matrices = sampleAnimation(animation, groups)): BakedAnimation {
	const ticks = tickCount(animation)
	const { counts, values } = bakeTracks(matrices, ticks + 1, groups.length)
	return { name: animation.name, loop: animation.loop, ticks, counts, values }
}

export function bakeTracks(matrices: Float64Array, frames: number, bones: number): { counts: ValueCount[]; values: Int32Array } {
	const values = new Int32Array(frames * bones * STRIDE)
	const counts: ValueCount[] = []
	for (let b = 0; b < bones; b++) {
		const track = Array.from({ length: frames }, (_, f) => matrices.subarray((f * bones + b) * 16, (f * bones + b + 1) * 16))
		const { count, frames: decomposed } = decomposeTrack(track)
		counts.push(count)
		decomposed.forEach((d, f) => quantizeInto(d, values, (f * bones + b) * STRIDE))
	}
	return { counts, values }
}
