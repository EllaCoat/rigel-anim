import { buildExport, ExportError } from './build'
import { COMMON_PACK, hexId, MARKER } from './datapack'
import { itemModelPath, packMeta } from './resource-pack'
import type { Files, RigSettings, RigSource } from './types'

// The part of node:fs the export uses; Blockbench's scoped fs has the same shape.
export interface ExportFs {
	existsSync(path: string): boolean
	readdirSync(path: string): string[]
	readFileSync(path: string, encoding: 'utf8'): string
	writeFileSync(path: string, data: string | Uint8Array): void
	mkdirSync(path: string, options: { recursive: true }): unknown
	promises: { rm(path: string, options: { recursive: true; force: true }): Promise<void> }
}

export interface ExportTarget {
	// The world's datapacks folder: the rig's pack and the common pack go in as folders.
	datapacks: { fs: ExportFs; dir: string }
	// The root of the shared resource pack.
	resourcePack: { fs: ExportFs; dir: string }
}

// Another project exported a rig under the same name; the export goes ahead only when the user agrees to replace it.
export class ExportConflict extends Error {
	constructor(readonly conflicts: string[]) {
		super(conflicts.join('\n'))
	}
}

export interface ExportOptions {
	replace?: boolean
}

const join = (dir: string, path: string) => `${dir.replace(/[\\/]+$/, '')}/${path}`
const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

type Marker = Record<string, unknown>

// A string is the reason the file is not a marker rigel wrote.
function readMarker(fs: ExportFs, file: string): Marker | string {
	try {
		const marker: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
		if (typeof marker === 'object' && marker !== null && (marker as Marker).generator === 'rigel') return marker as Marker
	} catch {}
	return `${file} は Rigel の印として読めないため、書き換えません。`
}

// undefined when the folder is missing or empty, a string when it is not a folder rigel wrote.
function folderMarker(fs: ExportFs, dir: string): Marker | string | undefined {
	if (!fs.existsSync(dir)) return undefined
	const entries = fs.readdirSync(dir)
	if (entries.length === 0) return undefined
	if (!entries.includes(MARKER)) return `${dir} は Rigel が書き出したフォルダではない（${MARKER} がない）ため、書き換えません。`
	return readMarker(fs, join(dir, MARKER))
}

// The resource pack's marker maps each rig name to the ID of the project that exported it.
function rigsOf(marker: Marker): Map<string, string> {
	const rigs = marker.rigs
	return new Map(typeof rigs === 'object' && rigs !== null ? Object.entries(rigs).filter((e): e is [string, string] => typeof e[1] === 'string') : [])
}

function writeFiles(fs: ExportFs, dir: string, files: Files): void {
	for (const [path, content] of files) {
		const file = join(dir, path)
		fs.mkdirSync(parent(file), { recursive: true })
		fs.writeFileSync(file, content)
	}
}

export interface ExportSummary {
	rigPack: string
	commonPack: string
	files: number
}

export async function exportRig(target: ExportTarget, source: RigSource, settings: RigSettings, options: ExportOptions = {}): Promise<ExportSummary> {
	const { fs: rp, dir: rpDir } = target.resourcePack
	const itemFile = join(rpDir, itemModelPath(settings.item))
	const result = buildExport(source, settings, rp.existsSync(itemFile) ? rp.readFileSync(itemFile, 'utf8') : undefined)

	const { fs: dp, dir: dpDir } = target.datapacks
	const rigDir = join(dpDir, settings.rig)
	const commonDir = join(dpDir, COMMON_PACK)
	const rpMarkerFile = join(rpDir, MARKER)
	const id = hexId(settings.id)
	const problems: string[] = []
	const conflicts: string[] = []

	const rig = folderMarker(dp, rigDir)
	if (typeof rig === 'string') problems.push(rig)
	else if (rig && !(rig.rig === settings.rig && rig.id === id)) conflicts.push(`データパックの ${rigDir} は、別のプロジェクト（固有 ID ${String(rig.id)}）が書き出したリグです。`)
	const common = folderMarker(dp, commonDir)
	if (typeof common === 'string') problems.push(common)
	else if (common && common.common !== true) problems.push(`${commonDir} は共通のデータパックではないため、書き換えません。`)
	const rpMarker = rp.existsSync(rpMarkerFile) ? readMarker(rp, rpMarkerFile) : { generator: 'rigel' }
	if (typeof rpMarker === 'string') problems.push(rpMarker)
	const rigs = typeof rpMarker === 'string' ? new Map<string, string>() : rigsOf(rpMarker)
	const owner = rigs.get(settings.rig)
	if (owner !== undefined && owner !== id) conflicts.push(`リソースパックの ${settings.rig} は、別のプロジェクト（固有 ID ${owner}）が書き出したリグです。`)

	if (problems.length > 0) throw new ExportError(problems)
	if (conflicts.length > 0 && !options.replace) throw new ExportConflict(conflicts)

	await dp.promises.rm(rigDir, { recursive: true, force: true })
	await dp.promises.rm(commonDir, { recursive: true, force: true })
	writeFiles(dp, rigDir, result.rigPack)
	writeFiles(dp, commonDir, result.commonPack)

	await rp.promises.rm(join(rpDir, `assets/rigel/models/${settings.rig}`), { recursive: true, force: true })
	await rp.promises.rm(join(rpDir, `assets/rigel/textures/item/${settings.rig}`), { recursive: true, force: true })
	rigs.set(settings.rig, id)
	const owners = Object.fromEntries([...rigs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
	// The marker goes first, like the data packs' markers.
	const resources: Files = new Map([[MARKER, `${JSON.stringify({ ...(rpMarker as Marker), rigs: owners }, null, '\t')}\n`]])
	for (const [path, content] of result.resources) resources.set(path, content)
	resources.set(result.itemModel.path, result.itemModel.json)
	if (!rp.existsSync(join(rpDir, 'pack.mcmeta'))) resources.set('pack.mcmeta', packMeta())
	writeFiles(rp, rpDir, resources)

	return { rigPack: rigDir, commonPack: commonDir, files: result.rigPack.size + result.commonPack.size + resources.size }
}
