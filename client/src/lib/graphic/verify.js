import { Validator } from 'jsonschema'
import { ResourceProvider } from '../../renderer/ResourceProvider.js'
import { getDefaultDataFromSchema } from '../GDD/gdd/data.js'
import { SW_VERSION } from '../sw-version.js'

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
				// rewriteUrls.push({
				// 	from: 'https://ebu.github.io/ograf',
				// 	to: 'http://localhost:3100/ograf/',
				// })
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
 * @returns
 */
async function _setupSchemaValidator(
	options
	/*: {
	fetch: (url: string) => Promise<any>
	getCache?: () => Promise<ValidatorCache>
}): Promise<{
	validate: SchemaValidator
	cache: ValidatorCache | null
}> {
*/
) {
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
		// Check if it is in the local cache first:
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
	// const baseSchema = await addRef(baseURL + '/v1/schema.json')
	const baseSchema = await addRef(baseURL + '')
	await handleUnresolvedRefs()

	if (bailOut) throw new Error(`Bailing out, more than ${handledRefs} references found!`)

	cachedValidator = (schema) => {
		const result = v.validate(schema, baseSchema)

		const schemaErrors = result.errors.map((err) => {
			const pathStr = err.path.join('.')
			return `${pathStr}: ${err.message}`
		})

		return validateGraphicManifest(schema, schemaErrors)
	}
	return {
		validate: cachedValidator,
		cache: cache,
	}
}
let cachedValidator = null

export function validateGraphicManifest(graphicManifest, schemaErrors) {
	const errors = []

	// Find helpful issues that is not covered by the JSON schema

	if (graphicManifest.$schema === 'https://ograf.ebu.io/v1-draft-0/specification/json-schemas/graphics/schema.json')
		errors.push(
			`The manifest $schema property is referencing the old "v1-draft-0". Update this to be "https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json"`
		)
	if (graphicManifest.rendering !== undefined)
		errors.push(
			`The manifest has a "rendering" property. The properties in this has been moved to the top level of the manifest (as of 2025-03-10).`
		)

	if (graphicManifest.actions !== undefined)
		errors.push(`The manifest has an "actions" property. This has been renamed to "customActions" (as of 2025-03-10).`)

	if (graphicManifest.customActions) {
		const uniqueIds = new Set()
		for (const customAction of graphicManifest.customActions) {
			if (uniqueIds.has(customAction.id)) {
				errors.push(`The customAction ids must be unique! ""${customAction.id}" is used more than once.`)
			}
			uniqueIds.add(customAction.id)
		}
	}

	for (const schemaError of schemaErrors) {
		{
			// : is not allowed to have the additional property "xyz"
			const m = schemaError.match(/(.*)is not allowed to have the additional property "(.*)"/)
			if (m) {
				const path = m[1]
				const prop = m[2]

				errors.push(
					`${path} is not allowed to have the additional property "${prop}". (Vendor-specific properties must be prefixed with "v_"!)`
				)
				continue
			}
		}

		errors.push(schemaError)
	}

	return errors
}
export function validateGraphicModule(graphicModule, manifest) {
	const errors = []

	if (!graphicModule) return [`No graphic exported`]

	const checkMethod = (methodName) => {
		if (graphicModule[methodName] === undefined) errors.push(`Graphic does not have a ${methodName}() method`)
		else if (typeof graphicModule[methodName] !== 'function')
			errors.push(
				`Graphic does not have a ${methodName}() method, instead there is a ${methodName} of type ${typeof graphicModule[
					methodName
				]}!`
			)
	}

	checkMethod('load')
	checkMethod('dispose')
	checkMethod('updateAction')
	checkMethod('playAction')
	checkMethod('stopAction')
	checkMethod('customAction')

	if (manifest?.supportsNonRealTime) {
		checkMethod('goToTime')
		checkMethod('setActionsSchedule')
	}

	return errors
}
export function testGraphicModule(graphic, manifest, callback) {
	// This runs a few tests on the module

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
					reject(new Error(`Timeout, the Promise didn't resolve after ${waitTime} ms`))
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
			if (payload == undefined) return // No payload is ok

			if (typeof payload !== 'object')
				throw new Error(`Bad return payload! Expected an object, got ${payload} (${typeof payload})`)

			if (payload == null) throw new Error(`Bad return payload! Expected an object, got null`)

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

		addLog(`This is a test that loads a Graphic into memory. Then it calls various`)
		addLog(`methods on it and checks the replies, ensuring that it performs as expected.`)
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

		for (const realtime of realtimeAlternatives) {
			await chapter(`--- Testing ${realtime ? 'RealTime' : 'Non-RealTime'} mode ---`, async () => {
				addLog(`Creating the HTML Element`)
				const element = document.createElement(elementName)

				await chapter(`Loading Graphic, by calling load()`, async () => {
					const result = await promiseTimeout(
						element.load({
							renderType: realtime ? 'realtime' : 'non-realtime',
						})
					)
					checkReturnPayload(result)
				})

				const initialData = manifest.schema ? getDefaultDataFromSchema(manifest.schema) : {}

				if (realtime) {
					await chapter(`Call updateAction({ data })`, async () => {
						const payload = await promiseTimeout(
							element.updateAction({
								data: initialData,
							})
						)
						checkReturnPayload(payload)
					})
					await chapter(`Call playAction({})`, async () => {
						const payload = await promiseTimeout(
							element.playAction({
								// delta,
								// goto,
								// skipAnimation
							})
						)
						checkReturnPayload(payload, {
							currentStep: (value) => {
								if (typeof value !== 'number')
									throw new Error(
										`Bad return payload! Expected "currentStep" to be a number, got ${value} (${typeof value})`
									)
							},
						})
					})
					await chapter(`Call stopAction({})`, async () => {
						const payload = await promiseTimeout(
							element.stopAction({
								// skipAnimation
							})
						)
						checkReturnPayload(payload)
					})
				} else {
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
											params: {
												// delta,
												// goto,
												// skipAnimation
											},
										},
									},
									{
										timestamp: 7000,
										action: {
											type: 'stopAction',
											params: {
												// skipAnimation
											},
										},
									},
								],
							})
						)
						checkReturnPayload(payload)
					})
					await chapter(`Call goToTime({})`, async () => {
						const payload = await promiseTimeout(
							element.goToTime({
								timestamp: 5000,
							})
						)
						checkReturnPayload(payload)
					})
				}

				// customAction?

				await chapter(`Unloading Graphic, by calling dispose()`, async () => {
					const payload = await promiseTimeout(
						element.dispose({
							renderType: realtime ? 'realtime' : 'non-realtime',
						})
					)
					checkReturnPayload(payload)
				})
			})
		}

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
export function testGraphicManifestFileNames(graphic) {
	const errors = []

	if (graphic.path && !graphic.path.endsWith('.ograf')) {
		errors.push(
			`The manifest file name should end with ".ograf", got "${graphic.path}".\n(This requirement was added to the OGraf specification 2025-06-13, please change the filename.)`
		)
	}

	return errors
}
