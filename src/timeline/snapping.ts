import { TICKS_PER_SECOND } from '../bake/sample'
import { isRigelProject } from '../easing/keyframes'

let addAnimation: Action | undefined
let originalClick: ((...args: unknown[]) => unknown) | undefined

export function registerTickSnapping(): void {
	addAnimation = BarItems.add_animation as Action | undefined
	if (!addAnimation) return
	const click: (...args: unknown[]) => unknown = addAnimation.onClick
	originalClick = click
	addAnimation.onClick = function (this: unknown, ...args: unknown[]) {
		if (!isRigelProject()) return click.apply(this, args)
		const setting = settings.animation_snap!
		const before = setting.value
		setting.value = TICKS_PER_SECOND
		try {
			return click.apply(this, args)
		} finally {
			setting.value = before
		}
	}
}

export function unregisterTickSnapping(): void {
	if (addAnimation && originalClick) addAnimation.onClick = originalClick
	addAnimation = undefined
	originalClick = undefined
}
