import { refreshAllDisplayPreviews, registerDisplayPreview, unregisterDisplayPreview } from './display/preview'
import { registerDisplaySettings, unregisterDisplaySettings } from './display/settings'
import { registerDisplayUi, unregisterDisplayUi } from './display/ui'
import { registerEasingKeyframes, unregisterEasingKeyframes } from './easing/keyframes'
import { registerEasingUi, unregisterEasingUi } from './easing/ui'
import { registerExportSettings, unregisterExportSettings } from './export/settings'
import { registerExportUi, unregisterExportUi } from './export/ui'
import { registerFontSettings, unregisterFontSettings } from './font'
import { registerFormat, unregisterFormat } from './format'
import { registerLocatorSettings, unregisterLocatorSettings } from './locator/settings'
import { registerLocatorUi, unregisterLocatorUi } from './locator/ui'
import { registerVariantSettings, unregisterVariantSettings } from './variant/settings'
import { redrawVariantPanel, registerVariantPanel, unregisterVariantPanel } from './variant/panel'
import { registerVariantUndo, unregisterVariantUndo } from './variant/undo'
import { refreshView, registerVariantView, unregisterVariantView } from './variant/view'

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
		registerVariantSettings()
		registerDisplaySettings()
		registerLocatorSettings()
		registerExportUi()
		registerVariantPanel()
		registerVariantView(redrawVariantPanel)
		registerVariantUndo(refreshView)
		registerDisplayUi()
		registerLocatorUi()
		registerFontSettings(refreshAllDisplayPreviews)
		registerDisplayPreview()
	},
	onunload() {
		unregisterDisplayPreview()
		unregisterFontSettings()
		unregisterLocatorUi()
		unregisterDisplayUi()
		unregisterVariantUndo()
		unregisterVariantView()
		unregisterVariantPanel()
		unregisterExportUi()
		unregisterLocatorSettings()
		unregisterDisplaySettings()
		unregisterVariantSettings()
		unregisterExportSettings()
		unregisterEasingUi()
		unregisterEasingKeyframes()
		unregisterFormat()
	},
})
