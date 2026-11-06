import type { Vec3 } from '../bake/matrix'
import type { Target } from './target'
import { DIRECTIONS, type BoneSource, type TextureSource } from './types'

// The bone's pivot goes to the centre of the item model; elements must stay within -16..32 there.
const CENTRE = 8
const REACH = 24

const round = (v: number) => Math.round(v * 1e6) / 1e6

// k ≥ 1: the bone is written k times smaller and the entity's matrix scales it back.
export function boneScale(bone: BoneSource): number {
	let reach = 0
	for (const cube of bone.cubes) {
		for (let i = 0; i < 3; i++) {
			const lo = Math.min(cube.from[i]!, cube.to[i]!) - cube.inflate - bone.pivot[i]!
			const hi = Math.max(cube.from[i]!, cube.to[i]!) + cube.inflate - bone.pivot[i]!
			reach = Math.max(reach, Math.abs(lo), Math.abs(hi))
		}
	}
	return Math.max(1, reach / REACH)
}

export function itemModel(bone: BoneSource, textures: TextureSource[], textureId: (index: number) => string, target: Target, errors: string[]): { json: object; scale: number } {
	const k = boneScale(bone)
	const place = (v: Vec3) => v.map((x, i) => round(CENTRE + (x - bone.pivot[i]!) / k))
	const used = new Set<number>()
	const elements: object[] = []
	for (const cube of bone.cubes) {
		const at = `${bone.name}/${cube.name}`
		const lo = [0, 1, 2].map((i) => Math.min(cube.from[i]!, cube.to[i]!) - cube.inflate) as Vec3
		const hi = [0, 1, 2].map((i) => Math.max(cube.from[i]!, cube.to[i]!) + cube.inflate) as Vec3
		const element: Record<string, unknown> = { from: place(lo), to: place(hi) }

		if (cube.rotation.some((v) => v !== 0)) {
			const rotation = target.elementRotation(cube.rotation, place(cube.origin) as Vec3)
			if (typeof rotation === 'string') errors.push(`${at}: ${rotation}`)
			else element.rotation = rotation
		}
		if (!cube.shade) element.shade = false

		const faces: Record<string, object> = {}
		for (const direction of DIRECTIONS) {
			const face = cube.faces[direction]
			if (!face) continue
			const texture = textures[face.texture]
			if (!texture) {
				errors.push(`${at}: ${direction} の面のテクスチャが見つかりません。`)
				continue
			}
			const su = 16 / texture.uvWidth
			const sv = 16 / texture.uvHeight
			const [u1, v1, u2, v2] = face.uv
			const out: Record<string, unknown> = { uv: [u1 * su, v1 * sv, u2 * su, v2 * sv].map(round), texture: `#${face.texture}` }
			if (face.rotation) out.rotation = face.rotation
			if (face.tint >= 0) out.tintindex = face.tint
			faces[direction] = out
			used.add(face.texture)
		}
		if (Object.keys(faces).length === 0) continue
		element.faces = faces
		elements.push(element)
	}
	const ids = [...used].sort((a, b) => a - b)
	const textureMap: Record<string, string> = Object.fromEntries(ids.map((i) => [String(i), textureId(i)]))
	if (ids.length > 0) textureMap.particle = textureId(ids[0]!)
	return { json: { textures: textureMap, elements }, scale: k }
}
