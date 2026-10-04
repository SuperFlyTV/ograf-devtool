import * as React from 'react'

export function CapabilityBadge({ supportsRealTime, supportsNonRealTime, compact = false }) {
	const hasRealTime = !!supportsRealTime
	const hasNonRealTime = !!supportsNonRealTime

	if (!hasRealTime && !hasNonRealTime) {
		return <span className="text-muted small">—</span>
	}

	return (
		<div className="d-flex flex-wrap gap-1 align-items-center">
			{hasRealTime && (
				<span
					className="cap-badge cap-realtime"
					title="Supports Real-Time rendering (used in live broadcast workflows)"
				>
					<span className="cap-icon">🏃</span>
					{!compact && <span className="cap-text">Real-Time</span>}
				</span>
			)}
			{hasNonRealTime && (
				<span className="cap-badge cap-nonrealtime" title="Supports Non-Real-Time rendering (used in NLE workflows)">
					<span className="cap-icon">🎞</span>
					{!compact && <span className="cap-text">Non-RT</span>}
				</span>
			)}
		</div>
	)
}
