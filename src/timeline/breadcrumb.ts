import { onRefresh, timelineBody, timelineRoot } from './bar'

const ATTRIBUTE = 'data-rigel-breadcrumb'
const NAME = '.timeline_animator_name'
const TOOLTIP = 'rigel-breadcrumb-tooltip'

type Named = { name?: unknown; parent?: unknown }

// "Body > Arm > Hand" for a node that has parents; undefined for a node at the root or one that is not in the outliner.
function breadcrumb(uuid: string): string | undefined {
	let node: Named | undefined = OutlinerNode.uuids[uuid] as Named | undefined
	if (typeof node?.name !== 'string') return undefined
	const path = [node.name]
	const seen = new Set<unknown>()
	while (typeof node.parent === 'object' && node.parent !== null && !seen.has(node.parent)) {
		seen.add(node.parent)
		node = node.parent as Named
		if (typeof node.name === 'string') path.unshift(node.name)
	}
	return path.length > 1 ? path.join(' > ') : undefined
}

function tag(): void {
	for (const row of timelineBody()?.querySelectorAll<HTMLElement>('li.animator') ?? []) {
		const name = row.querySelector<HTMLElement>(NAME)
		const path = breadcrumb(row.getAttribute('uuid') ?? '')
		if (path) name?.setAttribute(ATTRIBUTE, path)
		else name?.removeAttribute(ATTRIBUTE)
	}
}

function untag(): void {
	for (const name of timelineBody()?.querySelectorAll(`[${ATTRIBUTE}]`) ?? []) name.removeAttribute(ATTRIBUTE)
}

let tooltip: HTMLElement | undefined

// On the body, not in the panel: other panels stack above anything inside it.
function tooltipElement(): HTMLElement {
	if (!tooltip) {
		tooltip = document.createElement('div')
		tooltip.id = TOOLTIP
		tooltip.style.cssText = [
			'position: fixed',
			'display: none',
			'z-index: 99999',
			'max-width: 400px',
			'padding: 4px 8px',
			'white-space: nowrap',
			'font-size: 12px',
			'pointer-events: none',
			'background: var(--color-back)',
			'color: var(--color-text)',
			'border: 1px solid var(--color-border)',
			'border-radius: 2px',
			'box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35)',
			'transform: translateY(-50%)',
		].join('; ')
		document.body.append(tooltip)
	}
	return tooltip
}

function hideTooltip(): void {
	if (tooltip) tooltip.style.display = 'none'
}

function onOver(event: MouseEvent): void {
	const name = (event.target as HTMLElement | null)?.closest<HTMLElement>(NAME)
	const path = name?.getAttribute(ATTRIBUTE)
	if (!name || !path) return hideTooltip()
	const rect = name.getBoundingClientRect()
	const element = tooltipElement()
	element.textContent = path
	element.style.display = 'block'
	element.style.right = `${Math.max(8, window.innerWidth - rect.left + 12)}px`
	element.style.top = `${rect.top + rect.height / 2}px`
}

function onOut(event: MouseEvent): void {
	if ((event.target as HTMLElement | null)?.closest(NAME)) hideTooltip()
}

let stopRefresh: (() => void) | undefined
let root: HTMLElement | undefined

export function registerBreadcrumb(): void {
	root = timelineRoot()
	root?.addEventListener('mouseover', onOver, true)
	root?.addEventListener('mouseout', onOut, true)
	stopRefresh = onRefresh((active) => {
		if (active) tag()
		else {
			untag()
			hideTooltip()
		}
	})
}

export function unregisterBreadcrumb(): void {
	stopRefresh?.()
	stopRefresh = undefined
	root?.removeEventListener('mouseover', onOver, true)
	root?.removeEventListener('mouseout', onOut, true)
	root = undefined
	untag()
	tooltip?.remove()
	tooltip = undefined
}
