import { beforeAll, describe, expect, test } from 'bun:test'
import { drawTextDisplay, rasterizeTextDisplay, type Raster } from '../src/font/draw'
import { layoutTextDisplay } from '../src/font/layout'
import type { FontLibrary } from '../src/font/library'
import { image, layout, loadGame, spec, vanilla } from './font-support'

const json = JSON.stringify
let library: FontLibrary

beforeAll(async () => {
	// X: a pixel at the top left and one in the second column of the last row (3 wide); Y sits 3 pixels lower (ascent 4);
	// T is Y at twice the size, starting 3 pixels above the line (height 16, ascent 10); H is a 32 pixel high cell shown
	// 8 high, with a pixel at its column 15; U+F801 steps back 3.
	const hd = Array.from({ length: 32 }, (_, y) => (y === 0 ? `${'.'.repeat(15)}#${'.'.repeat(16)}` : '.'.repeat(32)))
	library = await loadGame({
		...vanilla(),
		packs: {
			'/packs/art': {
				'minecraft/font/default.json': json({
					providers: [
						{ type: 'bitmap', file: 'minecraft:font/x.png', ascent: 7, chars: ['X'] },
						{ type: 'bitmap', file: 'minecraft:font/y.png', ascent: 4, chars: ['Y'] },
						{ type: 'bitmap', file: 'minecraft:font/y.png', height: 16, ascent: 10, chars: ['T'] },
						{ type: 'bitmap', file: 'minecraft:font/hd.png', ascent: 7, chars: ['H'] },
						{ type: 'space', advances: { '': -3 } },
					],
				}),
				'minecraft/textures/font/x.png': image('#...', '....', '....', '....', '....', '....', '....', '.#..'),
				'minecraft/textures/font/y.png': image('#...', '....', '....', '....', '....', '....', '....', '....'),
				'minecraft/textures/font/hd.png': image(...hd),
			},
		},
	})
})

/** Without a background unless a test asks for one. */
const raster = (text: string, overrides = {}) => rasterizeTextDisplay(layout(library, text, { background: 0, ...overrides }))
const rows = (r: Raster) => Array.from({ length: r.height }, (_, y) => Array.from({ length: r.width }, (_, x) => (r.data[(y * r.width + x) * 4 + 3]! > 0 ? '#' : '.')).join(''))
const pixel = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)]
const picture = (width: number, height: number, marks: Record<number, string>) => Array.from({ length: height }, (_, y) => marks[y] ?? '.'.repeat(width))
/** First and last opaque texel of a row. */
const span = (r: Raster, y: number) => {
	const row = rows(r)[y]!
	return [row.indexOf('#'), row.lastIndexOf('#')]
}

describe('size', () => {
	test('the canvas covers u from -1 to the width and v from -1 to the height', () => {
		const one = raster('X')
		// width 3, one line: 4 x 11 font pixels at 2 texels per pixel
		expect([one.texelsPerPixel, one.width, one.height, one.left, one.top]).toEqual([2, 8, 22, -1, -1])
		const two = raster(json({ text: 'X\nX' }))
		expect([two.width, two.height]).toEqual([8, 42])
	})

	// DisplayRenderer draws the glyphs over the background quad without clipping them to it.
	test('a glyph above the line grows the canvas upwards', () => {
		const result = raster('T')
		expect([result.left, result.top]).toEqual([-1, -3])
		// the pixel is 2 x 2 font pixels at u = 0, v = -3; the advance is 3
		expect(rows(result)).toEqual(picture(8, 26, { 0: '..####..', 1: '..####..', 2: '..####..', 3: '..####..' }))
	})

	test('a glyph stepped back past the start grows the canvas to the left', () => {
		const result = raster('X')
		expect([result.left, result.top]).toEqual([-3, -1])
		expect(rows(result)).toEqual(picture(6, 22, { 2: '##....', 3: '##....', 16: '..##..', 17: '..##..' }))
	})

	test('half pixels need 2 texels per pixel, italics 4, and a high-resolution bitmap enough for its texels', () => {
		expect(raster('X').texelsPerPixel).toBe(2)
		expect(raster(json({ text: 'a', bold: true })).texelsPerPixel).toBe(2)
		expect(raster(json({ text: 'X', italic: true })).texelsPerPixel).toBe(4)
		expect(raster('H').texelsPerPixel).toBe(4)
	})
})

describe('glyphs', () => {
	test('a bitmap pixel is one font pixel; the pixel at the top left of the glyph is at u = 0, v = 0', () => {
		const result = raster('X')
		expect(rows(result)).toEqual(picture(8, 22, { 2: '..##....', 3: '..##....', 16: '....##..', 17: '....##..' }))
		expect(pixel(result, 2, 2)).toEqual([255, 255, 255, 255])
	})

	test('ascent moves the glyph: the baseline is 7 pixels below the top of the line', () => {
		const result = raster('Y')
		expect(rows(result)).toEqual(picture(6, 22, { 8: '..##..', 9: '..##..' }))
	})

	test('unihex glyphs are drawn at half size, from the left column of their bits', () => {
		const result = raster('a')
		// rows 1 and 5 of the 16, columns 1..6 of 8 (the glyph starts at its first used column): 0.5 pixel each
		expect(rows(result)).toEqual(picture(10, 22, { 3: '..#.......', 7: '..######..' }))
	})

	test('a high-resolution bitmap is scaled by height over cell height', () => {
		const result = raster('H')
		// column 15 of 32 at 0.25 pixel: u from 3.75; 4 texels per pixel
		expect(rows(result).flatMap((row, y) => (row.includes('#') ? [`${row.indexOf('#')},${y}`] : []))).toEqual(['19,4'])
	})

	test('bold draws the glyph again one bold offset to the right', () => {
		expect(rows(raster(json({ text: 'X', bold: true })))).toEqual(picture(10, 22, { 2: '..####....', 3: '..####....', 16: '....####..', 17: '....####..' }))
		// unihex: half a pixel
		expect(rows(raster(json({ text: 'a', bold: true })))).toEqual(picture(12, 22, { 3: '..##........', 7: '..#######...' }))
	})

	test('the missing glyph is a 5 x 8 outline', () => {
		const result = raster('Z')
		expect(rows(result)).toEqual(
			picture(14, 22, {
				2: '..##########..',
				3: '..##########..',
				...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [4 + i, '..##......##..'])),
				16: '..##########..',
				17: '..##########..',
			}),
		)
	})

	test('a space draws nothing', () => {
		expect(rows(raster(' ')).every((row) => !row.includes('#'))).toBe(true)
	})
})

describe('italic', () => {
	// BakedGlyph.render: the top edge moves right by 1 - 0.25 * top and the bottom edge by 1 - 0.25 * bottom
	test('the top of the glyph leans right by about a pixel and the bottom left by about a pixel', () => {
		const result = raster(json({ text: 'X', italic: true }))
		// canvas of 4 texels per pixel; unslanted, the top pixel would start at x = 4 and the bottom pixel at x = 8
		expect([4, 5, 6, 7].map((y) => span(result, y))).toEqual([
			[8, 11],
			[8, 11],
			[7, 10],
			[7, 10],
		])
		expect([32, 33, 34, 35].map((y) => span(result, y))).toEqual([
			[5, 8],
			[5, 8],
			[4, 7],
			[4, 7],
		])
	})
})

describe('lines', () => {
	test('underline covers one pixel below the glyph from one pixel before it to its advance', () => {
		const result = raster(json({ text: 'X', underlined: true }))
		expect(rows(result)).toEqual(picture(8, 22, { 2: '..##....', 3: '..##....', 16: '....##..', 17: '....##..', 18: '########', 19: '########' }))
	})

	test('strikethrough is one pixel at 3.5 to 4.5', () => {
		const result = raster(json({ text: 'X', strikethrough: true }))
		expect(rows(result)).toEqual(picture(8, 22, { 2: '..##....', 3: '..##....', 9: '########', 10: '########', 16: '....##..', 17: '....##..' }))
	})

	test('bold lines follow the bold advance', () => {
		const result = raster(json({ text: 'X', bold: true, underlined: true }))
		expect(rows(result)[18]).toBe('##########')
	})
})

describe('shadow', () => {
	// Font.StringRenderOutput: the shadow is a quarter of the color, one shadow offset down and right, drawn first
	test('a glyph shadow is one pixel down and right in a quarter of the color; the text covers it', () => {
		const result = raster('X', { shadow: true })
		expect(rows(result)).toEqual(picture(8, 22, { 2: '..##....', 3: '..##....', 4: '....##..', 5: '....##..', 16: '....##..', 17: '....##..', 18: '......##', 19: '......##' }))
		expect(pixel(result, 4, 4)).toEqual([64, 64, 64, 255])
		expect(pixel(result, 2, 2)).toEqual([255, 255, 255, 255])
		expect(pixel(result, 4, 16)).toEqual([255, 255, 255, 255])
	})

	test('a unihex shadow is half a pixel away', () => {
		const result = raster('a', { shadow: true })
		expect(rows(result)).toEqual(picture(10, 22, { 3: '..#.......', 4: '...#......', 7: '..######..', 8: '...######.' }))
	})

	test('lines have a shadow one pixel down and right whatever the glyph', () => {
		const result = raster(json({ text: 'X', underlined: true }), { shadow: true })
		expect(rows(result)[18]).toBe('########..')
		expect(rows(result)[20]).toBe('..########')
		expect(pixel(result, 3, 20)).toEqual([64, 64, 64, 255])
	})
})

describe('color', () => {
	test('a color tints the glyph, the shadow is a quarter of it', () => {
		const result = raster(json({ text: 'X', color: 'red' }), { shadow: true })
		expect(pixel(result, 2, 2)).toEqual([255, 85, 85, 255])
		expect(pixel(result, 4, 4)).toEqual([64, 21, 21, 255])
	})

	test('text_opacity is the alpha of the text and of its shadow', () => {
		const result = raster('X', { textOpacity: 128, shadow: true })
		expect(pixel(result, 2, 2)).toEqual([255, 255, 255, 128])
		expect(pixel(result, 4, 4)[3]).toBe(128)
	})

	// rendertype_text.fsh: fragments with an alpha below 0.1 are discarded
	test('text with an alpha below 0.1 is not drawn', () => {
		expect(rows(raster('X', { textOpacity: 25 })).some((row) => row.includes('#'))).toBe(false)
		expect(pixel(raster('X', { textOpacity: 26 }), 2, 2)).toEqual([255, 255, 255, 26])
	})

	test('opacity 0 to 3 is drawn opaque (Font.adjustColor)', () => {
		expect(pixel(raster('X', { textOpacity: 2 }), 2, 2)[3]).toBe(255)
	})
})

describe('background', () => {
	test('the background fills the whole canvas, text lies over it', () => {
		const result = raster('X', { background: 0xff2040ff })
		expect(pixel(result, 0, 0)).toEqual([0x20, 0x40, 0xff, 255])
		expect(pixel(result, result.width - 1, result.height - 1)).toEqual([0x20, 0x40, 0xff, 255])
		expect(pixel(result, 2, 2)).toEqual([255, 255, 255, 255])
	})

	test('a translucent background keeps its alpha where there is no text', () => {
		const result = raster('X', { background: 0x80000000 })
		expect(pixel(result, 0, 0)).toEqual([0, 0, 0, 128])
		expect(pixel(result, 2, 2)).toEqual([255, 255, 255, 255])
	})

	test('the default background is black with an alpha of 63', () => {
		expect(pixel(raster('X', { defaultBackground: true }), 0, 0)).toEqual([0, 0, 0, 63])
	})

	test('no background, or one with an alpha below 0.1 (rendertype_text_background.fsh), draws nothing', () => {
		expect(pixel(raster('X', { background: 0 }), 0, 0)).toEqual([0, 0, 0, 0])
		expect(pixel(raster('X', { background: 0x19ffffff }), 0, 0)).toEqual([0, 0, 0, 0])
		expect(pixel(raster('X', { background: 0x1affffff }), 0, 0)).toEqual([255, 255, 255, 26])
	})

	test('what reaches beyond the background, like the shadow of an underline, is drawn past its edge', () => {
		const result = raster(json({ text: 'X', underlined: true }), { shadow: true, background: 0xff000000 })
		// the background covers columns 0 to 7; the shadow of the underline reaches u = 4, column 9
		expect([result.width, result.height]).toEqual([10, 22])
		expect(pixel(result, 9, 21)).toEqual([64, 64, 64, 255])
		expect(pixel(result, 9, 0)).toEqual([0, 0, 0, 0])
		expect(pixel(result, 7, 0)).toEqual([0, 0, 0, 255])
	})
})

describe('canvas', () => {
	test('draws the raster onto a canvas made by the caller', () => {
		const requested: number[][] = []
		let written: { data: Uint8ClampedArray } | undefined
		const makeCanvas = (width: number, height: number) => {
			requested.push([width, height])
			return {
				width,
				height,
				getContext: () => ({
					createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
					putImageData: (data: { data: Uint8ClampedArray }) => {
						written = data
					},
				}),
			} as unknown as HTMLCanvasElement
		}
		const text = layoutTextDisplay(library, spec('X', { background: 0xff2040ff }))
		const drawn = drawTextDisplay(text, makeCanvas)
		expect(requested).toEqual([[8, 22]])
		expect([drawn.texelsPerPixel, drawn.width, drawn.height, drawn.left, drawn.top]).toEqual([2, 8, 22, -1, -1])
		expect(written?.data).toEqual(rasterizeTextDisplay(text).data)
	})
})
