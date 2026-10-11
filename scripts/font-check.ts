// Loads the real Minecraft 1.20.4 files and prints the width and lines of some texts, to compare with the game.
// Usage: bun scripts/font-check.ts [--dir <.minecraft>] [--pack <folder or zip>]... [--art] [--text <text>]...
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { rasterizeTextDisplay } from '../src/font/draw'
import { layoutTextDisplay, type TextDisplaySpec } from '../src/font/layout'
import { loadFontLibrary } from '../src/font/library'
import type { DecodedImage } from '../src/font/providers'

const args = process.argv.slice(2)
const values = (flag: string) => args.flatMap((arg, i) => (arg === flag && args[i + 1] ? [args[i + 1]!] : []))
const minecraftDir = values('--dir')[0] ?? `${process.env.APPDATA}/.minecraft`
const packs = values('--pack')
const art = args.includes('--art')

/** Non-interlaced PNG; enough for the textures Minecraft's fonts use. */
async function decodePng(png: Uint8Array): Promise<DecodedImage> {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	let width = 0
	let height = 0
	let depth = 8
	let type = 6
	let palette = new Uint8Array(0)
	let transparency = new Uint8Array(0)
	const parts: Uint8Array[] = []
	for (let pos = 8; pos < png.length; ) {
		const length = view.getUint32(pos)
		const name = String.fromCharCode(...png.subarray(pos + 4, pos + 8))
		const body = png.subarray(pos + 8, pos + 8 + length)
		if (name === 'IHDR') {
			width = view.getUint32(pos + 8)
			height = view.getUint32(pos + 12)
			depth = body[8]!
			type = body[9]!
			if (body[12] !== 0) throw new Error('interlaced PNG')
		} else if (name === 'PLTE') palette = body
		else if (name === 'tRNS') transparency = body
		else if (name === 'IDAT') parts.push(body)
		pos += 12 + length
	}
	const raw = inflateSync(Buffer.concat(parts))
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]!
	const bits = channels * depth
	const stride = Math.ceil((width * bits) / 8)
	const step = Math.max(1, bits >> 3)
	const rows: Uint8Array[] = []
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]!
		const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
		const above = rows[y - 1] ?? new Uint8Array(stride)
		for (let x = 0; x < stride; x++) {
			const left = x >= step ? line[x - step]! : 0
			const up = above[x]!
			const upLeft = x >= step ? above[x - step]! : 0
			const p = left + up - upLeft
			const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
			const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
			line[x] = (line[x]! + [0, left, up, (left + up) >> 1, paeth][filter]!) & 255
		}
		rows.push(line)
	}
	const data = new Uint8ClampedArray(width * height * 4)
	const sample = (line: Uint8Array, index: number) => {
		if (depth === 8) return line[index]!
		if (depth === 16) return line[index * 2]!
		const per = 8 / depth
		return (line[Math.floor(index / per)]! >> (8 - depth * ((index % per) + 1))) & ((1 << depth) - 1)
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4
			const line = rows[y]!
			const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1
			if (type === 3) {
				const index = sample(line, x)
				data.set([palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!, transparency[index] ?? 255], i)
			} else if (type === 0 || type === 4) {
				const gray = sample(line, x * channels) * scale
				data.set([gray, gray, gray, type === 4 ? sample(line, x * 2 + 1) : 255], i)
			} else data.set([sample(line, x * channels), sample(line, x * channels + 1), sample(line, x * channels + 2), type === 6 ? sample(line, x * 4 + 3) : 255], i)
		}
	}
	return { width, height, data }
}

const result = await loadFontLibrary({ fs: { existsSync, readFileSync, readdirSync, statSync }, sources: { minecraftDir, resourcePacks: packs }, decodeImage: decodePng })
if ('error' in result) {
	console.error(result.error)
	process.exit(1)
}
const { library } = result
console.log(`warnings: ${library.warnings.length}`)
for (const warning of library.warnings.slice(0, 10)) console.log(`  ${warning}`)

const base: TextDisplaySpec = { text: '', lineWidth: 200, background: 0x40000000, defaultBackground: false, textOpacity: -1, shadow: false, alignment: 'center' }
const texts = values('--text')
const samples = texts.length > 0 ? texts : [
	'Hello',
	'こんにちは',
	'{"text":"Bold ","bold":true,"extra":[{"text":"italic","italic":true,"color":"red"},{"text":" under","underlined":true}]}',
	'{"translate":"commands.give.success.single","with":[1,"Stick","Steve"]}',
	'The quick brown fox jumps over the lazy dog',
]
for (const text of samples) {
	const layout = layoutTextDisplay(library, { ...base, text, lineWidth: text.startsWith('The quick') ? 80 : 200 })
	console.log(`\n${text}\n  W=${layout.width} H=${layout.height} lines=${layout.lines.length} widths=[${layout.lines.map((line) => line.glyphs.reduce((sum, glyph) => sum + glyph.advance, 0)).join(', ')}]`)
	for (const warning of layout.warnings) console.log(`  warning: ${warning}`)
	if (art) {
		const raster = rasterizeTextDisplay({ ...layout, background: 0 })
		for (let y = 0; y < raster.height; y++) {
			let row = ''
			for (let x = 0; x < raster.width; x++) row += raster.data[(y * raster.width + x) * 4 + 3]! > 0 ? '#' : '.'
			console.log(`  ${row}`)
		}
	}
}
