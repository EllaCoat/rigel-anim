import { parseJson, type ResourceStack } from './resources'

export interface ClientOptions {
	lang: string
	/** forceUnicodeFont: Minecraft.selectMainFont renames minecraft:default to minecraft:uniform. */
	forceUnicodeFont: boolean
	/** Options.getBackgroundOpacity(0.25): the text_display default background is black with this alpha. */
	backgroundOpacity: number
	/** `key_key.jump:key.keyboard.space` as `key.jump` -> `key.keyboard.space`. */
	keys: Map<string, string>
}

export const DEFAULT_LANGUAGE = 'en_us'
export const DEFAULT_BACKGROUND_OPACITY = 0.25

/** Options defaults apply when options.txt is missing or a line is absent. */
export function parseOptions(text: string | undefined): ClientOptions {
	const values = new Map<string, string>()
	for (const line of (text ?? '').split(/\r?\n/)) {
		const colon = line.indexOf(':')
		if (colon > 0) values.set(line.slice(0, colon), line.slice(colon + 1))
	}
	const keys = new Map<string, string>()
	for (const [name, value] of values) if (name.startsWith('key_')) keys.set(name.slice(4), value)
	const opacity = Number(values.get('textBackgroundOpacity') ?? 0.5)
	return {
		lang: values.get('lang')?.trim() || DEFAULT_LANGUAGE,
		forceUnicodeFont: values.get('forceUnicodeFont') === 'true',
		backgroundOpacity: values.get('backgroundForChatOnly') === 'false' && Number.isFinite(opacity) ? Math.fround(opacity) : DEFAULT_BACKGROUND_OPACITY,
		keys,
	}
}

/** Language.UNSUPPORTED_FORMAT_PATTERN: `%d` and `%.1f` are read as `%s`. */
const UNSUPPORTED_FORMAT = /%(\d+\$)?[\d.]*[df]/g

/**
 * ClientLanguage.loadFrom: en_us first, then the selected language over it; every namespace, every pack, in stack order.
 */
export async function loadLanguage(stack: ResourceStack, code: string, warn: (message: string) => void): Promise<Map<string, string>> {
	const translations = new Map<string, string>()
	for (const language of code === DEFAULT_LANGUAGE ? [code] : [DEFAULT_LANGUAGE, code]) {
		for (const namespace of stack.namespaces()) {
			for (const layer of stack.layers) {
				const bytes = await layer.read(`${namespace}/lang/${language}.json`)
				if (!bytes) continue
				try {
					const json = parseJson(bytes)
					if (typeof json !== 'object' || json === null) throw new Error('object ではありません')
					for (const [key, value] of Object.entries(json)) {
						if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') translations.set(key, String(value).replace(UNSUPPORTED_FORMAT, '%$1s'))
					}
				} catch (error) {
					warn(`言語ファイル ${namespace}:lang/${language}.json（${layer.name}）を読めません: ${(error as Error).message}`)
				}
			}
		}
	}
	return translations
}
