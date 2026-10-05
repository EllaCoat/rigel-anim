// The Minecraft version the benchmark runs against (RIGEL_BENCH_MC, default 1.20.4) and what differs
// between versions: the Java runtime, the pack metadata and folder names, the item NBT and game rules.
export interface Target {
	version: string
	javaMajor: number
	packMeta: object
	// Folder under data/<namespace>/ for functions, and under data/minecraft/tags/ for function tags.
	functions: string
	// Bone item; `model` gives it a custom model, `name` adds a long custom name (a larger item NBT).
	item: (options: { model: boolean; name?: string }) => string
	// Game rules that keep the world quiet while measuring.
	quietRules: string[]
	// Commands that keep the benchmark area loaded without players. 1.20.4 has spawn chunks for that;
	// they were removed in 1.21.9.
	keepLoaded: string[]
	// The obfuscated jars need Mojang's mappings to read JFR stacks; 26.x jars are not obfuscated.
	obfuscated: boolean
}

const TARGETS: Record<string, Target> = {
	'1.20.4': {
		version: '1.20.4',
		javaMajor: 17,
		packMeta: { pack: { pack_format: 26, description: 'rigel-anim benchmark' } },
		functions: 'functions',
		item: ({ model, name }) => {
			const tag = [model ? 'CustomModelData:1' : '', name ? `display:{Name:'{"text":"${name}"}'}` : ''].filter(Boolean).join(',')
			return `{id:"minecraft:stone",Count:1b${tag ? `,tag:{${tag}}` : ''}}`
		},
		quietRules: ['doDaylightCycle false', 'doWeatherCycle false', 'randomTickSpeed 0', 'doMobSpawning false'],
		keepLoaded: [],
		obfuscated: true,
	},
	'26.1.2': {
		version: '26.1.2',
		javaMajor: 25,
		packMeta: { pack: { min_format: 101, max_format: 101, description: 'rigel-anim benchmark' } },
		functions: 'function',
		item: ({ model, name }) => {
			const components = [model ? '"minecraft:custom_model_data":{floats:[1f]}' : '', name ? `"minecraft:custom_name":"${name}"` : ''].filter(Boolean).join(',')
			return `{id:"minecraft:stone",count:1${components ? `,components:{${components}}` : ''}}`
		},
		quietRules: ['advance_time false', 'advance_weather false', 'random_tick_speed 0', 'spawn_mobs false'],
		// Rigs stand at x 0–8, z 0; background entities spread over x −25–24, z −50–49.
		keepLoaded: ['forceload add -32 -64 31 15'],
		obfuscated: false,
	},
}

const requested = process.env.RIGEL_BENCH_MC ?? '1.20.4'
if (!(requested in TARGETS)) throw new Error(`RIGEL_BENCH_MC=${requested} is not supported (${Object.keys(TARGETS).join(', ')})`)
export const TARGET: Target = TARGETS[requested]!
