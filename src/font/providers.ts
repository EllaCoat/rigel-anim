import { LazyGlyph, type BakedGlyph, type GlyphInfo, type GlyphProvider } from './glyph'
import type { ResourceStack } from './resources'
import { openZip } from './zip'

export interface DecodedImage {
	width: number
	height: number
	/** RGBA, 4 bytes per pixel, not premultiplied. */
	data: Uint8ClampedArray
}
export type DecodeImage = (png: Uint8Array) => Promise<DecodedImage>

export interface LoadContext {
	stack: ResourceStack
	decodeImage: DecodeImage
}

interface ResourceId {
	namespace: string
	path: string
}
interface SizeOverride {
	from: number
	to: number
	left: number
	right: number
}

export type ProviderDefinition =
	| { type: 'bitmap'; file: ResourceId; height: number; ascent: number; grid: number[][] }
	| { type: 'space'; advances: Map<number, number> }
	| { type: 'unihex'; hexFile: ResourceId; overrides: SizeOverride[] }
	| { type: 'reference'; id: string }
	| { type: 'unsupported'; name: string }

type Json = Record<string, unknown>

function resourceId(value: unknown, field: string): ResourceId {
	if (typeof value !== 'string') throw new Error(`${field} は文字列で指定します`)
	const colon = value.indexOf(':')
	const namespace = (colon < 0 ? '' : value.slice(0, colon)) || 'minecraft'
	const path = colon < 0 ? value : value.slice(colon + 1)
	if (!/^[a-z0-9_.-]+$/.test(namespace) || !/^[a-z0-9/._-]+$/.test(path)) throw new Error(`${field} が資源の ID として正しくありません: ${value}`)
	return { namespace, path }
}

function int(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} は数で指定します`)
	return Math.trunc(value)
}

function codepoint(value: unknown, field: string): number {
	const points = typeof value === 'string' ? Array.from(value) : []
	if (points.length !== 1) throw new Error(`${field} は 1 文字で指定します: ${String(value)}`)
	return points[0]!.codePointAt(0)!
}

const asObject = (value: unknown, field: string): Json => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} は object で指定します`)
	return value as Json
}

/** The decoders of BitmapProvider, SpaceProvider, UnihexProvider and ProviderReferenceDefinition. */
export function parseProvider(value: unknown): ProviderDefinition {
	const json = asObject(value, 'provider')
	const type = json.type
	if (type === 'ttf' || type === 'legacy_unicode') return { type: 'unsupported', name: type }
	if (type === 'reference') {
		const id = resourceId(json.id, 'id')
		return { type, id: `${id.namespace}:${id.path}` }
	}
	if (type === 'space') {
		const advances = new Map<number, number>()
		for (const [key, advance] of Object.entries(asObject(json.advances, 'advances'))) {
			if (typeof advance !== 'number') throw new Error(`advances の値は数で指定します: ${key}`)
			advances.set(codepoint(key, 'advances のキー'), Math.fround(advance))
		}
		return { type, advances }
	}
	if (type === 'bitmap') {
		const height = json.height === undefined ? 8 : int(json.height, 'height')
		const ascent = int(json.ascent, 'ascent')
		if (!Array.isArray(json.chars) || json.chars.length === 0) throw new Error('chars に文字の表がありません')
		const grid = json.chars.map((row) => Array.from(typeof row === 'string' ? row : '', (ch) => ch.codePointAt(0)!))
		if (grid[0]!.length === 0) throw new Error('chars に文字の表がありません')
		if (grid.some((row) => row.length !== grid[0]!.length)) throw new Error('chars の各行は同じ文字数にしてください')
		if (ascent > height) throw new Error(`ascent ${ascent} が height ${height} より大きいです`)
		return { type, file: resourceId(json.file, 'file'), height, ascent, grid }
	}
	if (type === 'unihex') {
		if (!Array.isArray(json.size_overrides)) throw new Error('size_overrides がありません')
		const overrides = json.size_overrides.map((item): SizeOverride => {
			const range = asObject(item, 'size_overrides の要素')
			const override = { from: codepoint(range.from, 'from'), to: codepoint(range.to, 'to'), left: int(range.left, 'left'), right: int(range.right, 'right') }
			if (override.from >= override.to) throw new Error(`size_overrides の範囲が正しくありません: ${override.from}-${override.to}`)
			return override
		})
		return { type, hexFile: resourceId(json.hex_file, 'hex_file'), overrides }
	}
	throw new Error(`provider の type が正しくありません: ${String(type)}`)
}

class MapProvider implements GlyphProvider {
	constructor(private readonly glyphs: Map<number, GlyphInfo>) {}
	glyph(codepoint: number) {
		return this.glyphs.get(codepoint)
	}
}

const readResource = async (stack: ResourceStack, id: ResourceId, prefix: string) => {
	const path = `${id.namespace}/${prefix}${id.path}`
	const bytes = await stack.read(path)
	if (!bytes) throw new Error(`${path} が見つかりません`)
	return bytes
}

class BitmapGlyph extends LazyGlyph {
	readonly boldOffset = 1
	readonly shadowOffset = 1

	constructor(
		readonly advance: number,
		private readonly sheet: DecodedImage,
		private readonly x: number,
		private readonly y: number,
		private readonly width: number,
		private readonly height: number,
		private readonly scale: number,
		private readonly ascent: number,
		private readonly fontHeight: number,
	) {
		super()
	}

	protected render(): BakedGlyph {
		const rgba = new Uint8ClampedArray(this.width * this.height * 4)
		for (let row = 0; row < this.height; row++) {
			const from = ((this.y + row) * this.sheet.width + this.x) * 4
			rgba.set(this.sheet.data.subarray(from, from + this.width * 4), row * this.width * 4)
		}
		const top = 7 - this.ascent
		return { width: this.width, height: this.height, rgba, left: 0, right: this.width * this.scale, top, bottom: top + this.fontHeight }
	}
}

async function loadBitmap(def: Extract<ProviderDefinition, { type: 'bitmap' }>, ctx: LoadContext): Promise<GlyphProvider> {
	const sheet = await ctx.decodeImage(await readResource(ctx.stack, def.file, 'textures/'))
	const cellWidth = Math.floor(sheet.width / def.grid[0]!.length)
	const cellHeight = Math.floor(sheet.height / def.grid.length)
	if (cellWidth < 1 || cellHeight < 1) throw new Error('画像が chars の表より小さいです')
	const scale = Math.fround(def.height / cellHeight)
	const glyphs = new Map<number, GlyphInfo>()
	def.grid.forEach((row, r) =>
		row.forEach((point, c) => {
			if (point === 0) return
			let used = 0
			for (let x = cellWidth - 1; x >= 0 && used === 0; x--) {
				for (let y = 0; y < cellHeight; y++) {
					if (sheet.data[((r * cellHeight + y) * sheet.width + c * cellWidth + x) * 4 + 3] !== 0) {
						used = x + 1
						break
					}
				}
			}
			const advance = Math.trunc(0.5 + Math.fround(used * scale)) + 1
			glyphs.set(point, new BitmapGlyph(advance, sheet, c * cellWidth, r * cellHeight, cellWidth, cellHeight, scale, def.ascent, def.height))
		}),
	)
	return new MapProvider(glyphs)
}

function loadSpace(def: Extract<ProviderDefinition, { type: 'space' }>): GlyphProvider {
	const glyphs = new Map<number, GlyphInfo>()
	for (const [point, advance] of def.advances) glyphs.set(point, { advance, boldOffset: 1, shadowOffset: 1, bake: () => undefined })
	return new MapProvider(glyphs)
}

/** One unifont glyph: 16 rows of up to 32 bits, aligned to the top bit like UnihexProvider's LineData. */
interface HexRows {
	rows: Int32Array
	bitWidth: number
}

class UnihexGlyph extends LazyGlyph {
	readonly boldOffset = 0.5
	readonly shadowOffset = 0.5
	readonly advance: number

	constructor(
		private readonly rows: Int32Array,
		private readonly left: number,
		private readonly right: number,
	) {
		super()
		this.advance = Math.trunc((right - left + 1) / 2) + 1
	}

	protected render(): BakedGlyph | undefined {
		const width = this.right - this.left + 1
		if (width < 1) return undefined
		const rgba = new Uint8ClampedArray(width * 16 * 4)
		for (let y = 0; y < 16; y++) {
			for (let x = 0; x < width; x++) {
				const bit = 31 - (this.left + x)
				if (bit >= 0 && bit < 32 && (this.rows[y]! >> bit) & 1) rgba.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4)
			}
		}
		return { width, height: 16, rgba, left: 0, right: width / 2, top: 0, bottom: 8 }
	}
}

function hexDigit(code: number, line: number): number {
	if (code >= 48 && code <= 57) return code - 48
	if (code >= 65 && code <= 70) return code - 55
	throw new Error(`${line + 1} 件目: 16 進数の数字ではありません`)
}

/** UnihexProvider.readFromStream: `XXXX:` followed by 32, 64, 96 or 128 hex digits per glyph, one glyph per line. */
function readHexFile(bytes: Uint8Array, out: Map<number, HexRows>): void {
	let pos = 0
	for (let entry = 0; ; entry++) {
		let start = pos
		while (pos < bytes.length && bytes[pos] !== 58) pos++
		const digits = pos - start
		if (digits === 0 && pos >= bytes.length) return
		if (pos >= bytes.length || (digits !== 4 && digits !== 5 && digits !== 6)) throw new Error(`${entry + 1} 件目: コードポイントが 4〜6 桁の 16 進数ではありません`)
		let point = 0
		for (let i = start; i < pos; i++) point = (point << 4) | hexDigit(bytes[i]!, entry)
		start = ++pos
		while (pos < bytes.length && bytes[pos] !== 10) pos++
		const length = pos - start
		pos++
		if (length !== 32 && length !== 64 && length !== 96 && length !== 128) throw new Error(`${entry + 1} 件目: 字形が 8・16・24・32 × 16 のどれでもありません`)
		const rows = new Int32Array(16)
		const perRow = length / 16
		for (let y = 0; y < 16; y++) {
			let row = 0
			for (let i = 0; i < perRow; i++) row = (row << 4) | hexDigit(bytes[start + y * perRow + i]!, entry)
			rows[y] = row << (32 - perRow * 4)
		}
		out.set(point, { rows, bitWidth: length / 4 })
	}
}

async function loadUnihex(def: Extract<ProviderDefinition, { type: 'unihex' }>, ctx: LoadContext): Promise<GlyphProvider> {
	const archive = openZip(await readResource(ctx.stack, def.hexFile, ''))
	const raw = new Map<number, HexRows>()
	for (const name of archive.names) if (name.endsWith('.hex')) readHexFile(await archive.read(name), raw)

	const glyphs = new Map<number, GlyphInfo>()
	for (const { from, to, left, right } of def.overrides) {
		for (let point = from; point <= to; point++) {
			const hex = raw.get(point)
			if (!hex) continue
			raw.delete(point)
			glyphs.set(point, new UnihexGlyph(hex.rows, left, right))
		}
	}
	for (const [point, { rows, bitWidth }] of raw) {
		let mask = 0
		for (const row of rows) mask |= row
		const left = mask === 0 ? 0 : Math.clz32(mask)
		const right = mask === 0 ? bitWidth : Math.clz32(mask & -mask)
		glyphs.set(point, new UnihexGlyph(rows, left, right))
	}
	return new MapProvider(glyphs)
}

export function loadProvider(def: Exclude<ProviderDefinition, { type: 'reference' | 'unsupported' }>, ctx: LoadContext): Promise<GlyphProvider> {
	switch (def.type) {
		case 'bitmap':
			return loadBitmap(def, ctx)
		case 'space':
			return Promise.resolve(loadSpace(def))
		case 'unihex':
			return loadUnihex(def, ctx)
	}
}
