import { FontSet, loadFontSets } from './fontset'
import { loadLanguage, parseOptions, type ClientOptions } from './options'
import type { DecodeImage } from './providers'
import { IndexLayer, joinPath, openPack, parseJson, ResourceStack, VanillaLayer, ZipLayer, type FontSources, type ReadFs, type ResourceLayer } from './resources'
import { DEFAULT_FONT } from './style'
import { openZip } from './zip'

const GAME_VERSION = '1.20.4'
const UNIFORM_FONT = 'minecraft:uniform'

export interface FontLibrary {
	/** Things that could not be loaded; the library still works without them. */
	readonly warnings: readonly string[]
	/** The font a style names. FontManager.createFont: an unknown font is all missing glyphs. */
	fontSet(id: string | undefined): FontSet
	/** The text for a translation key, if the language has one. */
	translate(key: string): string | undefined
	/** The name of the key a key binding is bound to, like Options.keyBinds shows it. */
	keybind(name: string): string
	/** Alpha (0 to 1) of the text_display background when `default_background` is set. */
	readonly backgroundOpacity: number
}

export interface LoadOptions {
	fs: ReadFs
	sources: FontSources
	decodeImage: DecodeImage
}

export type LibraryResult = { library: FontLibrary } | { error: string }

function readIndex(fs: ReadFs, assets: string, id: string): IndexLayer | undefined {
	const file = joinPath(assets, `indexes/${id}.json`)
	if (!fs.existsSync(file)) return undefined
	const objects = (parseJson(fs.readFileSync(file)) as { objects?: Record<string, { hash?: unknown }> }).objects ?? {}
	const hashes = new Map<string, string>()
	for (const [path, object] of Object.entries(objects)) if (typeof object.hash === 'string') hashes.set(path, object.hash)
	return new IndexLayer(fs, joinPath(assets, 'objects'), hashes)
}

/**
 * Reads the vanilla jar and asset index of `minecraftDir` and the resource packs over them, the way the client stacks them.
 */
export async function loadFontLibrary({ fs, sources, decodeImage }: LoadOptions): Promise<LibraryResult> {
	const { minecraftDir } = sources
	if (!fs.existsSync(minecraftDir)) return { error: `.minecraft フォルダが見つかりません: ${minecraftDir}` }
	const versionDir = joinPath(minecraftDir, `versions/${GAME_VERSION}`)
	const jarFile = joinPath(versionDir, `${GAME_VERSION}.jar`)
	if (!fs.existsSync(jarFile)) return { error: `Minecraft ${GAME_VERSION} の jar が見つかりません: ${jarFile}` }

	const warnings: string[] = []
	const warn = (message: string) => warnings.push(message)
	const vanilla: ResourceLayer[] = []
	try {
		const versionFile = joinPath(versionDir, `${GAME_VERSION}.json`)
		const indexId = fs.existsSync(versionFile) ? (parseJson(fs.readFileSync(versionFile)) as { assetIndex?: { id?: unknown } }).assetIndex?.id : undefined
		const index = typeof indexId === 'string' ? readIndex(fs, joinPath(minecraftDir, 'assets'), indexId) : undefined
		if (index) vanilla.push(index)
		else warn('アセット索引が見つからないため、日本語など jar にないフォントと言語は読めません')
		vanilla.push(new ZipLayer(openZip(fs.readFileSync(jarFile)), jarFile))
	} catch (error) {
		return { error: `Minecraft ${GAME_VERSION} のファイルを読めません: ${(error as Error).message}` }
	}

	const layers: ResourceLayer[] = [new VanillaLayer(vanilla)]
	for (const pack of sources.resourcePacks) {
		try {
			layers.push(openPack(fs, pack))
		} catch (error) {
			warn(`リソースパック ${pack} を読めません: ${(error as Error).message}`)
		}
	}
	const stack = new ResourceStack(layers)

	const optionsFile = joinPath(minecraftDir, 'options.txt')
	const options = parseOptions(fs.existsSync(optionsFile) ? new TextDecoder().decode(fs.readFileSync(optionsFile)) : undefined)
	const [fonts, translations] = await Promise.all([loadFontSets({ stack, decodeImage }, warn), loadLanguage(stack, options.lang, warn)])
	return { library: createLibrary(fonts, translations, options, warnings) }
}

function createLibrary(fonts: Map<string, FontSet>, translations: Map<string, string>, options: ClientOptions, warnings: string[]): FontLibrary {
	const missing = new FontSet([])
	return {
		warnings,
		fontSet(id = DEFAULT_FONT) {
			const renamed = options.forceUnicodeFont && id === DEFAULT_FONT ? UNIFORM_FONT : id
			return fonts.get(renamed) ?? missing
		},
		translate: (key) => translations.get(key),
		keybind(name) {
			const key = options.keys.get(name)
			return key === undefined ? (translations.get(name) ?? name) : (translations.get(key) ?? key)
		},
		backgroundOpacity: options.backgroundOpacity,
	}
}
