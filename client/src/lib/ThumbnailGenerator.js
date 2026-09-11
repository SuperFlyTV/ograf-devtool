import domtoimage from 'dom-to-image-more'
import { getDefaultDataFromSchema } from 'ograf-form'
import { Renderer } from '../renderer/Renderer.js'

/**
 * Generate PNG thumbnails for a single ograf graphic using dom-to-image-more.
 *
 * The graphic is rendered in an off-screen container (positioned outside the viewport)
 * using an open-mode shadow DOM so dom-to-image-more can traverse and serialise it.
 * Default schema data is injected before loading so that the graphic has something to show.
 * The resulting native-resolution canvas is rescaled to every requested output resolution.
 * If a resolution has `addCropped: true`, an additional cropped variant is produced by
 * trimming fully-transparent border pixels.
 *
 * @param {object} opts
 * @param {object}   opts.graphic           Graphic entry from fileHandler.listGraphics()
 * @param {object}   opts.thumbnailSettings { resolutions, transparent, captureDelay }
 *   resolutions: Array<{ width, height, addCropped? }>
 * @param {Function} opts.onProgress        (message: string) => void
 * @param {Function} opts.writeFileFn       async (path: string, blob: Blob) => void
 * @returns {Promise<Array<{file:string, resolution:{width:number,height:number}}>>}
 */
export async function generateThumbnailsForGraphic({ graphic, thumbnailSettings, onProgress, writeFileFn }) {
	const { resolutions, transparent, captureDelay = 1000, skipAnimation = true } = thumbnailSettings

	if (!resolutions || resolutions.length === 0) throw new Error('No resolutions specified')

	// Use the largest resolution as the native render resolution.
	// All other resolutions are produced by downscaling the native canvas.
	const maxRes = resolutions.reduce(
		(best, r) => (r.width * r.height > best.width * best.height ? r : best),
		resolutions[0]
	)

	// ── Off-screen container ──────────────────────────────────────────────────
	// Must be in the DOM for the browser to lay out and paint the graphic,
	// but placed far off the left edge so it is invisible to the user.
	const container = document.createElement('div')
	container.style.position = 'fixed'
	container.style.top = '0'
	container.style.left = `-${maxRes.width + 100}px`
	container.style.width = `${maxRes.width}px`
	container.style.height = `${maxRes.height}px`
	container.style.overflow = 'hidden'
	container.style.pointerEvents = 'none'
	document.body.appendChild(container)

	try {
		// ── Derive default data from schema ───────────────────────────────────
		const defaultData = graphic.manifest?.schema ? getDefaultDataFromSchema(graphic.manifest.schema) : {}

		// ── Load and play the graphic ─────────────────────────────────────────
		onProgress('Loading graphic…')

		// 'open' shadow DOM mode is required so dom-to-image-more can traverse it
		const renderer = new Renderer(container, { shadowDomMode: 'open' })
		renderer.setGraphic(graphic)
		renderer.setData(defaultData)

		await renderer.loadGraphic({
			realtime: true,
			width: maxRes.width,
			height: maxRes.height,
		})
		await renderer.playAction({ skipAnimation: skipAnimation || undefined })

		// ── Wait for animation to settle ──────────────────────────────────────
		onProgress(`Waiting ${captureDelay} ms for graphic to settle…`)
		await sleep(captureDelay)

		// ── Capture native-resolution canvas ──────────────────────────────────
		onProgress(`Capturing at ${maxRes.width}×${maxRes.height}…`)

		/** @type {HTMLCanvasElement} */
		const nativeCanvas = await domtoimage.toCanvas(container, {
			width: maxRes.width,
			height: maxRes.height,
			// null = transparent background; '#000000' for opaque
			bgcolor: transparent ? null : '#000000',
		})

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
			await renderer.clearGraphic()
		} catch (_) {
			// ignore disposal errors during thumbnail generation
		}

		return results
	} finally {
		container.remove()
	}
}

/**
 * Crop fully-transparent border pixels from a canvas.
 *
 * Scans all pixels and finds the tightest bounding-box of pixels whose alpha
 * channel exceeds `threshold`. Returns a new canvas containing only that region
 * (and its actual pixel dimensions), or `null` if every pixel is transparent.
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

	// No crop needed — the entire canvas is already filled
	if (minX === 0 && minY === 0 && maxX === width - 1 && maxY === height - 1) {
		return { canvas, width, height }
	}

	const croppedW = maxX - minX + 1
	const croppedH = maxY - minY + 1

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
