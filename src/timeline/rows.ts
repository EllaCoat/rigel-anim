export interface RowFacts {
	name: string
	// Any channel counts: the Effects row has none of position, rotation and scale, but its variant keyframes are keyframes.
	hasKeyframes: boolean
	selected: boolean
	effects: boolean
}

export interface RowFilter {
	query: string
	keyframesOnly: boolean
	onlySelected: boolean
}

export function rowVisible(row: RowFacts, filter: RowFilter): boolean {
	const query = filter.query.trim().toLowerCase()
	if (query && !row.name.toLowerCase().includes(query)) return false
	if (filter.keyframesOnly && !row.hasKeyframes) return false
	// The Effects row belongs to no node of the outliner, so it is never "selected" and is not hidden for that.
	if (filter.onlySelected && !row.selected && !row.effects) return false
	return true
}
