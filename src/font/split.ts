import type { TextPart } from './component'
import { applyLegacyFormat, EMPTY_STYLE, type Style } from './style'

/** FormattedCharSink: return false to stop. */
type CharSink = (index: number, style: Style, codepoint: number) => boolean
export type WidthOf = (codepoint: number, style: Style) => number

export interface StyledChar {
	codepoint: number
	style: Style
}

const SECTION_SIGN = 0xa7
const REPLACEMENT_CHARACTER = 0xfffd

const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff
const charCount = (codepoint: number) => (codepoint >= 0x10000 ? 2 : 1)

/** StringDecomposer.iterateFormatted: a `§` and the code after it change the style instead of being a character. */
export function iterateFormatted(text: string, start: number, style: Style, resetStyle: Style, sink: CharSink): boolean {
	let current = style
	for (let i = start; i < text.length; i++) {
		const unit = text.charCodeAt(i)
		if (unit === SECTION_SIGN) {
			if (i + 1 >= text.length) break
			current = applyLegacyFormat(current, text[i + 1]!, resetStyle)
			i++
		} else if (isHighSurrogate(unit)) {
			if (i + 1 >= text.length) {
				if (!sink(i, current, REPLACEMENT_CHARACTER)) return false
				break
			}
			const next = text.charCodeAt(i + 1)
			if (isLowSurrogate(next)) {
				if (!sink(i, current, text.codePointAt(i)!)) return false
				i++
			} else if (!sink(i, current, REPLACEMENT_CHARACTER)) return false
		} else if (!sink(i, current, isLowSurrogate(unit) ? REPLACEMENT_CHARACTER : unit)) return false
	}
	return true
}

/** StringSplitter.LineBreakFinder */
class LineBreakFinder {
	private readonly maxWidth: number
	private lineBreak = -1
	private hadNonZeroWidthChar = false
	private width = 0
	private lastSpace = -1
	private lastSpaceStyle = EMPTY_STYLE
	private nextChar = 0
	private offset = 0
	splitStyle = EMPTY_STYLE

	constructor(
		maxWidth: number,
		private readonly widthOf: WidthOf,
	) {
		this.maxWidth = Math.fround(Math.max(maxWidth, 1))
	}

	readonly accept: CharSink = (index, style, codepoint) => {
		const position = index + this.offset
		if (codepoint === 10) return this.finish(position, style)
		if (codepoint === 32) {
			this.lastSpace = position
			this.lastSpaceStyle = style
		}
		const advance = this.widthOf(codepoint, style)
		this.width = Math.fround(this.width + advance)
		if (!this.hadNonZeroWidthChar || !(this.width > this.maxWidth)) {
			this.hadNonZeroWidthChar ||= advance !== 0
			this.nextChar = position + charCount(codepoint)
			return true
		}
		return this.lastSpace !== -1 ? this.finish(this.lastSpace, this.lastSpaceStyle) : this.finish(position, style)
	}

	private finish(position: number, style: Style): false {
		this.lineBreak = position
		this.splitStyle = style
		return false
	}

	get splitPosition() {
		return this.lineBreak !== -1 ? this.lineBreak : this.nextChar
	}

	addToOffset(length: number) {
		this.offset += length
	}
}

/** StringSplitter.FlatComponents: the remaining text of a split in progress. */
class FlatComponents {
	private flat: string

	constructor(readonly parts: TextPart[]) {
		this.flat = parts.map((part) => part.text).join('')
	}

	charAt(index: number) {
		return this.flat[index]
	}

	/** Takes the text before `position` as a line and drops `skip` characters after it; the rest continues in `style`. */
	splitAt(position: number, skip: number, style: Style): TextPart[] {
		const line: TextPart[] = []
		let remaining = position
		let passed = false
		let i = 0
		while (i < this.parts.length) {
			const part = this.parts[i]!
			const length = part.text.length
			if (!passed) {
				if (remaining > length) {
					line.push(part)
					this.parts.splice(i, 1)
					remaining -= length
					continue
				}
				const head = part.text.slice(0, remaining)
				if (head !== '') line.push({ text: head, style: part.style })
				remaining += skip
				passed = true
			}
			if (remaining <= length) {
				const tail = part.text.slice(remaining)
				if (tail === '') this.parts.splice(i, 1)
				else this.parts[i] = { text: tail, style }
				break
			}
			this.parts.splice(i, 1)
			remaining -= length
		}
		this.flat = this.flat.slice(position + skip)
		return line
	}
}

/**
 * StringSplitter.splitLines(FormattedText, width, Style.EMPTY): the lines Font.split gives before the visual-order step.
 * A line break comes at a newline, at the last space that fits, or in the middle of a word that does not fit on any line.
 */
export function splitLines(input: TextPart[], maxWidth: number, widthOf: WidthOf): TextPart[][] {
	const flat = new FlatComponents(input.filter((part) => part.text !== ''))
	const lines: TextPart[][] = []
	let lastBreakWasNewline = false
	for (let again = true; again; ) {
		again = false
		const finder = new LineBreakFinder(maxWidth, widthOf)
		for (const part of flat.parts) {
			if (!iterateFormatted(part.text, 0, part.style, EMPTY_STYLE, finder.accept)) {
				const position = finder.splitPosition
				const at = flat.charAt(position)
				lastBreakWasNewline = at === '\n'
				lines.push(flat.splitAt(position, at === '\n' || at === ' ' ? 1 : 0, finder.splitStyle))
				again = true
				break
			}
			finder.addToOffset(part.text.length)
		}
	}
	if (flat.parts.length > 0) lines.push([...flat.parts])
	else if (lastBreakWasNewline) lines.push([])
	return lines
}

/** FormattedBidiReorder for left-to-right text: the characters of a line, `§` codes applied, each with its style. */
export function lineChars(line: TextPart[]): StyledChar[] {
	// ponytail: no bidi reordering or Arabic shaping; right-to-left text keeps its logical order, add ICU-like handling if needed
	const chars: StyledChar[] = []
	for (const part of line) {
		iterateFormatted(part.text, 0, part.style, part.style, (_, style, codepoint) => {
			chars.push({ codepoint, style })
			return true
		})
	}
	return chars
}
