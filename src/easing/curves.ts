// Easing curves: the built-in functions (the usual Penner / easings.net definitions, with the overshoot
// of back and the amplitude and period of elastic adjustable) and normalized cubic béziers with the same
// meaning as CSS cubic-bezier(). Both map the progress t through a segment, 0 to 1, to an eased progress.

export const FAMILIES = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ', 'back', 'elastic', 'bounce'] as const
export const MODES = ['in', 'out', 'inOut'] as const
export type Family = (typeof FAMILIES)[number]
export type Mode = (typeof MODES)[number]

export interface FunctionCurve {
	type: 'function'
	family: Family
	mode: Mode
	/** back only */
	overshoot?: number
	/** elastic only */
	amplitude?: number
	/** elastic only, in units of the segment */
	period?: number
}
export interface BezierCurve {
	type: 'bezier'
	x1: number
	y1: number
	x2: number
	y2: number
}
export type EasingCurve = FunctionCurve | BezierCurve
export interface Easing {
	name: string
	curve: EasingCurve
}

export const DEFAULT_OVERSHOOT = 1.70158
export const DEFAULT_AMPLITUDE = 1
export const defaultPeriod = (mode: Mode) => (mode === 'inOut' ? 0.45 : 0.3)

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1)
export const functionName = (family: Family, mode: Mode) => `ease${capitalize(mode)}${capitalize(family)}`

export function builtinEasings(): Easing[] {
	return FAMILIES.flatMap((family) => MODES.map((mode) => ({ name: functionName(family, mode), curve: { type: 'function' as const, family, mode } })))
}

type Fn = (t: number) => number

function bounceOut(t: number): number {
	const n = 7.5625
	const d = 2.75
	if (t < 1 / d) return n * t * t
	if (t < 2 / d) return n * (t - 1.5 / d) ** 2 + 0.75
	if (t < 2.5 / d) return n * (t - 2.25 / d) ** 2 + 0.9375
	return n * (t - 2.625 / d) ** 2 + 0.984375
}

// The in-variant of each family; out and in-out are derived from it, except where the family is
// defined piecewise in its own right.
function easeIn(curve: FunctionCurve): Fn {
	switch (curve.family) {
		case 'sine':
			return (t) => 1 - Math.cos((t * Math.PI) / 2)
		case 'quad':
			return (t) => t * t
		case 'cubic':
			return (t) => t ** 3
		case 'quart':
			return (t) => t ** 4
		case 'quint':
			return (t) => t ** 5
		case 'expo':
			return (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10))
		case 'circ':
			return (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t))
		case 'back': {
			const s = curve.overshoot ?? DEFAULT_OVERSHOOT
			return (t) => (s + 1) * t ** 3 - s * t * t
		}
		case 'elastic': {
			const { a, s, p } = elasticParams(curve)
			return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : -(a * 2 ** (10 * t - 10) * Math.sin(((t - 1 - s) * 2 * Math.PI) / p)))
		}
		case 'bounce':
			return (t) => 1 - bounceOut(1 - t)
	}
}

function elasticParams(curve: FunctionCurve) {
	const p = curve.period ?? defaultPeriod(curve.mode)
	const amplitude = curve.amplitude ?? DEFAULT_AMPLITUDE
	// Below 1 the curve could not reach its end values; Penner's definition raises it to 1.
	const a = Math.max(1, amplitude)
	const s = (p / (2 * Math.PI)) * Math.asin(1 / a)
	return { a, s, p }
}

function curveFunction(curve: FunctionCurve): Fn {
	if (curve.family === 'back' && curve.mode === 'inOut') {
		// Penner widens the overshoot of the in-out variant by 1.525.
		const s = (curve.overshoot ?? DEFAULT_OVERSHOOT) * 1.525
		return (t) => (t < 0.5 ? ((2 * t) ** 2 * ((s + 1) * 2 * t - s)) / 2 : ((2 * t - 2) ** 2 * ((s + 1) * (2 * t - 2) + s) + 2) / 2)
	}
	const fIn = easeIn(curve)
	switch (curve.mode) {
		case 'in':
			return fIn
		case 'out':
			return (t) => 1 - fIn(1 - t)
		case 'inOut':
			return (t) => (t < 0.5 ? fIn(2 * t) / 2 : 1 - fIn(2 - 2 * t) / 2)
	}
}

// x(s) and y(s) of a cubic bézier from (0, 0) to (1, 1) with control points (x1, y1) and (x2, y2).
const bezier1 = (p1: number, p2: number, s: number) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3
const bezier1Slope = (p1: number, p2: number, s: number) => 3 * (1 - s) ** 2 * p1 + 6 * (1 - s) * s * (p2 - p1) + 3 * s * s * (1 - p2)

/** The curve parameter where x(s) = x; x1 and x2 in [0, 1] keep x(s) monotonic. */
export function solveBezierX(x1: number, x2: number, x: number): number {
	if (x <= 0) return 0
	if (x >= 1) return 1
	let s = x
	for (let i = 0; i < 8; i++) {
		const error = bezier1(x1, x2, s) - x
		if (Math.abs(error) < 1e-12) return s
		const slope = bezier1Slope(x1, x2, s)
		if (Math.abs(slope) < 1e-9) break
		s -= error / slope
		if (s < 0 || s > 1) break
	}
	let lo = 0
	let hi = 1
	for (let i = 0; i < 60; i++) {
		s = (lo + hi) / 2
		if (bezier1(x1, x2, s) < x) lo = s
		else hi = s
	}
	return (lo + hi) / 2
}

export function bezierEase(curve: BezierCurve, t: number): number {
	return bezier1(curve.y1, curve.y2, solveBezierX(curve.x1, curve.x2, t))
}

/** The eased progress for t in [0, 1]; the ends map to exactly 0 and 1. */
export function ease(curve: EasingCurve, t: number): number {
	if (t <= 0) return 0
	if (t >= 1) return 1
	if (curve.type === 'bezier') return bezierEase(curve, t)
	return curveFunction(curve)(t)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optionalFinite = (v: unknown) => v === undefined || finite(v)

/** Checks data read from a project or a preset file. */
export function isEasingCurve(value: unknown): value is EasingCurve {
	if (typeof value !== 'object' || value === null) return false
	const c = value as Record<string, unknown>
	if (c.type === 'bezier') {
		return [c.x1, c.y1, c.x2, c.y2].every(finite) && (c.x1 as number) >= 0 && (c.x1 as number) <= 1 && (c.x2 as number) >= 0 && (c.x2 as number) <= 1
	}
	if (c.type === 'function') {
		return (
			FAMILIES.includes(c.family as Family) &&
			MODES.includes(c.mode as Mode) &&
			optionalFinite(c.overshoot) &&
			optionalFinite(c.amplitude) &&
			(c.period === undefined || (finite(c.period) && c.period > 0))
		)
	}
	return false
}

export function isEasing(value: unknown): value is Easing {
	if (typeof value !== 'object' || value === null) return false
	const e = value as Record<string, unknown>
	return typeof e.name === 'string' && e.name.length > 0 && isEasingCurve(e.curve)
}

export function sameCurve(a: EasingCurve, b: EasingCurve): boolean {
	return JSON.stringify(normalizeCurve(a)) === JSON.stringify(normalizeCurve(b))
}

// Fixed key order and defaults filled in, so equal curves compare equal.
function normalizeCurve(c: EasingCurve): unknown[] {
	if (c.type === 'bezier') return ['bezier', c.x1, c.y1, c.x2, c.y2]
	return [
		'function',
		c.family,
		c.mode,
		c.family === 'back' ? (c.overshoot ?? DEFAULT_OVERSHOOT) : null,
		c.family === 'elastic' ? (c.amplitude ?? DEFAULT_AMPLITUDE) : null,
		c.family === 'elastic' ? (c.period ?? defaultPeriod(c.mode)) : null,
	]
}
