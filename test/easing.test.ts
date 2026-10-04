import { describe, expect, test } from 'bun:test'
import { bezierEase, builtinEasings, ease, isEasing, sameCurve, type EasingCurve } from '../src/easing/curves'
import { fitBezier, thirdsBezier } from '../src/easing/fit'
import { mergePresets, parsePresetFile, presetFile, loadPresets } from '../src/easing/presets'
import { catmullromNeighbours, easedProgress, segmentKind } from '../src/easing/segments'

// The easings.net definitions, written independently of the parameterised implementation.
const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5
function bounceOut(x: number): number {
	const n1 = 7.5625
	const d1 = 2.75
	if (x < 1 / d1) return n1 * x * x
	if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
	if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
	return n1 * (x -= 2.625 / d1) * x + 0.984375
}
const reference: Record<string, (x: number) => number> = {
	easeInSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
	easeOutSine: (x) => Math.sin((x * Math.PI) / 2),
	easeInOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
	easeInQuad: (x) => x * x,
	easeOutQuad: (x) => 1 - (1 - x) * (1 - x),
	easeInOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
	easeInCubic: (x) => x * x * x,
	easeOutCubic: (x) => 1 - Math.pow(1 - x, 3),
	easeInOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
	easeInQuart: (x) => x * x * x * x,
	easeOutQuart: (x) => 1 - Math.pow(1 - x, 4),
	easeInOutQuart: (x) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
	easeInQuint: (x) => x * x * x * x * x,
	easeOutQuint: (x) => 1 - Math.pow(1 - x, 5),
	easeInOutQuint: (x) => (x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2),
	easeInExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
	easeOutExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
	easeInOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
	easeInCirc: (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
	easeOutCirc: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
	easeInOutCirc: (x) => (x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2),
	easeInBack: (x) => c3 * x * x * x - c1 * x * x,
	easeOutBack: (x) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
	easeInOutBack: (x) => (x < 0.5 ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2),
	easeInElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4)),
	easeOutElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
	easeInOutElastic: (x) =>
		x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
	easeInBounce: (x) => 1 - bounceOut(1 - x),
	easeOutBounce: bounceOut,
	easeInOutBounce: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
}

describe('easing curves', () => {
	const builtins = builtinEasings()

	test('there are 30 built-in easings, each matching its easings.net definition', () => {
		expect(builtins.length).toBe(30)
		for (const { name, curve } of builtins) {
			const ref = reference[name]
			expect(ref, name).toBeDefined()
			for (let i = 1; i < 100; i++) expect(ease(curve, i / 100), `${name}(${i / 100})`).toBeCloseTo(ref!(i / 100), 12)
		}
	})

	test('every curve starts at 0 and ends at 1', () => {
		const curves: EasingCurve[] = [...builtins.map((e) => e.curve), { type: 'bezier', x1: 0.2, y1: -0.5, x2: 0.8, y2: 1.6 }]
		for (const curve of curves) {
			expect(ease(curve, 0)).toBe(0)
			expect(ease(curve, 1)).toBe(1)
		}
	})

	test('back and elastic take their parameters', () => {
		expect(ease({ type: 'function', family: 'back', mode: 'in', overshoot: 0 }, 0.5)).toBeCloseTo(0.125, 12)
		const elastic = (amplitude?: number, period?: number): number => {
			let peak = 0
			for (let i = 1; i < 1000; i++) peak = Math.max(peak, ease({ type: 'function', family: 'elastic', mode: 'out', amplitude, period }, i / 1000))
			return peak
		}
		expect(elastic(2)).toBeGreaterThan(elastic() + 0.1)
		// A shorter period oscillates more often, so the first overshoot comes earlier.
		const firstPeak = (period: number) => {
			for (let i = 1; i < 1000; i++) if (ease({ type: 'function', family: 'elastic', mode: 'out', period }, i / 1000) > 1) return i
			return 1000
		}
		expect(firstPeak(0.15)).toBeLessThan(firstPeak(0.3))
	})

	test('béziers follow CSS cubic-bezier()', () => {
		// CSS 'ease' at the halfway time.
		expect(bezierEase({ type: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 }, 0.5)).toBeCloseTo(0.8024033877, 8)
		for (let i = 0; i <= 10; i++) expect(bezierEase({ type: 'bezier', x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }, i / 10)).toBeCloseTo(i / 10, 10)
		// Steep ends, where Newton's method alone would leave [0, 1].
		const steep = { type: 'bezier' as const, x1: 1, y1: 0, x2: 0, y2: 1 }
		let previous = 0
		for (let i = 1; i <= 100; i++) {
			const v = bezierEase(steep, i / 100)
			expect(v).toBeGreaterThanOrEqual(previous - 1e-12)
			previous = v
		}
	})

	test('stored data is checked and compared by shape', () => {
		expect(isEasing({ name: 'a', curve: { type: 'bezier', x1: 0.5, y1: 2, x2: 0.5, y2: -1 } })).toBe(true)
		expect(isEasing({ name: 'a', curve: { type: 'bezier', x1: 1.5, y1: 0, x2: 0.5, y2: 1 } })).toBe(false)
		expect(isEasing({ name: '', curve: { type: 'function', family: 'quad', mode: 'in' } })).toBe(false)
		expect(isEasing({ name: 'a', curve: { type: 'function', family: 'wobble', mode: 'in' } })).toBe(false)
		expect(isEasing({ name: 'a', curve: { type: 'function', family: 'elastic', mode: 'in', period: 0 } })).toBe(false)
		expect(sameCurve({ type: 'function', family: 'back', mode: 'out' }, { type: 'function', family: 'back', mode: 'out', overshoot: 1.70158 })).toBe(true)
		expect(sameCurve({ type: 'function', family: 'quad', mode: 'out', overshoot: 3 }, { type: 'function', family: 'quad', mode: 'out' })).toBe(true)
		expect(sameCurve({ type: 'function', family: 'back', mode: 'out', overshoot: 3 }, { type: 'function', family: 'back', mode: 'out' })).toBe(false)
	})
})

// Value of a bézier with time handles x1, x2 at time t, from f0 to f3.
function bezierAt(f0: number, x1: number, v1: number, x2: number, v2: number, f3: number, t: number): number {
	let lo = 0
	let hi = 1
	for (let i = 0; i < 60; i++) {
		const m = (lo + hi) / 2
		const x = 3 * (1 - m) ** 2 * m * x1 + 3 * (1 - m) * m * m * x2 + m ** 3
		if (x < t) lo = m
		else hi = m
	}
	const u = (lo + hi) / 2
	return (1 - u) ** 3 * f0 + 3 * (1 - u) ** 2 * u * v1 + 3 * (1 - u) * u * u * v2 + u ** 3 * f3
}

describe('bézier fitting', () => {
	test('handles at thirds reproduce any cubic', () => {
		const f = (t: number) => 2 * t ** 3 - 3 * t * t + t + 5
		const [v1, v2] = thirdsBezier(f(0), f(1 / 3), f(2 / 3), f(1))
		for (let i = 0; i <= 20; i++) expect(bezierAt(f(0), 1 / 3, v1, 2 / 3, v2, f(1), i / 20)).toBeCloseTo(f(i / 20), 10)
	})

	const sampled = (f: (t: number) => number) => Array.from({ length: 201 }, (_, i) => f(i / 200))
	const curve = (name: string) => builtinEasings().find((e) => e.name === name)!.curve

	test('quad, cubic and back fit exactly; others within their known error', () => {
		for (const name of ['easeInQuad', 'easeOutCubic', 'easeOutBack', 'easeInBack']) {
			expect(fitBezier(sampled((t) => ease(curve(name), t))).error, name).toBeLessThan(1e-6)
		}
		const inOutQuad = fitBezier(sampled((t) => ease(curve('easeInOutQuad'), t)))
		expect(inOutQuad.error).toBeGreaterThan(0.004)
		expect(inOutQuad.error).toBeLessThan(0.006)
		expect(fitBezier(sampled((t) => ease(curve('easeOutExpo'), t))).error).toBeLessThan(0.0015)
	})

	test('a fit scales with the values and stays a function of time', () => {
		const fit = fitBezier(sampled((t) => 10 + 90 * ease(curve('easeOutSine'), t)))
		expect(fit.error).toBeLessThan(90 * 0.0015)
		expect(fit.x1).toBeGreaterThanOrEqual(0)
		expect(fit.x1).toBeLessThanOrEqual(1)
		expect(fit.x2).toBeGreaterThanOrEqual(0)
		expect(fit.x2).toBeLessThanOrEqual(1)
		for (let i = 0; i <= 20; i++) {
			expect(Math.abs(bezierAt(10, fit.x1, fit.v1, fit.x2, fit.v2, 100, i / 20) - (10 + 90 * ease(curve('easeOutSine'), i / 20)))).toBeLessThan(90 * 0.0015)
		}
	})
})

describe('segments', () => {
	const k = (interpolation: string) => ({ interpolation })

	test('interpolation precedence follows Blockbench', () => {
		expect(segmentKind(k('step'), k('catmullrom'))).toBe('step')
		expect(segmentKind(k('linear'), k('linear'))).toBe('linear')
		expect(segmentKind(k('linear'), k('step'))).toBe('linear')
		expect(segmentKind(k('linear'), k('catmullrom'))).toBe('catmullrom')
		expect(segmentKind(k('bezier'), k('catmullrom'))).toBe('catmullrom')
		expect(segmentKind(k('linear'), k('bezier'))).toBe('bezier')
		expect(segmentKind(k('bezier'), k('step'))).toBe('bezier')
	})

	test('catmullrom neighbours wrap in looping animations', () => {
		const sorted = ['a', 'b', 'c', 'd']
		expect(catmullromNeighbours(sorted, 0, false)).toEqual({ before: undefined, after: 'c' })
		expect(catmullromNeighbours(sorted, 2, false)).toEqual({ before: 'b', after: undefined })
		expect(catmullromNeighbours(sorted, 0, true)).toEqual({ before: 'c', after: 'c' })
		expect(catmullromNeighbours(sorted, 2, true)).toEqual({ before: 'b', after: 'b' })
		expect(catmullromNeighbours(['a', 'b'], 0, true)).toEqual({ before: undefined, after: undefined })
	})

	test('overshoot stays within what Blockbench can evaluate', () => {
		const inBack: EasingCurve = { type: 'function', family: 'back', mode: 'in' }
		const outBack: EasingCurve = { type: 'function', family: 'back', mode: 'out' }
		const strong: EasingCurve = { type: 'function', family: 'elastic', mode: 'in', amplitude: 8 }
		const context = (kind: 'linear' | 'catmullrom' | 'bezier', hasBefore: boolean, hasAfter: boolean, discontinuous = false) => ({ kind, hasBefore, hasAfter, discontinuous })
		expect(easedProgress(inBack, 0.2, context('linear', false, false))).toBeLessThan(0)
		expect(easedProgress(inBack, 0.2, context('catmullrom', true, true))).toBeLessThan(0)
		expect(easedProgress(inBack, 0.2, context('catmullrom', false, true))).toBe(0)
		expect(easedProgress(outBack, 0.8, context('catmullrom', true, true))).toBeGreaterThan(1)
		expect(easedProgress(outBack, 0.8, context('catmullrom', true, false))).toBe(1)
		expect(easedProgress(outBack, 0.8, context('catmullrom', true, true, true))).toBeLessThan(1)
		let lowest = 0
		for (let i = 1; i < 1000; i++) lowest = Math.min(lowest, easedProgress(strong, i / 1000, context('catmullrom', true, true)))
		expect(lowest).toBe(-1)
	})
})

describe('presets', () => {
	const a = { name: 'a', curve: { type: 'bezier' as const, x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 } }
	const b = { name: 'b', curve: { type: 'function' as const, family: 'back' as const, mode: 'out' as const, overshoot: 3 } }

	test('a preset file reads back what was written', () => {
		expect(parsePresetFile(presetFile([a, b]))).toEqual([a, b])
	})

	test('files that are not preset files are refused with a reason', () => {
		expect(() => parsePresetFile('{')).toThrow('JSON')
		expect(() => parsePresetFile(JSON.stringify([a]))).toThrow('プリセットのファイルではない')
		expect(() => parsePresetFile(JSON.stringify({ format: 'rigel-easing-presets', version: 2, presets: [] }))).toThrow('新しい版')
		expect(() => parsePresetFile(JSON.stringify({ format: 'rigel-easing-presets', version: 1, presets: [a, { name: 'x' }] }))).toThrow('1 個')
	})

	test('imports add new names and replace existing ones', () => {
		const b2 = { ...b, curve: { ...b.curve, overshoot: 5 } }
		expect(mergePresets([a, b], [b2, { ...a, name: 'c' }])).toEqual({ presets: [a, b2, { ...a, name: 'c' }], added: 1, replaced: 1 })
	})

	test('stored presets that do not parse are dropped', () => {
		const storage = (value: string | null) => ({ getItem: () => value })
		expect(loadPresets(storage(JSON.stringify([a, { name: 'broken' }])))).toEqual([a])
		expect(loadPresets(storage('not json'))).toEqual([])
		expect(loadPresets(storage(null))).toEqual([])
	})
})
