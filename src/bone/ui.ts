import { readDisplay } from '../display/settings'
import { isRigelProject } from '../easing/keyframes'
import { BONE_OWN_KEYS, boneNbtProblems } from '../export/display'
import { readBoneNbt, writeBoneNbt } from './settings'

const MENU_ID = 'rigel_bone_settings'

let dialog: Dialog | undefined

// Only groups with cubes become entities; a display group has its own settings.
const hasBoneSettings = (group: Group) => !readDisplay(group) && group.children.some((c) => c instanceof Cube)

const menuEntry = {
	id: MENU_ID,
	name: 'Rigel の Bone 設定',
	icon: 'settings',
	condition: (group: unknown) => isRigelProject() && group instanceof Group && hasBoneSettings(group),
	click: (group: unknown) => {
		if (group instanceof Group) openBoneDialog(group)
	},
}

function openBoneDialog(group: Group): void {
	dialog?.delete()
	dialog = new Dialog({
		id: MENU_ID,
		title: `Bone「${group.name}」の設定`,
		width: 560,
		form: {
			nbt: {
				label: '追加の NBT',
				type: 'text',
				value: readBoneNbt(group),
				placeholder: '{brightness:{block:15,sky:15},Glowing:1b}',
				description: `この Bone の entity を召喚するときに足すキーです。${BONE_OWN_KEYS.join('・')} は Rigel が書くため使えません。`,
			},
		},
		onConfirm(form: Record<string, unknown>) {
			const nbt = String(form.nbt ?? '').trim()
			const problems = boneNbtProblems(group.name, nbt)
			if (problems.length > 0) {
				Blockbench.showMessageBox({ title: 'Bone の設定', message: problems.join('\n\n') })
				return false
			}
			Undo.initEdit({ outliner: true, groups: [group] })
			writeBoneNbt(group, nbt)
			Undo.finishEdit('Bone の設定', { outliner: true, groups: [group] })
		},
	})
	dialog.show()
}

export function registerBoneUi(): void {
	Group.prototype.menu?.addAction(menuEntry)
}

export function unregisterBoneUi(): void {
	Group.prototype.menu?.removeAction(MENU_ID)
	dialog?.delete()
	dialog = undefined
}
