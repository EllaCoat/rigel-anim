// The Bones a variant can apply to, in the outliner's hierarchy. A Bone is a Group that holds Cubes; groups without
// Cubes appear only as parents of such Bones, and displays do not appear at all.

export interface GroupSource {
	uuid: string
	name: string
	display: boolean
	hasCubes: boolean
	children: GroupSource[]
}

export interface BoneNode {
	uuid: string
	name: string
	// Whether this Group has a model of its own, so that a variant can apply to it or leave it out.
	bone: boolean
	// The uuids of the outliner ancestors and then this group, whether or not they appear in the tree.
	lineage: string[]
	children: BoneNode[]
}

export type Check = 'all' | 'none' | 'some'

export function boneTree(groups: GroupSource[], ancestors: string[] = []): BoneNode[] {
	return groups.flatMap((g): BoneNode[] => {
		const lineage = [...ancestors, g.uuid]
		const children = boneTree(g.children, lineage)
		if (g.display) return children
		const bone = g.hasCubes
		return bone || children.length > 0 ? [{ uuid: g.uuid, name: g.name, bone, lineage, children }] : []
	})
}

// The Bones at or below the node, the node first.
export function bonesOf(node: BoneNode): string[] {
	return [...(node.bone ? [node.uuid] : []), ...node.children.flatMap(bonesOf)]
}

export function allBones(tree: BoneNode[]): string[] {
	return tree.flatMap(bonesOf)
}

export function checkOf(node: BoneNode, excluded: ReadonlySet<string>): Check {
	const bones = bonesOf(node)
	const off = bones.filter((b) => excluded.has(b)).length
	return off === 0 ? 'all' : off === bones.length ? 'none' : 'some'
}

// The excluded list after the node and everything under it is applied or left out.
export function setApplied(node: BoneNode, excluded: readonly string[], apply: boolean): string[] {
	const bones = bonesOf(node)
	const rest = excluded.filter((u) => !bones.includes(u))
	return apply ? rest : [...rest, ...bones]
}

// Everything is applied except the Bones outside the selected groups and their descendants.
export function onlyUnder(tree: BoneNode[], selected: ReadonlySet<string>): string[] {
	const under = (n: BoneNode) => n.lineage.some((u) => selected.has(u))
	const walk = (nodes: BoneNode[]): string[] => nodes.flatMap((n) => [...(n.bone && !under(n) ? [n.uuid] : []), ...walk(n.children)])
	return walk(tree)
}

export interface BoneRow {
	node: BoneNode
	depth: number
	check: Check
	open: boolean
}

// The rows to draw: a closed node hides its descendants.
export function boneRows(tree: BoneNode[], excluded: ReadonlySet<string>, closed: ReadonlySet<string>, depth = 0): BoneRow[] {
	return tree.flatMap((node) => {
		const open = !closed.has(node.uuid)
		return [{ node, depth, check: checkOf(node, excluded), open }, ...(open ? boneRows(node.children, excluded, closed, depth + 1) : [])]
	})
}
