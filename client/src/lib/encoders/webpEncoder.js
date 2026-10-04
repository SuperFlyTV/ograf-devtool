/**
 * Pure JavaScript Animated WebP Muxer.
 * Takes multiple single-frame WebP buffers (from canvas.toBlob or image/webp)
 * and packs them into a valid animated WebP (RIFF / VP8X / ANIM / ANMF) file.
 */

/**
 * Encodes an array of HTMLCanvasElement frames into an animated WebP Blob.
 *
 * @param {HTMLCanvasElement[]} frames - Array of canvas frames
 * @param {object} opts
 * @param {number} opts.width - Output width
 * @param {number} opts.height - Output height
 * @param {number} opts.fps - Frames per second
 * @param {number} [opts.quality=0.85] - WebP compression quality (0..1)
 * @param {number} [opts.loopCount=0] - 0 for infinite loop
 * @returns {Promise<Blob>}
 */
export async function createAnimatedWebpFromCanvases(frames, opts = {}) {
	const { width, height, fps = 15, quality = 0.85, loopCount = 0 } = opts
	if (!frames || frames.length === 0) {
		throw new Error('No frames provided for animated WebP creation.')
	}

	const frameDurationMs = Math.max(10, Math.round(1000 / fps))

	// Convert all canvases to single-frame WebP ArrayBuffers in parallel or sequentially
	const frameBuffers = []
	for (const frameCanvas of frames) {
		const blob = await new Promise((resolve, reject) => {
			frameCanvas.toBlob(
				(b) => {
					if (b) resolve(b)
					else reject(new Error('Canvas toBlob(image/webp) failed'))
				},
				'image/webp',
				quality
			)
		})
		const buffer = await blob.arrayBuffer()
		frameBuffers.push(new Uint8Array(buffer))
	}

	return muxWebpFrames(frameBuffers, {
		width,
		height,
		durationMs: frameDurationMs,
		loopCount,
	})
}

/**
 * Muxes multiple single-frame WebP Uint8Arrays into a single animated WebP Blob.
 *
 * @param {Uint8Array[]} webpFrameBuffers
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {number} [opts.durationMs=66]
 * @param {number} [opts.loopCount=0]
 * @returns {Blob}
 */
export function muxWebpFrames(webpFrameBuffers, opts) {
	const { width, height, durationMs = 66, loopCount = 0 } = opts

	const anmfChunks = []
	let hasAlphaGlobal = false

	for (const frameBytes of webpFrameBuffers) {
		const parsed = parseSingleFrameWebp(frameBytes)
		if (parsed.hasAlpha) hasAlphaGlobal = true

		// Build ANMF chunk for this frame
		// ANMF Header: 16 bytes:
		// [0..2]: Frame X / 2 (24-bit LE)
		// [3..5]: Frame Y / 2 (24-bit LE)
		// [6..8]: Frame Width - 1 (24-bit LE)
		// [9..11]: Frame Height - 1 (24-bit LE)
		// [12..14]: Frame Duration ms (24-bit LE)
		// [15]: Flags: bit 1 (blend 0 = alpha blend, 2 = no blend), bit 0 (dispose 0 = none, 1 = bg)
		const anmfHeader = new Uint8Array(16)
		const view = new DataView(anmfHeader.buffer)

		// Frame X = 0, Frame Y = 0
		writeUint24LE(anmfHeader, 0, 0)
		writeUint24LE(anmfHeader, 3, 0)
		// Frame Width - 1
		writeUint24LE(anmfHeader, 6, width - 1)
		// Frame Height - 1
		writeUint24LE(anmfHeader, 9, height - 1)
		// Frame Duration ms
		writeUint24LE(anmfHeader, 12, durationMs)
		// Flags: bit 0 = 1 (dispose to background), bit 1 = 0 (alpha blend)
		// If each frame is a full redraw, dispose to background or no blend (2) works great
		anmfHeader[15] = 0x01 // Dispose to background for clean transparency between frames

		const anmfPayloadLength = anmfHeader.length + parsed.payload.length
		const anmfPadding = anmfPayloadLength % 2 === 1 ? 1 : 0

		const anmfChunk = new Uint8Array(8 + anmfPayloadLength + anmfPadding)
		// FourCC 'ANMF'
		anmfChunk.set([0x41, 0x4e, 0x4d, 0x46], 0)
		// Chunk size
		new DataView(anmfChunk.buffer).setUint32(4, anmfPayloadLength, true)
		// ANMF header
		anmfChunk.set(anmfHeader, 8)
		// Frame image payload (VP8 / VP8L / ALPH chunks)
		anmfChunk.set(parsed.payload, 24)
		if (anmfPadding > 0) {
			anmfChunk[anmfChunk.length - 1] = 0
		}

		anmfChunks.push(anmfChunk)
	}

	// ── VP8X Chunk (Extended header) ──────────────────────────────────────────
	// FourCC 'VP8X' (4) + Size (4 = 10) + Flags (4) + Canvas W-1 (3) + Canvas H-1 (3) = 18 bytes
	const vp8xChunk = new Uint8Array(18)
	vp8xChunk.set([0x56, 0x50, 0x38, 0x58], 0) // 'VP8X'
	const vp8xView = new DataView(vp8xChunk.buffer)
	vp8xView.setUint32(4, 10, true) // size = 10

	// Flags: bit 1 = Animation (0x02), bit 4 = Alpha (0x10)
	let flags = 0x02 // Animation flag always set
	if (hasAlphaGlobal) flags |= 0x10 // Alpha flag
	vp8xView.setUint32(8, flags, true)

	// Canvas Width - 1 (24-bit LE)
	writeUint24LE(vp8xChunk, 12, width - 1)
	// Canvas Height - 1 (24-bit LE)
	writeUint24LE(vp8xChunk, 15, height - 1)

	// ── ANIM Chunk (Animation parameters) ─────────────────────────────────────
	// FourCC 'ANIM' (4) + Size (4 = 6) + BG Color (4) + Loop Count (2) = 14 bytes
	const animChunk = new Uint8Array(14)
	animChunk.set([0x41, 0x4e, 0x49, 0x4d], 0) // 'ANIM'
	const animView = new DataView(animChunk.buffer)
	animView.setUint32(4, 6, true)
	animView.setUint32(8, 0x00000000, true) // 0 = transparent black BG
	animView.setUint16(12, loopCount, true) // 0 = infinite loop

	// ── Calculate Total RIFF Size ─────────────────────────────────────────────
	let totalChunksSize = 4 + vp8xChunk.length + animChunk.length // 4 for 'WEBP'
	for (const chunk of anmfChunks) {
		totalChunksSize += chunk.length
	}

	const riffHeader = new Uint8Array(12)
	riffHeader.set([0x52, 0x49, 0x46, 0x46], 0) // 'RIFF'
	new DataView(riffHeader.buffer).setUint32(4, totalChunksSize, true)
	riffHeader.set([0x57, 0x45, 0x42, 0x50], 8) // 'WEBP'

	// Combine all parts into a Blob
	const blobParts = [riffHeader, vp8xChunk, animChunk, ...anmfChunks]
	return new Blob(blobParts, { type: 'image/webp' })
}

function writeUint24LE(arr, offset, val) {
	arr[offset] = val & 0xff
	arr[offset + 1] = (val >> 8) & 0xff
	arr[offset + 2] = (val >> 16) & 0xff
}

/**
 * Parses a single-frame WebP buffer and extracts the inner chunks (VP8/VP8L/ALPH)
 * needed as the payload for an ANMF chunk.
 *
 * @param {Uint8Array} buffer
 * @returns {{ payload: Uint8Array, hasAlpha: boolean }}
 */
function parseSingleFrameWebp(buffer) {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

	// Check RIFF header
	const isRiff = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
	const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50

	if (!isRiff || !isWebp) {
		throw new Error('Invalid WebP buffer header')
	}

	let offset = 12
	const payloadParts = []
	let hasAlpha = false

	while (offset < buffer.byteLength) {
		if (offset + 8 > buffer.byteLength) break

		const fourCC = String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3])
		const chunkSize = view.getUint32(offset + 4, true)
		const paddedSize = chunkSize + (chunkSize % 2)

		if (fourCC === 'VP8X') {
			const flags = view.getUint32(offset + 8, true)
			if (flags & 0x10) hasAlpha = true
		} else if (fourCC === 'ALPH') {
			hasAlpha = true
			payloadParts.push(buffer.subarray(offset, offset + 8 + paddedSize))
		} else if (fourCC === 'VP8L') {
			hasAlpha = true // Lossless WebP generally has alpha capability
			payloadParts.push(buffer.subarray(offset, offset + 8 + paddedSize))
		} else if (fourCC === 'VP8 ') {
			payloadParts.push(buffer.subarray(offset, offset + 8 + paddedSize))
		}

		offset += 8 + paddedSize
	}

	// Concatenate payload parts
	const totalLen = payloadParts.reduce((acc, p) => acc + p.length, 0)
	const combined = new Uint8Array(totalLen)
	let cur = 0
	for (const p of payloadParts) {
		combined.set(p, cur)
		cur += p.length
	}

	return { payload: combined, hasAlpha }
}
