import { Validator } from 'jsonschema'

let cachedCache = null
export async function setupSchemaValidator() {
	if (!cachedCache) {
		const cache = localStorage.getItem('schema-cache')
		if (cache) cachedCache = JSON.parse(cache)
	}
	const v = await _setupSchemaValidator({
		fetch: async (url) => {
			console.log('fetching', url)

			const rewriteUrls = []
			if (location.hostname.includes('localhost')) {
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
		localStorage.setItem('schema-cache', JSON.stringify(v.cache))
		cachedCache = v.cache
	}
	console.log('setupSchemaValidator', v)
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

	const baseURL = `https://ograf.ebu.io/v1-draft-0/specification/json-schemas/graphics/schema.json`

	const v = new Validator()
	async function addRef(ref) {
		// Check if it is in the local cache first:
		if (cache[ref]) {
			v.addSchema(cache[ref], ref)
			return cache[ref]
		} else {
			console.log('fetching2', ref)
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

		const customErrors = validateGraphicManifest(schema)

		return [...customErrors, ...schemaErrors]
	}
	return {
		validate: cachedValidator,
		cache: cache,
	}
}
let cachedValidator = null

export function validateGraphicManifest(graphicManifest) {
	const errors = []

	// Find helpful issues that is not covered by the JSON schema

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

	return errors
}
export function validateGraphicModule(graphicModule) {
	const errors = []

	if (!graphicModule) return [`No graphic exported`]

	if (typeof graphicModule.load !== 'function') errors.push('Graphic does not expose a load() method')
	if (typeof graphicModule.dispose !== 'function') errors.push('Graphic does not expose a dispose() method')
	if (typeof graphicModule.getStatus !== 'function') errors.push('Graphic does not expose a getStatus() method')
	if (typeof graphicModule.updateAction !== 'function') errors.push('Graphic does not expose a updateAction() method')
	if (typeof graphicModule.playAction !== 'function') errors.push('Graphic does not expose a playAction() method')
	if (typeof graphicModule.stopAction !== 'function') errors.push('Graphic does not expose a stopAction() method')
	if (typeof graphicModule.customAction !== 'function') errors.push('Graphic does not expose a customAction() method')
	if (typeof graphicModule.goToTime !== 'function') errors.push('Graphic does not expose a goToTime() method')
	if (typeof graphicModule.setActionsSchedule !== 'function')
		errors.push('Graphic does not expose a setActionsSchedule() method')

	return errors
}
