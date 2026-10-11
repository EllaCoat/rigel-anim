/** A glyph's image and where its quad sits, in font pixels from the glyph origin (x, top of the line). */
export interface BakedGlyph {
	/** Image size in texels. */
	width: number
	height: number
	rgba: Uint8ClampedArray
	left: number
	right: number
	top: number
	bottom: number
}

/** GlyphInfo of Minecraft: the metrics every provider reports plus how to draw the glyph. */
export interface GlyphInfo {
	advance: number
	boldOffset: number
	shadowOffset: number
	/** Undefined when nothing is drawn (EmptyGlyph, space). */
	bake(): BakedGlyph | undefined
}

export interface GlyphProvider {
	glyph(codepoint: number): GlyphInfo | undefined
}

/** Renders its image on first use; most of the tens of thousands of unifont glyphs are never drawn. */
export abstract class LazyGlyph implements GlyphInfo {
	abstract readonly advance: number
	abstract readonly boldOffset: number
	abstract readonly shadowOffset: number
	private baked: BakedGlyph | null | undefined

	protected abstract render(): BakedGlyph | undefined

	bake(): BakedGlyph | undefined {
		if (this.baked === undefined) this.baked = this.render() ?? null
		return this.baked ?? undefined
	}
}

/** SpecialGlyphs.MISSING: a 5x8 outline with an advance of 6. */
export const MISSING_GLYPH: GlyphInfo = (() => {
	const width = 5
	const height = 8
	const rgba = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (x === 0 || x + 1 === width || y === 0 || y + 1 === height) rgba.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4)
		}
	}
	const baked: BakedGlyph = { width, height, rgba, left: 0, right: width, top: 0, bottom: height }
	return { advance: width + 1, boldOffset: 1, shadowOffset: 1, bake: () => baked }
})()
