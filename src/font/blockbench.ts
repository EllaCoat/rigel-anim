import { loadFontLibrary, type LibraryResult } from './library'
import type { DecodedImage } from './providers'
import type { FontSources, ReadFs } from './resources'

export const MINECRAFT_DIR_SETTING = 'rigel_font_minecraft_dir'
export const RESOURCE_PACKS_SETTING = 'rigel_font_resource_packs'

let registered: Setting[] = []
let cached: { key: string; result: Promise<LibraryResult> } | undefined

/** The default .minecraft folder of the platform Blockbench runs on; empty when that is unknown. */
export function defaultMinecraftDir(): string {
	if (typeof SystemInfo === 'undefined') return ''
	const { platform, appdata_directory, home_directory } = SystemInfo
	if (platform === 'win32') return `${appdata_directory}\\.minecraft`
	return platform === 'darwin' ? `${home_directory}/Library/Application Support/minecraft` : `${home_directory}/.minecraft`
}

// onChange: called after a setting changes, once the next getFontLibrary reads the new settings.
export function registerFontSettings(onChange?: () => void): void {
	const reset = () => {
		cached = undefined
		onChange?.()
	}
	registered = [
		new Setting(MINECRAFT_DIR_SETTING, {
			name: 'text_display のプレビュー：.minecraft の場所',
			description: 'Minecraft 1.20.4 の jar とアセットを読み、text_display のテキストを Minecraft のフォントで描きます。',
			type: 'text',
			category: 'preview',
			value: defaultMinecraftDir(),
			onChange: reset,
		}),
		new Setting(RESOURCE_PACKS_SETTING, {
			name: 'text_display のプレビュー：フォントを読むリソースパック',
			description: 'フォルダまたは .zip のパスを ; で区切って並べます。後ろに書いたものほど優先されます。',
			type: 'text',
			category: 'preview',
			value: '',
			onChange: reset,
		}),
	]
}

export function unregisterFontSettings(): void {
	for (const setting of registered) setting.delete()
	registered = []
	cached = undefined
}

const unquote = (path: string) => path.trim().replace(/^"(.*)"$/, '$1').trim()

export function readFontSources(): FontSources {
	const text = (id: string) => String(settings[id]?.value ?? '')
	return {
		minecraftDir: unquote(text(MINECRAFT_DIR_SETTING)) || defaultMinecraftDir(),
		resourcePacks: text(RESOURCE_PACKS_SETTING).split(';').map(unquote).filter(Boolean),
	}
}

const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Blockbench asks the user once for each path (a folder or a .zip), and its scoped fs refuses any other path. */
function scopedReadFs(paths: string[]): ReadFs | string {
	const scopes: { scope: string; fs: ScopedFS }[] = []
	for (const path of paths) {
		const fs = requireNativeModule('fs', { scope: path, message: 'text_display のプレビューで、Minecraft のフォントを読むためです。' })
		if (!fs) return `${path} を読むことが許可されなかったため、Minecraft のフォントを使えません。`
		scopes.push({ scope: normalize(path), fs })
	}
	const pick = (path: string) => {
		const target = normalize(path)
		const owner = scopes.filter(({ scope }) => target === scope || target.startsWith(`${scope}/`)).sort((a, b) => b.scope.length - a.scope.length)[0]
		return (owner ?? scopes[0]!).fs
	}
	return {
		existsSync: (path) => pick(path).existsSync(path),
		readFileSync: (path) => pick(path).readFileSync(path),
		readdirSync: (path) => pick(path).readdirSync(path),
		statSync: (path) => pick(path).statSync(path),
	}
}

async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
	const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
	try {
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width
		canvas.height = bitmap.height
		const context = canvas.getContext('2d', { willReadFrequently: true })!
		context.drawImage(bitmap, 0, 0)
		return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data }
	} finally {
		bitmap.close()
	}
}

// denied: the user refused the permission dialog, which would otherwise come back on every preview refresh.
async function load(sources: FontSources): Promise<LibraryResult & { denied?: true }> {
	try {
		const fs = scopedReadFs([sources.minecraftDir, ...sources.resourcePacks])
		if (typeof fs === 'string') return { error: fs, denied: true }
		return await loadFontLibrary({ fs, sources, decodeImage: decodePng })
	} catch (error) {
		return { error: `Minecraft のフォントを読めませんでした: ${(error as Error).message}` }
	}
}

/**
 * The font library for the current settings. It is loaded once and reused until a setting changes. A failure is
 * returned with its reason and tried again on the next call, except a refused permission, which waits for a setting change.
 */
export function getFontLibrary(): Promise<LibraryResult> {
	const sources = readFontSources()
	const key = JSON.stringify(sources)
	let entry = cached
	if (entry?.key !== key) {
		const result = load(sources)
		entry = { key, result }
		cached = entry
		void result.then((loaded) => {
			if ('error' in loaded && !('denied' in loaded) && cached === entry) cached = undefined
		})
	}
	return entry.result
}
