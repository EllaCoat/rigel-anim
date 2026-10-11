// Builds small Minecraft installations in memory: a jar, an asset index, resource packs and options.txt.
import { deflateRawSync } from 'node:zlib'
import { layoutTextDisplay, type TextDisplaySpec, type TextLayout } from '../src/font/layout'
import { loadFontLibrary, type FontLibrary } from '../src/font/library'
import type { DecodedImage } from '../src/font/providers'
import type { ReadFs } from '../src/font/resources'

export type Files = Record<string, string | Uint8Array>

const encoder = new TextEncoder()
export const bytesOf = (content: string | Uint8Array) => (typeof content === 'string' ? encoder.encode(content) : content)

export function memoryFs(files: Files): ReadFs {
	const entries = new Map(Object.entries(files).map(([path, content]) => [path, bytesOf(content)]))
	const isDirectory = (path: string) => [...entries.keys()].some((file) => file.startsWith(`${path}/`))
	return {
		existsSync: (path) => entries.has(path) || isDirectory(path),
		readFileSync(path) {
			const bytes = entries.get(path)
			if (!bytes) throw new Error(`ENOENT ${path}`)
			return bytes
		},
		readdirSync: (path) => [...new Set([...entries.keys()].filter((file) => file.startsWith(`${path}/`)).map((file) => file.slice(path.length + 1).split('/')[0]!))],
		statSync: (path) => ({ isDirectory: () => !entries.has(path) && isDirectory(path) }),
	}
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
const crc32 = (data: Uint8Array) => {
	let c = 0xffffffff
	for (const byte of data) c = CRC_TABLE[(c ^ byte) & 255]! ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

/** A ZIP file; `method` 0 stores the entries and 8 deflates them. */
export function zipOf(files: Files, method: 0 | 8 = 8, comment = ''): Uint8Array {
	const chunks: Uint8Array[] = []
	const central: Uint8Array[] = []
	let offset = 0
	for (const [name, content] of Object.entries(files)) {
		const raw = bytesOf(content)
		const data = method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw
		const nameBytes = encoder.encode(name)
		const header = new DataView(new ArrayBuffer(30))
		header.setUint32(0, 0x04034b50, true)
		header.setUint16(4, 20, true)
		header.setUint16(8, method, true)
		header.setUint32(14, crc32(raw), true)
		header.setUint32(18, data.length, true)
		header.setUint32(22, raw.length, true)
		header.setUint16(26, nameBytes.length, true)
		const entry = new DataView(new ArrayBuffer(46))
		entry.setUint32(0, 0x02014b50, true)
		entry.setUint16(4, 20, true)
		entry.setUint16(6, 20, true)
		entry.setUint16(10, method, true)
		entry.setUint32(16, crc32(raw), true)
		entry.setUint32(20, data.length, true)
		entry.setUint32(24, raw.length, true)
		entry.setUint16(28, nameBytes.length, true)
		entry.setUint32(42, offset, true)
		chunks.push(new Uint8Array(header.buffer), nameBytes, data)
		central.push(new Uint8Array(entry.buffer), nameBytes)
		offset += 30 + nameBytes.length + data.length
	}
	const size = central.reduce((sum, part) => sum + part.length, 0)
	const end = new DataView(new ArrayBuffer(22))
	end.setUint32(0, 0x06054b50, true)
	end.setUint16(8, Object.keys(files).length, true)
	end.setUint16(10, Object.keys(files).length, true)
	end.setUint32(12, size, true)
	end.setUint32(16, offset, true)
	end.setUint16(20, comment.length, true)
	return concat([...chunks, ...central, new Uint8Array(end.buffer), encoder.encode(comment)])
}

const concat = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
	let at = 0
	for (const part of parts) {
		out.set(part, at)
		at += part.length
	}
	return out
}

/**
 * A stand-in for a PNG: `#` is an opaque white pixel and any other character is transparent.
 * The bytes only have to survive `decodeImage` below.
 */
export const image = (...rows: string[]) => `IMG\n${rows.join('\n')}`

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
	const text = new TextDecoder().decode(bytes)
	if (!text.startsWith('IMG\n')) throw new Error('not an image')
	const rows = text.slice(4).split('\n')
	const width = rows[0]!.length
	const data = new Uint8ClampedArray(width * rows.length * 4)
	rows.forEach((row, y) => [...row].forEach((pixel, x) => data.fill(pixel === '#' ? 255 : 0, (y * width + x) * 4, (y * width + x) * 4 + 4)))
	return { width, height: rows.length, data }
}

/**
 * One line of a unifont .hex file: 16 rows of `width` (8, 16, 24 or 32) bits. `rows` maps a row to its pixels
 * (`#` set, `.` clear); the other rows are blank.
 */
export function hexGlyph(codepoint: number, width: number, rows: Record<number, string>): string {
	const digits = Array.from({ length: 16 }, (_, y) => {
		const pixels = (rows[y] ?? '').padEnd(width, '.')
		return parseInt(pixels.replaceAll('#', '1').replaceAll('.', '0'), 2).toString(16).toUpperCase().padStart(width / 4, '0')
	})
	return `${codepoint.toString(16).toUpperCase().padStart(4, '0')}:${digits.join('')}\n`
}

export interface Game {
	/** Under `assets/` in the jar. */
	jar?: Files
	/** Keys of the asset index, like `minecraft/lang/ja_jp.json`. */
	index?: Files
	options?: string
	/** Resource packs by path; a value is the files under `assets/`, or the bytes of a .zip. */
	packs?: Record<string, Files | Uint8Array>
}

export const MINECRAFT_DIR = '/home/.minecraft'

export function installation(game: Game): { fs: ReadFs; resourcePacks: string[] } {
	const files: Files = {
		[`${MINECRAFT_DIR}/versions/1.20.4/1.20.4.json`]: JSON.stringify({ assetIndex: { id: '12' } }),
		[`${MINECRAFT_DIR}/versions/1.20.4/1.20.4.jar`]: zipOf(Object.fromEntries(Object.entries(game.jar ?? {}).map(([path, content]) => [`assets/${path}`, content]))),
	}
	const objects: Record<string, { hash: string }> = {}
	Object.entries(game.index ?? {}).forEach(([path, content], i) => {
		const hash = `${i.toString(16).padStart(2, '0')}${'0'.repeat(38)}`
		objects[path] = { hash }
		files[`${MINECRAFT_DIR}/assets/objects/${hash.slice(0, 2)}/${hash}`] = content
	})
	files[`${MINECRAFT_DIR}/assets/indexes/12.json`] = JSON.stringify({ objects })
	if (game.options !== undefined) files[`${MINECRAFT_DIR}/options.txt`] = game.options
	for (const [path, pack] of Object.entries(game.packs ?? {})) {
		if (pack instanceof Uint8Array) files[path] = pack
		else for (const [file, content] of Object.entries(pack)) files[`${path}/assets/${file}`] = content
	}
	return { fs: memoryFs(files), resourcePacks: Object.keys(game.packs ?? {}) }
}

export async function loadGame(game: Game, resourcePacks?: string[]): Promise<FontLibrary> {
	const { fs, resourcePacks: packs } = installation(game)
	const result = await loadFontLibrary({ fs, sources: { minecraftDir: MINECRAFT_DIR, resourcePacks: resourcePacks ?? packs }, decodeImage })
	if ('error' in result) throw new Error(result.error)
	return result.library
}

export const spec = (text: string, overrides: Partial<TextDisplaySpec> = {}): TextDisplaySpec => ({
	text,
	lineWidth: 200,
	background: 0x40000000,
	defaultBackground: false,
	textOpacity: -1,
	shadow: false,
	alignment: 'center',
	...overrides,
})

export const layout = (library: FontLibrary, text: string, overrides: Partial<TextDisplaySpec> = {}): TextLayout => layoutTextDisplay(library, spec(text, overrides))

export const linesOf = (result: TextLayout) => result.lines.map((line) => line.glyphs.map((glyph) => String.fromCodePoint(glyph.codepoint)).join(''))

const json = (value: unknown) => JSON.stringify(value)
const reference = (id: string) => ({ type: 'reference', id })
const mono = Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map((letter) => [letter, 5]))

/**
 * A miniature vanilla: the default font is the space, bitmap and unihex providers, as in default.json, and the unihex
 * definition is only in the asset index while the jar has an empty one (as with the real 1.20.4 files).
 * Advances: A 4, B 2, C 1, space 4, U+200C 0, a 4, b 5, c 13, d 17, U+00A0 5, hiragana 9. Anything else is missing (6).
 */
export function vanilla(): Game {
	// Three 4x8 cells: A is 3 pixels wide, B 1 pixel and C is empty.
	const sheet = image('#.#.#...' + '....', ...Array<string>(7).fill('.'.repeat(12)))
	return {
		jar: {
			'minecraft/font/default.json': json({
				providers: [
					reference('minecraft:include/space'),
					{ type: 'bitmap', file: 'minecraft:font/test.png', ascent: 7, chars: ['ABC'] },
					reference('minecraft:include/unifont'),
				],
			}),
			'minecraft/font/uniform.json': json({ providers: [reference('minecraft:include/space'), reference('minecraft:include/unifont')] }),
			'minecraft/font/include/space.json': json({ providers: [{ type: 'space', advances: { ' ': 4, '\u200c': 0 } }] }),
			'minecraft/font/include/unifont.json': json({ providers: [] }),
			'minecraft/textures/font/test.png': sheet,
			'minecraft/lang/en_us.json': json({
				'test.hello': 'Hello',
				'test.args': '%s and %2$s then %1$s',
				'test.percent': '100%% sure',
				'test.number': '%d items',
				'test.stray': '50% off',
				'test.unsupported': '%x',
				'test.two': '%s %s',
				'test.only_english': 'English only',
				'key.keyboard.space': 'Space',
				'key.attack': 'Attack/Destroy',
			}),
			'test/font/mono.json': json({ providers: [{ type: 'space', advances: { ...mono, ' ': 4 } }] }),
		},
		index: {
			'minecraft/font/include/unifont.json': json({
				providers: [{ type: 'unihex', hex_file: 'minecraft:font/unifont.zip', size_overrides: [{ from: '\u3041', to: '\u309f', left: 0, right: 15 }] }],
			}),
			'minecraft/font/unifont.zip': zipOf(
				{
					'first.hex':
						hexGlyph(0x61, 8, { 1: '.#......', 5: '.######.' }) +
						hexGlyph(0x62, 16, { 3: '..########......' }) +
						hexGlyph(0x63, 24, { 0: `#${'.'.repeat(22)}#` }) +
						hexGlyph(0x64, 32, { 0: `#${'.'.repeat(30)}#` }) +
						hexGlyph(0x65, 8, { 0: '##' }) +
						hexGlyph(0xa0, 8, {}) +
						hexGlyph(0x3042, 16, { 7: '.###############' }) +
						hexGlyph(0x3044, 16, { 7: '..########......' }),
					'second.hex': hexGlyph(0x65, 8, { 0: '####' }),
					'readme.txt': 'not a glyph file',
				},
				0,
			),
		},
	}
}
