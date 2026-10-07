import { isRigelProject } from '../easing/keyframes'
import { ExportError, normalizeItem, settingsProblems, uniqueName } from './build'
import { collectRig } from './collect'
import { getPriority, newRigId, readProjectSettings, setPriority, writeProjectSettings, type ProjectSettings } from './settings'
import { WARM_PRIORITIES, type WarmPriority } from './types'
import { exportRig, type ExportFs } from './write'

const ACTION_ID = 'rigel_export'
const TITLE = 'Rigel のパックを書き出す'

let action: Action | undefined
let dialog: Dialog | undefined

type FormResult = Record<string, unknown>

function problemsOf(settings: ProjectSettings): string[] {
	const problems = settingsProblems(settings)
	if (!settings.datapacks) problems.push('データパックの置き場所を選んで')
	if (!settings.resourcePack) problems.push('リソースパックのフォルダを選んで')
	return problems
}

async function run(settings: ProjectSettings): Promise<void> {
	const message = 'Rigel が書き出したパックをこのフォルダに書き込むため'
	const datapacks = requireNativeModule('fs', { scope: settings.datapacks, message })
	const resourcePack = datapacks && requireNativeModule('fs', { scope: settings.resourcePack, message })
	if (!datapacks || !resourcePack) {
		Blockbench.showMessageBox({ title: TITLE, message: 'フォルダへの書き込みが許可されなかったので、書き出していない' })
		return
	}
	try {
		const summary = await exportRig(
			{ datapacks: { fs: datapacks as unknown as ExportFs, dir: settings.datapacks }, resourcePack: { fs: resourcePack as unknown as ExportFs, dir: settings.resourcePack } },
			collectRig(),
			settings,
		)
		Blockbench.showQuickMessage(`書き出した（${summary.files} ファイル）`, 2500)
	} catch (error) {
		const message = error instanceof ExportError ? error.problems.join('\n') : String((error as Error)?.message ?? error)
		Blockbench.showMessageBox({ title: '書き出せなかった', message })
	}
}

function openExportDialog(): void {
	const project = Project!
	const current = readProjectSettings(project)
	const animations = project.animations
	const priorities = Object.fromEntries(WARM_PRIORITIES.map((p) => [p, p]))
	dialog?.delete()
	dialog = new Dialog({
		id: 'rigel_export',
		title: TITLE,
		width: 640,
		form: {
			rig: { label: 'リグ名', type: 'text', value: current.rig || uniqueName(project.name, new Set()), description: '関数・偽プレイヤー・storage の名前に使う。小文字・数字・_ だけ' },
			item: { label: '元の item', type: 'text', value: current.item, placeholder: 'minecraft:white_dye', description: 'CustomModelData を付けて Bone に表示する item' },
			datapacks: { label: 'データパックの置き場所', type: 'folder', value: current.datapacks, description: 'ワールドの datapacks フォルダ。リグのパックと共通のパック rigel をここに書く' },
			resourcePack: { label: 'リソースパック', type: 'folder', value: current.resourcePack, description: '全リグで共有するリソースパックのフォルダ' },
			chunkLines: { label: '温めの 1 かたまり（行）', type: 'number', value: current.chunkLines, min: 1, step: 1 },
			...Object.fromEntries(animations.map((a, i) => [`warm_${i}`, { label: `温めの優先度 ${i}: ${a.name}`, type: 'select', options: priorities, value: getPriority(a) }])),
		},
		onConfirm(result: FormResult) {
			const settings: ProjectSettings = {
				rig: String(result.rig ?? '').trim(),
				id: current.id || newRigId(),
				item: normalizeItem(String(result.item ?? '')),
				datapacks: String(result.datapacks ?? ''),
				resourcePack: String(result.resourcePack ?? ''),
				chunkLines: Number(result.chunkLines),
			}
			const problems = problemsOf(settings)
			if (problems.length > 0) {
				Blockbench.showMessageBox({ title: TITLE, message: problems.join('\n') })
				return false
			}
			writeProjectSettings(project, settings)
			animations.forEach((a, i) => setPriority(a, result[`warm_${i}`] as WarmPriority))
			project.saved = false
			void run(settings)
		},
	})
	dialog.show()
}

export function registerExportUi(): void {
	action = new Action(ACTION_ID, { name: TITLE, icon: 'movie', category: 'file', condition: () => isRigelProject(), click: openExportDialog })
	MenuBar.addAction(action, 'file.export')
}

export function unregisterExportUi(): void {
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
}
