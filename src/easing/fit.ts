// Cubic béziers in the form Blockbench uses for keyframe handles: time runs from 0 to 1 along the
// segment and the value from f(0) to f(1); (x1, v1) and (x2, v2) are the two inner control points.
import { solveBezierX } from './curves'

export interface BezierFit {
	x1: number
	v1: number
	x2: number
	v2: number
	/** largest |bezier - target| over the samples */
	error: number
}

const bernstein = (s: number): [number, number, number, number] => {
	const u = 1 - s
	return [u * u * u, 3 * u * u * s, 3 * u * s * s, s * s * s]
}

/**
 * Inner control values of the bézier with time handles at 1/3 and 2/3, where time is linear in the
 * curve parameter, through f(0), f(1/3), f(2/3), f(1). Exact for any cubic in t, so linear and
 * catmullrom segments keep their shape.
 */
export function thirdsBezier(f0: number, f1: number, f2: number, f3: number): [number, number] {
	// f(1/3) = (8 f0 + 12 v1 + 6 v2 + f3) / 27 and f(2/3) = (f0 + 6 v1 + 12 v2 + 8 f3) / 27
	const a = 27 * f1 - 8 * f0 - f3
	const b = 27 * f2 - f0 - 8 * f3
	return [(2 * a - b) / 18, (2 * b - a) / 18]
}

/** samples[i] is the target at t = i / (samples.length - 1); at least 3 samples. */
export function fitBezier(samples: ArrayLike<number>): BezierFit {
	let best = fitWithTimeHandles(samples, 1 / 3, 2 / 3)
	const GRID = 10
	for (let i = 0; i <= GRID; i++) {
		for (let j = 0; j <= GRID; j++) {
			const fit = fitWithTimeHandles(samples, i / GRID, j / GRID)
			if (fit.error < best.error) best = fit
		}
	}
	// Pattern search around the best grid point.
	let step = 0.5 / GRID
	while (step > 1e-3) {
		let improved = false
		for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
			const fit = fitWithTimeHandles(samples, clamp01(best.x1 + dx), clamp01(best.x2 + dy))
			if (fit.error < best.error) {
				best = fit
				improved = true
			}
		}
		if (!improved) step /= 2
	}
	return best
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// Least-squares inner values for fixed time handles.
function fitWithTimeHandles(samples: ArrayLike<number>, x1: number, x2: number): BezierFit {
	const n = samples.length - 1
	const f0 = samples[0]!
	const f3 = samples[n]!
	const basis: [number, number, number, number][] = []
	let a11 = 0
	let a12 = 0
	let a22 = 0
	let r1 = 0
	let r2 = 0
	for (let i = 0; i <= n; i++) {
		const b = bernstein(solveBezierX(x1, x2, i / n))
		basis.push(b)
		const r = samples[i]! - b[0] * f0 - b[3] * f3
		a11 += b[1] * b[1]
		a12 += b[1] * b[2]
		a22 += b[2] * b[2]
		r1 += b[1] * r
		r2 += b[2] * r
	}
	const det = a11 * a22 - a12 * a12
	let v1 = f0 + (f3 - f0) / 3
	let v2 = f0 + (2 * (f3 - f0)) / 3
	if (Math.abs(det) > 1e-12 * Math.max(1, a11 * a22)) {
		v1 = (r1 * a22 - r2 * a12) / det
		v2 = (a11 * r2 - a12 * r1) / det
	}
	let error = 0
	for (let i = 0; i <= n; i++) {
		const b = basis[i]!
		error = Math.max(error, Math.abs(b[0] * f0 + b[1] * v1 + b[2] * v2 + b[3] * f3 - samples[i]!))
	}
	return { x1, v1, x2, v2, error }
}
