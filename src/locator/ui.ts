import { isRigelProject } from '../easing/keyframes'
import { normalizeId, RESOURCE_ID, snbtProblem } from '../export/display'
import { readLocatorEntity, writeLocatorEntity } from './settings'

const ACTION_ID = 'rigel_locator_entity'

let action: Action | undefined
let dialog: Dialog | undefined

function openLocatorDialog(locator: Locator): void {
	const current = readLocatorEntity(locator)
	dialog?.delete()
	dialog = new Dialog({
		id: ACTION_ID,
		title: `locator「${locator.name}」の entity`,
		width: 520,
		form: {
			type: {
				label: 'entity の種類',
				type: 'text',
				value: current.type,
				placeholder: 'minecraft:marker',
				description: '空なら entity を置かず、位置だけを storage に持ちます。自分では動かない entity（marker、NoAI の mob など）にしてください。',
			},
			nbt: { label: 'summon の NBT', type: 'text', value: current.nbt, placeholder: '{NoAI:1b,Silent:1b}' },
		},
		onConfirm(form: Record<string, unknown>) {
			const type = String(form.type ?? '').trim()
			const nbt = String(form.nbt ?? '').trim()
			const problems: string[] = []
			if (type && !RESOURCE_ID.test(normalizeId(type))) problems.push('entity の種類は minecraft:marker のような ID で入力してください。')
			const p = nbt && snbtProblem(nbt)
			if (p) problems.push(`summon の NBT は ${p}`)
			if (problems.length > 0) {
				Blockbench.showMessageBox({ title: 'locator', message: problems.join('\n\n') })
				return false
			}
			Undo.initEdit({ elements: [locator] })
			writeLocatorEntity(locator, { type, nbt })
			Undo.finishEdit('locator の entity')
		},
	})
	dialog.show()
}

export function registerLocatorUi(): void {
	action = new Action(ACTION_ID, {
		name: 'locator の entity',
		icon: 'pets',
		category: 'edit',
		condition: () => isRigelProject() && Locator.selected.length === 1,
		click: () => {
			const locator = Locator.selected[0]
			if (locator) openLocatorDialog(locator)
		},
	})
	Locator.prototype.menu?.addAction(action)
}

export function unregisterLocatorUi(): void {
	Locator.prototype.menu?.removeAction(ACTION_ID)
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
}
