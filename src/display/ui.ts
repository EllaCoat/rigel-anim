import type { Vec3 } from '../bake/matrix'
import { isRigelProject } from '../easing/keyframes'
import { displayProblems } from '../export/display'
import { ITEM_DISPLAY_MODES, TEXT_ALIGNMENTS, type DisplaySettings, type ItemDisplayMode, type TextAlignment } from '../export/types'
import { refreshDisplayPreview } from './preview'
import { DEFAULT_BACKGROUND, defaultDisplay, readDisplay, writeDisplay, type DisplayKind } from './settings'

const ADD_ID = 'rigel_add_display'
const EDIT_ID = 'rigel_display_settings'
const KIND_LABELS: Record<DisplayKind, string> = { block: 'ブロック表示（block_display）', item: 'アイテム表示（item_display）', text: 'テキスト表示（text_display）' }

let addAction: Action | undefined
let editAction: Action | undefined
let dialog: Dialog | undefined

type FormResult = Record<string, unknown>

const hex = (argb: number) => `#${(argb >>> 0).toString(16).padStart(8, '0')}`
const parseHex = (s: string): number | undefined => (/^#?[0-9a-f]{8}$/i.test(s.trim()) ? Number.parseInt(s.trim().replace('#', ''), 16) | 0 : undefined)

function fromForm(form: FormResult, kind: DisplayKind): DisplaySettings | string {
	const common = { scale: (form.scale as number[]).map(Number) as Vec3, nbt: String(form.nbt ?? '') }
	if (kind === 'block') return { ...common, kind, block: String(form.block ?? '') }
	if (kind === 'item') return { ...common, kind, item: String(form.item ?? ''), tag: String(form.tag ?? ''), mode: form.mode as ItemDisplayMode }
	const background = parseHex(String(form.background ?? ''))
	if (background === undefined) return '背景色は #AARRGGBB の形で入力してください。'
	return {
		...common,
		kind,
		text: String(form.text ?? ''),
		lineWidth: Number(form.lineWidth),
		background,
		defaultBackground: !!form.defaultBackground,
		textOpacity: Number(form.textOpacity),
		shadow: !!form.shadow,
		seeThrough: !!form.seeThrough,
		alignment: form.alignment as TextAlignment,
	}
}

// group: the display to edit, or the parent to add a new one under (undefined for the root).
function openDisplayDialog(target: { edit: Group } | { parent: Group | undefined }): void {
	const editing = 'edit' in target ? target.edit : undefined
	const current = (editing && readDisplay(editing)) || defaultDisplay('text')
	const value = (kind: DisplayKind, key: string, fallback: unknown) => (current.kind === kind ? (current as unknown as Record<string, unknown>)[key] : fallback)
	const textDefaults = defaultDisplay('text') as Extract<DisplaySettings, { kind: 'text' }>
	const itemDefaults = defaultDisplay('item') as Extract<DisplaySettings, { kind: 'item' }>
	const is = (kind: DisplayKind) => (form: FormResult) => form.kind === kind
	dialog?.delete()
	dialog = new Dialog({
		id: EDIT_ID,
		title: editing ? 'display の設定' : 'display を追加',
		width: 560,
		form: {
			kind: { label: '種類', type: 'select', options: KIND_LABELS, value: current.kind },
			name: { label: '名前', type: 'text', value: editing?.name ?? 'display', description: 'タグ rigel.<リグ名>.<名前> に使います。' },
			block: { label: 'ブロック', type: 'text', value: value('block', 'block', 'minecraft:stone'), placeholder: 'minecraft:oak_stairs[facing=east]', condition: is('block') },
			item: { label: 'item', type: 'text', value: value('item', 'item', itemDefaults.item), condition: is('item') },
			tag: { label: 'item の tag', type: 'text', value: value('item', 'tag', ''), placeholder: '{CustomModelData:1}', condition: is('item') },
			mode: {
				label: '表示の型',
				type: 'select',
				options: Object.fromEntries(ITEM_DISPLAY_MODES.map((m) => [m, m])),
				value: value('item', 'mode', 'none'),
				description: 'Blockbench では none の向きで表示します。',
				condition: is('item'),
			},
			text: { label: 'テキスト', type: 'textarea', value: value('text', 'text', textDefaults.text), description: '文字か JSON のテキストです。', condition: is('text') },
			lineWidth: { label: '行の幅', type: 'number', value: value('text', 'lineWidth', textDefaults.lineWidth), min: 1, step: 1, condition: is('text') },
			background: { label: '背景色（#AARRGGBB）', type: 'text', value: hex(value('text', 'background', DEFAULT_BACKGROUND) as number), condition: is('text') },
			defaultBackground: { label: '既定の背景', type: 'checkbox', value: value('text', 'defaultBackground', false), condition: is('text') },
			textOpacity: { label: '文字の不透明度（0〜255）', type: 'number', value: value('text', 'textOpacity', 255), min: 0, max: 255, step: 1, condition: is('text') },
			shadow: { label: '影', type: 'checkbox', value: value('text', 'shadow', false), condition: is('text') },
			seeThrough: { label: '透けて見える', type: 'checkbox', value: value('text', 'seeThrough', false), condition: is('text') },
			alignment: { label: '揃え', type: 'select', options: Object.fromEntries(TEXT_ALIGNMENTS.map((a) => [a, a])), value: value('text', 'alignment', 'center'), condition: is('text') },
			scale: { label: '拡大', type: 'vector', dimensions: 3, value: [...current.scale], step: 0.1 },
			nbt: { label: '追加の NBT', type: 'text', value: current.nbt, placeholder: '{brightness:{block:15,sky:15}}', description: 'summon に足すキーです。id・UUID・Tags・Passengers・transformation・interpolation_duration・teleport_duration は書かないでください。' },
		},
		onConfirm(form: FormResult) {
			const kind = form.kind as DisplayKind
			const display = fromForm(form, kind)
			const name = String(form.name ?? '').trim() || 'display'
			const problems = typeof display === 'string' ? [display] : displayProblems(name, display)
			if (problems.length > 0 || typeof display === 'string') {
				Blockbench.showMessageBox({ title: 'display', message: problems.join('\n\n') })
				return false
			}
			Undo.initEdit({ outliner: true, groups: editing ? [editing] : [] })
			let group = editing
			if (!group) {
				const parent = 'parent' in target ? target.parent : undefined
				group = new Group({ name, origin: parent ? [...parent.origin] : [0, 0, 0] })
				group.addTo(parent).init()
			}
			group.name = name
			writeDisplay(group, display)
			Undo.finishEdit(editing ? 'display の設定' : 'display を追加', { outliner: true, groups: [group] })
			refreshDisplayPreview(group)
			Canvas.updateAll()
		},
	})
	dialog.show()
}

const selectedGroup = (): Group | undefined => {
	const g = Group.first_selected as Group | undefined
	return g instanceof Group ? g : undefined
}

export function registerDisplayUi(): void {
	addAction = new Action(ADD_ID, {
		name: 'display を追加',
		icon: 'text_fields',
		category: 'edit',
		condition: () => isRigelProject(),
		click: () => openDisplayDialog({ parent: selectedGroup() }),
	})
	editAction = new Action(EDIT_ID, {
		name: 'display の設定',
		icon: 'tune',
		category: 'edit',
		condition: () => isRigelProject() && !!selectedGroup() && !!readDisplay(selectedGroup()!),
		click: () => {
			const group = selectedGroup()
			if (group) openDisplayDialog({ edit: group })
		},
	})
	// The toolbar keeps its children across reloads, so a reload must not add the button again.
	if (!Toolbars.outliner.children.some((c) => c === ADD_ID || (typeof c === 'object' && c.id === ADD_ID))) Toolbars.outliner.add(addAction)
	Group.prototype.menu?.addAction(editAction)
	Group.prototype.menu?.addAction(addAction)
}

export function unregisterDisplayUi(): void {
	Group.prototype.menu?.removeAction(EDIT_ID)
	Group.prototype.menu?.removeAction(ADD_ID)
	if (addAction) Toolbars.outliner.remove(addAction)
	addAction?.delete()
	editAction?.delete()
	addAction = undefined
	editAction = undefined
	dialog?.delete()
	dialog = undefined
}
