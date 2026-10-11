import { isRigelProject } from '../easing/keyframes'
import { ExportError, normalizeItem, settingsProblems, uniqueName } from './build'
import { collectRig } from './collect'
import {
	getAnimationTolerance,
	getPriority,
	getThinMode,
	newRigId,
	readProjectSettings,
	setPriority,
	setThin,
	writeProjectSettings,
	type AnimationThinMode,
	type ProjectSettings,
} from './settings'
import { WARM_PRIORITIES, type WarmPriority } from './types'
import { ExportConflict, exportRig, type ExportFs } from './write'

const ACTION_ID = 'rigel_export'
const TITLE = 'Rigel のパックを書き出す'

let action: Action | undefined
let dialog: Dialog | undefined

type FormResult = Record<string, unknown>

// Message boxes render Markdown: each line becomes its own paragraph, and doubled backslashes keep Windows paths intact.
const paragraphs = (lines: string[]) => lines.map((l) => l.replace(/\\/g, '\\\\')).join('\n\n')

function problemsOf(settings: ProjectSettings): string[] {
	const problems = settingsProblems(settings)
	if (!settings.datapacks) problems.push('データパックの置き場所を選んでください。')
	if (!settings.resourcePack) problems.push('リソースパックのフォルダを選んでください。')
	return problems
}

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

function openExportDialog(): void {
	const project = Project!
	const current = readProjectSettings(project)
	const animations = project.animations
	const priorities = Object.fromEntries(WARM_PRIORITIES.map((p) => [p, p]))
	const thinModes: Record<AnimationThinMode, string> = { project: 'プロジェクトと同じ', off: '間引かない', custom: 'このアニメの値' }
	const custom = (i: number) => (form: FormResult) => form[`thin_${i}`] === 'custom'
	dialog?.delete()
	dialog = new Dialog({
		id: 'rigel_export',
		title: TITLE,
		width: 640,
		form: {
			rig: { label: 'リグ名', type: 'text', value: current.rig || uniqueName(project.name, new Set()), description: '関数・偽プレイヤー・storage の名前に使います。小文字・数字・_ だけが使えます。' },
			item: { label: '元の item', type: 'text', value: current.item, placeholder: 'minecraft:white_dye', description: 'CustomModelData を付けて、Bone の表示に使う item です。' },
			datapacks: { label: 'データパックの置き場所', type: 'folder', value: current.datapacks, description: 'ワールドの datapacks フォルダです。リグのパックと、共通のパック rigel をここに書き出します。' },
			resourcePack: { label: 'リソースパック', type: 'folder', value: current.resourcePack, description: '全リグで共有するリソースパックのフォルダです。' },
			chunkLines: { label: '温めの 1 かたまり（行）', type: 'number', value: current.chunkLines, min: 1, step: 1 },
			thin: {
				label: '間引く',
				type: 'checkbox',
				value: current.thin !== undefined,
				description: 'display entity の補間で、ずれの上限の中に再現できる tick への書き込みを、Bone ごとに省きます。',
			},
			thinPosition: { label: 'ずれの上限：位置（ブロック）', type: 'number', value: current.tolerance.position, min: 0, step: 0.001, condition: (form: FormResult) => !!form.thin },
			thinRotation: {
				label: 'ずれの上限：向き（度）',
				type: 'number',
				value: current.tolerance.rotation,
				min: 0,
				step: 0.1,
				description: '拡大のずれの上限（割合）にも、この角度をラジアンにした値を使います。',
				condition: (form: FormResult) => !!form.thin,
			},
			span: {
				label: '1 回の書き込みで補間する上限（tick）',
				type: 'number',
				value: current.span,
				min: 1,
				step: 1,
				condition: (form: FormResult) => !!form.thin || animations.some((_, i) => custom(i)(form)),
			},
			...Object.fromEntries(
				animations.flatMap((a, i) => {
					const own = getAnimationTolerance(a)
					return [
						[`warm_${i}`, { label: `温めの優先度 ${i}: ${a.name}`, type: 'select', options: priorities, value: getPriority(a) }],
						[`thin_${i}`, { label: `間引き ${i}: ${a.name}`, type: 'select', options: thinModes, value: getThinMode(a) }],
						[`thin_position_${i}`, { label: `位置（ブロック） ${i}: ${a.name}`, type: 'number', value: own.position, min: 0, step: 0.001, condition: custom(i) }],
						[`thin_rotation_${i}`, { label: `向き（度） ${i}: ${a.name}`, type: 'number', value: own.rotation, min: 0, step: 0.1, condition: custom(i) }],
					]
				}),
			),
		},
		onConfirm(result: FormResult) {
			// Fields hidden by their condition keep the value they had.
			const number = (key: string, fallback: number) => (result[key] === undefined || result[key] === '' ? fallback : Number(result[key]))
			const tolerance = { position: number('thinPosition', current.tolerance.position), rotation: number('thinRotation', current.tolerance.rotation) }
			const settings: ProjectSettings = {
				rig: String(result.rig ?? '').trim(),
				id: current.id || newRigId(),
				item: normalizeItem(String(result.item ?? '')),
				datapacks: String(result.datapacks ?? ''),
				resourcePack: String(result.resourcePack ?? ''),
				chunkLines: Number(result.chunkLines),
				thin: result.thin ? tolerance : undefined,
				tolerance,
				span: number('span', current.span),
			}
			const problems = problemsOf(settings)
			if (problems.length > 0) {
				Blockbench.showMessageBox({ title: TITLE, message: paragraphs(problems) })
				return false
			}
			writeProjectSettings(project, settings)
			animations.forEach((a, i) => {
				setPriority(a, result[`warm_${i}`] as WarmPriority)
				const own = getAnimationTolerance(a)
				setThin(a, result[`thin_${i}`] as AnimationThinMode, { position: number(`thin_position_${i}`, own.position), rotation: number(`thin_rotation_${i}`, own.rotation) })
			})
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
