// Reads the open project into the plain data the export is generated from.
import type { Vec3 } from '../bake/matrix'
import { collectBones, readBoneMatrices, sampleAnimation, tickCount } from '../bake/sample'
import { getPriority } from './settings'
import { DIRECTIONS, type CubeSource, type FaceSource, type RigSource, type TextureSource } from './types'

function pngBytes(texture: Texture): Uint8Array {
	const url = texture.getDataURL()
	const binary = atob(url.slice(url.indexOf(',') + 1))
	return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function cubeSource(cube: Cube, textures: Texture[]): CubeSource {
	const faces: CubeSource['faces'] = {}
	for (const direction of DIRECTIONS) {
		const face = cube.faces[direction]
		// No texture (null) or a hidden face (false) draws nothing in Minecraft either.
		if (!face || typeof face.texture !== 'string' || (face as { enabled?: boolean }).enabled === false) continue
		const texture = textures.findIndex((t) => t.uuid === face.texture)
		if (texture < 0) continue
		const out: FaceSource = { uv: [...face.uv] as FaceSource['uv'], texture, rotation: face.rotation ?? 0, tint: face.tint ?? -1 }
		faces[direction] = out
	}
	return {
		name: cube.name,
		from: [...cube.from] as Vec3,
		to: [...cube.to] as Vec3,
		inflate: cube.inflate ?? 0,
		origin: [...cube.origin] as Vec3,
		rotation: [...cube.rotation] as Vec3,
		shade: cube.shade !== false,
		faces,
	}
}

function restMatrices(groups: Group[]): Float64Array {
	const rest = new Float64Array(groups.length * 16)
	try {
		// With `true` the bone matrices keep the pose the preview showed last.
		Animator.showDefaultPose()
		readBoneMatrices(groups, rest, 0)
	} finally {
		Animator.preview()
	}
	return rest
}

// Blockbench's own exports leave out elements whose Export toggle (theirs or a parent group's) is off.
// Hiding an element only affects the viewport, so hidden cubes are exported.
function exported(node: OutlinerNode): boolean {
	if ((node as { export?: boolean }).export === false) return false
	return node.parent instanceof Group ? exported(node.parent) : true
}

export function collectRig(): RigSource {
	const groups = collectBones()
	const textures = Texture.all
	const textureSources: TextureSource[] = textures.map((t) => ({ name: t.name, png: pngBytes(t), uvWidth: t.getUVWidth(), uvHeight: t.getUVHeight() }))
	const previous = Modes.selected as Mode | false
	Modes.options.animate!.select()
	try {
		return {
			bones: groups.map((g) => ({
				name: g.name,
				pivot: [...g.origin] as Vec3,
				cubes: g.children.filter((c): c is Cube => c instanceof Cube && exported(c)).map((c) => cubeSource(c, textures)),
			})),
			textures: textureSources,
			rest: restMatrices(groups),
			animations: Project!.animations.map((a) => ({
				name: a.name,
				loop: a.loop,
				ticks: tickCount(a),
				priority: getPriority(a),
				matrices: sampleAnimation(a, groups),
			})),
		}
	} finally {
		if (previous && previous !== Modes.selected) previous.select()
	}
}
