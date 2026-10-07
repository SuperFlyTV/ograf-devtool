import { getDefaultDataFromSchema } from 'ograf-form'
import { captureSingleGraphicFrame, createGraphicRenderSession } from './VideoRenderer.js'
import { createAnimatedWebpFromCanvases } from './encoders/webpEncoder.js'
import { createAnimatedGifFromCanvases } from './encoders/gifEncoder.js'
import { fileHandler } from '../FileHandler.js'

/**
 * Generate thumbnails for a single ograf graphic.
 *
 * Supports both realtime and non-realtime graphics:
 *   - For non-realtime: loads with renderType "non-realtime", sets action schedule if provided,
 *     and seeks with gotoTime.
 *   - For realtime: loads with renderType "realtime", plays action, and waits for captureDelay.
 *
 * Supports both "html-in-canvas" (Chrome native) and "dom-to-image" capture methods.
 * Supports generating animated thumbnails (WebP and GIF) for non-realtime graphics.
 *
 * @param {object} opts
 * @param {object}   opts.graphic           Graphic entry from fileHandler.listGraphics()
 * @param {object}   opts.thumbnailSettings {
 *   resolutions, transparent, captureDelay, skipAnimation, time, schedule, renderMethod,
 *   generateAnimated, animatedWebp, animatedGif, animatedResolution, animatedFps, animatedHoldDuration
 * }
 * @param {Function} opts.onProgress        (message: string) => void
 * @param {Function} opts.writeFileFn       async (path: string, blob: Blob) => void
 * @returns {Promise<Array<{file:string, resolution:{width:number,height:number}, animated?:boolean, format?:string}>>}
 */
export async function generateThumbnailsForGraphic({ graphic, thumbnailSettings, onProgress, writeFileFn }) {
	const {
		resolutions = [],
		transparent = true,
		captureDelay = 1000,
		skipAnimation = true,
		time = 0,
		schedule = [],
		renderMethod = 'html-in-canvas',
		generateAnimated = false,
	} = thumbnailSettings

	const results = []

	// ── 1. Static PNG Thumbnails ──────────────────────────────────────────────
	if (resolutions.length > 0) {
		const staticResults = await generateStaticThumbnailsForGraphic({
			graphic,
			thumbnailSettings: {
				resolutions,
				transparent,
				captureDelay,
				skipAnimation,
				time,
				schedule,
				renderMethod,
			},
			onProgress,
			writeFileFn,
		})
		results.push(...staticResults)
	}

	// ── 2. Animated Thumbnails (WebP and/or GIF for non-realtime graphics) ───
	const supportsNonRealTime = Boolean(graphic.manifest?.supportsNonRealTime)

	if (generateAnimated && supportsNonRealTime) {
		onProgress('Generating animated thumbnails…')
		const animatedResults = await generateAnimatedThumbnailsForGraphic({
			graphic,
			thumbnailSettings,
			onProgress,
			writeFileFn,
		})
		results.push(...animatedResults)
	}

	return results
}

/**
 * Generate static PNG thumbnails (and cropped variants) for a graphic.
 */
export async function generateStaticThumbnailsForGraphic({ graphic, thumbnailSettings, onProgress, writeFileFn }) {
	const {
		resolutions,
		transparent = true,
		captureDelay = 1000,
		skipAnimation = true,
		time = 0,
		schedule = [],
		renderMethod = 'html-in-canvas',
	} = thumbnailSettings

	if (!resolutions || resolutions.length === 0) return []

	const maxRes = resolutions.reduce(
		(best, r) => (r.width * r.height > best.width * best.height ? r : best),
		resolutions[0]
	)

	const defaultData = graphic.manifest?.schema ? getDefaultDataFromSchema(graphic.manifest.schema) : {}
	const isNonRealTime =
		graphic.manifest?.supportsNonRealTime &&
		(!graphic.manifest?.supportsRealTime || thumbnailSettings.realtime === false)

	const seekTime = time ?? captureDelay ?? 0

	// Capture native max-resolution frame via unified renderer
	const nativeCanvas = await captureSingleGraphicFrame({
		graphic,
		width: maxRes.width,
		height: maxRes.height,
		bgcolor: transparent ? null : '#000000',
		renderMethod,
		realtime: !isNonRealTime,
		seekTime,
		captureDelay,
		skipAnimation,
		initialData: defaultData,
		schedule,
		onProgress,
	})

	const results = []

	for (const resolution of resolutions) {
		const filename = `thumbnails/${resolution.width}x${resolution.height}.png`
		onProgress(`Scaling & encoding ${resolution.width}×${resolution.height}…`)

		let scaledCanvas
		if (resolution.width === maxRes.width && resolution.height === maxRes.height) {
			scaledCanvas = nativeCanvas
		} else {
			scaledCanvas = document.createElement('canvas')
			scaledCanvas.width = resolution.width
			scaledCanvas.height = resolution.height
			const ctx = scaledCanvas.getContext('2d')
			if (transparent) ctx.clearRect(0, 0, resolution.width, resolution.height)
			ctx.drawImage(nativeCanvas, 0, 0, resolution.width, resolution.height)
		}

		const blob = await canvasToBlob(scaledCanvas, 'image/png')
		onProgress(`Writing ${filename}…`)
		await writeFileFn(graphic.folderPath + filename, blob)

		results.push({
			file: filename,
			resolution: { width: resolution.width, height: resolution.height },
		})

		// Cropped variant
		if (resolution.addCropped) {
			const cropped = cropTransparentBorder(scaledCanvas)
			if (cropped) {
				const croppedFilename = `thumbnails/${resolution.width}x${resolution.height}-cropped.png`
				onProgress(`Writing ${croppedFilename}…`)
				const croppedBlob = await canvasToBlob(cropped.canvas, 'image/png')
				await writeFileFn(graphic.folderPath + croppedFilename, croppedBlob)

				results.push({
					file: croppedFilename,
					resolution: { width: cropped.width, height: cropped.height },
				})
			}
		}
	}

	return results
}

/**
 * Generate animated WebP and GIF thumbnails for a non-realtime graphic.
 * Uses default schema data, start action (playAction), hold delay, and stop action (stopAction).
 *
 * @param {object} opts
 * @param {object} opts.graphic
 * @param {object} opts.thumbnailSettings
 * @param {Function} opts.onProgress
 * @param {Function} opts.writeFileFn
 * @returns {Promise<Array<{file:string, resolution:{width:number,height:number}, animated:boolean, format:string}>>}
 */
export async function generateAnimatedThumbnailsForGraphic({ graphic, thumbnailSettings, onProgress, writeFileFn }) {
	const {
		renderMethod = 'html-in-canvas',
		transparent = true,
		animatedWebp = true,
		animatedGif = true,
		animatedResolution = { width: 640, height: 360 },
		animatedFps = 15,
		animatedHoldDuration = 1000,
	} = thumbnailSettings

	const wantWebp = animatedWebp !== false
	const wantGif = animatedGif !== false

	if (!wantWebp && !wantGif) {
		return []
	}

	const width = animatedResolution?.width || 640
	const height = animatedResolution?.height || 360
	const fps = Math.max(1, animatedFps || 15)
	const holdDuration = Math.max(0, animatedHoldDuration ?? 1000)

	// Derive default schema data
	const defaultData = graphic.manifest?.schema ? getDefaultDataFromSchema(graphic.manifest.schema) : {}

	// Calculate action durations from manifest
	const actionDurations = Array.isArray(graphic.manifest?.actionDurations) ? graphic.manifest.actionDurations : []
	const playDuration = actionDurations.find((a) => a.type === 'playAction')?.duration || 1500
	const stopDuration = actionDurations.find((a) => a.type === 'stopAction')?.duration || 1000

	const stopTime = playDuration + holdDuration
	const totalDuration = stopTime + stopDuration
	const frameDurationMs = 1000 / fps
	const totalFrames = Math.ceil(totalDuration / frameDurationMs) + 1

	// Construct scheduled timeline: play at 0, stop at stopTime.
	// Explicitly ensure skipAnimation is not used for animated thumbnail captures.
	const schedule = [
		{
			timestamp: 0,
			action: { type: 'playAction', params: { skipAnimation: false } },
		},
		{
			timestamp: stopTime,
			action: { type: 'stopAction', params: { skipAnimation: false } },
		},
	]

	onProgress(`Rendering ${totalFrames} frames for animated thumbnail (${width}×${height} @ ${fps}fps)…`)

	const session = await createGraphicRenderSession({
		graphic,
		width,
		height,
		renderMethod,
		realtime: false,
		initialData: defaultData,
		schedule,
	})

	const capturedFrames = []

	try {
		for (let i = 0; i < totalFrames; i++) {
			const currentTime = Math.min(i * frameDurationMs, totalDuration)
			onProgress(`Rendering animation frame ${i + 1}/${totalFrames} (${(currentTime / 1000).toFixed(2)}s)…`)

			await session.seekTo(currentTime)
			const frameCanvas = await session.captureFrame(transparent ? null : '#000000')

			// Clone canvas so the frame can be retained for multi-format encoding
			const copyCanvas = document.createElement('canvas')
			copyCanvas.width = width
			copyCanvas.height = height
			const ctx = copyCanvas.getContext('2d')
			if (transparent) ctx.clearRect(0, 0, width, height)
			ctx.drawImage(frameCanvas, 0, 0, width, height)
			capturedFrames.push(copyCanvas)
		}
	} finally {
		await session.dispose()
	}

	const results = []

	// 1. Encode Animated WebP
	if (wantWebp) {
		try {
			onProgress('Encoding animated WebP thumbnail…')
			const webpBlob = await createAnimatedWebpFromCanvases(capturedFrames, {
				width,
				height,
				fps,
				quality: 0.85,
				loopCount: 0,
			})

			const webpFilename = `thumbnails/animated.webp`
			onProgress(`Writing ${webpFilename} (${Math.round(webpBlob.size / 1024)} KB)…`)
			await writeFileFn(graphic.folderPath + webpFilename, webpBlob)

			results.push({
				file: webpFilename,
				resolution: { width, height },
			})
		} catch (err) {
			console.warn('Failed to generate animated WebP thumbnail:', err)
		}
	}

	// 2. Encode Animated GIF
	if (wantGif) {
		try {
			onProgress('Encoding animated GIF thumbnail…')
			const gifBlob = await createAnimatedGifFromCanvases(capturedFrames, {
				width,
				height,
				fps,
				loopCount: 0,
			})

			const gifFilename = `thumbnails/animated.gif`
			onProgress(`Writing ${gifFilename} (${Math.round(gifBlob.size / 1024)} KB)…`)
			await writeFileFn(graphic.folderPath + gifFilename, gifBlob)

			results.push({
				file: gifFilename,
				resolution: { width, height },
			})
		} catch (err) {
			console.warn('Failed to generate animated GIF thumbnail:', err)
		}
	}

	return results
}

/**
 * Crop fully-transparent border pixels from a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [threshold=8]
 * @returns {{ canvas: HTMLCanvasElement, width: number, height: number } | null}
 */
function cropTransparentBorder(canvas, threshold = 8) {
	const { width, height } = canvas
	const ctx = canvas.getContext('2d')
	const { data } = ctx.getImageData(0, 0, width, height)

	let minX = width
	let minY = height
	let maxX = -1
	let maxY = -1

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const alpha = data[(y * width + x) * 4 + 3]
			if (alpha > threshold) {
				if (x < minX) minX = x
				if (x > maxX) maxX = x
				if (y < minY) minY = y
				if (y > maxY) maxY = y
			}
		}
	}

	if (maxX < 0) return null

	const croppedW = maxX - minX + 1
	const croppedH = maxY - minY + 1

	if (croppedW === width && croppedH === height) return null
	if (croppedW < 50 || croppedH < 50) return null

	const out = document.createElement('canvas')
	out.width = croppedW
	out.height = croppedH
	out.getContext('2d').drawImage(canvas, minX, minY, croppedW, croppedH, 0, 0, croppedW, croppedH)

	return { canvas: out, width: croppedW, height: croppedH }
}

/** Promise wrapper for HTMLCanvasElement.toBlob() */
function canvasToBlob(canvas, mimeType, quality) {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob)
				else reject(new Error('canvas.toBlob() returned null'))
			},
			mimeType,
			quality
		)
	})
}

function normalizePath(p) {
	if (!p) return ''
	return p.startsWith('/') ? p : '/' + p
}

function isFileBelongingToGraphic(filePath, graphic, allGraphics = []) {
	const folder = normalizePath(graphic.folderPath || '')
	if (folder && folder !== '/') {
		if (!filePath.startsWith(folder)) return false
	}

	if (allGraphics && allGraphics.length > 1) {
		for (const other of allGraphics) {
			if (other === graphic) continue
			const otherFolder = normalizePath(other.folderPath || '')
			if (otherFolder && otherFolder !== '/' && otherFolder.length > folder.length) {
				if (filePath.startsWith(otherFolder)) {
					return false
				}
			}
		}
	}

	return true
}

function isManifestOrThumbnailFile(normPath, graphic, thumbnailFiles) {
	const manifestPath = normalizePath(graphic.path || '')
	if (normPath === manifestPath || normPath.endsWith('.ograf.json')) {
		return true
	}

	const folder = normalizePath(graphic.folderPath || '')

	// Check against existing thumbnail files listed in manifest
	for (const thumbFile of thumbnailFiles) {
		const fullThumbPath = normalizePath((folder === '/' ? '' : folder) + thumbFile.replace(/^\//, ''))
		if (normPath === fullThumbPath) return true
	}

	// Check if file is inside a thumbnails/ directory
	if (normPath.startsWith(folder + 'thumbnails/') || normPath.includes('/thumbnails/')) {
		return true
	}

	// Check common thumbnail naming patterns (e.g. thumbnail.png, thumbnail.jpg, thumbnail.webp)
	const fileName = normPath.split('/').pop().toLowerCase()
	if (/^thumb(nail)?([-_].+)?\.(png|jpe?g|webp|gif)$/i.test(fileName)) {
		return true
	}

	return false
}

/**
 * Attempts to inspect real dimensions of an existing thumbnail image file.
 */
export async function getThumbnailDimensionsFromFile({ graphic, file, fileHandlerInstance = fileHandler }) {
	const relativePath = (graphic.folderPath || '') + file.replace(/^\//, '')
	const normalizedPath = normalizePath(relativePath)

	if (fileHandlerInstance?.readFile) {
		try {
			const fileData = await fileHandlerInstance.readFile(normalizedPath)
			if (fileData?.arrayBuffer) {
				const blob = new Blob([fileData.arrayBuffer], { type: fileData.type || 'image/png' })
				const url = URL.createObjectURL(blob)
				const dims = await new Promise((resolve) => {
					const img = new Image()
					img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
					img.onerror = () => resolve(null)
					img.src = url
				})
				URL.revokeObjectURL(url)
				if (dims?.width && dims?.height) return dims
			}
		} catch (_) {}
	}

	return null
}

/**
 * Checks a graphic for existing thumbnails that are older than other files in the graphic
 * (thumbnails and manifest excluded).
 *
 * @param {object} graphic
 * @param {Array} [allGraphics]
 * @param {object} [fileHandlerInstance]
 * @returns {Promise<Array<{
 *   entry: object|string,
 *   file: string,
 *   width: number,
 *   height: number,
 *   format: string,
 *   isAnimated: boolean,
 *   thumbModified: number,
 *   latestOtherModified: number
 * }>>}
 */
export async function getOutdatedThumbnailsForGraphic(graphic, allGraphics = [], fileHandlerInstance = fileHandler) {
	if (!graphic?.manifest) return []
	const thumbnails = graphic.manifest.thumbnails
	if (!Array.isArray(thumbnails) || thumbnails.length === 0) return []

	if (!fileHandlerInstance?.files || Object.keys(fileHandlerInstance.files).length === 0) {
		if (fileHandlerInstance?.discoverFiles) {
			try {
				await fileHandlerInstance.discoverFiles()
			} catch (_) {}
		}
	}

	const folder = normalizePath(graphic.folderPath || '')

	// Collect existing thumbnail filenames listed in manifest
	const thumbnailFiles = new Set()
	for (const t of thumbnails) {
		const f = typeof t === 'string' ? t : t?.file
		if (f) {
			thumbnailFiles.add(f.replace(/^\//, ''))
			thumbnailFiles.add(f)
		}
	}

	// 1. Find the latest lastModified among "the other files (thumbnails and manifest excluded)"
	let latestOtherModified = 0

	for (const [key, fileEntry] of Object.entries(fileHandlerInstance?.files || {})) {
		const normKey = normalizePath(key)
		if (!isFileBelongingToGraphic(normKey, graphic, allGraphics)) continue
		if (isManifestOrThumbnailFile(normKey, graphic, thumbnailFiles)) continue

		try {
			if (fileEntry?.handle?.getFile) {
				const f = await fileEntry.handle.getFile()
				if (f.lastModified > latestOtherModified) {
					latestOtherModified = f.lastModified
				}
			}
		} catch (_) {}
	}

	// If no other files exist or have timestamps, none can be newer than existing thumbnails
	if (latestOtherModified === 0) {
		return []
	}

	// 2. Compare each existing thumbnail's modified date with latestOtherModified
	const outdatedThumbnails = []

	for (const t of thumbnails) {
		const file = typeof t === 'string' ? t : t?.file
		if (!file) continue

		const fullThumbPath = normalizePath((folder === '/' ? '' : folder) + file.replace(/^\//, ''))
		const altThumbPath = fullThumbPath.replace(/^\//, '')
		const entry = fileHandlerInstance?.files?.[fullThumbPath] || fileHandlerInstance?.files?.[altThumbPath]

		let thumbModified = 0
		if (entry?.handle?.getFile) {
			try {
				const f = await entry.handle.getFile()
				thumbModified = f.lastModified
			} catch (_) {}
		}

		// If thumbnail date is older than the other files (or missing on disk), it must be replaced
		if (thumbModified < latestOtherModified) {
			const extMatch = file.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/)
			const format = extMatch
				? extMatch[1].toLowerCase()
				: typeof t === 'object' && t?.format
				? t.format.toLowerCase()
				: 'png'

			let width = typeof t === 'object' && typeof t?.resolution?.width === 'number' ? t.resolution.width : 0
			let height = typeof t === 'object' && typeof t?.resolution?.height === 'number' ? t.resolution.height : 0

			if (!width || !height) {
				const resMatch = file.match(/(\d+)x(\d+)/)
				if (resMatch) {
					width = parseInt(resMatch[1], 10)
					height = parseInt(resMatch[2], 10)
				}
			}

			if (!width || !height) {
				const dims = await getThumbnailDimensionsFromFile({ graphic, file, fileHandlerInstance })
				if (dims?.width && dims?.height) {
					width = dims.width
					height = dims.height
				}
			}

			if (!width || !height) {
				width = 1280
				height = 720
			}

			const isAnimated =
				(typeof t === 'object' && t?.animated === true) || file.toLowerCase().includes('animated')

			outdatedThumbnails.push({
				entry: t,
				file,
				width,
				height,
				format,
				isAnimated,
				thumbModified,
				latestOtherModified,
			})
		}
	}

	return outdatedThumbnails
}

/**
 * Regenerates the specified outdated thumbnails for a graphic, preserving the exact same
 * resolution and file format as each thumbnail being replaced.
 *
 * @param {object} opts
 * @param {object} opts.graphic
 * @param {Array}  opts.outdatedThumbnails
 * @param {object} [opts.thumbnailSettings]
 * @param {Function} [opts.onProgress]
 * @param {Function} opts.writeFileFn
 * @returns {Promise<Array<{file:string, resolution:{width:number,height:number}, format:string, animated?:boolean}>>}
 */
export async function replaceOutdatedThumbnailsForGraphic({
	graphic,
	outdatedThumbnails,
	thumbnailSettings = {},
	onProgress = () => {},
	writeFileFn,
}) {
	if (!outdatedThumbnails || outdatedThumbnails.length === 0) return []

	const results = []
	const staticThumbnails = outdatedThumbnails.filter((t) => !t.isAnimated)
	const animatedThumbnails = outdatedThumbnails.filter((t) => t.isAnimated)

	const defaultData = graphic.manifest?.schema ? getDefaultDataFromSchema(graphic.manifest.schema) : {}
	const isNonRealTime =
		graphic.manifest?.supportsNonRealTime &&
		(!graphic.manifest?.supportsRealTime || thumbnailSettings.realtime === false)
	const seekTime = thumbnailSettings.time ?? thumbnailSettings.captureDelay ?? 0

	// ── 1. Static Thumbnails ──
	if (staticThumbnails.length > 0) {
		const maxRes = staticThumbnails.reduce(
			(best, r) => (r.width * r.height > best.width * best.height ? r : best),
			staticThumbnails[0]
		)

		onProgress(`Capturing frame at ${maxRes.width}×${maxRes.height}…`)
		const nativeCanvas = await captureSingleGraphicFrame({
			graphic,
			width: maxRes.width,
			height: maxRes.height,
			bgcolor: thumbnailSettings.transparent ? null : '#000000',
			renderMethod: thumbnailSettings.renderMethod || 'html-in-canvas',
			realtime: !isNonRealTime,
			seekTime,
			captureDelay: thumbnailSettings.captureDelay ?? 1000,
			skipAnimation: thumbnailSettings.skipAnimation ?? true,
			initialData: defaultData,
			schedule: thumbnailSettings.schedule || [],
			onProgress,
		})

		for (const t of staticThumbnails) {
			onProgress(`Scaling & encoding ${t.file} (${t.width}×${t.height}, ${t.format.toUpperCase()})…`)

			let scaledCanvas = document.createElement('canvas')
			scaledCanvas.width = t.width
			scaledCanvas.height = t.height
			const ctx = scaledCanvas.getContext('2d')
			if (thumbnailSettings.transparent && t.format !== 'jpg' && t.format !== 'jpeg') {
				ctx.clearRect(0, 0, t.width, t.height)
			}
			ctx.drawImage(nativeCanvas, 0, 0, t.width, t.height)

			// Cropped variant handling
			let finalWidth = t.width
			let finalHeight = t.height
			if (t.file.includes('-cropped')) {
				const cropped = cropTransparentBorder(scaledCanvas)
				if (cropped) {
					scaledCanvas = cropped.canvas
					finalWidth = cropped.width
					finalHeight = cropped.height
				}
			}

			let blob
			const format = t.format.toLowerCase()

			if (format === 'jpg' || format === 'jpeg') {
				const jpegCanvas = document.createElement('canvas')
				jpegCanvas.width = scaledCanvas.width
				jpegCanvas.height = scaledCanvas.height
				const jctx = jpegCanvas.getContext('2d')
				jctx.fillStyle = '#000000'
				jctx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height)
				jctx.drawImage(scaledCanvas, 0, 0)
				blob = await canvasToBlob(jpegCanvas, 'image/jpeg', 0.9)
			} else if (format === 'webp') {
				blob = await canvasToBlob(scaledCanvas, 'image/webp', 0.85)
			} else if (format === 'gif') {
				blob = await createAnimatedGifFromCanvases([scaledCanvas], {
					width: scaledCanvas.width,
					height: scaledCanvas.height,
					transparent: thumbnailSettings.transparent,
				})
			} else {
				// Default to PNG
				blob = await canvasToBlob(scaledCanvas, 'image/png')
			}

			onProgress(`Writing ${t.file}…`)
			await writeFileFn(graphic.folderPath + t.file, blob)

			results.push({
				file: t.file,
				resolution: { width: finalWidth, height: finalHeight },
				format,
			})
		}
	}

	// ── 2. Animated Thumbnails ──
	if (animatedThumbnails.length > 0 && graphic.manifest?.supportsNonRealTime) {
		for (const t of animatedThumbnails) {
			onProgress(`Generating animated thumbnail ${t.file} (${t.width}×${t.height})…`)

			const animSettings = {
				...thumbnailSettings,
				animatedResolution: { width: t.width, height: t.height },
				animatedWebp: t.format === 'webp',
				animatedGif: t.format === 'gif',
			}

			await generateAnimatedThumbnailsForGraphic({
				graphic,
				thumbnailSettings: animSettings,
				onProgress,
				writeFileFn: async (_outputPath, blob) => {
					await writeFileFn(graphic.folderPath + t.file, blob)
				},
			})

			results.push({
				file: t.file,
				resolution: { width: t.width, height: t.height },
				format: t.format,
				animated: true,
			})
		}
	}

	return results
}
