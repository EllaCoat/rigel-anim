import { commonPack, NAMESPACE, RESERVED_RIG_NAMES, rigPack, type PassengerInput, type VariantInput } from './datapack'
import { displayNbt, displayProblems, normalizeId, RESOURCE_ID, snbtProblem, topLevelKeys } from './display'
import { displayPoseString, locatorString, planEntries, planFrames, poseString } from './frames'
import { itemModel } from './item-model'
import { itemModelPath, mergeItemModel } from './resource-pack'
import { animationRunEnds } from './thin'
import type { AnimationSource, Files, RigSettings, RigSource, Tolerance } from './types'
import { variantCalls, variantCuts } from './variant-keys'

export class ExportError extends Error {
	constructor(readonly problems: string[]) {
		super(problems.join('\n'))
	}
}

const RIG_NAME = /^[a-z0-9_]+$/
const ITEM = RESOURCE_ID
const VARIANT_NAME = /^[a-z0-9_]+$/
const FUNCTION_ID = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/
export const DEFAULT_VARIANT = 'default'

export const normalizeItem = normalizeId

export interface SettingsProblem {
	field: keyof RigSettings
	message: string
}

// draft: settings still being filled in, where an empty rig name or item is not a problem yet.
export function settingsFieldProblems(s: RigSettings, draft = false): SettingsProblem[] {
	const problems: SettingsProblem[] = []
	const add = (field: keyof RigSettings, message: string) => problems.push({ field, message })
	if (!(draft && s.rig === '')) {
		if (!RIG_NAME.test(s.rig)) add('rig', 'リグ名には小文字・数字・_ だけを使ってください。')
		else if (RESERVED_RIG_NAMES.includes(s.rig)) add('rig', `リグ名 ${s.rig} は共通のデータパックが使うため、使えません（${RESERVED_RIG_NAMES.join('・')}）。`)
	}
	if (!(draft && s.item === '') && !ITEM.test(s.item)) add('item', '元の item は、minecraft:white_dye のような ID で入力してください。')
	if (!Number.isInteger(s.chunkLines) || s.chunkLines < 1) add('chunkLines', '温めの 1 かたまりの行数は、1 以上の整数にしてください。')
	if (!Number.isInteger(s.id) || s.id < 1 || s.id > 0xffffffff) add('id', '固有 ID が正しくありません（1〜4294967295 の整数ではありません）。')
	if (s.thin && !validTolerance(s.thin)) add('thin', '間引きの許容誤差は、位置・向きとも 0 以上の数にしてください。')
	if (!Number.isInteger(s.span) || s.span < 1) add('span', '間引きの区間の上限は、1 以上の整数にしてください。')
	if (!Number.isInteger(s.teleportDuration) || s.teleportDuration < 0 || s.teleportDuration > 59) add('teleportDuration', 'tp の補間は、0〜59 の整数にしてください。')
	return problems
}

export function settingsProblems(s: RigSettings): string[] {
	return settingsFieldProblems(s).map((p) => p.message)
}

// others: the names of the other variants.
export function variantNameProblem(name: string, others: ReadonlySet<string>): string | undefined {
	if (!VARIANT_NAME.test(name)) return '名前には小文字・数字・_ だけを使ってください。'
	if (name === DEFAULT_VARIANT) return `${DEFAULT_VARIANT} は元のモデルに戻す関数の名前なので使えません。`
	if (others.has(name)) return '同じ名前の variant が 2 つあります。'
	return undefined
}

export function variantProblems(source: RigSource): string[] {
	const problems: string[] = []
	const names = new Set<string>()
	for (const v of source.variants) {
		const at = `variant「${v.name}」`
		const nameProblem = variantNameProblem(v.name, names)
		if (nameProblem) problems.push(`${at}: ${nameProblem}`)
		names.add(v.name)
		for (const [from, to] of v.textures) {
			const a = source.textures[from]
			const b = source.textures[to]
			if (!a || !b) problems.push(`${at}: 差し替えのテクスチャが見つかりません。`)
			// UVs are written relative to the original texture's size.
			else if (a.uvWidth !== b.uvWidth || a.uvHeight !== b.uvHeight) problems.push(`${at}: ${a.name} と ${b.name} は UV の大きさが違うため差し替えられません。`)
		}
		if (v.onApply && !FUNCTION_ID.test(v.onApply)) problems.push(`${at}: 適用時の関数は namespace:path の形で入力してください。`)
	}
	for (const a of source.animations)
		for (const key of a.variantKeys)
			if (key.variant === null || (key.variant !== DEFAULT_VARIANT && !names.has(key.variant))) problems.push(`アニメ「${a.name}」の ${key.time.toFixed(2)} 秒の variant keyframe が、存在しない variant を指しています。`)
	return problems
}

const validTolerance = (t: Tolerance) => Number.isFinite(t.position) && Number.isFinite(t.rotation) && t.position >= 0 && t.rotation >= 0

export function toleranceOf(animation: AnimationSource, settings: RigSettings): Tolerance | undefined {
	if (animation.thin === 'off') return undefined
	return animation.thin === 'project' ? settings.thin : animation.thin
}

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
	resources: Files
	itemModel: { path: string; json: string }
	writes: { thinned: number; full: number }
}

export function buildExport(source: RigSource, settings: RigSettings, existingItemModel: string | undefined): ExportResult {
	const problems = settingsProblems(settings)
	for (const a of source.animations) if (typeof a.thin === 'object' && !validTolerance(a.thin)) problems.push(`アニメ「${a.name}」の間引きの許容誤差は、位置・向きとも 0 以上の数にしてください。`)
	// Bones with cubes become item models; displays draw what their settings name. Both ride the root, in outliner order.
	const renderable = source.bones.flatMap((bone, index) => (bone.display || bone.cubes.length > 0 ? [{ bone, index }] : []))
	if (renderable.length === 0) problems.push('Cube を持つ Bone も display もありません。')
	const entityNames = new Set<string>()
	const displayNames = renderable.map(({ bone }) => (bone.display ? uniqueName(bone.name, entityNames) : undefined))
	renderable.forEach(({ bone }) => {
		if (!bone.display) return
		if (bone.cubes.length > 0) problems.push(`display「${bone.name}」に Cube が入っています。display の Group には Cube を入れないでください。`)
		problems.push(...displayProblems(bone.name, bone.display))
	})
	const locatorNames = source.locators.map((l) => uniqueName(l.name, entityNames))
	source.locators.forEach((l) => {
		if (!l.entity) return
		if (!RESOURCE_ID.test(normalizeId(l.entity.type))) problems.push(`locator「${l.name}」: entity の種類は minecraft:marker のような ID で入力してください。`)
		const p = l.entity.nbt.trim() && snbtProblem(l.entity.nbt)
		if (p) problems.push(`locator「${l.name}」: summon の NBT は ${p}`)
		else if (l.entity.nbt.trim() && topLevelKeys(l.entity.nbt).includes('UUID')) problems.push(`locator「${l.name}」: summon の NBT に UUID は書けません（Rigel が書くため）。`)
	})
	problems.push(...variantProblems(source))
	if (problems.length > 0) throw new ExportError(problems)

	const textureNames = new Set<string>()
	const textures = source.textures.map((t) => uniqueName(t.name.replace(/\.png$/i, ''), textureNames))
	// The blocks atlas only takes textures under textures/block/ and textures/item/ of each namespace.
	const textureId = (i: number) => `${NAMESPACE}:item/${settings.rig}/${textures[i]}`
	const modelNames = new Set<string>()
	const models = renderable.map(({ bone }) => (bone.display ? undefined : { name: uniqueName(bone.name, modelNames), ...itemModel(bone, source.textures, textureId, problems) }))
	if (problems.length > 0) throw new ExportError(problems)

	const resources: Files = new Map()
	const modelId = (path: string) => `${NAMESPACE}:${settings.rig}/${path}`
	const modelFile = (path: string, json: object) => resources.set(`assets/${NAMESPACE}/models/${settings.rig}/${path}.json`, `${JSON.stringify(json)}\n`)
	for (const m of models) if (m) modelFile(m.name, m.json)
	source.textures.forEach((t, i) => resources.set(`assets/${NAMESPACE}/textures/item/${settings.rig}/${textures[i]}.png`, t.png))

	// A variant model only overrides the textures it replaces; the parent keeps the elements.
	const variantModels = source.variants.map((v) => {
		const replace = new Map(v.textures)
		return models.map((m) => {
			if (!m) return undefined
			const own = (m.json as { textures: Record<string, string> }).textures
			const overrides: Record<string, string> = {}
			for (const key of Object.keys(own)) {
				const from = key === 'particle' ? source.textures.findIndex((_, i) => textureId(i) === own.particle) : Number(key)
				const to = replace.get(from)
				if (to !== undefined) overrides[key] = textureId(to)
			}
			if (Object.keys(overrides).length === 0) return undefined
			const path = `${v.name}/${m.name}`
			modelFile(path, { parent: modelId(m.name), textures: overrides })
			return path
		})
	})
	const modelPaths = [...models.flatMap((m) => (m ? [m.name] : [])), ...variantModels.flat().filter((p): p is string => p !== undefined)]
	const merged = mergeItemModel(existingItemModel, settings.item, settings.rig, modelPaths.map(modelId))
	const cmdOf = new Map(modelPaths.map((p, i) => [p, merged.cmds[i]!]))

	const passengers: PassengerInput[] = renderable.map(({ bone, index }, r) => {
		const m = models[r]
		const rest = m ? poseString(source.rest, index * 16, m.scale) : displayPoseString(source.rest, index * 16, bone.display!.scale)
		if (!m) return { nbt: displayNbt(bone.display!), name: displayNames[r], rest }
		return { nbt: `id:"minecraft:item_display",item:{id:"${settings.item}",Count:1b,tag:{CustomModelData:${cmdOf.get(m.name)}}}`, rest }
	})
	// Bones some variant changes; a variant writes all of them it does not exclude, so applying it undoes the others there.
	const changed = renderable.flatMap((_, r) => (variantModels.some((vm) => vm[r] !== undefined) ? [r] : []))
	const usesVariants = source.variants.length > 0 || source.animations.some((a) => a.variantKeys.length > 0)
	const variants: VariantInput[] = !usesVariants ? [] : [
		...source.variants.map((v, k) => ({
			name: v.name,
			writes: changed.filter((r) => !v.excluded.includes(renderable[r]!.index)).map((r) => ({ passenger: r, cmd: cmdOf.get(variantModels[k]![r] ?? models[r]!.name)! })),
			onApply: v.onApply,
		})),
		{ name: DEFAULT_VARIANT, writes: changed.map((r) => ({ passenger: r, cmd: cmdOf.get(models[r]!.name)! })), onApply: '' },
	]

	const rewritten = (name: string) => new Set(variants.find((v) => v.name === name)?.writes.map((w) => w.passenger))
	const bones = source.bones.length
	const pose = (matrices: Float64Array, frame: number) =>
		renderable.map(({ bone, index }, r) => {
			const at = (frame * bones + index) * 16
			const m = models[r]
			return m ? poseString(matrices, at, m.scale) : displayPoseString(matrices, at, bone.display!.scale)
		})
	const locatorCount = source.locators.length
	const writes = { thinned: 0, full: 0 }
	const animations = source.animations.map((a) => {
		const poses = Array.from({ length: a.ticks + 1 }, (_, f) => pose(a.matrices, f))
		const tolerance = toleranceOf(a, settings)
		const calls = variantCalls(a.loop, a.ticks, a.variantKeys.flatMap((k) => (k.variant === null ? [] : [{ time: k.time, variant: k.variant }])))
		const runEnds = tolerance && animationRunEnds(a.loop, poses, tolerance, settings.span, variantCuts(calls, rewritten))
		const ends = runEnds && renderable.map((_, r) => runEnds(r))
		const runs = ends && ((bone: number) => ends[bone]!)
		const frames = planFrames(a.loop, poses, runs)
		const count = (plan: typeof frames) => plan.reduce((t, w) => t + w.length, 0)
		writes.thinned += count(frames)
		writes.full += tolerance ? count(planFrames(a.loop, poses)) : count(frames)
		const shown = (f: number) => (f === a.ticks && a.loop === 'loop' ? 0 : f)
		const locators = poses.map((_, f) => source.locators.map((_, l) => locatorString(a.locators, (shown(f) * locatorCount + l) * 3)))
		return { name: a.name, loop: a.loop, priority: a.priority, poses, frames, locators, variants: calls, entries: runs && planEntries(a.loop, poses, runs) }
	})
	return {
		rigPack: rigPack({
			rig: settings.rig,
			id: settings.id,
			chunkLines: settings.chunkLines,
			teleportDuration: settings.teleportDuration,
			passengers,
			locators: source.locators.map((l, i) => ({
				name: locatorNames[i]!,
				entity: l.entity && { type: normalizeId(l.entity.type), nbt: l.entity.nbt },
				rest: locatorString(source.locatorRest, i * 3),
			})),
			variants,
			animations,
		}),
		commonPack: commonPack(),
		resources,
		itemModel: { path: itemModelPath(settings.item), json: merged.json },
		writes,
	}
}
