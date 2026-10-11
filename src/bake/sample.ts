export const TICKS_PER_SECOND = 20
const PIXELS_PER_BLOCK = 16

type Stackable = { stackAnimations(animations: BBAnimation[], inLoop: boolean): void }

export function collectBones(): Group[] {
	const bones: Group[] = []
	const visit = (nodes: OutlinerNode[]) => {
		for (const node of nodes) {
			if (!(node instanceof Group)) continue
			bones.push(node)
			visit(node.children)
		}
	}
	visit(Outliner.root)
	return bones
}

// Each bone's transform relative to the model root, translation in blocks, written as 16 column-major values per bone.
export function readBoneMatrices(bones: Group[], out: Float64Array, offset: number): void {
	const inverse = Project!.model_3d.matrixWorld.clone().invert()
	const m = inverse.clone()
	bones.forEach((bone, i) => {
		m.multiplyMatrices(inverse, bone.mesh.matrixWorld)
		const at = offset + i * 16
		for (let k = 0; k < 16; k++) out[at + k] = m.elements[k]!
		out[at + 12] = out[at + 12]! / PIXELS_PER_BLOCK
		out[at + 13] = out[at + 13]! / PIXELS_PER_BLOCK
		out[at + 14] = out[at + 14]! / PIXELS_PER_BLOCK
	})
}

// Each locator's position relative to the model root, in blocks, 3 values per locator.
export function readLocatorPositions(locators: Locator[], out: Float64Array, offset: number): void {
	const inverse = Project!.model_3d.matrixWorld.clone().invert()
	const m = inverse.clone()
	locators.forEach((locator, i) => {
		m.multiplyMatrices(inverse, locator.mesh.matrixWorld)
		for (let k = 0; k < 3; k++) out[offset + i * 3 + k] = m.elements[12 + k]! / PIXELS_PER_BLOCK
	})
}

// Rounded up so the last tick reaches the end of the animation (it is clamped to the length).
export function tickCount(animation: BBAnimation): number {
	return Math.max(0, Math.ceil(animation.length * TICKS_PER_SECOND - 1e-9))
}

// Each tick's pose comes from the same calls the preview makes for one animation.
export function sampleAnimation(animation: BBAnimation, bones: Group[], locators: Locator[]): { matrices: Float64Array; locators: Float64Array } {
	const ticks = tickCount(animation)
	const matrices = new Float64Array((ticks + 1) * bones.length * 16)
	const positions = new Float64Array((ticks + 1) * locators.length * 3)
	const time = Timeline.time
	try {
		for (let i = 0; i <= ticks; i++) {
			// A 'once' animation shows the rest pose past its length, so the last tick is clamped to it.
			Timeline.time = Math.min(i / TICKS_PER_SECOND, animation.length)
			Animator.showDefaultPose(true)
			;(Animator as unknown as Stackable).stackAnimations([animation], false)
			readBoneMatrices(bones, matrices, i * bones.length * 16)
			readLocatorPositions(locators, positions, i * locators.length * 3)
		}
	} finally {
		Timeline.time = time
		Animator.preview()
	}
	return { matrices, locators: positions }
}
