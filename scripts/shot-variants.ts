// What the variant functions a view calls leave each bone wearing, view after view. No imports from the plugin:
// shot-harness.ts bundles this file for the Blockbench renderer and test/shot.test.ts runs it.

export const ORIGINAL = 'default'

// Variant name by bone (group uuid); a bone not in it wears the original model.
export type Worn = ReadonlyMap<string, string>

// The rig's variant function puts the variant on the bones it does not exclude, and leaves the others as they are.
// default puts the original model on every bone.
export function callVariant(worn: Worn, variant: string, excluded: ReadonlyMap<string, ReadonlySet<string>>, bones: readonly string[]): Worn {
	const next = new Map(worn)
	for (const bone of bones) if (variant === ORIGINAL || !excluded.get(variant)?.has(bone)) next.set(bone, variant)
	return next
}

// The variants the rig applies for a view, in the order poseCommands runs them: the view's own, then those of the
// frames from 0 to the pose's tick (frameCalls: frame → variant).
export function viewCalls(view: { variant?: string; pose?: { tick: number } }, frameCalls: ReadonlyMap<number, string>, lastTick: number): string[] {
	const upTo = view.pose ? Math.min(view.pose.tick, lastTick) : -1
	const frames = [...frameCalls].filter(([frame]) => frame <= upTo).sort((a, b) => a[0] - b[0])
	return [...(view.variant ? [view.variant] : []), ...frames.map(([, variant]) => variant)]
}
