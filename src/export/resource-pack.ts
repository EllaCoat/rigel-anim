// The resource pack every rig shares: models under assets/rigel/models/<rig>/, textures under
// assets/rigel/textures/item/<rig>/, and the overrides of the item the bones show.
import { NAMESPACE } from './datapack'

export const PACK_FORMAT = 22

export function itemModelPath(item: string): string {
	const [namespace, path] = item.split(':') as [string, string]
	return `assets/${namespace}/models/item/${path}.json`
}

type Override = { predicate?: Record<string, unknown>; model?: unknown }

// The item model with this rig's old overrides replaced by one per model. Models get the smallest
// CustomModelData numbers no other override of the item uses, so other rigs and anything else on the
// item keep theirs. An item without a model file in the pack gets the flat item model of vanilla items.
export function mergeItemModel(existing: string | undefined, item: string, rig: string, models: string[]): { json: string; cmds: number[] } {
	const [namespace, path] = item.split(':') as [string, string]
	const model: Record<string, unknown> = existing === undefined ? { parent: 'minecraft:item/generated', textures: { layer0: `${namespace}:item/${path}` } } : JSON.parse(existing)
	const own = `${NAMESPACE}:${rig}/`
	const kept = ((model.overrides as Override[] | undefined) ?? []).filter((o) => !(typeof o.model === 'string' && o.model.startsWith(own)))
	const used = new Set(kept.map((o) => o.predicate?.custom_model_data).filter((v): v is number => typeof v === 'number'))
	const cmds: number[] = []
	for (let n = 1; cmds.length < models.length; n++) if (!used.has(n)) cmds.push(n)
	// Minecraft uses the last override whose custom_model_data is at most the item's. Each new override goes
	// before the first one with a larger number, so it wins for its own number and not for theirs; the
	// other overrides keep their order, which decides between their other predicates.
	const cmdOf = (o: Override) => (typeof o.predicate?.custom_model_data === 'number' ? o.predicate.custom_model_data : 0)
	const overrides = [...kept]
	models.forEach((m, i) => {
		const at = overrides.findIndex((o) => cmdOf(o) > cmds[i]!)
		overrides.splice(at < 0 ? overrides.length : at, 0, { predicate: { custom_model_data: cmds[i] }, model: m })
	})
	model.overrides = overrides
	return { json: `${JSON.stringify(model, null, '\t')}\n`, cmds }
}

export function packMeta(): string {
	return `${JSON.stringify({ pack: { pack_format: PACK_FORMAT, description: 'rigel' } }, null, '\t')}\n`
}
