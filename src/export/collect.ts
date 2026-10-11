import type { Vec3 } from '../bake/matrix'
import { collectBones, readBoneMatrices, readLocatorPositions, sampleAnimation, tickCount } from '../bake/sample'
import { readDisplay } from '../display/settings'
import { readLocatorEntity } from '../locator/settings'
import { keyframeVariant, variantKeyframes } from '../variant/keyframes'
import { DEFAULT_VARIANT_ID, readVariants } from '../variant/settings'
import { getPriority, getThin } from './settings'
import { DIRECTIONS, type CubeSource, type FaceSource, type LocatorSource, type RigSource, type TextureSource, type VariantKey, type VariantSource } from './types'

function pngBytes(texture: Texture): Uint8Array {
	const url = texture.getDataURL()
	const binary = atob(url.slice(url.indexOf(',') + 1))
	return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function cubeSource(cube: Cube, textures: Texture[]): CubeSource {
	const faces: CubeSource['faces'] = {}
	for (const direction of DIRECTIONS) {
		const face = cube.faces[direction]
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

function restPose(groups: Group[], locators: Locator[]): { rest: Float64Array; locatorRest: Float64Array } {
	const rest = new Float64Array(groups.length * 16)
	const locatorRest = new Float64Array(locators.length * 3)
	try {
		// Not `true`: that would leave the bone matrices at the pose the preview showed last.
		Animator.showDefaultPose()
		readBoneMatrices(groups, rest, 0)
		readLocatorPositions(locators, locatorRest, 0)
	} finally {
		Animator.preview()
	}
	return { rest, locatorRest }
}

function variantSources(groups: Group[], textures: Texture[]): VariantSource[] {
	const texture = (uuid: string) => textures.findIndex((t) => t.uuid === uuid)
	return readVariants(Project!).map((v) => ({
		name: v.name,
		textures: v.textures.map(([from, to]): [number, number] => [texture(from), texture(to)]).filter(([from, to]) => from >= 0 && to >= 0),
		excluded: v.excluded.map((uuid) => groups.findIndex((g) => g.uuid === uuid)).filter((i) => i >= 0),
		onApply: v.onApply.trim(),
	}))
}

export function variantKeys(animation: BBAnimation): VariantKey[] {
	const variants = readVariants(Project!)
	return variantKeyframes(animation).map((kf) => {
		const id = keyframeVariant(kf)
		return { time: kf.time, variant: id === DEFAULT_VARIANT_ID ? id : (variants.find((v) => v.uuid === id)?.name ?? null) }
	})
}

function locatorSource(locator: Locator): LocatorSource {
	const entity = readLocatorEntity(locator)
	return { name: locator.name, entity: entity.type ? entity : undefined }
}

// Blockbench's own exports leave out elements whose Export toggle (theirs or a parent group's) is off.
// Hiding an element only affects the viewport, so hidden cubes are exported.
function exported(node: OutlinerNode): boolean {
	if ((node as { export?: boolean }).export === false) return false
	return node.parent instanceof Group ? exported(node.parent) : true
}

export function collectRig(): RigSource {
	const groups = collectBones()
	const locators = Locator.all.filter(exported)
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
				display: exported(g) ? readDisplay(g) : undefined,
			})),
			textures: textureSources,
			...restPose(groups, locators),
			locators: locators.map(locatorSource),
			variants: variantSources(groups, textures),
			animations: Project!.animations.map((a) => {
				const sampled = sampleAnimation(a, groups, locators)
				return { name: a.name, loop: a.loop, ticks: tickCount(a), priority: getPriority(a), thin: getThin(a), variantKeys: variantKeys(a), matrices: sampled.matrices, locators: sampled.locators }
			}),
		}
	} finally {
		if (previous && previous !== Modes.selected) previous.select()
	}
}
