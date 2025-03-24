import * as React from 'react'
import { Button, Accordion, Form } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { GraphicAction } from './GraphicAction.jsx'

export function GraphicControlNonRealTime({ rendererRef, manifest, setPlayTime, schedule, setActionsSchedule }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = JSON.parse(JSON.stringify(settingsContext.settings))
	const onChange = settingsContext.onChange

	const supportsNonRealTime = manifest.supportsNonRealTime

	const [playTimeLocal, setPlayTimeLocal] = React.useState(0)
	const [playTimeLocalStr, setPlayTimeLocalStr] = React.useState(playTimeLocal)

	const duration = settings.duration

	const updatePlayTime = React.useCallback(
		(time) => {
			time = parseInt(time)
			if (Number.isNaN(time)) time = 0

			const quantizedTime = settings.quantizeFps > 0 ? time - (time % (1000 / settings.quantizeFps)) : time

			if (quantizedTime !== playTimeLocal) {
				setPlayTime(quantizedTime)
				setPlayTimeLocal(quantizedTime)
				setPlayTimeLocalStr(quantizedTime)
			}
		},
		[settings]
	)
	const addToSchedule = React.useCallback(
		(timestamp, invokeAction) => {
			const newSchedule = [
				...schedule,
				{
					timestamp,
					invokeAction: JSON.parse(JSON.stringify(invokeAction)),
				},
			]
			setActionsSchedule(newSchedule)
		},
		[schedule]
	)
	const clearSchedule = React.useCallback(() => {
		setActionsSchedule([])
	}, [schedule])

	return (
		<div>
			<Accordion
				defaultActiveKey={settings.viewControlAccordion}
				alwaysOpen
				onSelect={(selection) => {
					onChange({ ...settings, viewControlAccordion: selection })
				}}
			>
				<Accordion.Item eventKey="0">
					<Accordion.Header>Graphic Control</Accordion.Header>
					<Accordion.Body>
						{supportsNonRealTime ? (
							<>
								<div>
									<Button
										onClick={() => {
											issueTracker.clear()
											rendererRef.current.loadGraphic(settings).catch(issueTracker.add)
										}}
									>
										Load Graphic
									</Button>
									<Button
										onClick={() => {
											rendererRef.current.clearGraphic().catch(issueTracker.add)
										}}
									>
										Clear Graphic
									</Button>
								</div>
								<div>
									<GraphicsActions
										rendererRef={rendererRef}
										manifest={manifest}
										onAction={(method, payload) => {
											addToSchedule(playTimeLocal, { method, payload })
										}}
									/>
								</div>
								<div>
									<Form.Group className="mb-3">
										<Form.Label>Point in Time</Form.Label>
										<Form.Range
											min={0}
											max={duration}
											value={playTimeLocal}
											onChange={(e) => {
												updatePlayTime(e.target.value)
											}}
										/>
										<Form.Control
											type="number"
											value={playTimeLocalStr}
											onChange={(e) => {
												setPlayTimeLocalStr(e.target.value)
											}}
											onBlur={(e) => {
												updatePlayTime(e.target.value)
											}}
										/>
									</Form.Group>
								</div>
							</>
						) : (
							<div className="alert alert-warning">This graphic does not support non-real-time rendering.</div>
						)}
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}
function GraphicsActions({ manifest, rendererRef, onAction }) {
	return (
		<>
			<div className="graphics-actions">
				{Object.entries(manifest.customActions || {}).map(([actionId, action]) => {
					return (
						<GraphicAction
							key={actionId}
							rendererRef={rendererRef}
							actionId={actionId}
							action={action}
							onAction={onAction}
						/>
					)
				})}
			</div>
			<div>
				<i>Click on an action to add it to the schedule of invoked actions.</i>
			</div>
		</>
	)
}
