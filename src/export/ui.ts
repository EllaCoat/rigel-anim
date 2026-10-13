import { isRigelProject } from '../easing/keyframes'
import { ExportError } from './build'
import { collectRig } from './collect'
import { openProjectSettings, paragraphs, projectProblems, PROJECT_SETTINGS_TITLE, registerProjectUi, unregisterProjectUi } from './project-ui'
import { getThinMode, readProjectSettings, type ProjectSettings } from './settings'
import { ExportConflict, exportRig, type ExportFs } from './write'

const ACTION_ID = 'rigel_export'
const TITLE = 'Rigel のパックを書き出す'

let action: Action | undefined

async function run(settings: ProjectSettings, replace = false): Promise<void> {
	const message = 'Rigel が書き出したパックを、このフォルダに書き込むためです。'
	const datapacks = requireNativeModule('fs', { scope: settings.datapacks, message })
	const resourcePack = datapacks && requireNativeModule('fs', { scope: settings.resourcePack, message })
	if (!datapacks || !resourcePack) {
		Blockbench.showMessageBox({ title: TITLE, message: 'フォルダへの書き込みが許可されなかったため、書き出していません。' })
		return
	}
	try {
		const summary = await exportRig(
			{ datapacks: { fs: datapacks as unknown as ExportFs, dir: settings.datapacks }, resourcePack: { fs: resourcePack as unknown as ExportFs, dir: settings.resourcePack } },
			collectRig(),
			settings,
			{ replace },
		)
		const { thinned, full } = summary.writes
		const requested = settings.thin !== undefined || Project!.animations.some((a) => getThinMode(a) === 'custom')
		const reduced = requested ? `、フレームの書き込み ${thinned.toLocaleString()} 行（間引く前の ${full.toLocaleString()} 行の ${Math.round((thinned / full) * 100)}%）` : ''
		Blockbench.showQuickMessage(`書き出しました（${summary.files} ファイル${reduced}）。`, reduced ? 6000 : 2500)
	} catch (error) {
		if (error instanceof ExportConflict) {
			const lines = [
				...error.conflicts,
				'このプロジェクトで置き換えますか？',
				`召喚中の前のリグは新しい kill では消えないため、kill @e[tag=rigel.${settings.rig}] で消してください。前のリグを使う別のワールドがある場合、そちらの見た目は崩れます。`,
			]
			Blockbench.showMessageBox({ title: '同じリグ名のリグがあります', message: paragraphs(lines), buttons: ['置き換える', 'キャンセル'], confirm: 0, cancel: 1 }, (button) => {
				if (button === 0) void run(settings, true)
			})
			return
		}
		const lines = error instanceof ExportError ? error.problems : [String((error as Error)?.message ?? error)]
		Blockbench.showMessageBox({ title: '書き出せませんでした', message: paragraphs(lines) })
	}
}

function exportProject(): void {
	const settings = readProjectSettings(Project!)
	// A project that never saved its settings has nothing to point out yet.
	if (!settings.rig) {
		openProjectSettings('general', exportProject, true)
		return
	}
	const problems = projectProblems(settings)
	if (problems.length === 0) {
		void run(settings)
		return
	}
	const lines = [...problems.map((p) => p.message), `${PROJECT_SETTINGS_TITLE}を開きます。`]
	Blockbench.showMessageBox({ title: TITLE, message: paragraphs(lines) }, () => openProjectSettings(problems[0]!.page, exportProject, true))
}

export function registerExportUi(): void {
	action = new Action(ACTION_ID, { name: TITLE, icon: 'movie', category: 'file', condition: () => isRigelProject(), click: exportProject })
	MenuBar.addAction(action, 'file.export')
	registerProjectUi(exportProject)
}

export function unregisterExportUi(): void {
	unregisterProjectUi()
	action?.delete()
	action = undefined
}
