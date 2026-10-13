import { isRigelProject } from '../easing/keyframes'
import { getAnimationTolerance, getPriority, getThinMode, setPriority, setThin, type AnimationThinMode } from './settings'
import { WARM_PRIORITIES, type WarmPriority } from './types'

const ACTION_ID = 'rigel_animation_settings'
const THIN_MODES: Record<AnimationThinMode, string> = { project: 'プロジェクトと同じ', off: '間引かない', custom: 'このアニメの値' }

let action: Action | undefined
let dialog: Dialog | undefined

type FormResult = Record<string, unknown>

function openAnimationDialog(animation: BBAnimation): void {
	const own = getAnimationTolerance(animation)
	const custom = (form: FormResult) => form.thin === 'custom'
	dialog?.delete()
	dialog = new Dialog({
		id: ACTION_ID,
		title: `アニメ「${animation.name}」の設定`,
		width: 560,
		form: {
			warm: {
				label: '温めの優先度',
				type: 'select',
				options: Object.fromEntries(WARM_PRIORITIES.map((p) => [p, p])),
				value: getPriority(animation),
				description: 'ワールドを読み込んだ後、アニメのデータを先に用意する順番です。',
			},
			thin: { label: '間引き', type: 'select', options: THIN_MODES, value: getThinMode(animation) },
			position: { label: 'ずれの上限：位置（ブロック）', type: 'number', value: own.position, min: 0, step: 0.001, condition: custom },
			rotation: { label: 'ずれの上限：向き（度）', type: 'number', value: own.rotation, min: 0, step: 0.1, condition: custom },
		},
		onConfirm(form: FormResult) {
			// Fields hidden by their condition keep the value they had.
			const number = (key: string, fallback: number) => (form[key] === undefined || form[key] === '' ? fallback : Number(form[key]))
			const tolerance = { position: number('position', own.position), rotation: number('rotation', own.rotation) }
			Undo.initEdit({ animations: [animation] })
			setPriority(animation, form.warm as WarmPriority)
			setThin(animation, form.thin as AnimationThinMode, tolerance)
			Undo.finishEdit('アニメの設定')
		},
	})
	dialog.show()
}

export function registerAnimationUi(): void {
	action = new Action(ACTION_ID, {
		name: 'Rigel のアニメ設定',
		icon: 'settings',
		category: 'animation',
		condition: () => isRigelProject() && !!BBAnimation.selected,
		click: () => {
			// Right-clicking an animation selects it before its menu opens.
			const animation = BBAnimation.selected
			if (animation) openAnimationDialog(animation)
		},
	})
	BBAnimation.prototype.menu?.addAction(action)
}

export function unregisterAnimationUi(): void {
	BBAnimation.prototype.menu?.removeAction(ACTION_ID)
	action?.delete()
	action = undefined
	dialog?.delete()
	dialog = undefined
}
