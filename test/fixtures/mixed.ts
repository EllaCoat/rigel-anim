import { expect, test } from 'bun:test'

test('passes on purpose', () => {
	console.log(['output', 'from', 'a', 'test'].join('-'))
	expect(1).toBe(1)
})

test('fails on purpose', () => {
	expect(2).toBe(3)
})
