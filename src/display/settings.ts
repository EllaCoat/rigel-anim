import type { Vec3 } from '../bake/matrix'
import { ITEM_DISPLAY_MODES, TEXT_ALIGNMENTS, type DisplaySettings, type ItemDisplayMode, type TextAlignment } from '../export/types'
import { FORMAT_ID } from '../format'

export type DisplayKind = DisplaySettings['kind']
export const DISPLAY_KINDS: readonly DisplayKind[] = ['block', 'item', 'text']

const KEY = 'rigel_display'
// Minecraft's defaults for a text_display.
export const DEFAULT_BACKGROUND = 0x40000000
export const DEFAULT_LINE_WIDTH = 200

let property: Deletable | undefined

export function registerDisplaySettings(): void {
	property = new Property(Group, 'object', KEY, { condition: { formats: [FORMAT_ID] }, exposed: false, default: {} })
}

export function unregisterDisplaySettings(): void {
	property?.delete()
	property = undefined
}

export function defaultDisplay(kind: DisplayKind): DisplaySettings {
	const common = { scale: [1, 1, 1] as Vec3, nbt: '' }
	if (kind === 'block') return { ...common, kind, block: 'minecraft:stone' }
	if (kind === 'item') return { ...common, kind, item: 'minecraft:iron_sword', tag: '', mode: 'none' }
	return {
		...common,
		kind,
		text: 'Text',
		lineWidth: DEFAULT_LINE_WIDTH,
		background: DEFAULT_BACKGROUND,
		defaultBackground: false,
		textOpacity: 255,
		shadow: false,
		seeThrough: false,
		alignment: 'center',
	}
}

type Bag = Record<string, unknown>
const pick = <T>(bag: Bag, key: string, ok: (v: unknown) => boolean, fallback: T): T => (ok(bag[key]) ? (bag[key] as T) : fallback)
const isString = (v: unknown) => typeof v === 'string'
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isBoolean = (v: unknown) => typeof v === 'boolean'
const isScale = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(isNumber)

export function readDisplay(group: Group): DisplaySettings | undefined {
	const bag = (group as unknown as Bag)[KEY]
	if (typeof bag !== 'object' || bag === null) return undefined
	const b = bag as Bag
	const kind = b.kind
	if (!DISPLAY_KINDS.includes(kind as DisplayKind)) return undefined
	const d = defaultDisplay(kind as DisplayKind)
	const scale = pick<Vec3>(b, 'scale', isScale, d.scale)
	const nbt = pick(b, 'nbt', isString, d.nbt)
	if (d.kind === 'block') return { ...d, scale: [...scale], nbt, block: pick(b, 'block', isString, d.block) }
	if (d.kind === 'item')
		return {
			...d,
			scale: [...scale],
			nbt,
			item: pick(b, 'item', isString, d.item),
			tag: pick(b, 'tag', isString, d.tag),
			mode: pick<ItemDisplayMode>(b, 'mode', (v) => ITEM_DISPLAY_MODES.includes(v as ItemDisplayMode), d.mode),
		}
	return {
		...d,
		scale: [...scale],
		nbt,
		text: pick(b, 'text', isString, d.text),
		lineWidth: pick(b, 'lineWidth', isNumber, d.lineWidth),
		background: pick(b, 'background', isNumber, d.background),
		defaultBackground: pick(b, 'defaultBackground', isBoolean, d.defaultBackground),
		textOpacity: pick(b, 'textOpacity', isNumber, d.textOpacity),
		shadow: pick(b, 'shadow', isBoolean, d.shadow),
		seeThrough: pick(b, 'seeThrough', isBoolean, d.seeThrough),
		alignment: pick<TextAlignment>(b, 'alignment', (v) => TEXT_ALIGNMENTS.includes(v as TextAlignment), d.alignment),
	}
}

export function writeDisplay(group: Group, display: DisplaySettings | undefined): void {
	;(group as unknown as Bag)[KEY] = display ? JSON.parse(JSON.stringify(display)) : {}
}
