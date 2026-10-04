import { fileHandler } from '../../FileHandler.js'

/**
 * Applies an automated fix to a graphic manifest or file.
 * @param {object} graphic - The graphic object (with .manifest, .path, etc.)
 * @param {object} issue - The issue object containing fixId and fixData
 * @returns {Promise<boolean>} - True if fix was applied
 */
export async function applyAutoFix(graphic, issue) {
	if (!graphic || !issue || !issue.fixId) return false

	if (issue.fixId === 'FIX_RENAME_MANIFEST_FILE') {
		if (!graphic.path || !fileHandler?.dirHandle) {
			throw new Error('Cannot rename file: No local directory opened in devtool')
		}
		const oldPath = graphic.path
		const newPath = oldPath.replace(/\.ograf$/, '.ograf.json')
		if (oldPath === newPath) return false

		const fileObj = await fileHandler.readFile(oldPath)
		const blob = new Blob([fileObj.arrayBuffer], { type: 'application/json' })
		await fileHandler.writeFile(newPath, blob)
		await fileHandler.deleteFile(oldPath)
		graphic.path = newPath
		return true
	}

	const manifest = JSON.parse(JSON.stringify(graphic.manifest || {}))
	let updated = false

	switch (issue.fixId) {
		case 'FIX_SCHEMA_URL':
			manifest.$schema = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json'
			updated = true
			break

		case 'FIX_MIGRATE_RENDERING':
			if (manifest.rendering) {
				const renderingProps = { ...manifest.rendering }
				delete manifest.rendering
				Object.assign(manifest, renderingProps)
				updated = true
			}
			break

		case 'FIX_MIGRATE_ACTIONS':
			if (manifest.actions) {
				manifest.customActions = manifest.actions
				delete manifest.actions
				updated = true
			}
			break

		case 'FIX_RENDER_MODES':
			manifest.supportsRealTime = true
			manifest.supportsNonRealTime = false
			updated = true
			break

		case 'FIX_MANIFEST_ID_SLASH':
			if (manifest.id) {
				manifest.id = manifest.id.replace(/\//g, '-')
				updated = true
			}
			break

		case 'FIX_CLEAN_ACTION_DURATIONS':
			if (manifest.actionDurations && Array.isArray(manifest.actionDurations)) {
				const validCustomIds = new Set((manifest.customActions || []).map((a) => a.id))
				const seenTypes = new Set()
				const seenCustomIds = new Set()
				manifest.actionDurations = manifest.actionDurations.filter((ad) => {
					if (ad.type === 'customAction') {
						if (!ad.customActionId || !validCustomIds.has(ad.customActionId)) return false
						if (seenCustomIds.has(ad.customActionId)) return false
						seenCustomIds.add(ad.customActionId)
						return true
					} else {
						if (seenTypes.has(ad.type)) return false
						seenTypes.add(ad.type)
						return true
					}
				})
				updated = true
			}
			break

		case 'FIX_ACTION_DURATION_STEP_BOUNDS':
			if (manifest.actionDurations && manifest.stepCount > 0) {
				for (const ad of manifest.actionDurations) {
					if (ad.type === 'playAction' && Array.isArray(ad.steps)) {
						ad.steps = ad.steps.filter((s) => s.step === undefined || s.step < manifest.stepCount)
					}
				}
				updated = true
			}
			break

		case 'FIX_MISSING_PROPERTY_TITLES':
			if (manifest.schema?.properties) {
				for (const [key, prop] of Object.entries(manifest.schema.properties)) {
					if (prop && typeof prop === 'object' && !prop.title && !prop.label) {
						prop.title = key
							.replace(/([A-Z])/g, ' $1')
							.replace(/^./, (str) => str.toUpperCase())
							.trim()
						updated = true
					}
				}
			}
			break

		case 'FIX_SYNC_THUMBNAIL_RESOLUTION':
			if (manifest.thumbnails && issue.fixData) {
				const { file, width, height } = issue.fixData
				manifest.thumbnails = manifest.thumbnails.map((thumb) => {
					const thumbFile = typeof thumb === 'string' ? thumb : thumb?.file
					if (thumbFile === file) {
						return { file, resolution: { width, height } }
					}
					return thumb
				})
				updated = true
			}
			break

		case 'FIX_ADD_DEFAULT_STEP_COUNT':
			manifest.stepCount = 1
			updated = true
			break

		default:
			break
	}

	if (updated) {
		graphic.manifest = manifest
		if (typeof fileHandler !== 'undefined' && fileHandler?.dirHandle && graphic.path) {
			await fileHandler.writeManifest(graphic, manifest)
		}
		return true
	}

	return false
}
