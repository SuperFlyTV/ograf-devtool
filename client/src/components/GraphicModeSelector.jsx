import * as React from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBolt, faClock } from '@fortawesome/free-solid-svg-icons'

export function GraphicModeSelector({ manifest, isRealtime, onChangeMode }) {
	const supportsRealTime = manifest ? Boolean(manifest.supportsRealTime) : true
	const supportsNonRealTime = manifest ? Boolean(manifest.supportsNonRealTime) : true

	return (
		<div className="graphic-mode-selector-wrapper mb-3">
			<div className="mode-selector-label d-flex justify-content-between align-items-center mb-1">
				<span className="text-secondary text-uppercase fw-bold fs-7 tracking-wider">Playback & Control Mode</span>
				{(!supportsRealTime || !supportsNonRealTime) && (
					<span className="badge bg-dark-subtle text-muted border border-secondary-subtle fs-8">
						Limited by Manifest
					</span>
				)}
			</div>

			<div className="mode-segmented-toggle d-flex p-1 rounded bg-dark border border-secondary">
				{/* Real-Time Mode Button */}
				<OverlayTrigger
					placement="top"
					overlay={
						!supportsRealTime ? (
							<Tooltip id="rt-mode-tt">This graphic manifest does not support Real-Time rendering.</Tooltip>
						) : (
							<Tooltip id="rt-mode-tt">Live, interactive execution with immediate action triggers.</Tooltip>
						)
					}
				>
					<button
						type="button"
						disabled={!supportsRealTime}
						className={`mode-toggle-btn flex-fill d-flex align-items-center justify-content-center gap-2 py-2 px-3 rounded border-0 fw-semibold transition-all ${
							isRealtime ? 'active-realtime text-white shadow-sm' : 'bg-transparent'
						} ${!supportsRealTime ? 'disabled opacity-40 cursor-not-allowed' : ''}`}
						onClick={() => supportsRealTime && onChangeMode(true)}
					>
						<FontAwesomeIcon icon={faBolt} className={isRealtime ? 'text-warning' : 'text-muted'} />
						<span>Real-Time</span>
					</button>
				</OverlayTrigger>

				{/* Non-Real-Time (Timeline) Mode Button */}
				<OverlayTrigger
					placement="top"
					overlay={
						!supportsNonRealTime ? (
							<Tooltip id="nrt-mode-tt">This graphic manifest does not support Non-Real-Time rendering.</Tooltip>
						) : (
							<Tooltip id="nrt-mode-tt">Deterministic timeline playback and scheduled action triggers.</Tooltip>
						)
					}
				>
					<button
						type="button"
						disabled={!supportsNonRealTime}
						className={`mode-toggle-btn flex-fill d-flex align-items-center justify-content-center gap-2 py-2 px-3 rounded border-0 fw-semibold transition-all ${
							!isRealtime ? 'active-nonrealtime text-white shadow-sm' : 'bg-transparent'
						} ${!supportsNonRealTime ? 'disabled opacity-40 cursor-not-allowed' : ''}`}
						onClick={() => supportsNonRealTime && onChangeMode(false)}
					>
						<FontAwesomeIcon icon={faClock} className={!isRealtime ? 'text-info' : 'text-muted'} />
						<span>Non Real-Time</span>
					</button>
				</OverlayTrigger>
			</div>
		</div>
	)
}
