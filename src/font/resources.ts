import { openZip, type ZipArchive } from './zip'

/** The part of node:fs the font loader reads with; Blockbench's scoped fs has the same shape. */
export interface ReadFs {
	existsSync(path: string): boolean
	readFileSync(path: string): Uint8Array
	readdirSync(path: string): string[]
	statSync(path: string): { isDirectory(): boolean }
}

export interface FontSources {
	/** The .minecraft folder that holds versions/1.20.4 and assets. */
	minecraftDir: string
	/** Resource pack folders or .zip files; later entries win. */
	resourcePacks: string[]
}

/**
 * One source of `assets/`. Paths are relative to the assets root, like `minecraft/font/default.json`.
 */
export interface ResourceLayer {
	readonly name: string
	read(path: string): Promise<Uint8Array | undefined>
	namespaces(): string[]
	/** `namespace:path` of every font definition (`<namespace>/font/**.json`). */
	fontIds(): string[]
}

export const joinPath = (dir: string, path: string) => `${dir.replace(/[\\/]+$/, '')}/${path}`

const FONT_FILE = /^([^/]+)\/font\/(.+)\.json$/

function fontIdsOf(paths: Iterable<string>): string[] {
	const ids: string[] = []
	for (const path of paths) {
		const match = FONT_FILE.exec(path)
		if (match) ids.push(`${match[1]}:${match[2]}`)
	}
	return ids
}

const namespacesOf = (paths: Iterable<string>) => [...new Set([...paths].map((path) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')))].filter(Boolean)

/** TextDecoder drops a leading byte order mark, which Gson accepts too. */
export const parseJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes))

export class DirectoryLayer implements ResourceLayer {
	constructor(
		private readonly fs: ReadFs,
		private readonly dir: string,
		readonly name: string,
	) {}

	async read(path: string) {
		const file = joinPath(this.dir, `assets/${path}`)
		return this.fs.existsSync(file) && !this.fs.statSync(file).isDirectory() ? this.fs.readFileSync(file) : undefined
	}

	namespaces() {
		const root = joinPath(this.dir, 'assets')
		if (!this.fs.existsSync(root)) return []
		return this.fs.readdirSync(root).filter((name) => this.fs.statSync(joinPath(root, name)).isDirectory())
	}

	fontIds() {
		const found: string[] = []
		const walk = (relative: string) => {
			const dir = joinPath(this.dir, `assets/${relative}`)
			if (!this.fs.existsSync(dir)) return
			for (const name of this.fs.readdirSync(dir)) {
				const path = `${relative}/${name}`
				if (this.fs.statSync(joinPath(this.dir, `assets/${path}`)).isDirectory()) walk(path)
				else found.push(path)
			}
		}
		for (const namespace of this.namespaces()) walk(`${namespace}/font`)
		return fontIdsOf(found)
	}
}

export class ZipLayer implements ResourceLayer {
	constructor(
		private readonly archive: ZipArchive,
		readonly name: string,
	) {}

	async read(path: string) {
		const entry = `assets/${path}`
		return this.archive.has(entry) ? this.archive.read(entry) : undefined
	}

	private assetPaths() {
		return this.archive.names.filter((name) => name.startsWith('assets/')).map((name) => name.slice('assets/'.length))
	}

	namespaces() {
		return namespacesOf(this.assetPaths())
	}

	fontIds() {
		return fontIdsOf(this.assetPaths())
	}
}

/** The asset index maps `minecraft/lang/ja_jp.json` and the like to files under `assets/objects`. */
export class IndexLayer implements ResourceLayer {
	readonly name = 'assets index'

	constructor(
		private readonly fs: ReadFs,
		private readonly objectsDir: string,
		private readonly hashes: Map<string, string>,
	) {}

	async read(path: string) {
		const hash = this.hashes.get(path)
		if (!hash) return undefined
		const file = joinPath(this.objectsDir, `${hash.slice(0, 2)}/${hash}`)
		return this.fs.existsSync(file) ? this.fs.readFileSync(file) : undefined
	}

	namespaces() {
		return namespacesOf(this.hashes.keys())
	}

	fontIds() {
		return fontIdsOf(this.hashes.keys())
	}
}

/** ClientPackSource puts the assets index before the jar, so a path that is in both comes from the index. */
export class VanillaLayer implements ResourceLayer {
	readonly name = 'vanilla'

	constructor(private readonly parts: ResourceLayer[]) {}

	async read(path: string) {
		for (const part of this.parts) {
			const bytes = await part.read(path)
			if (bytes) return bytes
		}
		return undefined
	}

	namespaces() {
		return [...new Set(this.parts.flatMap((part) => part.namespaces()))]
	}

	fontIds() {
		return [...new Set(this.parts.flatMap((part) => part.fontIds()))]
	}
}

/** Layers from the lowest priority (vanilla) to the highest. */
export class ResourceStack {
	constructor(readonly layers: ResourceLayer[]) {}

	/** The highest-priority copy, like ResourceManager.getResource. */
	async read(path: string): Promise<Uint8Array | undefined> {
		for (let i = this.layers.length - 1; i >= 0; i--) {
			const bytes = await this.layers[i]!.read(path)
			if (bytes) return bytes
		}
		return undefined
	}

	namespaces(): string[] {
		return [...new Set(this.layers.flatMap((layer) => layer.namespaces()))]
	}

	fontIds(): string[] {
		return [...new Set(this.layers.flatMap((layer) => layer.fontIds()))]
	}
}

/** A resource pack given as a folder or a .zip file. */
export function openPack(fs: ReadFs, path: string): ResourceLayer {
	if (!fs.existsSync(path)) throw new Error('見つかりません')
	return fs.statSync(path).isDirectory() ? new DirectoryLayer(fs, path, path) : new ZipLayer(openZip(fs.readFileSync(path)), path)
}
