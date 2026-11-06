import { MISSING_GLYPH, type GlyphInfo, type GlyphProvider } from './glyph'
import { loadProvider, parseProvider, type LoadContext } from './providers'
import { parseJson } from './resources'

/** FontSet: the first provider that has the codepoint decides its glyph; nothing has it, it is the missing glyph. */
export class FontSet {
	private readonly cache = new Map<number, GlyphInfo>()

	/** In priority order. */
	constructor(private readonly providers: GlyphProvider[]) {}

	glyph(codepoint: number): GlyphInfo {
		let glyph = this.cache.get(codepoint)
		if (!glyph) {
			glyph = MISSING_GLYPH
			for (const provider of this.providers) {
				const found = provider.glyph(codepoint)
				if (found) {
					glyph = found
					break
				}
			}
			this.cache.set(codepoint, glyph)
		}
		return glyph
	}
}

// A provider's `filter` (26.3's FontOption.Filter): the options that must be on (true) or off (false) for it to be used.
type Filter = ReadonlyMap<string, boolean>
type Builder = ({ provider: Promise<GlyphProvider | undefined> } | { reference: string }) & { filter: Filter }
type Conditional = { provider: GlyphProvider; filter: Filter }

function filterOf(value: unknown): Filter {
	const filter = (value as { filter?: unknown } | null)?.filter
	if (typeof filter !== 'object' || filter === null) return new Map()
	return new Map(Object.entries(filter).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'))
}

const passes = (filter: Filter, options: ReadonlySet<string>) => [...filter].every(([option, on]) => options.has(option) === on)

/**
 * Loads every `font/**.json` the stack defines. FontManager stacks the files of all packs, the highest pack's providers
 * first; a reference splices in the providers of another font. A provider that cannot be used is skipped with a warning.
 * options: the font options in effect (`uniform`, `jp`), for versions whose providers have filters; without it, filters are not read.
 */
export async function loadFontSets(ctx: LoadContext, warn: (message: string) => void, options?: ReadonlySet<string>): Promise<Map<string, FontSet>> {
	const builders = new Map<string, Builder[]>()
	for (const id of ctx.stack.fontIds()) {
		const colon = id.indexOf(':')
		const file = `${id.slice(0, colon)}/font/${id.slice(colon + 1)}.json`
		const list: Builder[] = []
		builders.set(id, list)
		for (const layer of ctx.stack.layers) {
			const bytes = await layer.read(file)
			if (!bytes) continue
			let providers: unknown[]
			try {
				const json = parseJson(bytes) as { providers?: unknown }
				if (typeof json !== 'object' || json === null || !Array.isArray(json.providers)) throw new Error('providers の一覧がありません')
				providers = json.providers
			} catch (error) {
				warn(`フォント ${id}（${layer.name}）を読めません: ${(error as Error).message}`)
				continue
			}
			for (let i = providers.length - 1; i >= 0; i--) {
				const where = `フォント ${id}（${layer.name}）の ${i + 1} 番目の provider`
				try {
					const def = parseProvider(providers[i], ctx.version)
					const filter = options ? filterOf(providers[i]) : new Map<string, boolean>()
					if (def.type === 'reference') list.push({ reference: def.id, filter })
					else if (def.type === 'unsupported') warn(`${where}は ${def.name} のため読みません`)
					else {
						const provider = loadProvider(def, ctx).catch((error: Error) => {
							warn(`${where}を読めません: ${error.message}`)
							return undefined
						})
						list.push({ provider, filter })
					}
				} catch (error) {
					warn(`${where}を読めません: ${(error as Error).message}`)
				}
			}
		}
	}

	const resolved = new Map<string, Conditional[]>()
	const resolving = new Set<string>()
	const resolve = async (id: string): Promise<Conditional[] | undefined> => {
		const done = resolved.get(id)
		if (done) return done
		const list = builders.get(id)
		if (!list || resolving.has(id)) return undefined
		resolving.add(id)
		const providers: Conditional[] = []
		for (const builder of list) {
			if ('provider' in builder) {
				const provider = await builder.provider
				if (provider) providers.push({ provider, filter: builder.filter })
			} else {
				const referenced = await resolve(builder.reference)
				// FontManager.BuilderResult.mergeFilters: the referring provider's filter wins over the referenced one's.
				if (referenced) providers.push(...referenced.map((c) => ({ provider: c.provider, filter: new Map([...c.filter, ...builder.filter]) })))
				else warn(`フォント ${id} が参照する ${builder.reference} がない、または循環しています`)
			}
		}
		resolving.delete(id)
		resolved.set(id, providers)
		return providers
	}

	const fonts = new Map<string, FontSet>()
	for (const id of builders.keys()) {
		const used = (await resolve(id))!.filter((c) => !options || passes(c.filter, options))
		fonts.set(id, new FontSet(used.map((c) => c.provider).reverse()))
	}
	return fonts
}
