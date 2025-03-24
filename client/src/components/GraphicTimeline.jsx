import * as React from 'react'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { Button } from 'react-bootstrap'

export function GraphicTimeline({ rendererRef, playTimeRef, realtime, schedule, onRemoveScheduledAction }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = JSON.parse(JSON.stringify(settingsContext.settings))
	const onChange = settingsContext.onChange

	const [width, setWidth] = React.useState(0)
	const [message, setMessage] = React.useState(null)

	const duration = settings.duration

	React.useEffect(() => {
		let active = true
		const triggerNextFrame = () => {
			if (!active) return

			// On each frame:
			window.requestAnimationFrame(() => {
				if (!active) return
				triggerNextFrame()

				if (!rendererRef?.current) return
				const graphicState = rendererRef.current.graphicState

				if (graphicState === 'pre-load') {
					setMessage('Loading...')
				} else if (graphicState === 'post-load') {
					setMessage('Loaded')
				} else if (graphicState === 'pre-clear') {
					setMessage('Clearing...')
				} else if (graphicState === 'post-clear') {
					setMessage('Cleared')
				} else if (graphicState === '') {
					// nothing
				} else {
					setMessage(`Unknown state: "${graphicState}"`)
				}

				if (settings.realtime) {
					const loadGraphicEndTime = rendererRef.current.loadGraphicEndTime || 0

					if (graphicState === 'pre-load') {
						setWidth(0)
					} else if (graphicState === 'post-load') {
						if (settings.autoReloadEnable) {
							setWidth((Date.now() - loadGraphicEndTime) / duration)
						} else {
							setWidth(0)
						}
					} else if (graphicState === 'post-clear') {
						setWidth(0)
					}
				} else {
					// non-realtime
					if (!playTimeRef) return

					setWidth(playTimeRef.current / duration)
				}
			})
		}
		triggerNextFrame()
		return () => {
			active = false
		}
	}, [rendererRef, settings])
	return (
		<div className="auto-reload-bar">
			<div
				className="auto-reload-bar_bar"
				style={{
					width: `${width * 100}%`,
				}}
			></div>
			<div className="auto-reload-bar_message">{message ? `Status: ${message}` : ''}</div>
			{schedule.length ? (
				<div className="auto-reload-bar_actions">
					{schedule.map((action, index) =>
						(settings.realtime && settings.autoReloadEnable) || !settings.realtime ? (
							<div
								key={index}
								className="auto-reload-bar_action auto-reload-bar_action-timed"
								style={{
									left: `${(action.timestamp / duration) * 100}%`,
								}}
							>
								{`${action.invokeAction.method}: ${JSON.stringify(action.invokeAction.payload)}`}
								<Button variant="outline-secondary" size="sm" onClick={() => onRemoveScheduledAction(index)}>
									🗑️
								</Button>
							</div>
						) : (
							<div key={index} className="auto-reload-bar_action auto-reload-bar_action-untimed">
								{`${action.invokeAction.method}: ${JSON.stringify(action.invokeAction.payload)}`}
								<Button variant="outline-secondary" size="sm" onClick={() => onRemoveScheduledAction(index)}>
									🗑️
								</Button>
							</div>
						)
					)}
				</div>
			) : null}
		</div>
	)
}
