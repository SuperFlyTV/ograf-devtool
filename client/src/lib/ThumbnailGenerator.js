import { getDefaultDataFromSchema } from 'ograf-form'
import { captureSingleGraphicFrame, createGraphicRenderSession } from './VideoRenderer.js'
import { createAnimatedWebpFromCanvases } from './encoders/webpEncoder.js'
import { createAnimatedGifFromCanvases } from './encoders/gifEncoder.js'

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
function canvasToBlob(canvas, mimeType) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob)
			else reject(new Error('canvas.toBlob() returned null'))
		}, mimeType)
	})
}
