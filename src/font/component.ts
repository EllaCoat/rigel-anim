import { applyTo, EMPTY_STYLE, parseColor, type Style } from './style'

/** The pieces of FormattedText: a string and the style it is drawn with. */
export interface TextPart {
	text: string
	style: Style
}

type Content = { kind: 'text'; text: string } | { kind: 'translate'; key: string; fallback?: string; args: (string | Component)[] } | { kind: 'keybind'; name: string }

interface Component {
	content: Content
	style: Style
	extra: Component[]
}

/** What flattening needs from the language and the key bindings. */
export interface Texts {
	translate(key: string): string | undefined
	keybind(name: string): string
}

type Json = Record<string, unknown>

const literal = (text: string): Component => ({ content: { kind: 'text', text }, style: EMPTY_STYLE, extra: [] })
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** JsonOps reads a number where a string is expected. */
const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined)

function parseStyle(json: Json, warn: (message: string) => void): Style {
	const style: Style = {}
	if (json.color !== undefined) {
		const color = typeof json.color === 'string' ? parseColor(json.color) : undefined
		if (color === undefined) warn(`color が正しくありません: ${JSON.stringify(json.color)}`)
		else style.color = color
	}
	for (const field of ['bold', 'italic', 'underlined', 'strikethrough', 'obfuscated'] as const) {
		const value = json[field]
		if (value === undefined) continue
		if (typeof value === 'boolean') style[field] = value
		else if (typeof value === 'number') style[field] = value !== 0
		else warn(`${field} が正しくありません: ${JSON.stringify(value)}`)
	}
	if (json.font !== undefined) {
		const match = typeof json.font === 'string' ? /^(?:([a-z0-9_.-]*):)?([a-z0-9/._-]+)$/.exec(json.font) : null
		if (match) style.font = `${match[1] || 'minecraft'}:${match[2]}`
		else warn(`font が正しくありません: ${JSON.stringify(json.font)}`)
	}
	return style
}

function parseContent(json: Json, warn: (message: string) => void): Content {
	// ComponentSerialization: an explicit "type" picks the codec, otherwise the first one whose fields are all there.
	const type = json.type
	const pick = (name: string, field: string) => (type === undefined ? json[field] !== undefined : type === name)

	if (pick('text', 'text')) {
		const text = stringValue(json.text)
		if (text !== undefined) return { kind: 'text', text }
	}
	if (pick('translatable', 'translate') && typeof json.translate === 'string') {
		const args: (string | Component)[] = []
		if (json.with !== undefined) {
			if (Array.isArray(json.with)) {
				for (const arg of json.with) {
					if (isObject(arg) || Array.isArray(arg)) args.push(parseComponent(arg, warn))
					else args.push(String(arg))
				}
			} else warn('with は配列で指定します')
		}
		return { kind: 'translate', key: json.translate, fallback: typeof json.fallback === 'string' ? json.fallback : undefined, args }
	}
	if (pick('keybind', 'keybind') && typeof json.keybind === 'string') return { kind: 'keybind', name: json.keybind }
	// The server resolves these when the entity is created; the preview shows what they refer to.
	if (pick('score', 'score') && isObject(json.score) && typeof json.score.name === 'string' && typeof json.score.objective === 'string') {
		return { kind: 'text', text: `[score:${json.score.name}/${json.score.objective}]` }
	}
	if (pick('selector', 'selector') && typeof json.selector === 'string') return { kind: 'text', text: `[selector:${json.selector}]` }
	if (pick('nbt', 'nbt') && typeof json.nbt === 'string') return { kind: 'text', text: `[nbt:${json.nbt}]` }
	warn('text・translate・keybind・score・selector・nbt のどれも指定されていない要素があります')
	return { kind: 'text', text: '' }
}

function parseComponent(value: unknown, warn: (message: string) => void): Component {
	const text = stringValue(value)
	if (text !== undefined) return literal(text)
	if (Array.isArray(value)) {
		// createFromList: the first element is the parent of the rest.
		if (value.length === 0) {
			warn('空の配列は要素として使えません')
			return literal('')
		}
		const [first, ...rest] = value.map((item) => parseComponent(item, warn))
		return { ...first!, extra: [...first!.extra, ...rest] }
	}
	if (!isObject(value)) {
		warn(`テキストとして読めない値があります: ${JSON.stringify(value)}`)
		return literal('')
	}
	let extra: Component[] = []
	if (value.extra !== undefined) {
		if (Array.isArray(value.extra) && value.extra.length > 0) extra = value.extra.map((item) => parseComponent(item, warn))
		else warn('extra は空でない配列で指定します')
	}
	return { content: parseContent(value, warn), style: parseStyle(value, warn), extra }
}

/** The text of a text_display. Anything that is not a JSON text component is shown as it is. */
export function parseText(input: string, warn: (message: string) => void): Component {
	let value: unknown
	try {
		value = JSON.parse(input)
	} catch {
		return literal(input)
	}
	if (typeof value === 'string' || Array.isArray(value) || isObject(value)) return parseComponent(value, warn)
	return literal(input)
}

const FORMAT_PATTERN = /%(?:(\d+)\$)?([A-Za-z%]|$)/g

/** TranslatableContents.decomposeTemplate; a template that does not fit its arguments is shown unformatted. */
function decompose(template: string, args: (string | Component)[]): (string | Component)[] {
	const parts: (string | Component)[] = []
	const pattern = new RegExp(FORMAT_PATTERN)
	let next = 0
	let position = 0
	const argument = (index: number) => {
		const arg = args[index]
		if (index < 0 || arg === undefined) throw new Error('missing argument')
		return arg
	}
	const plain = (text: string) => {
		if (text.includes('%')) throw new Error('stray percent')
		parts.push(text)
	}
	try {
		for (;;) {
			pattern.lastIndex = position
			const match = pattern.exec(template)
			if (!match) break
			if (match.index > position) plain(template.slice(position, match.index))
			if (match[2] === '%' && match[0] === '%%') parts.push('%')
			else {
				if (match[2] !== 's') throw new Error('unsupported format')
				parts.push(argument(match[1] !== undefined ? parseInt(match[1], 10) - 1 : next++))
			}
			position = match.index + match[0].length
		}
		if (position < template.length) plain(template.slice(position))
		return parts
	} catch {
		return [template]
	}
}

/** Component.visit: every string with the style it ends up with, siblings and arguments inheriting from their parent. */
export function flatten(component: Component, texts: Texts, parent: Style = EMPTY_STYLE, out: TextPart[] = []): TextPart[] {
	const style = applyTo(component.style, parent)
	const content = component.content
	if (content.kind === 'text') out.push({ text: content.text, style })
	else if (content.kind === 'keybind') out.push({ text: texts.keybind(content.name), style })
	else {
		const template = content.fallback !== undefined ? (texts.translate(content.key) ?? content.fallback) : (texts.translate(content.key) ?? content.key)
		for (const part of decompose(template, content.args)) {
			if (typeof part === 'string') out.push({ text: part, style })
			else flatten(part, texts, style, out)
		}
	}
	for (const child of component.extra) flatten(child, texts, style, out)
	return out
}
