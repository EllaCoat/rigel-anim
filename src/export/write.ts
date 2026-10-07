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

const join = (dir: string, path: string) => `${dir.replace(/[\\/]+$/, '')}/${path}`
const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))

// A pack folder may be replaced when it is missing, empty, or carries the marker `owns` accepts.
function folderProblem(fs: ExportFs, dir: string, owns: (marker: Record<string, unknown>) => string | undefined): string | undefined {
	if (!fs.existsSync(dir)) return undefined
	const entries = fs.readdirSync(dir)
	if (entries.length === 0) return undefined
	if (!entries.includes(MARKER)) return `${dir} は rigel が書き出したフォルダではない（${MARKER} が無い）ので書き換えない`
	try {
		return owns(JSON.parse(fs.readFileSync(join(dir, MARKER), 'utf8')))
	} catch {
		return `${join(dir, MARKER)} を読めない`
	}
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

export async function exportRig(target: ExportTarget, source: RigSource, settings: RigSettings): Promise<ExportSummary> {
	const { fs: rp, dir: rpDir } = target.resourcePack
	const itemFile = join(rpDir, itemModelPath(settings.item))
	const result = buildExport(source, settings, rp.existsSync(itemFile) ? rp.readFileSync(itemFile, 'utf8') : undefined)

	const { fs: dp, dir: dpDir } = target.datapacks
	const rigDir = join(dpDir, settings.rig)
	const commonDir = join(dpDir, COMMON_PACK)
	const problems = [
		folderProblem(dp, rigDir, (m) =>
			m.rig === settings.rig && m.id === hexId(settings.id) ? undefined : `${rigDir} は別のプロジェクト（固有 ID ${String(m.id)}）が書き出したリグなので書き換えない。リグ名を変えて`,
		),
		folderProblem(dp, commonDir, (m) => (m.common === true ? undefined : `${commonDir} は共通のデータパックではないので書き換えない`)),
	].filter((p): p is string => p !== undefined)
	if (problems.length > 0) throw new ExportError(problems)

	await dp.promises.rm(rigDir, { recursive: true, force: true })
	await dp.promises.rm(commonDir, { recursive: true, force: true })
	writeFiles(dp, rigDir, result.rigPack)
	writeFiles(dp, commonDir, result.commonPack)

	await rp.promises.rm(join(rpDir, `assets/rigel/models/${settings.rig}`), { recursive: true, force: true })
	await rp.promises.rm(join(rpDir, `assets/rigel/textures/item/${settings.rig}`), { recursive: true, force: true })
	const resources: Files = new Map(result.resources)
	resources.set(result.itemModel.path, result.itemModel.json)
	if (!rp.existsSync(join(rpDir, 'pack.mcmeta'))) resources.set('pack.mcmeta', packMeta())
	writeFiles(rp, rpDir, resources)

	return { rigPack: rigDir, commonPack: commonDir, files: result.rigPack.size + result.commonPack.size + resources.size }
}
