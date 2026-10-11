import { commonPack, NAMESPACE, RESERVED_RIG_NAMES, rigPack } from './datapack'
import { planFrames, poseString } from './frames'
import { itemModel } from './item-model'
import { itemModelPath, mergeItemModel } from './resource-pack'
import { animationRunEnds } from './thin'
import type { AnimationSource, Files, RigSettings, RigSource, Tolerance } from './types'

export class ExportError extends Error {
	constructor(readonly problems: string[]) {
		super(problems.join('\n'))
	}
}

const RIG_NAME = /^[a-z0-9_]+$/
const ITEM = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/

export function normalizeItem(item: string): string {
	const trimmed = item.trim()
	return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
}

export function settingsProblems(s: RigSettings): string[] {
	const problems: string[] = []
	if (!RIG_NAME.test(s.rig)) problems.push('リグ名には小文字・数字・_ だけを使ってください。')
	else if (RESERVED_RIG_NAMES.includes(s.rig)) problems.push(`リグ名 ${s.rig} は共通のデータパックが使うため、使えません（${RESERVED_RIG_NAMES.join('・')}）。`)
	if (!ITEM.test(s.item)) problems.push('元の item は、minecraft:white_dye のような ID で入力してください。')
	if (!Number.isInteger(s.chunkLines) || s.chunkLines < 1) problems.push('温めの 1 かたまりの行数は、1 以上の整数にしてください。')
	if (!Number.isInteger(s.id) || s.id < 1 || s.id > 0xffffffff) problems.push('固有 ID が正しくありません（1〜4294967295 の整数ではありません）。')
	if (s.thin && !validTolerance(s.thin)) problems.push('間引きの許容誤差は、位置・向きとも 0 以上の数にしてください。')
	if (!Number.isInteger(s.span) || s.span < 1) problems.push('間引きの区間の上限は、1 以上の整数にしてください。')
	return problems
}

const validTolerance = (t: Tolerance) => Number.isFinite(t.position) && Number.isFinite(t.rotation) && t.position >= 0 && t.rotation >= 0

function toleranceOf(animation: AnimationSource, settings: RigSettings): Tolerance | undefined {
	if (animation.thin === 'off') return undefined
	return animation.thin === 'project' ? settings.thin : animation.thin
}

// Lowercase letters, digits and _, unique among the names already taken.
export function uniqueName(name: string, taken: Set<string>): string {
	const base = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed'
	let out = base
	for (let n = 2; taken.has(out); n++) out = `${base}_${n}`
	taken.add(out)
	return out
}

export interface ExportResult {
	rigPack: Files
	commonPack: Files
	// Files of the shared resource pack that belong to this rig alone.
	resources: Files
	// The item's model with this rig's overrides merged in.
	itemModel: { path: string; json: string }
	// Bone writes in the frame functions, and how many there would be without thinning.
	writes: { thinned: number; full: number }
}

export function buildExport(source: RigSource, settings: RigSettings, existingItemModel: string | undefined): ExportResult {
	const problems = settingsProblems(settings)
	for (const a of source.animations) if (typeof a.thin === 'object' && !validTolerance(a.thin)) problems.push(`アニメ「${a.name}」の間引きの許容誤差は、位置・向きとも 0 以上の数にしてください。`)
	const renderable = source.bones.flatMap((bone, index) => (bone.cubes.length > 0 ? [{ bone, index }] : []))
	if (renderable.length === 0) problems.push('Cube を持つ Bone がありません。')
	if (problems.length > 0) throw new ExportError(problems)

	const textureNames = new Set<string>()
	const textures = source.textures.map((t) => uniqueName(t.name.replace(/\.png$/i, ''), textureNames))
	// The blocks atlas only takes textures under textures/block/ and textures/item/ of each namespace.
	const textureId = (i: number) => `${NAMESPACE}:item/${settings.rig}/${textures[i]}`
	const modelNames = new Set<string>()
	const models = renderable.map(({ bone }) => ({ name: uniqueName(bone.name, modelNames), ...itemModel(bone, source.textures, textureId, problems) }))
	if (problems.length > 0) throw new ExportError(problems)

	const resources: Files = new Map()
	for (const m of models) resources.set(`assets/${NAMESPACE}/models/${settings.rig}/${m.name}.json`, `${JSON.stringify(m.json)}\n`)
	source.textures.forEach((t, i) => resources.set(`assets/${NAMESPACE}/textures/item/${settings.rig}/${textures[i]}.png`, t.png))
	const merged = mergeItemModel(existingItemModel, settings.item, settings.rig, models.map((m) => `${NAMESPACE}:${settings.rig}/${m.name}`))

	const bones = source.bones.length
	const pose = (matrices: Float64Array, frame: number) => renderable.map(({ index }, r) => poseString(matrices, (frame * bones + index) * 16, models[r]!.scale))
	const writes = { thinned: 0, full: 0 }
	const animations = source.animations.map((a) => {
		const poses = Array.from({ length: a.ticks + 1 }, (_, f) => pose(a.matrices, f))
		const tolerance = toleranceOf(a, settings)
		const frames = planFrames(a.loop, poses, tolerance && animationRunEnds(a.loop, poses, tolerance, settings.span))
		const count = (plan: typeof frames) => plan.reduce((t, w) => t + w.length, 0)
		writes.thinned += count(frames)
		writes.full += tolerance ? count(planFrames(a.loop, poses)) : count(frames)
		return { name: a.name, loop: a.loop, priority: a.priority, poses, frames }
	})
	return {
		rigPack: rigPack({
			rig: settings.rig,
			id: settings.id,
			item: settings.item,
			chunkLines: settings.chunkLines,
			bones: renderable.map(({ index }, r) => ({ cmd: merged.cmds[r]!, rest: poseString(source.rest, index * 16, models[r]!.scale) })),
			animations,
		}),
		commonPack: commonPack(),
		resources,
		itemModel: { path: itemModelPath(settings.item), json: merged.json },
		writes,
	}
}
