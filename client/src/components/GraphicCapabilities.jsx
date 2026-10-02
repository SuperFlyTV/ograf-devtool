import * as React from 'react'
import { Accordion, Button, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { CapabilityBadge } from './common/CapabilityBadge.jsx'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCode, faCopy, faCheck } from '@fortawesome/free-solid-svg-icons'

export function GraphicCapabilities({ manifest }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = JSON.parse(JSON.stringify(settingsContext.settings))
	const onChange = settingsContext.onChange

	const [copied, setCopied] = React.useState(false)

	const handleCopyJson = React.useCallback(() => {
		if (!manifest) return
		navigator.clipboard.writeText(JSON.stringify(manifest, null, 2))
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
	}, [manifest])

	if (!manifest) return null

	return (
		<Accordion
			defaultActiveKey={settings.viewCapabilitiesAccordion}
			alwaysOpen
			onSelect={(selection) => {
				onChange({ ...settings, viewCapabilitiesAccordion: selection })
			}}
		>
			<Accordion.Item eventKey="0">
				<Accordion.Header>Graphic Info</Accordion.Header>
				<Accordion.Body className="p-3">
					<div className="graphic-info-sheet">
						<div className="info-property-grid">
							<div className="info-property-row">
								<div className="info-label-cell">
									<OverlayTrigger
										placement="top"
										overlay={<Tooltip id="tt-manifest-name">manifest.name</Tooltip>}
									>
										<span className="info-prop-name">Name</span>
									</OverlayTrigger>
								</div>
								<div className="info-value-cell">
									<strong className="text-light">{manifest.name || <span className="text-slate-400 fst-italic">Untitled</span>}</strong>
								</div>
							</div>

							<div className="info-property-row">
								<div className="info-label-cell">
									<OverlayTrigger
										placement="top"
										overlay={<Tooltip id="tt-manifest-id">manifest.id</Tooltip>}
									>
										<span className="info-prop-name">ID</span>
									</OverlayTrigger>
								</div>
								<div className="info-value-cell">
									<code className="info-code-val">{manifest.id || <span className="text-slate-400 fst-italic">None</span>}</code>
								</div>
							</div>

							<div className="info-property-row">
								<div className="info-label-cell">
									<OverlayTrigger
										placement="top"
										overlay={<Tooltip id="tt-manifest-version">manifest.version</Tooltip>}
									>
										<span className="info-prop-name">Version</span>
									</OverlayTrigger>
								</div>
								<div className="info-value-cell">
									<span className="badge bg-secondary info-badge">{manifest.version || '1.0.0'}</span>
								</div>
							</div>

							{manifest.description && (
								<div className="info-property-row">
									<div className="info-label-cell">
										<OverlayTrigger
											placement="top"
											overlay={<Tooltip id="tt-manifest-desc">manifest.description</Tooltip>}
										>
											<span className="info-prop-name">Description</span>
										</OverlayTrigger>
									</div>
									<div className="info-value-cell text-slate-300">
										{manifest.description}
									</div>
								</div>
							)}

							<div className="info-property-row">
								<div className="info-label-cell">
									<OverlayTrigger
										placement="top"
										overlay={<Tooltip id="tt-manifest-caps">manifest.supportsRealTime / manifest.supportsNonRealTime</Tooltip>}
									>
										<span className="info-prop-name">Capabilities</span>
									</OverlayTrigger>
								</div>
								<div className="info-value-cell d-flex flex-wrap gap-1 align-items-center">
									<CapabilityBadge
										type="realtime"
										supported={Boolean(manifest.supportsRealTime)}
										showUnsupported={true}
									/>
									<CapabilityBadge
										type="nonRealtime"
										supported={Boolean(manifest.supportsNonRealTime)}
										showUnsupported={true}
									/>
								</div>
							</div>
						</div>

						<Accordion className="mt-3 raw-manifest-accordion" flush>
							<Accordion.Item eventKey="raw-json">
								<Accordion.Header className="raw-json-header">
									<span className="d-flex align-items-center gap-2">
										<FontAwesomeIcon icon={faCode} className="text-muted" />
										<span className="fs-7 font-monospace">Raw Manifest JSON</span>
									</span>
								</Accordion.Header>
								<Accordion.Body className="p-2">
									<div className="position-relative">
										<OverlayTrigger
											placement="left"
											overlay={<Tooltip id="copy-json-tt">{copied ? 'Copied!' : 'Copy JSON'}</Tooltip>}
										>
											<Button
												size="sm"
												variant="outline-secondary"
												className="position-absolute top-0 end-0 m-2 btn-copy-json"
												onClick={handleCopyJson}
											>
												<FontAwesomeIcon icon={copied ? faCheck : faCopy} />
											</Button>
										</OverlayTrigger>
										<pre className="raw-json-viewer mb-0">
											<code>{JSON.stringify(manifest, null, 2)}</code>
										</pre>
									</div>
								</Accordion.Body>
							</Accordion.Item>
						</Accordion>
					</div>
				</Accordion.Body>
			</Accordion.Item>
		</Accordion>
	)
}
