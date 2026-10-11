import type { BakedGlyph } from './glyph'
import type { TextLayout } from './layout'

/** The text shader (rendertype_text, rendertype_text_background) discards fragments with an alpha below this. */
const ALPHA_CUTOFF = 0.1
const MAX_SIDE = 8192
const MAX_TEXELS = 1 << 24

export interface Raster {
	/** Size in texels. */
	width: number
	height: number
	texelsPerPixel: number
	/** Font pixels (u, v) at the top left corner of texel (0, 0): -1, -1 unless something is drawn left of or above the background. */
	left: number
	top: number
	/** RGBA, not premultiplied. */
	data: Uint8ClampedArray
}

interface Tint {
	r: number
	g: number
	b: number
	a: number
}

interface Bounds {
	left: number
	top: number
	right: number
	bottom: number
}

/**
 * The whole font pixels everything is drawn in: the background quad (u from -1 to the width, v from -1 to the height) and
 * every glyph with its bold copy, shadow and lines.
 */
function drawnBounds(layout: TextLayout): Bounds {
	const bounds = { left: -1, top: -1, right: layout.width, bottom: layout.height }
	const add = (u0: number, v0: number, u1: number, v1: number) => {
		bounds.left = Math.min(bounds.left, u0, u1)
		bounds.top = Math.min(bounds.top, v0, v1)
		bounds.right = Math.max(bounds.right, u0, u1)
		bounds.bottom = Math.max(bounds.bottom, v0, v1)
	}
	for (const line of layout.lines) {
		for (const glyph of line.glyphs) {
			const shadow = layout.shadow ? glyph.info.shadowOffset : 0
			const baked = glyph.info.bake()
			if (baked) {
				const slants = glyph.italic ? [1 - 0.25 * baked.top, 1 - 0.25 * baked.bottom] : [0]
				const bold = glyph.bold ? glyph.info.boldOffset : 0
				add(glyph.x + baked.left + Math.min(...slants), line.y + baked.top, glyph.x + baked.right + Math.max(...slants) + bold + shadow, line.y + baked.bottom + shadow)
			}
			const lineShadow = layout.shadow ? 1 : 0
			if (glyph.underlined || glyph.strikethrough) add(glyph.x - 1, line.y + 3.5, glyph.x + glyph.advance + lineShadow, line.y + 9 + lineShadow)
		}
	}
	return { left: Math.floor(bounds.left), top: Math.floor(bounds.top), right: Math.ceil(bounds.right), bottom: Math.ceil(bounds.bottom) }
}

/**
 * Texels per font pixel: 2 so that half pixels (unihex, centered lines, 4.5 for the strikethrough) are exact, 4 for the
 * quarter-pixel steps of italics, and enough to keep every glyph texel at least one canvas texel (high-resolution bitmaps).
 */
function chooseTexelsPerPixel(layout: TextLayout, { left, top, right, bottom }: Bounds): number {
	let wanted = 2
	for (const line of layout.lines) {
		for (const glyph of line.glyphs) {
			if (glyph.italic) wanted = Math.max(wanted, 4)
			const baked = glyph.info.bake()
			if (baked && baked.right > baked.left) wanted = Math.max(wanted, Math.ceil(baked.width / (baked.right - baked.left) - 1e-9))
		}
	}
	// ponytail: large layouts lose resolution to stay under the canvas size limits; tile the canvas if that matters
	const width = right - left
	const height = bottom - top
	const limit = Math.floor(Math.min(MAX_SIDE / Math.max(width, height), Math.sqrt(MAX_TEXELS / (width * height))))
	return Math.max(1, Math.min(wanted, limit))
}

class Surface {
	readonly data: Uint8ClampedArray
	readonly width: number
	readonly height: number

	constructor(
		readonly bounds: Bounds,
		readonly scale: number,
	) {
		this.width = (bounds.right - bounds.left) * scale
		this.height = (bounds.bottom - bounds.top) * scale
		this.data = new Uint8ClampedArray(this.width * this.height * 4)
	}

	/** First column whose center is at or after `u` (font pixels). */
	column(u: number) {
		return Math.ceil((u - this.bounds.left) * this.scale - 0.5)
	}

	/** First row whose center is at or below `v` (font pixels). */
	row(v: number) {
		return Math.ceil((v - this.bounds.top) * this.scale - 0.5)
	}

	centerU(column: number) {
		return (column + 0.5) / this.scale + this.bounds.left
	}

	centerV(row: number) {
		return (row + 0.5) / this.scale + this.bounds.top
	}

	/** Source-over onto straight alpha; `r`, `g`, `b` are 0 to 255 and `a` is 0 to 1. */
	blend(texel: number, r: number, g: number, b: number, a: number) {
		const i = texel * 4
		const behind = (this.data[i + 3]! / 255) * (1 - a)
		const alpha = a + behind
		this.data[i] = (r * a + this.data[i]! * behind) / alpha
		this.data[i + 1] = (g * a + this.data[i + 1]! * behind) / alpha
		this.data[i + 2] = (b * a + this.data[i + 2]! * behind) / alpha
		this.data[i + 3] = alpha * 255
	}

	fillRect(x0: number, y0: number, x1: number, y1: number, { r, g, b, a }: Tint) {
		if (a < ALPHA_CUTOFF) return
		const [left, right] = x0 < x1 ? [x0, x1] : [x1, x0]
		const [top, bottom] = y0 < y1 ? [y0, y1] : [y1, y0]
		const rows = Math.min(this.height, this.row(bottom))
		const columns = Math.min(this.width, this.column(right))
		for (let row = Math.max(0, this.row(top)); row < rows; row++) {
			for (let column = Math.max(0, this.column(left)); column < columns; column++) this.blend(row * this.width + column, r * 255, g * 255, b * 255, a)
		}
	}

	/** BakedGlyph.render: the quad at (x, y), sheared for italics, sampled without smoothing and multiplied by the tint. */
	drawGlyph(glyph: BakedGlyph, x: number, y: number, italic: boolean, tint: Tint) {
		const left = x + glyph.left
		const right = x + glyph.right
		const top = y + glyph.top
		const bottom = y + glyph.bottom
		const slantTop = italic ? 1 - 0.25 * glyph.top : 0
		const slantBottom = italic ? 1 - 0.25 * glyph.bottom : 0
		const rows = Math.min(this.height, this.row(bottom))
		for (let row = Math.max(0, this.row(top)); row < rows; row++) {
			const t = (this.centerV(row) - top) / (bottom - top)
			const slant = slantTop + t * (slantBottom - slantTop)
			const v = Math.min(glyph.height - 1, Math.floor(t * glyph.height))
			const columns = Math.min(this.width, this.column(right + slant))
			for (let column = Math.max(0, this.column(left + slant)); column < columns; column++) {
				const u = Math.min(glyph.width - 1, Math.floor(((this.centerU(column) - slant - left) / (right - left)) * glyph.width))
				const i = (v * glyph.width + u) * 4
				const a = (glyph.rgba[i + 3]! / 255) * tint.a
				if (a >= ALPHA_CUTOFF) this.blend(row * this.width + column, glyph.rgba[i]! * tint.r, glyph.rgba[i + 1]! * tint.g, glyph.rgba[i + 2]! * tint.b, a)
			}
		}
	}
}

/**
 * Draws the layout the way DisplayRenderer and Font.drawInBatch do: the background, then for each line the shadow pass
 * (a quarter of the color, one glyph shadow offset down and right) and the text, each followed by its underlines and strikethroughs.
 */
export function rasterizeTextDisplay(layout: TextLayout): Raster {
	const bounds = drawnBounds(layout)
	const scale = chooseTexelsPerPixel(layout, bounds)
	const surface = new Surface(bounds, scale)

	const argb = layout.background | 0
	if (argb !== 0) {
		const tint = { r: ((argb >> 16) & 255) / 255, g: ((argb >> 8) & 255) / 255, b: (argb & 255) / 255, a: ((argb >>> 24) & 255) / 255 }
		surface.fillRect(-1, -1, layout.width, layout.height, tint)
	}

	const alpha = layout.textAlpha / 255
	for (const line of layout.lines) {
		for (const shadow of layout.shadow ? [true, false] : [false]) {
			const dim = shadow ? 0.25 : 1
			const underline = shadow ? 1 : 0
			const effects: [number, number, number, number, Tint][] = []
			for (const glyph of line.glyphs) {
				const rgb = glyph.color ?? 0xffffff
				const tint = {
					r: Math.fround((((rgb >> 16) & 255) / 255) * dim),
					g: Math.fround((((rgb >> 8) & 255) / 255) * dim),
					b: Math.fround(((rgb & 255) / 255) * dim),
					a: alpha,
				}
				const baked = glyph.info.bake()
				if (baked) {
					const offset = shadow ? glyph.info.shadowOffset : 0
					surface.drawGlyph(baked, glyph.x + offset, line.y + offset, glyph.italic, tint)
					if (glyph.bold) surface.drawGlyph(baked, glyph.x + offset + glyph.info.boldOffset, line.y + offset, glyph.italic, tint)
				}
				const x0 = glyph.x + underline - 1
				const x1 = glyph.x + underline + glyph.advance
				if (glyph.strikethrough) effects.push([x0, line.y + underline + 4.5, x1, line.y + underline + 3.5, tint])
				if (glyph.underlined) effects.push([x0, line.y + underline + 9, x1, line.y + underline + 8, tint])
			}
			for (const [x0, y0, x1, y1, tint] of effects) surface.fillRect(x0, y0, x1, y1, tint)
		}
	}
	return crop(surface, layout)
}

/** The drawing cut down to the background's rectangle and every texel drawn outside it, in whole font pixels. */
function crop(surface: Surface, layout: TextLayout): Raster {
	const { scale, bounds, width, data } = surface
	let x0 = (-1 - bounds.left) * scale
	let y0 = (-1 - bounds.top) * scale
	let x1 = (layout.width - bounds.left) * scale
	let y1 = (layout.height - bounds.top) * scale
	for (let row = 0; row < surface.height; row++) {
		for (let column = 0; column < width; column++) {
			if (data[(row * width + column) * 4 + 3] === 0) continue
			x0 = Math.min(x0, column)
			y0 = Math.min(y0, row)
			x1 = Math.max(x1, column + 1)
			y1 = Math.max(y1, row + 1)
		}
	}
	x0 = Math.floor(x0 / scale) * scale
	y0 = Math.floor(y0 / scale) * scale
	x1 = Math.ceil(x1 / scale) * scale
	y1 = Math.ceil(y1 / scale) * scale
	const cropped = new Uint8ClampedArray((x1 - x0) * (y1 - y0) * 4)
	for (let row = y0; row < y1; row++) cropped.set(data.subarray((row * width + x0) * 4, (row * width + x1) * 4), (row - y0) * (x1 - x0) * 4)
	return { width: x1 - x0, height: y1 - y0, texelsPerPixel: scale, left: bounds.left + x0 / scale, top: bounds.top + y0 / scale, data: cropped }
}

export interface DrawnTextDisplay {
	canvas: HTMLCanvasElement
	texelsPerPixel: number
	/** Canvas size in texels. */
	width: number
	height: number
	/** Font pixels (u, v) at the top left corner of the canvas. */
	left: number
	top: number
}

export function drawTextDisplay(layout: TextLayout, makeCanvas: (width: number, height: number) => HTMLCanvasElement): DrawnTextDisplay {
	const raster = rasterizeTextDisplay(layout)
	const canvas = makeCanvas(raster.width, raster.height)
	const context = canvas.getContext('2d')
	if (!context) throw new Error('canvas の 2D コンテキストを作れません')
	const image = context.createImageData(raster.width, raster.height)
	image.data.set(raster.data)
	context.putImageData(image, 0, 0)
	return { canvas, texelsPerPixel: raster.texelsPerPixel, width: raster.width, height: raster.height, left: raster.left, top: raster.top }
}
