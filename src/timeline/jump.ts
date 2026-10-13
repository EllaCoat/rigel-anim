import { isRigelProject } from '../easing/keyframes'
import { jumpTarget } from './ticks'

const ARROW_LEFT = 37
const ARROW_RIGHT = 39

let actions: Action[] = []

// Only while the Timeline has the focus, as Shift with an arrow key does other things elsewhere.
const available = (): boolean => isRigelProject() && Modes.animate && !!BBAnimation.selected && Prop.active_panel === 'timeline'

// The keyframes of every channel of the selected row count, so on the Effects row the variant keyframes are targets too.
function jump(direction: 1 | -1): void {
	const animation = BBAnimation.selected
	const animator = Timeline.animators.find((a) => a.selected)
	if (!animation || !animator) return
	const times = (animator.keyframes as BBKeyframe[]).map((keyframe) => keyframe.time)
	const target = jumpTarget(times, Timeline.time, animation.length, direction)
	if (target === undefined) return
	Timeline.setTime(target)
	Animator.preview()
}

export function registerKeyframeJump(): void {
	actions = [
		new Action('rigel_next_keyframe', {
			name: 'Rigel：次のキーフレームへ移動',
			icon: 'skip_next',
			category: 'animation',
			keybind: new Keybind({ key: ARROW_RIGHT, shift: true }),
			condition: available,
			click: () => jump(1),
		}),
		new Action('rigel_previous_keyframe', {
			name: 'Rigel：前のキーフレームへ移動',
			icon: 'skip_previous',
			category: 'animation',
			keybind: new Keybind({ key: ARROW_LEFT, shift: true }),
			condition: available,
			click: () => jump(-1),
		}),
	]
}

export function unregisterKeyframeJump(): void {
	for (const action of actions) action.delete()
	actions = []
}
