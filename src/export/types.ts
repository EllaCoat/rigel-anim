import type { Vec3 } from '../bake/matrix'

export type Direction = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
export const DIRECTIONS: readonly Direction[] = ['north', 'south', 'east', 'west', 'up', 'down']

export type Loop = 'once' | 'loop' | 'hold'
export type WarmPriority = 'xhigh' | 'high' | 'low'
export const WARM_PRIORITIES: readonly WarmPriority[] = ['xhigh', 'high', 'low']

export interface FaceSource {
	// In the texture's UV size, as Blockbench shows it.
	uv: [number, number, number, number]
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

export const ITEM_DISPLAY_MODES = ['none', 'thirdperson_lefthand', 'thirdperson_righthand', 'firstperson_lefthand', 'firstperson_righthand', 'head', 'gui', 'ground', 'fixed'] as const
export type ItemDisplayMode = (typeof ITEM_DISPLAY_MODES)[number]
export const TEXT_ALIGNMENTS = ['center', 'left', 'right'] as const
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number]

interface DisplayCommon {
	// Applied on top of the bone's own transform; groups have no scale of their own.
	scale: Vec3
	// SNBT compound merged into the summon, for keys the settings do not cover.
	nbt: string
}

export type DisplaySettings =
	| (DisplayCommon & { kind: 'block'; block: string })
	| (DisplayCommon & { kind: 'item'; item: string; tag: string; mode: ItemDisplayMode })
	| (DisplayCommon & {
			kind: 'text'
			// A JSON text component, or plain text when it does not parse as JSON.
			text: string
			lineWidth: number
			// ARGB.
			background: number
			defaultBackground: boolean
			// 0–255.
			textOpacity: number
			shadow: boolean
			seeThrough: boolean
			alignment: TextAlignment
	  })

export interface BoneSource {
	name: string
	pivot: Vec3
	cubes: CubeSource[]
	display?: DisplaySettings
}

export interface VariantSource {
	name: string
	// [texture, replacement] pairs, as indices into RigSource.textures.
	textures: [number, number][]
	// Bones (indices into RigSource.bones) the variant leaves as they are.
	excluded: number[]
	// A function ID, or '' for none.
	onApply: string
}

export interface LocatorSource {
	name: string
	// An entity kept at the locator, or none.
	entity?: { type: string; nbt: string }
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

export type AnimationThin = 'project' | 'off' | Tolerance

// A variant keyframe of an animation.
export interface VariantKey {
	// Seconds into the animation.
	time: number
	// A variant's name, 'default' for the original model, or null when the keyframe names a variant that no longer exists.
	variant: string | null
}

export interface AnimationSource {
	name: string
	loop: Loop
	ticks: number
	priority: WarmPriority
	thin: AnimationThin
	variantKeys: VariantKey[]
	// (ticks + 1) frames × bones × 16, as readBoneMatrices writes them.
	matrices: Float64Array
	// (ticks + 1) frames × locators × 3: positions in blocks, in the rig's frame.
	locators: Float64Array
}

export interface RigSource {
	bones: BoneSource[]
	textures: TextureSource[]
	// bones × 16: the pose without animations.
	rest: Float64Array
	locators: LocatorSource[]
	// locators × 3.
	locatorRest: Float64Array
	variants: VariantSource[]
	animations: AnimationSource[]
}

export interface RigSettings {
	rig: string
	// Unsigned 32-bit; the first part of every entity UUID of the rig.
	id: number
	item: string
	chunkLines: number
	thin?: Tolerance
	// Longest run one write may cover, in ticks.
	span: number
	teleportDuration: number
}

export type Files = Map<string, string | Uint8Array>
