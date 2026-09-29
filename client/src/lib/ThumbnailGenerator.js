import { createOffscreenRenderContainer, captureContainerFrame } from './frameCapture.js'
import { getDefaultDataFromSchema } from 'ograf-form'
import { Renderer } from '../renderer/Renderer.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'

/**
 * Generate PNG thumbnails for a single ograf graphic.
 *
 * Supports both realtime and non-realtime graphics:
 *   - For non-realtime: loads with renderType "non-realtime", sets action schedule if provided,
 *     and seeks with gotoTime.
 *   - For realtime: loads with renderType "realtime", plays action, and waits for captureDelay.
 *
 * Supports both "html-in-canvas" (Chrome native) and "dom-to-image" capture methods.
 *
 * @param {object} opts
 * @param {object}   opts.graphic           Graphic entry from fileHandler.listGraphics()
 * @param {object}   opts.thumbnailSettings { resolutions, transparent, captureDelay, skipAnimation, time, schedule, renderMethod }
 *   resolutions: Array<{ width, height, addCropped? }>
 * @param {Function} opts.onProgress        (message: string) => void
 * @param {Function} opts.writeFileFn       async (path: string, blob: Blob) => void
 * @returns {Promise<Array<{file:string, resolution:{width:number,height:number}}>>}
 */
export async function generateThumbnailsForGraphic({ graphic, thumbnailSettings, onProgress, writeFileFn }) {
	const {
		resolutions,
		transparent,
		captureDelay = 1000,
		skipAnimation = true,
		time = 0,
		schedule = [],
		renderMethod = 'html-in-canvas',
	} = thumbnailSettings

	if (!resolutions || resolutions.length === 0) throw new Error('No resolutions specified')

	// Use the largest resolution as the native render resolution.
	// All other resolutions are produced by downscaling the native canvas.
	const maxRes = resolutions.reduce(
		(best, r) => (r.width * r.height > best.width * best.height ? r : best),
		resolutions[0]
	)

	// ── Off-screen container ──────────────────────────────────────────────────
	const containerInfo = createOffscreenRenderContainer({
		width: maxRes.width,
		height: maxRes.height,
		renderMethod,
	})

	let graphicElement = null
	let renderer = null

	try {
		// ── Derive default data from schema ───────────────────────────────────
		const defaultData = graphic.manifest?.schema ? getDefaultDataFromSchema(graphic.manifest.schema) : {}

		// ── Load and play / seek the graphic ───────────────────────────────────
		onProgress('Loading graphic…')

		const isNonRealTime =
			graphic.manifest?.supportsNonRealTime &&
			(!graphic.manifest?.supportsRealTime || thumbnailSettings.realtime === false)

		if (containerInfo.renderMethod === 'html-in-canvas') {
			// Direct mount into canvas with Shadow DOM style encapsulation
			const graphicPath = ResourceProvider.graphicPath(graphic.folderPath, graphic.manifest.main)
			const elementName = await ResourceProvider.loadGraphic(graphicPath)

			graphicElement = document.createElement(elementName)
			graphicElement.setAttribute('drawable', '')
			graphicElement.style.position = 'absolute'
			graphicElement.style.top = '0px'
			graphicElement.style.left = '0px'
			graphicElement.style.width = `${maxRes.width}px`
			graphicElement.style.height = `${maxRes.height}px`
			graphicElement.style.display = 'block'
			graphicElement.style.margin = '0'
			graphicElement.style.padding = '0'
			containerInfo.canvasElement.appendChild(graphicElement)

			await graphicElement.load({
				renderType: isNonRealTime ? 'non-realtime' : 'realtime',
				data: defaultData,
				renderCharacteristics: {
					resolution: { width: maxRes.width, height: maxRes.height },
					_environment: 'OGraf DevTool',
				},
			})

			// If the graphic populated its light DOM (and didn't create its own shadowRoot),
			// adopt its children into an open ShadowRoot on graphicElement for total style encapsulation:
			if (!graphicElement.shadowRoot && graphicElement.childNodes.length > 0) {
				const shadow = graphicElement.attachShadow({ mode: 'open' })
				while (graphicElement.firstChild) {
					shadow.appendChild(graphicElement.firstChild)
				}
			}

			if (isNonRealTime) {
				if (schedule && schedule.length > 0 && typeof graphicElement.setActionsSchedule === 'function') {
					const actionSchedule = schedule.filter((item) => item.action?.type !== 'initialData')
					await graphicElement.setActionsSchedule({ schedule: actionSchedule })
				}

				const seekTime = time ?? captureDelay ?? 0
				onProgress(`Seeking to ${seekTime} ms…`)
				if (typeof graphicElement.goToTime === 'function') {
					await graphicElement.goToTime({ timestamp: seekTime })
				}
			} else {
				if (typeof graphicElement.playAction === 'function') {
					await graphicElement.playAction({ skipAnimation: skipAnimation || undefined })
				}

				onProgress(`Waiting ${captureDelay} ms for graphic to settle…`)
				await sleep(captureDelay)
			}
		} else {
			renderer = new Renderer(containerInfo.container, { shadowDomMode: 'open' })
			renderer.setGraphic(graphic)
			renderer.setData(defaultData)

			if (isNonRealTime) {
				await renderer.loadGraphic({
					realtime: false,
					width: maxRes.width,
					height: maxRes.height,
				})

				if (schedule && schedule.length > 0) {
					await renderer.setActionsSchedule(schedule)
				}

				const seekTime = time ?? captureDelay ?? 0
				onProgress(`Seeking to ${seekTime} ms…`)
				await renderer.gotoTime(seekTime)
			} else {
				await renderer.loadGraphic({
					realtime: true,
					width: maxRes.width,
					height: maxRes.height,
				})
				await renderer.playAction({ skipAnimation: skipAnimation || undefined })

				// Wait for animation to settle
				onProgress(`Waiting ${captureDelay} ms for graphic to settle…`)
				await sleep(captureDelay)
			}
		}

		// ── Capture native-resolution canvas ──────────────────────────────────
		onProgress(`Capturing at ${maxRes.width}×${maxRes.height}…`)

		/** @type {HTMLCanvasElement} */
		const nativeCanvas = await captureContainerFrame(
			containerInfo,
			maxRes.width,
			maxRes.height,
			transparent ? null : '#000000'
		)

		// ── Export each requested resolution ──────────────────────────────────
		const results = []

		for (const resolution of resolutions) {
			// ── Full-size thumbnail ───────────────────────────────────────────
			const filename = `thumbnails/${resolution.width}x${resolution.height}.png`

			onProgress(`Scaling & encoding ${resolution.width}×${resolution.height}…`)

			/** @type {HTMLCanvasElement} */
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

			// ── Cropped variant ───────────────────────────────────────────────
			if (resolution.addCropped) {
				const cropped = cropTransparentBorder(scaledCanvas)
				if (cropped) {
					const croppedFilename = `thumbnails/${resolution.width}x${resolution.height}-cropped.png`
					onProgress(`Writing ${croppedFilename}…`)
					const croppedBlob = await canvasToBlob(cropped.canvas, 'image/png')
					await writeFileFn(graphic.folderPath + croppedFilename, croppedBlob)

					results.push({
						file: croppedFilename,
						// Record the actual cropped pixel dimensions
						resolution: { width: cropped.width, height: cropped.height },
					})
				}
			}
		}

		// Dispose the graphic cleanly
		try {
			if (graphicElement && typeof graphicElement.dispose === 'function') {
				await graphicElement.dispose({})
			} else if (renderer) {
				await renderer.clearGraphic()
			}
		} catch (_) {
			// ignore disposal errors during thumbnail generation
		}

		return results
	} finally {
		containerInfo.cleanup()
	}
}

/**
 * Crop fully-transparent border pixels from a canvas.
 *
 * Scans all pixels and finds the tightest bounding-box of pixels whose alpha
 * channel exceeds `threshold`. Returns a new canvas containing only that region
 * (and its actual pixel dimensions), or `null` if:
 *   - every pixel is transparent,
 *   - the cropped dimensions match the original canvas dimensions (no trimming occurred), or
 *   - the cropped dimensions are less than 50x50px.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [threshold=8]   Alpha values <= threshold are treated as "empty"
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

	// Fully transparent — nothing to crop to
	if (maxX < 0) return null

	const croppedW = maxX - minX + 1
	const croppedH = maxY - minY + 1

	// No crop needed — the entire canvas is already filled (same dimensions as source thumbnail)
	if (croppedW === width && croppedH === height) return null

	// Cropped size is less than 50x50px
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

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
