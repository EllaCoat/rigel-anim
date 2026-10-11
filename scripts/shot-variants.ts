export const ORIGINAL = 'default'

export type Worn = ReadonlyMap<string, string>

export function callVariant(worn: Worn, variant: string, excluded: ReadonlyMap<string, ReadonlySet<string>>, bones: readonly string[]): Worn {
	const next = new Map(worn)
	for (const bone of bones) if (variant === ORIGINAL || !excluded.get(variant)?.has(bone)) next.set(bone, variant)
	return next
}

export function viewCalls(view: { variant?: string; pose?: { tick: number } }, frameCalls: ReadonlyMap<number, string>, lastTick: number): string[] {
	const upTo = view.pose ? Math.min(view.pose.tick, lastTick) : -1
	const frames = [...frameCalls].filter(([frame]) => frame <= upTo).sort((a, b) => a[0] - b[0])
	return [...(view.variant ? [view.variant] : []), ...frames.map(([, variant]) => variant)]
}
