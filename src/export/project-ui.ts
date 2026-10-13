import { isRigelProject } from '../easing/keyframes'
import { normalizeItem, settingsFieldProblems, uniqueName } from './build'
import { getThinMode, newRigId, readProjectSettings, writeProjectSettings, type ProjectSettings } from './settings'

const ACTION_ID = 'rigel_project_settings'
export const PROJECT_SETTINGS_TITLE = 'Rigel のプロジェクト設定'

export type SettingsPage = 'general' | 'output' | 'optimize'
const PAGES: Record<SettingsPage, { label: string; icon: string }> = {
	general: { label: '一般', icon: 'tune' },
	output: { label: '書き出し先', icon: 'folder' },
	optimize: { label: '最適化', icon: 'speed' },
}
const PAGE_OF: Record<keyof ProjectSettings, SettingsPage> = {
	rig: 'general',
	id: 'general',
	item: 'general',
	teleportDuration: 'general',
	datapacks: 'output',
	resourcePack: 'output',
	chunkLines: 'optimize',
	thin: 'optimize',
	tolerance: 'optimize',
	span: 'optimize',
}

export interface ProjectProblem {
	page: SettingsPage
	message: string
}

// draft: what the dialog saves, where fields left empty are filled in before exporting.
export function projectProblems(settings: ProjectSettings, draft = false): ProjectProblem[] {
	const problems = settingsFieldProblems(settings, draft).map((p) => ({ page: PAGE_OF[p.field], message: p.message }))
	if (!draft && !settings.datapacks) problems.push({ page: 'output', message: 'データパックの置き場所を選んでください。' })
	if (!draft && !settings.resourcePack) problems.push({ page: 'output', message: 'リソースパックのフォルダを選んでください。' })
	return problems
}

let action: Action | undefined
let dialog: Dialog | undefined

type FormResult = Record<string, unknown>

// Message boxes render Markdown: each line becomes its own paragraph, and doubled backslashes keep Windows paths intact.
export const paragraphs = (lines: string[]) => lines.map((l) => l.replace(/\\/g, '\\\\')).join('\n\n')

// onExport: runs after the settings are saved, when the sidebar's export button is pressed.
// exporting: opened by exporting, so confirming exports too.
export function openProjectSettings(page: SettingsPage, onExport: () => void, exporting = false): void {
	const project = Project!
	const current = readProjectSettings(project)
	let shown = page
	const on = (p: SettingsPage, also: (form: FormResult) => boolean = () => true) => (form: FormResult) => shown === p && also(form)
	const thin = (form: FormResult) => !!form.thin
	const usesSpan = (form: FormResult) => !!form.thin || project.animations.some((a) => getThinMode(a) === 'custom')

	// Fields hidden by their condition keep the value they had.
	const fromForm = (form: FormResult): ProjectSettings => {
		const number = (key: string, fallback: number) => (form[key] === undefined || form[key] === '' ? fallback : Number(form[key]))
		const tolerance = { position: number('thinPosition', current.tolerance.position), rotation: number('thinRotation', current.tolerance.rotation) }
		const item = String(form.item ?? '').trim()
		return {
			rig: String(form.rig ?? '').trim(),
			id: current.id || newRigId(),
			item: item ? normalizeItem(item) : '',
			datapacks: String(form.datapacks ?? ''),
			resourcePack: String(form.resourcePack ?? ''),
			chunkLines: number('chunkLines', current.chunkLines),
			thin: form.thin ? tolerance : undefined,
			tolerance,
			span: number('span', current.span),
			teleportDuration: number('teleportDuration', current.teleportDuration),
		}
	}
	const save = (form: FormResult): ProjectSettings | undefined => {
		const settings = fromForm(form)
		const problems = projectProblems(settings, true)
		if (problems.length > 0) {
			Blockbench.showMessageBox({ title: PROJECT_SETTINGS_TITLE, message: paragraphs(problems.map((p) => p.message)) })
			dialog?.sidebar?.setPage(problems[0]!.page)
			return undefined
		}
		writeProjectSettings(project, settings)
		project.saved = false
		return settings
	}
	const saveAndExport = (form: FormResult) => {
		if (!dialog || !save(form)) return
		dialog.hide()
		onExport()
	}

	dialog?.delete()
	dialog = new Dialog({
		id: ACTION_ID,
		title: PROJECT_SETTINGS_TITLE,
		width: 720,
		buttons: exporting ? ['書き出す', 'dialog.cancel'] : undefined,
		sidebar: {
			pages: PAGES,
			page,
			actions: [
				{
					name: '書き出す',
					icon: 'movie',
					description: '設定を保存して、パックを書き出します。',
					click: () => {
						if (dialog) saveAndExport(dialog.getFormResult())
					},
				},
			],
			onPageSwitch(next: string) {
				shown = next as SettingsPage
				dialog?.form?.update(dialog.getFormResult())
			},
		},
		form: {
			rig: {
				label: 'リグ名',
				type: 'text',
				value: current.rig || uniqueName(project.name, new Set()),
				description: '関数・偽プレイヤー・storage の名前に使います。小文字・数字・_ だけが使えます。',
				condition: on('general'),
			},
			item: {
				label: '元の item',
				type: 'text',
				value: current.item,
				placeholder: 'minecraft:white_dye',
				description: 'CustomModelData を付けて、Bone の表示に使う item です。',
				condition: on('general'),
			},
			teleportDuration: {
				label: 'tp の補間（tick）',
				type: 'number',
				value: current.teleportDuration,
				min: 0,
				max: 59,
				step: 1,
				description: 'リグを tp したときに、client が位置と向きを補間する tick 数（teleport_duration）です。0 だと向きはすぐ変わり、位置は 1 tick で移ります。',
				condition: on('general'),
			},
			datapacks: {
				label: 'データパックの置き場所',
				type: 'folder',
				value: current.datapacks,
				description: 'ワールドの datapacks フォルダです。リグのパックと、共通のパック rigel をここに書き出します。',
				condition: on('output'),
			},
			resourcePack: { label: 'リソースパック', type: 'folder', value: current.resourcePack, description: '全リグで共有するリソースパックのフォルダです。', condition: on('output') },
			thin: {
				label: '間引く',
				type: 'checkbox',
				value: current.thin !== undefined,
				description: 'display entity の補間で、ずれの上限の中に再現できる tick への書き込みを、Bone ごとに省きます。アニメごとの指定は、アニメを右クリックして「Rigel のアニメ設定」で変えます。',
				condition: on('optimize'),
			},
			thinPosition: { label: 'ずれの上限：位置（ブロック）', type: 'number', value: current.tolerance.position, min: 0, step: 0.001, condition: on('optimize', thin) },
			thinRotation: {
				label: 'ずれの上限：向き（度）',
				type: 'number',
				value: current.tolerance.rotation,
				min: 0,
				step: 0.1,
				description: '拡大のずれの上限（割合）にも、この角度をラジアンにした値を使います。',
				condition: on('optimize', thin),
			},
			span: { label: '1 回の書き込みで補間する上限（tick）', type: 'number', value: current.span, min: 1, step: 1, condition: on('optimize', usesSpan) },
			chunkLines: { label: '温めの 1 かたまり（行）', type: 'number', value: current.chunkLines, min: 1, step: 1, condition: on('optimize') },
		},
		onConfirm(form: FormResult) {
			if (!exporting) return save(form) ? undefined : false
			saveAndExport(form)
			// saveAndExport hides the dialog itself; Blockbench hiding it again after onExport opened a message would close that instead.
			return false
		},
	})
	dialog.show()
}

export function registerProjectUi(onExport: () => void): void {
	action = new Action(ACTION_ID, {
		name: `${PROJECT_SETTINGS_TITLE}…`,
		icon: 'settings',
		category: 'file',
		condition: () => isRigelProject(),
		click: () => openProjectSettings('general', onExport),
	})
	MenuBar.addAction(action, 'file.#file_options')
}

export function unregisterProjectUi(): void {
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
}
