import { GIFEncoder, quantize, applyPalette } from 'gifenc'

/**
 * Creates an animated GIF frame writer using gifenc.
 *
 * @param {object} opts
 * @param {number} opts.width - Output width
 * @param {number} opts.height - Output height
 * @param {number} [opts.fps=15] - Frames per second
 * @param {number} [opts.delayMs] - Explicit delay per frame in ms (overrides fps)
 * @param {boolean} [opts.transparent=true] - Whether to preserve transparency
 * @param {number} [opts.transparentThreshold=10] - Alpha threshold <= treated as transparent
 * @param {number} [opts.loopCount=0] - 0 for infinite loop
 * @returns {Promise<{
 *   canvas: HTMLCanvasElement,
 *   width: number,
 *   height: number,
 *   ext: string,
 *   mime: string,
 *   isGif: boolean,
 *   addFrame: (sourceCanvas: HTMLCanvasElement, timestampSec?: number, durationSec?: number) => Promise<void>,
 *   finalize: () => Promise<Blob>,
 *   cancel: () => Promise<void>
 * }>}
 */
export async function createGifWriter(opts = {}) {
	const {
		width,
		height,
		fps = 15,
		delayMs: customDelayMs,
		transparent = true,
		transparentThreshold = 10,
		loopCount = 0,
	} = opts

	if (!width || !height) {
		throw new Error('Width and height are required for GIF writer.')
	}

	const defaultDelayMs = customDelayMs || Math.max(10, Math.round(1000 / fps))
	const gif = GIFEncoder()
	let frameIndex = 0

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext('2d')

	return {
		canvas,
		width,
		height,
		ext: 'gif',
		mime: 'image/gif',
		isGif: true,
		addFrame: async (sourceCanvas, _timestampSec, durationSec) => {
			ctx.clearRect(0, 0, width, height)
			ctx.drawImage(sourceCanvas, 0, 0, width, height)
			const imgData = ctx.getImageData(0, 0, width, height)
			const data = imgData.data

			const delay = durationSec > 0 ? Math.max(10, Math.round(durationSec * 1000)) : defaultDelayMs

			let palette
			let index
			let hasTransparency = false
			let transparentIndex = 0

			if (transparent) {
				// Quantize colors to a palette of max 256 colors with rgba4444 format for transparency
				palette = quantize(data, 256, {
					format: 'rgba4444',
					clearAlpha: true,
					clearAlphaThreshold: transparentThreshold,
				})

				index = applyPalette(data, palette, 'rgba4444')
				const foundIdx = palette.findIndex((p) => p[3] === 0)
				if (foundIdx >= 0) {
					hasTransparency = true
					transparentIndex = foundIdx
				}
			} else {
				palette = quantize(data, 256, {
					format: 'rgb565',
				})
				index = applyPalette(data, palette, 'rgb565')
			}

			gif.writeFrame(index, width, height, {
				palette,
				delay,
				transparent: hasTransparency,
				transparentIndex: hasTransparency ? transparentIndex : 0,
				dispose: 2, // Restore to background
				repeat: frameIndex === 0 ? loopCount : undefined,
			})
			frameIndex++
		},
		finalize: async () => {
			gif.finish()
			const bytes = gif.bytes()
			return new Blob([bytes], { type: 'image/gif' })
		},
		cancel: async () => {
			try {
				gif.reset()
			} catch (_) {}
		},
	}
}

/**
 * Encodes an array of HTMLCanvasElement frames into an animated GIF Blob using gifenc.
 *
 * @param {HTMLCanvasElement[]} frames - Array of canvas frames
 * @param {object} opts
 * @param {number} opts.width - Output width
 * @param {number} opts.height - Output height
 * @param {number} [opts.fps=15] - Frames per second
 * @param {number} [opts.transparentThreshold=10] - Alpha threshold <= treated as transparent
 * @param {number} [opts.loopCount=0] - 0 for infinite loop
 * @returns {Promise<Blob>}
 */
export async function createAnimatedGifFromCanvases(frames, opts = {}) {
	if (!frames || frames.length === 0) {
		throw new Error('No frames provided for animated GIF creation.')
	}

	const width = opts.width || frames[0].width
	const height = opts.height || frames[0].height
	const writer = await createGifWriter({ ...opts, width, height })

	for (const frame of frames) {
		await writer.addFrame(frame)
	}

	return await writer.finalize()
}
