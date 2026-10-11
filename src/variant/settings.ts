import { FORMAT_ID } from '../format'

// Textures and groups are kept by UUID so that reordering them does not change a variant.
export interface StoredVariant {
	name: string
	textures: [string, string][]
	excluded: string[]
	onApply: string
}

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

export function readVariants(project: ModelProject): StoredVariant[] {
	const raw = (project as unknown as Record<string, unknown>)[KEY]
	if (!Array.isArray(raw)) return []
	return raw.flatMap((v) => {
		if (typeof v !== 'object' || v === null) return []
		const o = v as Record<string, unknown>
		const textures = Array.isArray(o.textures) ? o.textures.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string') : []
		return [{ name: typeof o.name === 'string' ? o.name : '', textures, excluded: strings(o.excluded), onApply: typeof o.onApply === 'string' ? o.onApply : '' }]
	})
}

export function writeVariants(project: ModelProject, variants: StoredVariant[]): void {
	;(project as unknown as Record<string, unknown>)[KEY] = variants.map((v) => ({ ...v, textures: v.textures.map((p) => [...p]), excluded: [...v.excluded] }))
	project.saved = false
}
