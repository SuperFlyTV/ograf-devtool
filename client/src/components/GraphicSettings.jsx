import * as React from 'react'
import { Form, Accordion, Row, Col } from 'react-bootstrap'
import { SettingsContext } from '../contexts/SettingsContext.js'

export function GraphicSettings() {
	const settingsContext = React.useContext(SettingsContext)
	const settings = JSON.parse(JSON.stringify(settingsContext.settings))
	const onChange = settingsContext.onChange

	const handleOnChange = React.useCallback(
		(event, key, transform) => {
			const rawValue = event.target.type === 'checkbox' ? event.target.checked : event.target.value
			const newValue = transform ? transform(rawValue) : rawValue

			if (newValue === undefined) return
			settings[key] = newValue
			onChange(settings)
		},
		[settings, onChange]
	)

	return (
		<div>
			<Accordion
				defaultActiveKey={settings.viewSettingsAccordion}
				alwaysOpen
				onSelect={(selection) => {
					onChange({ ...settings, viewSettingsAccordion: selection })
				}}
			>
				<Accordion.Item eventKey="0">
					<Accordion.Header>Settings</Accordion.Header>
					<Accordion.Body>
						<Form>
							<Row>
								<Col md={6}>
									<Form.Group className="mb-3">
										<Form.Label>Renderer Type</Form.Label>
										<Form.Select
											value={`${settings.realtime ? '1' : '0'}`}
											onChange={(e) => handleOnChange(e, 'realtime', (v) => v === '1')}
										>
											<option value="1">Real Time</option>
											<option value="0">Non Real Time</option>
										</Form.Select>
									</Form.Group>
									<Form.Group className="mb-3">
										<Form.Label>Renderer Width</Form.Label>
										<Form.Control
											type="number"
											value={settings.width}
											onChange={(e) =>
												handleOnChange(e, 'width', (v) => {
													const num = parseInt(v)
													if (Number.isNaN(num)) return undefined
													if (`${v}`[0] === '0') return v
													return num
												})
											}
										/>
									</Form.Group>
									<Form.Group className="mb-3">
										<Form.Label>Renderer Height</Form.Label>
										<Form.Control
											type="number"
											value={settings.height}
											onChange={(e) =>
												handleOnChange(e, 'height', (v) => {
													const num = parseInt(v)
													if (Number.isNaN(num)) return undefined
													if (`${v}`[0] === '0') return v
													return num
												})
											}
										/>
									</Form.Group>
								</Col>
								<Col md={6}>
									<Form.Group className="mb-3">
										<Form.Label>Duration (ms)</Form.Label>
										<Form.Control
											type="number"
											value={settings.duration}
											onChange={(e) => handleOnChange(e, 'duration')}
										/>
										<Form.Text>Duration of the graphic in milliseconds</Form.Text>
									</Form.Group>

									{!settings.realtime ? (
										<>
											<Form.Group className="mb-3">
												<Form.Label>Quantize point-in-time (fps)</Form.Label>
												<Form.Control
													type="number"
													value={settings.quantizeFps}
													onChange={(e) => handleOnChange(e, 'quantizeFps')}
												/>
												<Form.Text>When set, will cause the point-in-time to stick to discrete frame times.</Form.Text>
											</Form.Group>
										</>
									) : (
										<Form.Group className="mb-3">
											<Form.Label>Auto-reload</Form.Label>
											<Form.Check
												type="switch"
												checked={settings.autoReloadEnable}
												onChange={(e) =>
													handleOnChange(e, 'autoReloadEnable', (v) => {
														return Boolean(v)
													})
												}
											/>
											<Form.Text>
												When Auto-reload is active, the graphic will be cleared and loaded continuously.
											</Form.Text>
										</Form.Group>
									)}
								</Col>
							</Row>
						</Form>
					</Accordion.Body>
				</Accordion.Item>
			</Accordion>
		</div>
	)
}
