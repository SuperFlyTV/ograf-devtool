import * as React from 'react'

/**
 * Live FPS & Frame-Drop Meter for real-time mode
 */
export function FpsMeter({ active = true, onReset }) {
	const [fps, setFps] = React.useState(60)
	const [frameTime, setFrameTime] = React.useState(16.6)
	const [droppedFrames, setDroppedFrames] = React.useState(0)
	const [maxFrameTime, setMaxFrameTime] = React.useState(16.6)

	const frameCountRef = React.useRef(0)
	const lastTimeRef = React.useRef(performance.now())
	const lastSecondRef = React.useRef(performance.now())
	const droppedRef = React.useRef(0)
	const animIdRef = React.useRef(null)

	React.useEffect(() => {
		if (!active) return

		const loop = (now) => {
			const delta = now - lastTimeRef.current
			lastTimeRef.current = now
			frameCountRef.current++

			// Check for dropped frame (nominal 60fps is 16.6ms; > 24ms is a dropped frame)
			if (delta > 24 && delta < 500) {
				const missed = Math.max(1, Math.round(delta / 16.66) - 1)
				droppedRef.current += missed
				setDroppedFrames(droppedRef.current)
			}

			// Update stats roughly twice per second
			if (now - lastSecondRef.current >= 500) {
				const elapsed = (now - lastSecondRef.current) / 1000
				const currentFps = Math.round((frameCountRef.current / elapsed) * 10) / 10
				const avgFrameTime = Math.round((1000 / (currentFps || 60)) * 10) / 10

				setFps(currentFps)
				setFrameTime(avgFrameTime)
				setMaxFrameTime(Math.round(delta * 10) / 10)

				frameCountRef.current = 0
				lastSecondRef.current = now
			}

			animIdRef.current = requestAnimationFrame(loop)
		}

		lastTimeRef.current = performance.now()
		lastSecondRef.current = performance.now()
		frameCountRef.current = 0
		animIdRef.current = requestAnimationFrame(loop)

		return () => {
			if (animIdRef.current) cancelAnimationFrame(animIdRef.current)
		}
	}, [active])

	const handleReset = React.useCallback(
		(e) => {
			e.stopPropagation()
			droppedRef.current = 0
			setDroppedFrames(0)
			if (onReset) onReset()
		},
		[onReset]
	)

	if (!active) return null

	const statusColor = fps >= 55 && droppedFrames === 0 ? '#10b981' : fps >= 40 ? '#f59e0b' : '#ef4444'

	return (
		<div
			className="fps-meter-hud"
			style={{
				position: 'absolute',
				top: '12px',
				right: '12px',
				background: 'rgba(15, 23, 42, 0.85)',
				backdropFilter: 'blur(8px)',
				border: `1px solid ${statusColor}`,
				borderRadius: '8px',
				padding: '6px 10px',
				color: '#f8fafc',
				fontFamily: 'monospace',
				fontSize: '12px',
				fontWeight: '600',
				display: 'inline-flex',
				alignItems: 'center',
				gap: '8px',
				zIndex: 60,
				boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
				userSelect: 'none',
				pointerEvents: 'auto',
			}}
		>
			<span
				style={{
					display: 'inline-block',
					width: '8px',
					height: '8px',
					borderRadius: '50%',
					backgroundColor: statusColor,
					boxShadow: `0 0 6px ${statusColor}`,
				}}
			/>
			<span>
				<strong style={{ color: statusColor }}>{fps.toFixed(1)}</strong> FPS
			</span>
			<span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>|</span>
			<span style={{ color: '#94a3b8' }}>{frameTime.toFixed(1)}ms</span>
			<span style={{ color: 'rgba(255, 255, 255, 0.4)' }}>|</span>
			<span style={{ color: droppedFrames > 0 ? '#f87171' : '#94a3b8' }}>
				{droppedFrames} {droppedFrames === 1 ? 'drop' : 'drops'}
			</span>
			{droppedFrames > 0 && (
				<button
					type="button"
					onClick={handleReset}
					style={{
						background: 'rgba(255, 255, 255, 0.15)',
						border: 'none',
						borderRadius: '4px',
						color: '#f8fafc',
						fontSize: '10px',
						padding: '2px 5px',
						cursor: 'pointer',
						marginLeft: '2px',
					}}
					title="Reset dropped frame counter"
				>
					Reset
				</button>
			)}
		</div>
	)
}
