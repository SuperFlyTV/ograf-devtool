/**
 * Helper to compute subtle background color gradients for graphic modified date cells,
 * based on fixed time slots (today, this week, older) and relative positions
 * within each time slot.
 *
 * Requirements:
 * - older: default background color (black / transparent in dark mode)
 * - this week: subtle grayish tint
 * - today: toned-down subtle blue tint
 * - text: left as default (not overridden)
 */

export const TIME_SLOTS = {
	TODAY: 'today',
	THIS_WEEK: 'this_week',
	OLDER: 'older',
}

function interpolate(start, end, ratio) {
	return start + ratio * (end - start)
}

function interpolateRgba(startRgba, endRgba, ratio) {
	const clampedRatio = Math.max(0, Math.min(1, ratio))
	const r = Math.round(interpolate(startRgba[0], endRgba[0], clampedRatio))
	const g = Math.round(interpolate(startRgba[1], endRgba[1], clampedRatio))
	const b = Math.round(interpolate(startRgba[2], endRgba[2], clampedRatio))
	const a = +interpolate(startRgba[3], endRgba[3], clampedRatio).toFixed(3)
	return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Gradient definitions for cell backgrounds (Dark & Light modes).
 * - today: toned-down subtle blue
 * - this_week: grayish
 * - older: default background (transparent)
 */
const GRADIENT_DEFINITIONS = {
	dark: {
		// Today: Toned-down subtle blue gradient
		[TIME_SLOTS.TODAY]: {
			cellBg: { start: [59, 130, 246, 0.08], end: [59, 130, 255, 0.5] },
			label: 'Today',
		},
		// This Week: Subtle grayish gradient
		[TIME_SLOTS.THIS_WEEK]: {
			cellBg: { start: [255, 255, 255, 0.01], end: [255, 255, 255, 0.12] },
			label: 'This week',
		},
		// Older: Default background (transparent / black in dark mode)
		[TIME_SLOTS.OLDER]: {
			cellBg: null,
			label: 'Older',
		},
	},
	light: {
		// Today: Toned-down subtle blue
		[TIME_SLOTS.TODAY]: {
			cellBg: { start: [59, 130, 246, 0.06], end: [59, 130, 246, 0.5] },
			label: 'Today',
		},
		// This Week: Subtle grayish
		[TIME_SLOTS.THIS_WEEK]: {
			cellBg: { start: [0, 0, 0, 0.01], end: [0, 0, 0, 0.08] },
			label: 'This week',
		},
		// Older: Default background (transparent / white in light mode)
		[TIME_SLOTS.OLDER]: {
			cellBg: null,
			label: 'Older',
		},
	},
}

/**
 * Determine which fixed time slot a timestamp belongs to
 */
export function getTimeSlot(timestamp, now = Date.now()) {
	if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp) || timestamp <= 0) {
		return null
	}

	const todayDate = new Date(now)
	todayDate.setHours(0, 0, 0, 0)
	const todayStartMs = todayDate.getTime()

	// Rolling 7 days: 7 days prior to today's start
	const weekStartMs = todayStartMs - 7 * 86400000

	if (timestamp >= todayStartMs) {
		return TIME_SLOTS.TODAY
	}
	if (timestamp >= weekStartMs) {
		return TIME_SLOTS.THIS_WEEK
	}
	return TIME_SLOTS.OLDER
}

/**
 * Compute the color map for a list of graphics.
 * Maps graphic.path -> { cellBg, slot, slotLabel, ratio, tooltip }
 */
export function computeGraphicDateColors(graphicsList = [], isDark = true) {
	const now = Date.now()
	const themeKey = isDark ? 'dark' : 'light'
	const gradients = GRADIENT_DEFINITIONS[themeKey]

	// 1. Group graphics into slots
	const slotTimestamps = {
		[TIME_SLOTS.TODAY]: [],
		[TIME_SLOTS.THIS_WEEK]: [],
		[TIME_SLOTS.OLDER]: [],
	}

	for (const graphic of graphicsList) {
		const ts = graphic.lastModified
		const slot = getTimeSlot(ts, now)
		if (slot && slotTimestamps[slot]) {
			slotTimestamps[slot].push(ts)
		}
	}

	// 2. Compute min, max, span for each slot
	const slotStats = {}
	for (const slot of Object.values(TIME_SLOTS)) {
		const arr = slotTimestamps[slot]
		if (arr.length > 0) {
			const min = Math.min(...arr)
			const max = Math.max(...arr)
			slotStats[slot] = {
				min,
				max,
				span: max - min,
				count: arr.length,
			}
		} else {
			slotStats[slot] = { min: 0, max: 0, span: 0, count: 0 }
		}
	}

	// 3. Generate cell background color mapping for each graphic
	const resultMap = new Map()

	for (const graphic of graphicsList) {
		const ts = graphic.lastModified
		const slot = getTimeSlot(ts, now)

		if (!slot || !gradients[slot]) {
			resultMap.set(graphic.path, {
				cellBg: 'transparent',
				slot: 'unknown',
				slotLabel: '—',
				ratio: 0.5,
				tooltip: 'Modified date unknown',
			})
			continue
		}

		const slotDef = gradients[slot]
		const stats = slotStats[slot]

		// Calculate relative ratio in this slot span (0.0 to 1.0)
		let ratio = 0.5
		if (stats.span > 0) {
			ratio = Math.max(0, Math.min(1, (ts - stats.min) / stats.span))
		}

		// Interpolate background color if slot defines a gradient, otherwise transparent (default)
		const cellBg = slotDef.cellBg ? interpolateRgba(slotDef.cellBg.start, slotDef.cellBg.end, ratio) : 'transparent'

		const d = new Date(ts)
		const formattedDate = !isNaN(d.getTime()) ? d.toLocaleString() : '—'

		const tooltip = `Modified: ${formattedDate}`

		resultMap.set(graphic.path, {
			cellBg,
			slot,
			slotLabel: slotDef.label,
			ratio,
			tooltip,
		})
	}

	return {
		getColorInfo: (graphicPath) =>
			resultMap.get(graphicPath) || {
				cellBg: 'transparent',
				slot: 'unknown',
				slotLabel: '—',
				ratio: 0.5,
				tooltip: '',
			},
		slotStats,
	}
}
