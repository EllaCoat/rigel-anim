/** Style of net.minecraft.network.chat: a field left undefined is inherited from the parent. */
export interface Style {
	color?: number
	bold?: boolean
	italic?: boolean
	underlined?: boolean
	strikethrough?: boolean
	obfuscated?: boolean
	font?: string
}

export const EMPTY_STYLE: Style = {}
export const DEFAULT_FONT = 'minecraft:default'

/** ChatFormatting colors by name and by `§` code. */
const COLORS: Record<string, { code: string; rgb: number }> = {
	black: { code: '0', rgb: 0x000000 },
	dark_blue: { code: '1', rgb: 0x0000aa },
	dark_green: { code: '2', rgb: 0x00aa00 },
	dark_aqua: { code: '3', rgb: 0x00aaaa },
	dark_red: { code: '4', rgb: 0xaa0000 },
	dark_purple: { code: '5', rgb: 0xaa00aa },
	gold: { code: '6', rgb: 0xffaa00 },
	gray: { code: '7', rgb: 0xaaaaaa },
	dark_gray: { code: '8', rgb: 0x555555 },
	blue: { code: '9', rgb: 0x5555ff },
	green: { code: 'a', rgb: 0x55ff55 },
	aqua: { code: 'b', rgb: 0x55ffff },
	red: { code: 'c', rgb: 0xff5555 },
	light_purple: { code: 'd', rgb: 0xff55ff },
	yellow: { code: 'e', rgb: 0xffff55 },
	white: { code: 'f', rgb: 0xffffff },
}
const COLOR_BY_CODE = new Map(Object.values(COLORS).map(({ code, rgb }) => [code, rgb]))

/** TextColor.parseColor: a color name or `#` and up to six hex digits; undefined when it is neither. */
export function parseColor(value: string): number | undefined {
	if (value.startsWith('#')) return /^#[0-9a-f]{1,6}$/i.test(value) ? parseInt(value.slice(1), 16) : undefined
	return COLORS[value]?.rgb
}

export const isBold = (style: Style) => style.bold === true
export const isItalic = (style: Style) => style.italic === true

/** Style.applyTo: the fields of `style` win over `parent`. */
export function applyTo(style: Style, parent: Style): Style {
	return {
		color: style.color ?? parent.color,
		bold: style.bold ?? parent.bold,
		italic: style.italic ?? parent.italic,
		underlined: style.underlined ?? parent.underlined,
		strikethrough: style.strikethrough ?? parent.strikethrough,
		obfuscated: style.obfuscated ?? parent.obfuscated,
		font: style.font ?? parent.font,
	}
}

/** The style after `§` and a code, as StringDecomposer.iterateFormatted applies it; an unknown code changes nothing. */
export function applyLegacyFormat(style: Style, code: string, reset: Style): Style {
	const lower = code.toLowerCase()
	switch (lower) {
		case 'k':
			return { ...style, obfuscated: true }
		case 'l':
			return { ...style, bold: true }
		case 'm':
			return { ...style, strikethrough: true }
		case 'n':
			return { ...style, underlined: true }
		case 'o':
			return { ...style, italic: true }
		case 'r':
			return reset
	}
	const color = COLOR_BY_CODE.get(lower)
	return color === undefined ? style : { ...style, color, obfuscated: false, bold: false, strikethrough: false, underlined: false, italic: false }
}
