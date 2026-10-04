import * as React from 'react'

/**
 * Broadcast Safe Area Overlay matching EBU R95 / SMPTE RP 208 specifications:
 * - Action Safe: 90% width, 90% height (5% margin)
 * - Title Safe: 80% width, 80% height (10% margin)
 * - Center Crosshair
 */
export function SafeAreaOverlay({ width = 1920, height = 1080 }) {
	const actionLeft = width * 0.05
	const actionTop = height * 0.05
	const actionWidth = width * 0.9
	const actionHeight = height * 0.9

	const titleLeft = width * 0.1
	const titleTop = height * 0.1
	const titleWidth = width * 0.8
	const titleHeight = height * 0.8

	const centerX = width / 2
	const centerY = height / 2
	const crosshairSize = Math.min(width, height) * 0.025

	return (
		<svg
			className="safe-area-overlay"
			viewBox={`0 0 ${width} ${height}`}
			style={{
				position: 'absolute',
				top: 0,
				left: 0,
				width: '100%',
				height: '100%',
				pointerEvents: 'none',
				zIndex: 50,
			}}
		>
			<defs>
				<filter id="safe-text-shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.8" />
				</filter>
			</defs>

			{/* 90% Action Safe Area */}
			<rect
				x={actionLeft}
				y={actionTop}
				width={actionWidth}
				height={actionHeight}
				fill="none"
				stroke="#38bdf8"
				strokeWidth="1.5"
				strokeDasharray="8 4"
				opacity="0.85"
			/>
			<text
				x={actionLeft + 8}
				y={actionTop + 18}
				fill="#38bdf8"
				fontSize="13"
				fontFamily="monospace"
				fontWeight="bold"
				filter="url(#safe-text-shadow)"
			>
				90% Action Safe (EBU R95)
			</text>

			{/* 80% Title Safe Area */}
			<rect
				x={titleLeft}
				y={titleTop}
				width={titleWidth}
				height={titleHeight}
				fill="none"
				stroke="#f59e0b"
				strokeWidth="1.5"
				strokeDasharray="4 4"
				opacity="0.9"
			/>
			<text
				x={titleLeft + 8}
				y={titleTop + 18}
				fill="#f59e0b"
				fontSize="13"
				fontFamily="monospace"
				fontWeight="bold"
				filter="url(#safe-text-shadow)"
			>
				80% Title Safe (EBU R95)
			</text>

			{/* Center Crosshair */}
			<line
				x1={centerX - crosshairSize}
				y1={centerY}
				x2={centerX + crosshairSize}
				y2={centerY}
				stroke="rgba(255, 255, 255, 0.6)"
				strokeWidth="1.5"
			/>
			<line
				x1={centerX}
				y1={centerY - crosshairSize}
				x2={centerX}
				y2={centerY + crosshairSize}
				stroke="rgba(255, 255, 255, 0.6)"
				strokeWidth="1.5"
			/>
			<circle
				cx={centerX}
				cy={centerY}
				r="4"
				fill="none"
				stroke="rgba(255, 255, 255, 0.6)"
				strokeWidth="1.5"
			/>
		</svg>
	)
}
