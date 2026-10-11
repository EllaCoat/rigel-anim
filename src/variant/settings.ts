import { FORMAT_ID } from '../format'

// Textures and groups are kept by UUID so that reordering them does not change a variant. A keyframe names its
// variant by `uuid`, which a rename leaves alone.
export interface StoredVariant {
	uuid: string
	name: string
	textures: [string, string][]
	excluded: string[]
	onApply: string
}

// What a keyframe holds to show the original model.
export const DEFAULT_VARIANT_ID = 'default'

const KEY = 'rigel_variants'

let property: Deletable | undefined

export function registerVariantSettings(): void {
	property = new Property(ModelProject, 'array', KEY, { condition: { formats: [FORMAT_ID] }, exposed: false, default: [] })
}

export function unregisterVariantSettings(): void {
	property?.delete()
	property = undefined
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// Entries saved before variants had a uuid get one here, in the stored entry itself, so that every later read agrees.
export function readVariants(project: ModelProject): StoredVariant[] {
	const raw = (project as unknown as Record<string, unknown>)[KEY]
	if (!Array.isArray(raw)) return []
	const seen = new Set<string>([DEFAULT_VARIANT_ID])
	return raw.flatMap((v) => {
		if (typeof v !== 'object' || v === null) return []
		const o = v as Record<string, unknown>
		if (typeof o.uuid !== 'string' || seen.has(o.uuid)) o.uuid = crypto.randomUUID()
		seen.add(o.uuid as string)
		const textures = Array.isArray(o.textures) ? o.textures.flatMap((p): [string, string][] => (Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string' ? [[p[0], p[1]]] : [])) : []
		return [{ uuid: o.uuid as string, name: typeof o.name === 'string' ? o.name : '', textures, excluded: strings(o.excluded), onApply: typeof o.onApply === 'string' ? o.onApply : '' }]
	})
}

export function writeVariants(project: ModelProject, variants: StoredVariant[]): void {
	;(project as unknown as Record<string, unknown>)[KEY] = variants.map((v) => ({ ...v, textures: v.textures.map((p) => [...p]), excluded: [...v.excluded] }))
	project.saved = false
}

export function newVariant(name: string): StoredVariant {
	return { uuid: crypto.randomUUID(), name, textures: [], excluded: [], onApply: '' }
}

// `base`, then `base_2`, `base_3` … for the first name no variant has.
export function freeName(base: string, variants: StoredVariant[]): string {
	const taken = new Set(variants.map((v) => v.name))
	let name = base
	for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
	return name
}
