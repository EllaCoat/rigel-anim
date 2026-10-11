import { describe, expect, test } from 'bun:test'
import { allBones, boneRows, boneTree, bonesOf, checkOf, onlyUnder, setApplied, type BoneNode, type GroupSource } from '../src/variant/tree'

const group = (name: string, children: GroupSource[] = [], kind: 'bone' | 'plain' | 'display' = 'bone'): GroupSource => ({ uuid: name, name, display: kind === 'display', hasCubes: kind === 'bone', children })

describe('bone tree', () => {
	const roots = [
		group('body', [
			group('head', [group('eye_l'), group('eye_r')]),
			group('arm'),
			group('pivot', [group('gem')], 'plain'),
			group('label', [group('note')], 'display'),
			group('empty', [], 'plain'),
		]),
	]
	const tree = boneTree(roots)
	const names = (nodes: BoneNode[]): unknown[] => nodes.map((n) => (n.children.length ? { [n.name]: names(n.children) } : n.name))

	test('follows the outliner without displays and groups that lead to no bone, and keeps what a display held', () => {
		expect(names(tree)).toEqual([{ body: [{ head: ['eye_l', 'eye_r'] }, 'arm', { pivot: ['gem'] }, 'note'] }])
		expect(tree[0]!.children.find((n) => n.name === 'note')!.lineage).toEqual(['body', 'label', 'note'])
		expect(tree[0]!.children.find((n) => n.name === 'pivot')!.bone).toBe(false)
	})

	test('a parent is checked when every bone under it is, and half checked when they differ', () => {
		const head = tree[0]!.children[0]!
		const pivot = tree[0]!.children[2]!
		expect(checkOf(head, new Set())).toBe('all')
		expect(checkOf(head, new Set(['eye_l']))).toBe('some')
		expect(checkOf(head, new Set(['head', 'eye_l', 'eye_r']))).toBe('none')
		expect(checkOf(head, new Set(['head']))).toBe('some')
		expect(checkOf(pivot, new Set(['gem']))).toBe('none')
		expect(checkOf(tree[0]!, new Set(['gem']))).toBe('some')
	})

	test('switching a parent switches everything under it, and nothing else', () => {
		const head = tree[0]!.children[0]!
		expect(setApplied(head, ['arm', 'gone'], false)).toEqual(['arm', 'gone', 'head', 'eye_l', 'eye_r'])
		expect(setApplied(head, ['eye_l', 'arm'], false)).toEqual(['arm', 'head', 'eye_l', 'eye_r'])
		expect(setApplied(head, ['head', 'eye_l', 'eye_r', 'arm'], true)).toEqual(['arm'])
		expect(setApplied(tree[0]!.children[2]!, [], false)).toEqual(['gem'])
		expect(bonesOf(tree[0]!)).toEqual(['body', 'head', 'eye_l', 'eye_r', 'arm', 'gem', 'note'])
		expect(allBones(tree)).toEqual(bonesOf(tree[0]!))
	})

	test('only the selected groups and their descendants stay applied', () => {
		expect(onlyUnder(tree, new Set(['head']))).toEqual(['body', 'arm', 'gem', 'note'])
		expect(onlyUnder(tree, new Set(['head', 'pivot']))).toEqual(['body', 'arm', 'note'])
		expect(onlyUnder(tree, new Set(['label']))).toEqual(['body', 'head', 'eye_l', 'eye_r', 'arm', 'gem'])
		expect(onlyUnder(tree, new Set(['body']))).toEqual([])
		expect(onlyUnder(tree, new Set())).toEqual(allBones(tree))
	})

	test('a folded group hides its descendants from the rows', () => {
		const rows = (closed: string[]) => boneRows(tree, new Set(['eye_r']), new Set(closed)).map((r) => `${'.'.repeat(r.depth)}${r.node.name}:${r.check}${r.open ? '' : '+'}`)
		expect(rows([])).toEqual(['body:some', '.head:some', '..eye_l:all', '..eye_r:none', '.arm:all', '.pivot:all', '..gem:all', '.note:all'])
		expect(rows(['head', 'pivot'])).toEqual(['body:some', '.head:some+', '.arm:all', '.pivot:all+', '.note:all'])
	})
})
