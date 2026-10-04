import { GIFEncoder, quantize, applyPalette } from 'gifenc'

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
	const { width, height, fps = 15, transparentThreshold = 10, loopCount = 0 } = opts
	if (!frames || frames.length === 0) {
		throw new Error('No frames provided for animated GIF creation.')
	}

	const delayMs = Math.max(10, Math.round(1000 / fps))
	const gif = GIFEncoder()

	for (let i = 0; i < frames.length; i++) {
		const canvas = frames[i]
		const ctx = canvas.getContext('2d')
		const imgData = ctx.getImageData(0, 0, width, height)
		const data = imgData.data

		// Quantize colors to a palette of max 256 colors with rgba4444 format for transparency
		const palette = quantize(data, 256, {
			format: 'rgba4444',
			clearAlpha: true,
			clearAlphaThreshold: transparentThreshold,
		})

		const index = applyPalette(data, palette, 'rgba4444')
		const transparentIndex = palette.findIndex((p) => p[3] === 0)
		const hasTransparency = transparentIndex >= 0

		gif.writeFrame(index, width, height, {
			palette,
			delay: delayMs,
			transparent: hasTransparency,
			transparentIndex: hasTransparency ? transparentIndex : 0,
			dispose: 2, // Restore to background
			repeat: i === 0 ? loopCount : undefined,
		})
	}

	gif.finish()

	const bytes = gif.bytes()
	return new Blob([bytes], { type: 'image/gif' })
}
