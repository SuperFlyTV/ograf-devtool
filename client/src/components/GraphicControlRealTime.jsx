import * as React from 'react'
import { Button, Accordion, ButtonGroup, InputGroup, Form, ButtonToolbar } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'
import { OGrafForm } from '../lib/GDD/ograf-form.jsx'
import { getDefaultDataFromSchema } from 'ograf-form'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { GraphicAction } from './GraphicAction.jsx'

export function GraphicControlRealTime({ rendererRef, setActionsSchedule, manifest, schedule }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext.settings
	const onChange = settingsContext.onChange

	const initialData = React.useMemo(() => {
		return manifest?.schema ? getDefaultDataFromSchema(manifest.schema) : {}
	}, [manifest?.schema])

	const [data, setData] = React.useState(initialData)
	const onDataSave = (d) => {
		setData(JSON.parse(JSON.stringify(d)))
	}

	React.useEffect(() => {
		if (rendererRef.current) {
			rendererRef.current.setData(data)
		}
	}, [data, rendererRef])

	const [skipAnimation, setSkipAnimation] = React.useState(false)
	const [gotoStep, setGotoStep] = React.useState(1)
	const [deltaStep, setDeltaStep] = React.useState(1)

	const supportsRealTime = manifest?.supportsRealTime

	return (
		<div className="graphic-control-panel">
			<Accordion
				defaultActiveKey={settings.viewControlAccordion}
				alwaysOpen
				onSelect={(selection) => {
					onChange({ ...settings, viewControlAccordion: selection })
				}}
			>
				<Accordion.Item eventKey="0">
					<Accordion.Header>Graphic Control (Real-Time)</Accordion.Header>
					<Accordion.Body className="p-3">
						{supportsRealTime ? (
							<div className="control-sections-wrapper d-flex flex-column gap-3">
								{/* Lifecycle Controls */}
								<div className="control-section-card p-2 rounded">
									<div className="d-flex flex-wrap gap-2">
										<Button
											variant="primary"
											className="px-3 fw-semibold"
											onClick={async () => {
												issueTracker.clear()
												try {
													await rendererRef.current?.clearGraphic()
													if (manifest && rendererRef.current?.graphic) {
														rendererRef.current.setGraphic({ ...rendererRef.current.graphic, manifest })
													}
													rendererRef.current?.setData(data)
													await rendererRef.current?.loadGraphic(settings, data)
												} catch (err) {
													issueTracker.addError(err)
												}
											}}
										>
											Load Graphic
										</Button>
										<Button
											variant="outline-danger"
											className="px-3"
											onClick={() => {
												issueTracker.clear()
												rendererRef.current?.clearGraphic().catch(issueTracker.addError)
											}}
										>
											Clear Graphic
										</Button>
									</div>
								</div>

								{/* Data Schema Form */}
								{manifest.schema && (
									<div className="control-section-card rounded p-3">
										<div className="d-flex justify-content-between align-items-center mb-2">
											<h6 className="section-card-title mb-0">Parameters / Schema Data</h6>
										</div>
										<div className="graphics-manifest-schema m-0">
											<OGrafForm schema={manifest.schema} data={data} setData={onDataSave} />
										</div>
									</div>
								)}

								{/* Live Action Triggers */}
								<div className="control-section-card rounded p-3">
									<div className="d-flex justify-content-between align-items-center mb-3">
										<h6 className="section-card-title mb-0">OGraf Actions</h6>
										<Form.Check
											type="switch"
											id="rt-skip-animation-switch"
											label={<span className="fs-7 text-slate-300">skipAnimation</span>}
											onChange={(e) => setSkipAnimation(e.target.checked)}
											checked={skipAnimation}
											className="mb-0"
										/>
									</div>

									{/* Main Action Buttons */}
									<div className="mb-3">
										<ButtonGroup className="w-100">
											<Button
												variant="success"
												className="fw-semibold"
												onClick={() => {
													issueTracker.clear()
													rendererRef.current?.updateAction({ data }).catch(issueTracker.addError)
												}}
											>
												Update
											</Button>
											<Button
												variant="primary"
												className="fw-semibold"
												onClick={() => {
													issueTracker.clear()
													rendererRef.current
														?.playAction({
															skipAnimation,
														})
														.catch(issueTracker.addError)
												}}
											>
												Play
											</Button>
											<Button
												variant="danger"
												className="fw-semibold"
												onClick={() => {
													issueTracker.clear()
													rendererRef.current
														?.stopAction({
															skipAnimation,
														})
														.catch(issueTracker.addError)
												}}
											>
												Stop
											</Button>
										</ButtonGroup>
									</div>

									{/* Step Navigation */}
									<ButtonToolbar aria-label="Step navigation toolbar" className="d-flex gap-2">
										<InputGroup size="sm" className="flex-grow-1">
											<Form.Control
												type="number"
												placeholder="Step"
												value={gotoStep}
												onChange={(e) => setGotoStep(parseInt(e.target.value, 10) || 0)}
												style={{ maxWidth: '4.5rem' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													issueTracker.clear()
													rendererRef.current
														?.playAction({
															goto: gotoStep,
															skipAnimation,
														})
														.catch(issueTracker.addError)
												}}
											>
												Goto Step
											</Button>
										</InputGroup>

										<InputGroup size="sm" className="flex-grow-1">
											<Form.Control
												type="number"
												placeholder="Delta"
												value={deltaStep}
												onChange={(e) => setDeltaStep(parseInt(e.target.value, 10) || 0)}
												style={{ maxWidth: '4.5rem' }}
											/>
											<Button
												variant="outline-primary"
												onClick={() => {
													issueTracker.clear()
													rendererRef.current
														?.playAction({
															delta: deltaStep,
															skipAnimation,
														})
														.catch(issueTracker.addError)
												}}
											>
												Delta Step
											</Button>
										</InputGroup>
									</ButtonToolbar>
								</div>

								{/* Custom Actions */}
								{manifest.customActions && Object.keys(manifest.customActions).length > 0 && (
									<div className="control-section-card rounded p-3">
										<h6 className="section-card-title mb-2">Custom Actions</h6>
										<GraphicsActions
											rendererRef={rendererRef}
											schedule={schedule}
											setActionsSchedule={setActionsSchedule}
											manifest={manifest}
										/>
									</div>
								)}
							</div>
						) : (
							<div className="alert alert-warning mb-0" role="alert">
								This graphic does not support real-time rendering.
							</div>
						)}
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}

function GraphicsActions({ manifest, rendererRef, schedule, setActionsSchedule }) {
	const customActionsList = Object.values(manifest?.customActions || {})

	if (customActionsList.length === 0) return null

	return (
		<>
			<div className="graphics-actions flex-wrap mb-2">
				{customActionsList.map((action) => {
					return (
						<GraphicAction
							key={action.id}
							rendererRef={rendererRef}
							action={action}
							onAction={(actionId, data, e) => {
								issueTracker.clear()
								rendererRef.current?.customAction(actionId, data).catch(issueTracker.addError)
								if (e.shiftKey && schedule && setActionsSchedule) {
									const newSchedule = [...schedule]
									newSchedule.push({
										timestamp: Date.now() - (rendererRef.current?.loadGraphicEndTime || 0),
										invokeAction: {
											id: actionId,
											payload: JSON.parse(JSON.stringify(data)),
										},
									})
									setActionsSchedule(newSchedule)
								}
							}}
						/>
					)
				})}
			</div>
			<div className="helper-tip-text fs-7">
				<i>Tip: Shift-clicking custom actions will schedule them to trigger automatically on reload.</i>
			</div>
		</>
	)
}
