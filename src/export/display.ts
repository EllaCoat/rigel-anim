import { parseText } from '../font/component'
import { ITEM_DISPLAY_MODES, TEXT_ALIGNMENTS, type DisplaySettings } from './types'

export const RESOURCE_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const BLOCK_STATE = /^([a-z0-9_.-]+:[a-z0-9_./-]+)(?:\[([^\]]*)\])?$/
const PROPERTY = /^([a-z0-9_]+)=([a-z0-9_]+)$/

export function normalizeId(id: string): string {
	const trimmed = id.trim()
	return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
}

// Only the shape: one compound with balanced brackets and closed quotes. Minecraft checks the rest when it loads the function.
export function snbtProblem(snbt: string): string | undefined {
	const s = snbt.trim()
	if (!s.startsWith('{') || !s.endsWith('}')) return '{ } で囲んだ SNBT にしてください。'
	const open: string[] = []
	let quote = ''
	for (let i = 0; i < s.length; i++) {
		const c = s[i]!
		if (quote) {
			if (c === '\\') i++
			else if (c === quote) quote = ''
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === '{' || c === '[') open.push(c === '{' ? '}' : ']')
		else if (c === '}' || c === ']') {
			if (open.pop() !== c) return '括弧の対応が取れていません。'
			if (open.length === 0 && i < s.length - 1) return '全体を 1 つの { } にしてください。'
		}
	}
	if (quote) return '引用符が閉じていません。'
	if (open.length > 0) return '括弧の対応が取れていません。'
	return undefined
}

const inner = (snbt: string) => snbt.trim().slice(1, -1).trim()

// The keys of the outer compound of an SNBT that snbtProblem accepts.
export function topLevelKeys(snbt: string): string[] {
	const s = inner(snbt)
	const keys: string[] = []
	let depth = 0
	let quote = ''
	let start = 0
	let inKey = true
	for (let i = 0; i <= s.length; i++) {
		const c = s[i]
		if (quote) {
			if (c === '\\') i++
			else if (c === quote) quote = ''
			continue
		}
		if (c === '"' || c === "'") quote = c
		else if (c === '{' || c === '[') depth++
		else if (c === '}' || c === ']') depth--
		else if (depth === 0 && inKey && c === ':') {
			keys.push(s.slice(start, i).trim().replace(/^["']|["']$/g, ''))
			inKey = false
		} else if (depth === 0 && (c === ',' || c === undefined)) {
			start = i + 1
			inKey = true
		}
	}
	return keys.filter((k) => k.length > 0)
}

// Keys Rigel writes itself; another value would break the rig or its selection.
const OWN_KEYS = ['id', 'UUID', 'Tags', 'transformation', 'Passengers', 'interpolation_duration', 'teleport_duration']

export function blockStateNbt(block: string): string | undefined {
	const m = BLOCK_STATE.exec(normalizeId(block))
	if (!m) return undefined
	const properties = (m[2] ?? '').split(',').map((p) => p.trim()).filter((p) => p.length > 0)
	const pairs: string[] = []
	for (const p of properties) {
		const pm = PROPERTY.exec(p)
		if (!pm) return undefined
		// Minecraft reads property values only as strings.
		pairs.push(`${pm[1]}:"${pm[2]}"`)
	}
	return `{Name:"${m[1]}"${pairs.length > 0 ? `,Properties:{${pairs.join(',')}}` : ''}}`
}

// Minecraft drops text that does not parse as JSON without an error, keeping the old text.
export function textJson(text: string): string {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch {
		return JSON.stringify(text)
	}
	return typeof value === 'string' || (typeof value === 'object' && value !== null) ? JSON.stringify(value) : JSON.stringify(text)
}

const quoted = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const byte = (v: number) => `${(Math.round(v) << 24) >> 24}b`
const bool = (v: boolean) => (v ? '1b' : '0b')

export function displayProblems(name: string, d: DisplaySettings): string[] {
	const problems: string[] = []
	const at = `display「${name}」`
	if (!d.scale.every((v) => Number.isFinite(v))) problems.push(`${at}: 拡大は数にしてください。`)
	if (d.nbt.trim()) {
		const p = snbtProblem(d.nbt)
		if (p) problems.push(`${at}: 追加の NBT は ${p}`)
		else {
			const own = topLevelKeys(d.nbt).filter((k) => OWN_KEYS.includes(k))
			if (own.length > 0) problems.push(`${at}: 追加の NBT に ${own.join('・')} は書けません（Rigel が書くため）。`)
		}
	}
	if (d.kind === 'block') {
		if (!blockStateNbt(d.block)) problems.push(`${at}: ブロックは minecraft:oak_stairs[facing=east] の形で入力してください。`)
	} else if (d.kind === 'item') {
		if (!RESOURCE_ID.test(normalizeId(d.item))) problems.push(`${at}: item は minecraft:iron_axe のような ID で入力してください。`)
		if (d.tag.trim()) {
			const p = snbtProblem(d.tag)
			if (p) problems.push(`${at}: item の tag は ${p}`)
		}
		if (!ITEM_DISPLAY_MODES.includes(d.mode)) problems.push(`${at}: 表示の型 ${d.mode} は使えません。`)
	} else {
		if (!Number.isInteger(d.lineWidth) || d.lineWidth < 1) problems.push(`${at}: 行の幅は 1 以上の整数にしてください。`)
		if (!Number.isInteger(d.textOpacity) || d.textOpacity < 0 || d.textOpacity > 255) problems.push(`${at}: 文字の不透明度は 0〜255 にしてください。`)
		if (!TEXT_ALIGNMENTS.includes(d.alignment)) problems.push(`${at}: 揃え ${d.alignment} は使えません。`)
		parseText(d.text, (message) => problems.push(`${at}: Minecraft はこのテキストを読めず、文字を表示しません（${message}）。`))
	}
	return problems
}

// The summon compound's keys for the display, without UUID, Tags and the transformation.
export function displayNbt(d: DisplaySettings): string {
	const parts: string[] = []
	if (d.kind === 'block') parts.push('id:"minecraft:block_display"', `block_state:${blockStateNbt(d.block)}`)
	else if (d.kind === 'item') {
		const tag = d.tag.trim() ? `,tag:${d.tag.trim()}` : ''
		parts.push('id:"minecraft:item_display"', `item:{id:"${normalizeId(d.item)}",Count:1b${tag}}`, `item_display:"${d.mode}"`)
	} else
		parts.push(
			'id:"minecraft:text_display"',
			`text:${quoted(textJson(d.text))}`,
			`line_width:${d.lineWidth}`,
			`background:${d.background | 0}`,
			`text_opacity:${byte(d.textOpacity)}`,
			`alignment:"${d.alignment}"`,
			`shadow:${bool(d.shadow)}`,
			`see_through:${bool(d.seeThrough)}`,
			`default_background:${bool(d.defaultBackground)}`,
		)
	const extra = d.nbt.trim() ? inner(d.nbt) : ''
	if (extra) parts.push(extra)
	return parts.join(',')
}
