import { NAMESPACE } from './datapack'

export function itemModelPath(item: string): string {
	const [namespace, path] = item.split(':') as [string, string]
	return `assets/${namespace}/models/item/${path}.json`
}

type Override = { predicate?: Record<string, unknown>; model?: unknown }

export function mergeItemModel(existing: string | undefined, item: string, rig: string, models: string[]): { json: string; cmds: number[] } {
	const [namespace, path] = item.split(':') as [string, string]
	const model: Record<string, unknown> = existing === undefined ? { parent: 'minecraft:item/generated', textures: { layer0: `${namespace}:item/${path}` } } : JSON.parse(existing)
	const own = `${NAMESPACE}:${rig}/`
	const kept = ((model.overrides as Override[] | undefined) ?? []).filter((o) => !(typeof o.model === 'string' && o.model.startsWith(own)))
	const used = new Set(kept.map((o) => o.predicate?.custom_model_data).filter((v): v is number => typeof v === 'number'))
	const cmds: number[] = []
	for (let n = 1; cmds.length < models.length; n++) if (!used.has(n)) cmds.push(n)
	// Minecraft uses the last override whose custom_model_data is at most the item's, so each new override goes
	// before the first larger number. The others keep their order, which decides between their other predicates.
	const cmdOf = (o: Override) => (typeof o.predicate?.custom_model_data === 'number' ? o.predicate.custom_model_data : 0)
	const overrides = [...kept]
	models.forEach((m, i) => {
		const at = overrides.findIndex((o) => cmdOf(o) > cmds[i]!)
		overrides.splice(at < 0 ? overrides.length : at, 0, { predicate: { custom_model_data: cmds[i] }, model: m })
	})
	model.overrides = overrides
	return { json: `${JSON.stringify(model, null, '\t')}\n`, cmds }
}

// 26.3's item definition that draws one model, at the same ID under items/; the item_model component names it.
export const itemDefinition = (model: string) => `${JSON.stringify({ model: { type: 'minecraft:model', model } })}\n`

export function itemDefinitionPath(id: string): string {
	const [namespace, path] = id.split(':') as [string, string]
	return `assets/${namespace}/items/${path}.json`
}

// The launcher shares resourcepacks/ among versions, so one pack.mcmeta declares both 1.20.4's and 26.3's formats,
// in the fields each reads (26.3: PackFormat.IntermediaryFormat.validate).
export const RESOURCE_PACK = { pack_format: 22, supported_formats: [22, 97], min_format: 22, max_format: 97 }

export const packMeta = `${JSON.stringify({ pack: { ...RESOURCE_PACK, description: 'rigel' } }, null, '\t')}\n`

// What Rigel wrote when it exported for 1.20.4 only; it is Rigel's, so it gives way to packMeta.
export const OLD_PACK_META = `${JSON.stringify({ pack: { pack_format: 22, description: 'rigel' } }, null, '\t')}\n`
