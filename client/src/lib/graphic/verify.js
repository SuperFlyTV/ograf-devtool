import { Validator } from 'jsonschema'
import { ResourceProvider } from '../../renderer/ResourceProvider.js'
import { SW_VERSION } from '../sw-version.js'
import { getDefaultDataFromSchema, validateDataSimple } from 'ograf-form'
import { pathJoin, graphicResourcePath } from '../lib.js'
import { fileHandler } from '../../FileHandler.js'

let cachedCache = null
export async function setupSchemaValidator() {
	if (!cachedCache) {
		const cacheStr = localStorage.getItem('schema-cache')
		if (cacheStr) {
			try {
				const cacheObj = JSON.parse(cacheStr)
				if (cacheObj && cacheObj.sw_version === SW_VERSION && cacheObj.ttl > Date.now()) {
					console.log('Using cached schema-cache from localStorage')
					cachedCache = cacheObj.data
				}
			} catch (e) {
				console.error('Failed to parse schema-cache from localStorage', e)
			}
		}
	}
	const v = await _setupSchemaValidator({
		fetch: async (url) => {
			const rewriteUrls = []
			if (location.hostname.includes('localhost')) {
				// This is to fix an issue with CORS:
				rewriteUrls.push({
					from: 'https://ograf.ebu.io/',
					to: 'http://localhost:3100/ograf/',
				})
			}
			for (const rewrite of rewriteUrls) {
				url = url.replace(rewrite.from, rewrite.to)
			}

			const response = await fetch(`${url}?a=${Date.now()}`, {
				cache: 'no-store',
			})

			if (!response.ok) throw new Error(`Failed to fetch schema from "${url}"`)
			return response.json()
		},
		getCache: () => {
			return cachedCache ?? {}
		},
	})

	if (v.cache) {
		localStorage.setItem(
			'schema-cache',
			JSON.stringify({
				sw_version: SW_VERSION,
				ttl: Date.now() + 1000 * 60 * 60 * 24, // 1 day
				data: v.cache,
			})
		)
		cachedCache = v.cache
	}
	return v.validate
}

/**
 * Downloads the GDD meta-schemas needed for the validator to work
 */
async function _setupSchemaValidator(options) {
	if (cachedValidator) {
		return {
			validate: cachedValidator,
			cache: null,
		}
	}

	const cache = options.getCache ? await options.getCache() : {}
	const baseURL = `https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json`
	const v = new Validator()

	async function addRef(ref) {
		if (cache[ref]) {
			v.addSchema(cache[ref], ref)
			return cache[ref]
		} else {
			const content = await options.fetch(`${ref}?a=${Date.now()}`, {
				cache: 'no-store',
			})
			if (!content) throw new Error(`Not able to resolve schema for "${ref}"`)
			v.addSchema(content, ref)
			cache[ref] = content
			return content
		}
	}

	let handledRefs = 0
	let bailOut = false
	const handled = new Set()
	async function handleUnresolvedRefs() {
		if (bailOut) return

		const refsToHandle = []
		for (let i = 0; i < v.unresolvedRefs.length; i++) {
			const ref = v.unresolvedRefs.shift()
			if (!ref) break
			if (refsToHandle.length > 30) break
			if (handled.has(ref)) continue

			refsToHandle.push(ref)
			handled.add(ref)
		}
		await Promise.all(
			refsToHandle.map(async (ref) => {
				handledRefs++
				if (handledRefs > 100) {
					bailOut = true
					return
				}

				const fixedRef = ref.replace(/#.*/, '')
				await addRef(fixedRef)
				await handleUnresolvedRefs()
			})
		)
	}

	const baseSchema = await addRef(baseURL + '')
	await handleUnresolvedRefs()

	if (bailOut) throw new Error(`Bailing out, more than ${handledRefs} references found!`)

	cachedValidator = async (schema, graphic) => {
		const result = v.validate(schema, baseSchema)

		const schemaErrors = result.errors.map((err) => {
			const pathStr = err.path.join('.')
			return `${pathStr}: ${err.message}`
		})

		return validateGraphicManifest(schema, schemaErrors, graphic)
	}
	return {
		validate: cachedValidator,
		cache: cache,
	}
}
let cachedValidator = null

/**
 * Creates a structured issue object
 */
export function createIssue({
	id = null,
	severity = 'error', // 'error' | 'warning' | 'info'
	message = '',
	fixable = false,
	fixLabel = null,
	fixId = null,
	fixData = null,
}) {
	return {
		id,
		severity,
		message,
		fixable,
		fixLabel,
		fixId,
		fixData,
		toString() {
			return this.message
		},
	}
}

/**
 * Normalizes an issue (string or object) to a structured issue object
 */
export function normalizeIssue(issue, defaultSeverity = 'error') {
	if (!issue) return null
	if (typeof issue === 'string') {
		return createIssue({
			severity: defaultSeverity,
			message: issue,
		})
	}
	return issue
}

export async function checkFileExists(folderPath, filePath) {
	if (!filePath || typeof filePath !== 'string') return true
	const fullPath = pathJoin(folderPath || '', filePath)

	// 1. If local directory is opened via fileHandler:
	if (typeof fileHandler !== 'undefined' && fileHandler?.dirHandle) {
		try {
			const normalizedPath = fullPath.startsWith('/') ? fullPath : '/' + fullPath
			if (fileHandler.files && fileHandler.files[normalizedPath]) {
				return true
			}
			await fileHandler.readFile(normalizedPath)
			return true
		} catch (_err) {
			return false
		}
	}

	// 2. If remote or via service worker:
	if (typeof fetch === 'function') {
		try {
			const url = graphicResourcePath(fullPath)
			const response = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null)
			if (response && response.ok) return true
			if (!response || response.status === 405 || response.status === 501) {
				const getResponse = await fetch(url, { method: 'GET', cache: 'no-store' })
				return getResponse.ok
			}
			return response ? response.ok : false
		} catch (_err) {
			return false
		}
	}

	return true
}

export async function checkThumbnailFileExists(folderPath, thumbFile) {
	return checkFileExists(folderPath, thumbFile)
}

export async function getThumbnailDimensions(folderPath, thumbFile) {
	if (!thumbFile || typeof thumbFile !== 'string') return null
	const fullPath = pathJoin(folderPath || '', thumbFile)
	const url = graphicResourcePath(fullPath)

	return new Promise((resolve) => {
		const img = new Image()
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight })
		}
		img.onerror = () => {
			resolve(null)
		}
		img.src = url
	})
}

function formatBytes(bytes) {
	if (bytes === 0) return '0 Bytes'
	const k = 1024
	const sizes = ['Bytes', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export async function validateGraphicManifest(graphicManifest, schemaErrors, options) {
	const issues = []

	if (!graphicManifest || typeof graphicManifest !== 'object') {
		return [createIssue({ severity: 'error', message: 'Manifest is empty or not an object' })]
	}

	let folderPath = ''
	let graphic = null
	if (typeof options === 'string') {
		folderPath = options
	} else if (options && typeof options === 'object') {
		graphic = options.graphic || (options.path ? options : null)
		if (options.folderPath !== undefined) {
			folderPath = options.folderPath
		} else if (options.graphic?.folderPath !== undefined) {
			folderPath = options.graphic.folderPath
		}
	}

	// FIX.1 / Legacy $schema
	if (graphicManifest.$schema === 'https://ograf.ebu.io/v1-draft-0/specification/json-schemas/graphics/schema.json') {
		issues.push(
			createIssue({
				id: 'FIX.1',
				severity: 'error',
				message: `The manifest $schema property is referencing the old "v1-draft-0". Update this to "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json"`,
				fixable: true,
				fixLabel: 'Upgrade $schema',
				fixId: 'FIX_SCHEMA_URL',
			})
		)
	}

	// FIX.2 / Legacy rendering property
	if (graphicManifest.rendering !== undefined) {
		issues.push(
			createIssue({
				id: 'FIX.2',
				severity: 'error',
				message: `The manifest has a deprecated "rendering" property. Properties inside it should be at the top level of the manifest.`,
				fixable: true,
				fixLabel: 'Flatten rendering properties',
				fixId: 'FIX_MIGRATE_RENDERING',
			})
		)
	}

	// FIX.2 / Legacy actions property
	if (graphicManifest.actions !== undefined) {
		issues.push(
			createIssue({
				id: 'FIX.2',
				severity: 'error',
				message: `The manifest has an "actions" property. This has been renamed to "customActions".`,
				fixable: true,
				fixLabel: 'Rename actions to customActions',
				fixId: 'FIX_MIGRATE_ACTIONS',
			})
		)
	}

	// Custom Action unique IDs
	if (graphicManifest.customActions && Array.isArray(graphicManifest.customActions)) {
		const uniqueIds = new Set()
		for (const customAction of graphicManifest.customActions) {
			if (customAction?.id) {
				if (uniqueIds.has(customAction.id)) {
					issues.push(
						createIssue({
							severity: 'error',
							message: `The customAction ids must be unique! "${customAction.id}" is used more than once.`,
						})
					)
				}
				uniqueIds.add(customAction.id)
			}
		}
	}

	// Schema errors from JSON validator
	if (schemaErrors) {
		for (const schemaError of schemaErrors) {
			const m = schemaError.match(/(.*)is not allowed to have the additional property "(.*)"/)
			if (m) {
				const path = m[1]
				const prop = m[2]
				issues.push(
					createIssue({
						severity: 'error',
						message: `${path} is not allowed to have the additional property "${prop}". (Vendor-specific properties must be prefixed with "v_"!)`,
					})
				)
				continue
			}
			issues.push(createIssue({ severity: 'error', message: schemaError }))
		}
	}

	// T1.1: Check main entrypoint file exists on disk
	if (graphicManifest.main) {
		const exists = await checkFileExists(folderPath, graphicManifest.main)
		if (!exists) {
			issues.push(
				createIssue({
					id: 'T1.1',
					severity: 'error',
					message: `Main entrypoint file "${graphicManifest.main}" does not exist in the graphic folder.`,
				})
			)
		}
	}

	// T1.3: At least one render mode enabled
	if (graphicManifest.supportsRealTime === false && graphicManifest.supportsNonRealTime === false) {
		issues.push(
			createIssue({
				id: 'T1.3',
				severity: 'error',
				message: `Both supportsRealTime and supportsNonRealTime are set to false. The OGraf specification requires a Graphic to support real-time, non-real-time, or both.`,
				fixable: true,
				fixLabel: 'Enable supportsRealTime',
				fixId: 'FIX_RENDER_MODES',
			})
		)
	}

	// T1.6: Manifest id must not contain forward slashes
	if (graphicManifest.id && typeof graphicManifest.id === 'string' && graphicManifest.id.includes('/')) {
		issues.push(
			createIssue({
				id: 'T1.6',
				severity: 'error',
				message: `Manifest id "${graphicManifest.id}" contains forward slashes ("/"), which is disallowed by the OGraf specification.`,
				fixable: true,
				fixLabel: 'Replace slashes with hyphens',
				fixId: 'FIX_MANIFEST_ID_SLASH',
			})
		)
	}

	// T1.4 & T1.5: actionDurations integrity and step bounds
	if (graphicManifest.actionDurations && Array.isArray(graphicManifest.actionDurations)) {
		const validCustomActionIds = new Set(
			(graphicManifest.customActions || []).map((a) => a?.id).filter(Boolean)
		)
		const seenTypes = new Set()
		const seenCustomIds = new Set()

		for (const ad of graphicManifest.actionDurations) {
			if (!ad || typeof ad !== 'object') continue

			if (ad.type === 'customAction') {
				if (!ad.customActionId || !validCustomActionIds.has(ad.customActionId)) {
					issues.push(
						createIssue({
							id: 'T1.4',
							severity: 'error',
							message: `actionDuration for customAction references unknown customActionId "${ad.customActionId}".`,
							fixable: true,
							fixLabel: 'Remove orphan customAction duration',
							fixId: 'FIX_CLEAN_ACTION_DURATIONS',
						})
					)
				}
				if (seenCustomIds.has(ad.customActionId)) {
					issues.push(
						createIssue({
							id: 'T1.4',
							severity: 'error',
							message: `Duplicate actionDuration found for customActionId "${ad.customActionId}". There MUST be at most one duration per custom action.`,
							fixable: true,
							fixLabel: 'Deduplicate action durations',
							fixId: 'FIX_CLEAN_ACTION_DURATIONS',
						})
					)
				}
				if (ad.customActionId) seenCustomIds.add(ad.customActionId)
			} else if (['playAction', 'updateAction', 'stopAction'].includes(ad.type)) {
				if (seenTypes.has(ad.type)) {
					issues.push(
						createIssue({
							id: 'T1.4',
							severity: 'error',
							message: `Duplicate actionDuration found for type "${ad.type}". There MUST be at most one duration per action type.`,
							fixable: true,
							fixLabel: 'Deduplicate action durations',
							fixId: 'FIX_CLEAN_ACTION_DURATIONS',
						})
					)
				}
				seenTypes.add(ad.type)

				// T1.5: Step bounds check for playAction
				if (ad.type === 'playAction' && Array.isArray(ad.steps) && typeof graphicManifest.stepCount === 'number' && graphicManifest.stepCount > 0) {
					for (const s of ad.steps) {
						if (typeof s?.step === 'number' && s.step >= graphicManifest.stepCount) {
							issues.push(
								createIssue({
									id: 'T1.5',
									severity: 'info',
									message: `actionDuration step ${s.step} is >= stepCount (${graphicManifest.stepCount}). Target steps >= stepCount transition to end.`,
									fixable: true,
									fixLabel: 'Remove out-of-bounds step duration',
									fixId: 'FIX_ACTION_DURATION_STEP_BOUNDS',
								})
							)
						}
					}
				}
			}
		}
	}

	// GDD Schema validation & T2.1: Missing property titles
	if (graphicManifest.schema) {
		let defaultData = null
		try {
			defaultData = getDefaultDataFromSchema(graphicManifest.schema)
		} catch (err) {
			issues.push(createIssue({ severity: 'error', message: `Error generating default values from schema: ${err.message}` }))
		}
		if (defaultData) {
			const result = validateDataSimple(graphicManifest.schema, defaultData, '')
			for (const error of result.errors) {
				issues.push(createIssue({ severity: 'error', message: `Bad default value in schema: ${error}` }))
			}
		}

		if (graphicManifest.schema.properties && typeof graphicManifest.schema.properties === 'object') {
			const missingTitleProps = []
			for (const [key, prop] of Object.entries(graphicManifest.schema.properties)) {
				if (prop && typeof prop === 'object' && !prop.title && !prop.label) {
					missingTitleProps.push(key)
				}
			}
			if (missingTitleProps.length > 0) {
				issues.push(
					createIssue({
						id: 'T2.1',
						severity: 'info',
						message: `Properties in schema lack a "title" or "label": ${missingTitleProps.join(', ')}. Adding titles improves controller GUI display.`,
						fixable: true,
						fixLabel: 'Add readable titles to schema properties',
						fixId: 'FIX_MISSING_PROPERTY_TITLES',
					})
				)
			}
		}
	}

	// T2.4: Missing thumbnails notice
	const hasThumbnails = Array.isArray(graphicManifest.thumbnails) && graphicManifest.thumbnails.length > 0
	if (!hasThumbnails) {
		issues.push(
			createIssue({
				id: 'T2.4',
				severity: 'info',
				message: `Graphic does not have any thumbnails defined in manifest. Thumbnails are recommended for controller catalogs.`,
			})
		)
	}

	// Thumbnails verification (T2.2, T2.3, and file existence)
	if (hasThumbnails) {
		const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

		for (const thumb of graphicManifest.thumbnails) {
			const thumbFile = typeof thumb === 'string' ? thumb : thumb?.file
			if (thumbFile && typeof thumbFile === 'string') {
				// T2.3: Check format
				const extMatch = thumbFile.match(/\.([a-zA-Z0-9]+)$/)
				const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ''
				if (!allowedExtensions.includes(ext)) {
					issues.push(
						createIssue({
							id: 'T2.3',
							severity: 'error',
							message: `Thumbnail "${thumbFile}" has unsupported file format "${ext}". Allowed formats: PNG, JPG, GIF, WebP.`,
						})
					)
				}

				// Check existence
				const exists = await checkThumbnailFileExists(folderPath, thumbFile)
				if (!exists) {
					issues.push(
						createIssue({
							severity: 'error',
							message: `Referenced thumbnail file "${thumbFile}" does not exist in the graphic folder`,
						})
					)
				} else {
					// T2.2: Check dimensions if resolution is declared
					if (thumb && typeof thumb === 'object' && thumb.resolution) {
						try {
							const dims = await getThumbnailDimensions(folderPath, thumbFile)
							if (dims && (dims.width !== thumb.resolution.width || dims.height !== thumb.resolution.height)) {
								issues.push(
									createIssue({
										id: 'T2.2',
										severity: 'info',
										message: `Thumbnail "${thumbFile}" actual dimensions (${dims.width}x${dims.height}) differ from declared resolution (${thumb.resolution.width}x${thumb.resolution.height}).`,
										fixable: true,
										fixLabel: `Update resolution metadata to ${dims.width}x${dims.height}`,
										fixId: 'FIX_SYNC_THUMBNAIL_RESOLUTION',
										fixData: { file: thumbFile, width: dims.width, height: dims.height },
									})
								)
							}
						} catch (_err) {
							// Ignore measurement error
						}
					}
				}
			}
		}
	}

	// T2.5: Heavy asset & bundle size advisory
	if (typeof fileHandler !== 'undefined' && fileHandler?.files && folderPath) {
		const normalizedFolder = folderPath.startsWith('/') ? folderPath : '/' + folderPath
		let totalFolderSize = 0
		const largeFiles = []

		for (const [filePath, fileEntry] of Object.entries(fileHandler.files)) {
			if (filePath.startsWith(normalizedFolder)) {
				try {
					if (fileEntry?.handle?.getFile) {
						const file = await fileEntry.handle.getFile()
						totalFolderSize += file.size
						if (file.size > 5 * 1024 * 1024) {
							largeFiles.push({ name: fileEntry.handle.name, size: file.size })
						}
					}
				} catch (_) {}
			}
		}

		for (const lf of largeFiles) {
			issues.push(
				createIssue({
					id: 'T2.5',
					severity: 'info',
					message: `Asset "${lf.name}" is ${formatBytes(lf.size)} (> 5MB). Large assets may increase playout load time.`,
				})
			)
		}
		if (totalFolderSize > 20 * 1024 * 1024) {
			issues.push(
				createIssue({
					id: 'T2.5',
					severity: 'info',
					message: `Graphic folder total size is ${formatBytes(totalFolderSize)} (> 20MB). Consider optimizing assets for faster loading.`,
				})
			)
		}
	}

	return issues
}

export function validateGraphicModule(graphicModule, manifest) {
	const issues = []

	if (!graphicModule) return [createIssue({ severity: 'error', message: `No graphic exported` })]

	// T1.2: Check default export & custom element prototype
	if (typeof HTMLElement !== 'undefined' && !(graphicModule instanceof HTMLElement)) {
		// If passed an element instance, check inheritance
		if (graphicModule.prototype && !(graphicModule.prototype instanceof HTMLElement)) {
			issues.push(
				createIssue({
					id: 'T1.2',
					severity: 'error',
					message: `Graphic default export does not extend HTMLElement. An OGraf Graphic MUST be implemented as a Web Component extending HTMLElement.`,
				})
			)
		}
	}

	const checkMethod = (methodName, checkId) => {
		if (graphicModule[methodName] === undefined) {
			issues.push(
				createIssue({
					id: checkId || null,
					severity: 'error',
					message: `Graphic does not have a ${methodName}() method`,
				})
			)
		} else if (typeof graphicModule[methodName] !== 'function') {
			issues.push(
				createIssue({
					id: checkId || null,
					severity: 'error',
					message: `Graphic does not have a ${methodName}() method, instead there is a ${methodName} of type ${typeof graphicModule[methodName]}!`,
				})
			)
		}
	}

	checkMethod('load')
	checkMethod('dispose')
	checkMethod('updateAction')
	checkMethod('playAction')
	checkMethod('stopAction')
	checkMethod('customAction')

	// T1.7: Non-real-time required methods
	if (manifest?.supportsNonRealTime) {
		checkMethod('goToTime', 'T1.7')
		checkMethod('setActionsSchedule', 'T1.7')
	}

	return issues
}

export function testGraphicManifestFileNames(graphic) {
	const issues = []

	if (graphic?.path) {
		if (graphic.path.endsWith('.ograf')) {
			issues.push(
				createIssue({
					id: 'FIX.3',
					severity: 'error',
					message: `The manifest file name must end with ".ograf.json", got "${graphic.path}".`,
					fixable: true,
					fixLabel: 'Rename to .ograf.json',
					fixId: 'FIX_RENAME_MANIFEST_FILE',
				})
			)
		} else if (!graphic.path.endsWith('.ograf.json')) {
			issues.push(
				createIssue({
					severity: 'error',
					message: `The manifest file name must end with ".ograf.json", got "${graphic.path}".`,
				})
			)
		}
	}

	return issues
}

export function testGraphicModule(graphic, manifest, callback) {
	let testLog = ''
	let testStatus = undefined
	let indentation = 0

	const addLog = (log, status) => {
		if (testLog) testLog += '\n'
		testLog += '                   '.slice(0, indentation * 2)
		testLog += log

		console.log(log)

		if (status === false) testStatus = status
		if (status === true && testStatus === undefined) testStatus = status

		callback(testLog, testStatus)
	}

	const chapter = async (name, cb) => {
		addLog(name)
		indentation++
		const startTime = Date.now()
		await cb()

		const duration = Date.now() - startTime
		addLog(`Finished executing in ${duration} ms`)

		await sleep(100)
		indentation--
	}

	const sleep = async (duration) => {
		return new Promise((resolve) => setTimeout(resolve, duration))
	}

	const promiseTimeout = (promise, waitTime) => {
		return Promise.race([
			promise,
			new Promise((resolve, reject) => {
				setTimeout(() => {
					reject(new Error(`Timeout, the Promise didn't resolve after ${waitTime || 3000} ms`))
				}, waitTime || 3000)
			}),
		])
	}

	const checkReturnPayload = (payload, customCheck) => {
		if (!customCheck) customCheck = {}

		customCheck['statusCode'] = (value) => {
			if (typeof value !== 'number')
				throw new Error(`Bad return payload! Expected "statusCode" to be a number, got ${value} (${typeof value})`)
		}
		customCheck['statusMessage'] = (value) => {
			if (value !== undefined && typeof value !== 'string')
				throw new Error(`Bad return payload! Expected "statusMessage" to be a string, got ${value} (${typeof value})`)
		}

		try {
			if (payload === undefined) return // No payload is ok

			if (typeof payload !== 'object')
				throw new Error(`Bad return payload! Expected an object, got ${payload} (${typeof payload})`)

			if (payload === null) throw new Error(`Bad return payload! Expected an object, got null`)

			for (const key of Object.keys(payload)) {
				const check = customCheck[key]
				if (check) check(payload[key])
				else {
					if (key.startsWith('v_')) continue
					throw new Error(
						`Bad return payload! Payload contains key "${key}" which is not allowed. (Use "v_" prefix for vendor-specific properties!)`
					)
				}
			}
		} catch (e) {
			addLog(`${e}`, false)
		}
	}

	const runTest = async () => {
		console.log('--- Running Graphic test ---')

		addLog(`This is an automated test suite that mounts the Graphic Web Component,`)
		addLog(`exercises lifecycle actions, verifies step calculations, and tests state transitions.`)
		addLog(``)

		if (!manifest) throw new Error(`No manifest loaded`)

		let elementName
		await chapter('Loading the Graphic module', async () => {
			const graphicPath = ResourceProvider.graphicPath(graphic.folderPath, manifest?.main)
			elementName = await ResourceProvider.loadGraphic(graphicPath)
		})

		let realtimeAlternatives = []
		if (manifest.supportsRealTime) realtimeAlternatives.push(true)
		if (manifest.supportsNonRealTime) realtimeAlternatives.push(false)

		const initialData = manifest.schema ? getDefaultDataFromSchema(manifest.schema) : {}

		for (const realtime of realtimeAlternatives) {
			await chapter(`--- Testing ${realtime ? 'RealTime' : 'Non-RealTime'} mode ---`, async () => {
				addLog(`Creating custom element <${elementName}>`)
				const element = document.createElement(elementName)

				await chapter(`Calling load({ renderType, data })`, async () => {
					const result = await promiseTimeout(
						element.load({
							renderType: realtime ? 'realtime' : 'non-realtime',
							data: initialData,
							renderCharacteristics: {
								resolution: { width: 1920, height: 1080 },
								_environment: 'OGraf DevTool Test',
							},
						})
					)
					checkReturnPayload(result)
				})

				// T3.6: Default data render check (inspect DOM for undefined/NaN)
				const textContent = element.shadowRoot ? element.shadowRoot.textContent : element.textContent
				if (textContent && (textContent.includes('undefined') || textContent.includes('NaN'))) {
					addLog(`ℹ️ Notice: Graphic rendered literal "undefined" or "NaN" text with default schema values.`)
				}

				if (realtime) {
					// Update action
					await chapter(`Call updateAction({ data })`, async () => {
						const payload = await promiseTimeout(
							element.updateAction({
								data: initialData,
							})
						)
						checkReturnPayload(payload)
					})

					// T3.3: Partial updateAction & empty object resilience
					await chapter(`Testing partial and empty updateAction resilience (T3.3)`, async () => {
						const emptyPayload = await promiseTimeout(
							element.updateAction({
								data: {},
							})
						)
						checkReturnPayload(emptyPayload)
						addLog(`✓ Handled empty update payload {} successfully`)
					})

					// T3.1: skipAnimation latency check
					await chapter(`Testing playAction({ skipAnimation: true }) latency (T3.1)`, async () => {
						const start = Date.now()
						const payload = await promiseTimeout(
							element.playAction({
								skipAnimation: true,
							})
						)
						const elapsed = Date.now() - start
						checkReturnPayload(payload, {
							currentStep: (value) => {
								if (typeof value !== 'number' && value !== undefined)
									throw new Error(`Bad currentStep return: ${value}`)
							},
						})
						if (elapsed > 100) {
							addLog(`⚠️ Warning: playAction({ skipAnimation: true }) took ${elapsed}ms (> 100ms). Ensure animation timers are skipped!`)
						} else {
							addLog(`✓ skipAnimation completed quickly in ${elapsed}ms`)
						}
					})

					// T3.2: Step state machine tests
					const stepCount = typeof manifest.stepCount === 'number' ? manifest.stepCount : 1
					await chapter(`Testing Step Navigation & goto/delta calculation (T3.2, stepCount: ${stepCount})`, async () => {
						if (stepCount === 0) {
							const payload = await promiseTimeout(element.playAction({}))
							checkReturnPayload(payload)
							if (payload?.currentStep !== undefined) {
								addLog(`⚠️ For stepCount 0, playAction currentStep MUST be undefined, got: ${payload.currentStep}`, false)
							} else {
								addLog(`✓ stepCount 0 correctly returned undefined currentStep`)
							}
						} else if (stepCount > 1) {
							// Test goto step 1
							const gotoPayload = await promiseTimeout(element.playAction({ goto: 1 }))
							checkReturnPayload(gotoPayload)
							if (gotoPayload?.currentStep === 1) {
								addLog(`✓ goto: 1 correctly returned currentStep: 1`)
							} else {
								addLog(`ℹ️ goto: 1 returned currentStep: ${gotoPayload?.currentStep}`)
							}

							// Test relative delta
							const deltaPayload = await promiseTimeout(element.playAction({ delta: -1 }))
							checkReturnPayload(deltaPayload)
							addLog(`✓ delta: -1 executed successfully`)

							// Test transitioning past stepCount
							const pastEndPayload = await promiseTimeout(element.playAction({ goto: stepCount }))
							checkReturnPayload(pastEndPayload)
							if (pastEndPayload?.currentStep === undefined) {
								addLog(`✓ goto >= stepCount correctly transitioned to end (currentStep: undefined)`)
							}
						}
					})

					// Stop action
					await chapter(`Call stopAction({})`, async () => {
						const payload = await promiseTimeout(
							element.stopAction({
								skipAnimation: false,
							})
						)
						checkReturnPayload(payload)
					})
				} else {
					// Non-real-time tests
					await chapter(`Call setActionsSchedule()`, async () => {
						const payload = await promiseTimeout(
							element.setActionsSchedule({
								schedule: [
									{
										timestamp: 0,
										action: {
											type: 'updateAction',
											params: { data: initialData },
										},
									},
									{
										timestamp: 1000,
										action: {
											type: 'playAction',
											params: {},
										},
									},
									{
										timestamp: 5000,
										action: {
											type: 'stopAction',
											params: {},
										},
									},
								],
							})
						)
						checkReturnPayload(payload)
					})

					// T3.5: Non-real-time seeking and backward seek
					await chapter(`Testing Non-Real-Time forward and backward seeking (T3.5)`, async () => {
						addLog(`Seeking to 5000ms...`)
						const p1 = await promiseTimeout(element.goToTime({ timestamp: 5000 }))
						checkReturnPayload(p1)

						addLog(`Seeking backward to 1000ms...`)
						const p2 = await promiseTimeout(element.goToTime({ timestamp: 1000 }))
						checkReturnPayload(p2)

						addLog(`Seeking to start 0ms...`)
						const p3 = await promiseTimeout(element.goToTime({ timestamp: 0 }))
						checkReturnPayload(p3)

						addLog(`✓ Non-real-time seeking verified`)
					})
				}

				// Dispose
				await chapter(`Unloading Graphic, calling dispose()`, async () => {
					const payload = await promiseTimeout(
						element.dispose({
							renderType: realtime ? 'realtime' : 'non-realtime',
						})
					)
					checkReturnPayload(payload)
				})
			})
		}

		// T3.4: Rapid concurrent invocation stress test
		await chapter(`--- Stress Testing: Rapid Concurrent Invocations (T3.4) ---`, async () => {
			addLog(`Mounting new element to test back-to-back unawaited invocations...`)
			const stressElement = document.createElement(elementName)

			try {
				const loadP = stressElement.load({
					renderType: manifest.supportsRealTime ? 'realtime' : 'non-realtime',
					data: initialData,
					renderCharacteristics: { resolution: { width: 1920, height: 1080 } },
				})
				const playP = stressElement.playAction({ skipAnimation: true })
				const updateP = stressElement.updateAction({ data: initialData, skipAnimation: true })
				const stopP = stressElement.stopAction({ skipAnimation: true })

				const results = await Promise.allSettled([loadP, playP, updateP, stopP])
				const rejections = results.filter((r) => r.status === 'rejected')
				if (rejections.length > 0) {
					addLog(`⚠️ Notice: ${rejections.length} concurrent calls rejected (handled): ${rejections.map((r) => r.reason).join(', ')}`)
				} else {
					addLog(`✓ Handled rapid concurrent invocations without crashing`)
				}

				await stressElement.dispose({ renderType: 'realtime' }).catch(() => null)
			} catch (err) {
				addLog(`❌ Stress test crashed: ${err.message || err}`, false)
			}
		})

		addLog(`End of test`, true)
	}

	try {
		runTest()
			.catch((e) => {
				console.error(e)
				addLog(`Error thrown: ${e}`, false)
			})
			.finally(() => {
				if (testStatus === true) {
					addLog(`Everything looks ok!`)
				} else {
					addLog(`Uh-oh! Something went wrong, check the log above!`)
				}
			})
	} catch (e) {
		console.error(e)
		addLog(`Error thrown: ${e}`, false)
	}
}
