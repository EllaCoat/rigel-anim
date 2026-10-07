import { registerEasingKeyframes, unregisterEasingKeyframes } from './easing/keyframes'
import { registerEasingUi, unregisterEasingUi } from './easing/ui'
import { registerExportSettings, unregisterExportSettings } from './export/settings'
import { registerExportUi, unregisterExportUi } from './export/ui'
import { registerFormat, unregisterFormat } from './format'

const PLUGIN_ID = 'rigel'
const VERSION = '0.0.0'

BBPlugin.register(PLUGIN_ID, {
	title: 'Rigel',
	author: 'EllaCoat',
	description: 'Export Blockbench animations as display-entity data packs for Minecraft Java Edition 1.20.4 and 26.3.',
	icon: 'movie',
	version: VERSION,
	variant: 'desktop',
	min_version: '5.2.1',
	onload() {
		registerFormat()
		registerEasingKeyframes()
		registerEasingUi()
		registerExportSettings()
		registerExportUi()
	},
	onunload() {
		unregisterExportUi()
		unregisterExportSettings()
		unregisterEasingUi()
		unregisterEasingKeyframes()
		unregisterFormat()
	},
})
