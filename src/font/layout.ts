import { flatten, parseText } from './component'
import type { GlyphInfo } from './glyph'
import type { FontLibrary } from './library'
import { lineChars, splitLines } from './split'
import { isBold, isItalic, type Style } from './style'

export interface TextDisplaySpec {
	/** The `text` of the text_display: a JSON text component, or plain text. */
	text: string
	lineWidth: number
	/** ARGB, as the `background` tag. */
	background: number
	defaultBackground: boolean
	/** The `text_opacity` byte: -128 to 127, or 0 to 255. */
	textOpacity: number
	shadow: boolean
	alignment: 'center' | 'left' | 'right'
}

export interface LayoutGlyph {
	codepoint: number
	/** Left of the glyph's advance, in font pixels. */
	x: number
	info: GlyphInfo
	/** Distance to the next glyph; includes the bold offset. */
	advance: number
	/** RGB from the style; undefined draws in the display's own color (white). */
	color: number | undefined
	bold: boolean
	italic: boolean
	underlined: boolean
	strikethrough: boolean
}

export interface LayoutLine {
	/** Top of the line, in font pixels from the top of the first line. */
	y: number
	glyphs: LayoutGlyph[]
}

/**
 * Positions are font pixels (the size of a pixel of the default font): u grows to the right and v downwards, the origin
 * is the top left of the first line. The background covers u from -1 to `width` and v from -1 to `height`.
 */
export interface TextLayout {
	width: number
	height: number
	lines: LayoutLine[]
	/** ARGB of the background quad; 0 draws none. */
	background: number
	/** 0 to 255, after the renderer's treatment of nearly transparent colors. */
	textAlpha: number
	shadow: boolean
	warnings: string[]
}

/** DisplayRenderer.TextDisplayRenderer: every line takes 10 pixels (Font.lineHeight 9 + 1). */
export const LINE_HEIGHT = 10

/** Font.adjustColor: an alpha below 4 is replaced by fully opaque. */
const adjustAlpha = (alpha: number) => (alpha & 0xfc ? alpha : 255)

/** Display.TextDisplay.getAlign + TextDisplayRenderer.renderInner */
const lineStart = (alignment: TextDisplaySpec['alignment'], width: number, lineWidth: number) =>
	alignment === 'left' ? 0 : alignment === 'right' ? width - lineWidth : Math.fround(Math.fround(width / 2) - Math.fround(lineWidth / 2))

export function layoutTextDisplay(library: FontLibrary, spec: TextDisplaySpec): TextLayout {
	const warnings: string[] = []
	const glyphOf = (codepoint: number, style: Style) => library.fontSet(style.font).glyph(codepoint)
	const advanceOf = (codepoint: number, style: Style) => {
		const info = glyphOf(codepoint, style)
		return Math.fround(info.advance + (isBold(style) ? info.boldOffset : 0))
	}

	const parts = flatten(parseText(spec.text, (message) => warnings.push(message)), library)
	const lines = splitLines(parts, spec.lineWidth, advanceOf).map((line) => {
		const chars = lineChars(line).map(({ codepoint, style }) => ({ codepoint, info: glyphOf(codepoint, style), style, advance: advanceOf(codepoint, style) }))
		let sum = 0
		for (const char of chars) sum = Math.fround(sum + char.advance)
		return { chars, width: Math.ceil(sum) }
	})

	const width = lines.reduce((widest, line) => Math.max(widest, line.width), 0)
	const layout: LayoutLine[] = lines.map((line, row) => {
		let x = lineStart(spec.alignment, width, line.width)
		const glyphs = line.chars.map(({ codepoint, info, style, advance }): LayoutGlyph => {
			const glyph = { codepoint, x, info, advance, color: style.color, bold: isBold(style), italic: isItalic(style), underlined: style.underlined === true, strikethrough: style.strikethrough === true }
			x = Math.fround(x + advance)
			return glyph
		})
		return { y: row * LINE_HEIGHT, glyphs }
	})

	return {
		width,
		height: lines.length * LINE_HEIGHT,
		lines: layout,
		background: spec.defaultBackground ? (Math.trunc(Math.fround(library.backgroundOpacity * 255)) << 24) >>> 0 : spec.background >>> 0,
		textAlpha: adjustAlpha(spec.textOpacity & 0xff),
		shadow: spec.shadow,
		warnings,
	}
}
