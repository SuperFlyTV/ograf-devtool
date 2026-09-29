import domtoimage from 'dom-to-image-more'

/**
 * Capture a DOM element to an HTMLCanvasElement at the given resolution.
 *
 * @param {HTMLElement} element   The DOM element to capture.
 * @param {number}      width     Output canvas width in pixels.
 * @param {number}      height    Output canvas height in pixels.
 * @param {string|null} bgcolor
 *   - `null`        → transparent background (PNG alpha / VP9 alpha channel)
 *   - `'#rrggbb'`   → solid colour fill before compositing
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function captureFrameToCanvas(element, width, height, bgcolor) {
	return domtoimage.toCanvas(element, {
		width,
		height,
		bgcolor: bgcolor ?? null,
	})
}

/**
 * Resolve the `bgcolor` argument from a background setting object.
 *
 * The background setting used across the app is:
 *   { type: 'transparent' }          → null   (transparent)
 *   { type: 'color', value: '#hex' } → '#hex' (solid colour)
 *
 * For backwards-compatibility a plain boolean `true` (legacy "include background")
 * maps to black, and `false` / `null` maps to transparent.
 *
 * @param {{ type: 'transparent' } | { type: 'color', value: string } | boolean | null} bg
 * @returns {string|null}
 */
export function resolveBgcolor(bg) {
	if (!bg) return null
	if (bg === true) return '#000000'
	if (typeof bg === 'object') {
		if (bg.type === 'transparent') return null
		if (bg.type === 'color') return bg.value || '#000000'
	}
	return null
}
