// Runs inside the development Blockbench: mc-shot.ts bundles this file and injects it as __rigelShot.
import { blockbenchCamera, FOV, type View } from './shot-spec'

async function open(model: any, name: string) {
	const format = model.meta?.model_format
	if (!Formats[format]) throw new Error(`model format "${format}" is not registered; rigel models need \`bun scripts/dev-bb.ts install\``)
	for (const project of [...ModelProject.all]) {
		project.saved = true
		await project.close(true)
	}
	Codecs.project.load(model, { name, path: name, no_file: true } as any)
	unselectAllElements()
	return { format: Format.id, elements: Outliner.elements.length }
}

// Draws only the model (no grid, gizmos or background) into a transparent image of the given size.
function render(view: View, width: number, height: number): string {
	const renderer = Preview.selected!.renderer
	const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.5, 30000)
	const { position, target } = blockbenchCamera(view)
	camera.position.set(...position)
	camera.lookAt(...target)

	const renderTarget = new THREE.WebGLRenderTarget(width, height)
	const previousTarget = renderer.getRenderTarget()
	const previousColor = renderer.getClearColor(new THREE.Color())
	const previousAlpha = renderer.getClearAlpha()
	const pixels = new Uint8Array(width * height * 4)
	try {
		renderer.setRenderTarget(renderTarget)
		renderer.setClearColor(0x000000, 0)
		renderer.clear()
		renderer.render(Project!.model_3d, camera)
		renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixels)
	} finally {
		renderer.setRenderTarget(previousTarget)
		renderer.setClearColor(previousColor, previousAlpha)
		renderTarget.dispose()
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const image = new ImageData(width, height)
	// WebGL rows run bottom to top.
	for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4)
	canvas.getContext('2d')!.putImageData(image, 0, 0)
	return canvas.toDataURL('image/png')
}

function load(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('could not decode an image'))
		image.src = url
	})
}

// Minecraft | Blockbench | Blockbench at half opacity over Minecraft, each labelled.
async function compose(minecraft: string, blockbench: string): Promise<string> {
	const [mc, bb] = await Promise.all([load(minecraft), load(blockbench)])
	const { width, height } = mc
	const canvas = document.createElement('canvas')
	canvas.width = width * 3
	canvas.height = height
	const ctx = canvas.getContext('2d')!
	ctx.drawImage(mc, 0, 0)
	ctx.fillStyle = '#3a3f47'
	ctx.fillRect(width, 0, width, height)
	ctx.drawImage(bb, width, 0)
	ctx.drawImage(mc, width * 2, 0)
	ctx.globalAlpha = 0.5
	ctx.drawImage(bb, width * 2, 0)
	ctx.globalAlpha = 1
	ctx.font = `bold ${Math.round(height / 24)}px sans-serif`
	ctx.textBaseline = 'top'
	;['Minecraft', 'Blockbench', 'Blockbench over Minecraft'].forEach((label, i) => {
		const x = width * i + 12
		ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
		ctx.fillRect(x - 6, 6, ctx.measureText(label).width + 12, height / 24 + 12)
		ctx.fillStyle = '#ffffff'
		ctx.fillText(label, x, 12)
	})
	return canvas.toDataURL('image/png')
}

;(window as any).__rigelShot = { open, render, compose }
