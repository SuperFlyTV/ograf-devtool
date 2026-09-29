import { Renderer } from '../renderer/Renderer.js'
import { captureFrameToCanvas } from './frameCapture.js'

/**
 * Render a graphic timeline frame-by-frame into an array of HTMLCanvasElements
 * (or stream them to a callback), using an isolated off-screen Renderer instance.
 *
 * Works for both realtime and non-realtime graphics:
 *   - For non-realtime: loads with renderType "non-realtime", calls setActionsSchedule,
 *     then seeks each frame with gotoTime.
 *   - For realtime: loads with renderType "realtime", calls setActionsSchedule,
 *     then calls gotoTime (which may be a no-op for realtime graphics, but the graphic
 *     will still render its current state correctly for each capture).
 *
 * @param {object}   opts
 * @param {object}   opts.graphic          Graphic entry (folderPath, manifest, …)
 * @param {object}   opts.settings         Renderer / playback settings
 *   { width, height, duration, quantizeFps, realtime }
 * @param {Array}    opts.schedule         Actions schedule (array of { timestamp, action } entries)
 * @param {object}   opts.data             Graphic data to inject (passed to renderer.setData)
 * @param {number}   opts.fps              Frames per second for the render loop
 * @param {string|null} opts.bgcolor       Background colour: null = transparent, '#rrggbb' = solid
 * @param {Function} opts.onProgress       (frameIndex, totalFrames, timestampMs) => void  — called before each capture
 * @param {Function} opts.onFrame          async (canvas: HTMLCanvasElement, frameIndex: number, timestampMs: number) => void
 *                                         Called with the captured frame canvas after each seek+capture.
 *                                         Awaited before the next frame begins, so the caller controls pacing.
 * @returns {Promise<void>}                Resolves when all frames have been captured and onFrame has settled.
 */
export async function renderVideoFrames({
	graphic,
	settings,
	schedule = [],
	data = {},
	fps,
	bgcolor,
	onProgress,
	onFrame,
}) {
	const width = settings.width || 1920
	const height = settings.height || 1080
	const duration = settings.duration || 5000
	const frameDurationMs = 1000 / fps
	const totalFrames = Math.ceil(duration / frameDurationMs) + 1

	// ── Off-screen container ────────────────────────────────────────────────────
	// Must be in the DOM for layout/paint; pushed far off-screen so it is invisible.
	// shadowDomMode: 'open' is required so dom-to-image-more can traverse the shadow DOM.
	const container = document.createElement('div')
	container.style.position = 'fixed'
	container.style.top = '0'
	container.style.left = `-${width + 100}px`
	container.style.width = `${width}px`
	container.style.height = `${height}px`
	container.style.overflow = 'hidden'
	container.style.pointerEvents = 'none'
	document.body.appendChild(container)

	try {
		// ── Instantiate and load renderer ─────────────────────────────────────
		const renderer = new Renderer(container, { shadowDomMode: 'open' })
		renderer.setGraphic(graphic)
		renderer.setData(data)

		await renderer.loadGraphic({
			// Non-realtime mode enables gotoTime / setActionsSchedule.
			// Even for graphics authored as "realtime", loading as non-realtime
			// allows frame-accurate seeking during export.
			realtime: false,
			width,
			height,
		})

		// ── Inject the actions schedule ───────────────────────────────────────
		// This tells the graphic which actions fire at which timestamps, so
		// gotoTime() can drive the correct visual state at each frame.
		if (schedule && schedule.length > 0) {
			await renderer.setActionsSchedule(schedule)
		}

		// ── Seek to t=0 first so the graphic initialises its first frame ──────
		await renderer.gotoTime(0)

		// ── Frame loop ────────────────────────────────────────────────────────
		for (let i = 0; i < totalFrames; i++) {
			const currentTime = Math.min(i * frameDurationMs, duration)

			onProgress?.(i, totalFrames, currentTime)

			// Seek graphic to this timestamp
			await renderer.gotoTime(currentTime)

			// Capture the DOM element for this frame
			const frameCanvas = await captureFrameToCanvas(container, width, height, bgcolor)

			// Hand off the canvas to the caller (e.g. to push a video frame)
			await onFrame?.(frameCanvas, i, currentTime)
		}

		// ── Clean up renderer ────────────────────────────────────────────────
		try {
			await renderer.clearGraphic()
		} catch (_) {
			// Ignore disposal errors
		}
	} finally {
		container.remove()
	}
}
