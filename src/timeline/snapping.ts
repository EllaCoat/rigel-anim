import { TICKS_PER_SECOND } from '../bake/sample'
import { isRigelProject } from '../easing/keyframes'

let property: Deletable | undefined

export function registerTickSnapping(): void {
	property = new Property(Animation, 'number', 'snapping', {
		exposed: false,
		default: (animation: BBAnimation) => (isRigelProject() ? TICKS_PER_SECOND : animation.snapping),
	})
}

export function unregisterTickSnapping(): void {
	property?.delete()
	property = undefined
}
