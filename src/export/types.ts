import type { Vec3 } from '../bake/matrix'

export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
export const DIRECTIONS: readonly Direction[] = ['north', 'south', 'east', 'west', 'up', 'down']

export type Loop = 'once' | 'loop' | 'hold'
export type WarmPriority = 'xhigh' | 'high' | 'low'
export const WARM_PRIORITIES: readonly WarmPriority[] = ['xhigh', 'high', 'low']

export interface FaceSource {
	// In the texture's UV size, as Blockbench shows it.
	uv: [number, number, number, number]
	// Index into RigSource.textures.
	texture: number
	rotation: number
	tint: number
}

export interface CubeSource {
	name: string
	from: Vec3
	to: Vec3
	inflate: number
	origin: Vec3
	rotation: Vec3
	shade: boolean
	faces: Partial<Record<Direction, FaceSource>>
}

export interface BoneSource {
	name: string
	pivot: Vec3
	cubes: CubeSource[]
}

export interface TextureSource {
	name: string
	png: Uint8Array
	uvWidth: number
	uvHeight: number
}

export interface Tolerance {
	// Blocks.
	position: number
	// Degrees; also the allowed relative scale error.
	rotation: number
}

// Thinning of one animation: as the project sets it, none, or its own tolerance.
export type AnimationThin = 'project' | 'off' | Tolerance

export interface AnimationSource {
	name: string
	loop: Loop
	ticks: number
	priority: WarmPriority
	thin: AnimationThin
	// (ticks + 1) frames × bones × 16, as readBoneMatrices writes them.
	matrices: Float64Array
}

// Everything the export reads from a Blockbench project, in plain data.
export interface RigSource {
	bones: BoneSource[]
	textures: TextureSource[]
	// bones × 16: the pose without animations.
	rest: Float64Array
	animations: AnimationSource[]
}

export interface RigSettings {
	rig: string
	// Unsigned 32-bit; the first part of every entity UUID of the rig.
	id: number
	item: string
	chunkLines: number
	// The project's thinning tolerance; none when undefined.
	thin?: Tolerance
	// Longest run one write may cover, in ticks.
	span: number
}

// Path inside a pack → content.
export type Files = Map<string, string | Uint8Array>
