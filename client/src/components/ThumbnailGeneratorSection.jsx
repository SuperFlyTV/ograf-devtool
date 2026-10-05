import * as React from 'react'
import { Button, Form, ProgressBar, Modal, Badge, Alert } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faImages,
	faImage,
	faBolt,
	faTrashCan,
	faStop,
	faRotateRight,
	faXmark,
	faTerminal,
	faCircleCheck,
	faCircleExclamation,
	faTriangleExclamation,
	faFilm,
} from '@fortawesome/free-solid-svg-icons'
import { isHtmlInCanvasSupported } from '../lib/frameCapture.js'

export const SETTINGS_STORAGE_KEY = 'thumbnailGeneratorSettings'

export function getDefaultThumbnailSettings() {
	const htmlInCanvas = isHtmlInCanvasSupported()
	return {
		resolutions: [{ width: 1280, height: 720, addCropped: true }],
		transparent: true,
		forceRegenerate: false,
		captureDelay: 1000,
		skipAnimation: true,
		renderMethod: htmlInCanvas ? 'html-in-canvas' : 'dom-to-image',
		generateAnimated: false,
		animatedWebp: true,
		animatedGif: true,
		animatedResolution: { width: 640, height: 360 },
		animatedFps: 15,
		animatedHoldDuration: 1000,
	}
}

export function loadPersistedSettings() {
	try {
		const s = localStorage.getItem(SETTINGS_STORAGE_KEY)
		if (s) {
			const parsed = JSON.parse(s)
			return { ...getDefaultThumbnailSettings(), ...parsed }
		}
	} catch (_) {}
	return getDefaultThumbnailSettings()
}

/**
 * Extracts and normalizes thumbnail entries from manifest, reading resolution and format
 * directly from the manifest object.
 */
export function getManifestThumbnailItems(graphicOrManifest) {
	const manifest = graphicOrManifest?.manifest || graphicOrManifest
	const thumbnails = manifest?.thumbnails
	if (!Array.isArray(thumbnails) || thumbnails.length === 0) return []

	return thumbnails
		.map((t) => {
			const file = typeof t === 'string' ? t : t?.file
			if (!file) return null

			const width = typeof t === 'object' && typeof t?.resolution?.width === 'number' ? t.resolution.width : undefined
			const height =
				typeof t === 'object' && typeof t?.resolution?.height === 'number' ? t.resolution.height : undefined
			const extMatch = typeof file === 'string' ? file.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/) : null
			const format = extMatch ? extMatch[1].toLowerCase() : ''

			return {
				raw: t,
				file,
				width: width || 0,
				height: height || 0,
				format,
				resolution: width && height ? { width, height } : null,
			}
		})
		.filter(Boolean)
}

/**
 * Checks if a graphic has zero thumbnails generated.
 */
export function hasNoThumbnails(graphic) {
	if (!graphic?.manifest) return true
	const items = getManifestThumbnailItems(graphic.manifest)
	return items.length === 0
}

/**
 * Checks if a graphic already contains a thumbnail in its manifest matching targetResolution.
 */
export function graphicHasResolution(graphic, targetResolution) {
	if (!graphic?.manifest) return false
	const items = getManifestThumbnailItems(graphic.manifest)
	if (items.length === 0) return false

	return items.some((item) => item.width === targetResolution.width && item.height === targetResolution.height)
}

/**
 * Checks if a non-realtime graphic has animated thumbnails generated.
 */
export function graphicHasAnimatedThumbnails(graphic, settings) {
	if (!graphic?.manifest?.supportsNonRealTime) return true
	const items = getManifestThumbnailItems(graphic.manifest)
	const wantWebp = settings?.animatedWebp !== false
	const wantGif = settings?.animatedGif !== false
	const hasWebp = !wantWebp || items.some((item) => item.format === 'webp')
	const hasGif = !wantGif || items.some((item) => item.format === 'gif')
	return hasWebp && hasGif
}

/**
 * Checks if a graphic is missing any of the configured output resolutions or animated thumbnails.
 */
export function isGraphicMissingConfiguredResolutions(graphic, settings) {
	if (!graphic?.manifest) return true
	const configuredResolutions = settings?.resolutions || []

	const missingStatic = configuredResolutions.some((res) => !graphicHasResolution(graphic, res))
	if (missingStatic) return true

	if (settings?.generateAnimated && graphic.manifest.supportsNonRealTime) {
		if (!graphicHasAnimatedThumbnails(graphic, settings)) return true
	}

	return false
}

export function countTotalThumbnails(graphicsList) {
	if (!Array.isArray(graphicsList)) return 0
	return graphicsList.reduce((acc, g) => acc + (g.manifest?.thumbnails?.length || 0), 0)
}

export function ThumbnailGeneratorSection({
	graphicsList,
	settings,
	onSettingsChange,
	isRunning,
	statuses,
	batchProgress,
	previewVersions,
	globalLog,
	onClearLog,
	onGenerateAll,
	onGenerateWithoutThumbnails,
	onGenerateMissingResolutions,
	onCancelGeneration,
	onDeleteAllThumbnails,
	onClose,
}) {
	const [showDeleteModal, setShowDeleteModal] = React.useState(false)
	const [isDeletingAll, setIsDeletingAll] = React.useState(false)
	const [copiedFlag, setCopiedFlag] = React.useState(false)
	const logRef = React.useRef(null)

	const htmlInCanvasAvailable = React.useMemo(() => isHtmlInCanvasSupported(), [])

	// Auto-scroll the log
	React.useEffect(() => {
		if (logRef.current) {
			logRef.current.scrollTop = logRef.current.scrollHeight
		}
	}, [globalLog])

	const noThumbnailsCount = graphicsList ? graphicsList.filter((g) => hasNoThumbnails(g)).length : 0
	const missingResolutionsCount = graphicsList
		? graphicsList.filter((g) => isGraphicMissingConfiguredResolutions(g, settings)).length
		: 0
	const totalThumbnails = countTotalThumbnails(graphicsList)

	const totalGraphics = graphicsList?.length ?? 0
	const doneCount = Object.values(statuses).filter((s) => s.status === 'done' || s.status === 'skipped').length
	const errorCount = Object.values(statuses).filter((s) => s.status === 'error').length

	const effectiveTotal = batchProgress?.total ?? totalGraphics
	const effectiveProcessed = batchProgress?.processed ?? doneCount + errorCount
	const effectiveDone = batchProgress?.doneCount ?? doneCount
	const effectiveError = batchProgress?.errorCount ?? errorCount
	const showProgressBar = isRunning || (batchProgress && batchProgress.total > 0 && batchProgress.processed > 0)

	const handleConfirmDeleteAll = async () => {
		setIsDeletingAll(true)
		try {
			await onDeleteAllThumbnails()
			setShowDeleteModal(false)
		} finally {
			setIsDeletingAll(false)
		}
	}

	const handleResetSettings = () => {
		const defaults = getDefaultThumbnailSettings()
		onSettingsChange(defaults)
	}

	const copyFlagUrl = () => {
		navigator.clipboard?.writeText('chrome://flags/#canvas-draw-element').then(() => {
			setCopiedFlag(true)
			setTimeout(() => setCopiedFlag(false), 3000)
		})
	}

	const missingResButtonLabel = React.useMemo(() => {
		const resolutions = settings.resolutions ?? []
		if (resolutions.length === 0) return 'Missing Thumbnails only'
		if (resolutions.length === 1) {
			const r = resolutions[0]
			return `Missing ${r.width}x${r.height} only`
		}
		const resList = resolutions.map((r) => `${r.width}x${r.height}`).join(', ')
		return `Missing ${resList} only`
	}, [settings.resolutions])

	const configuredResSummary = React.useMemo(() => {
		return (settings.resolutions ?? []).map((r) => `${r.width}×${r.height}`).join(', ')
	}, [settings.resolutions])

	return (
		<div className="thumbnail-generator-card">
			{/* Section Header */}
			<div className="generator-header">
				<div className="generator-header-title">
					<div className="header-icon-wrap">
						<FontAwesomeIcon icon={faImages} />
					</div>
					<div>
						<h3 className="generator-title">Thumbnail Generator</h3>
					</div>
				</div>

				<div className="generator-header-actions">
					<button
						type="button"
						className="generator-close-btn"
						onClick={onClose}
						title="Close generator panel"
						aria-label="Close"
					>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</div>
			</div>

			{/* Main Content */}
			<div className="generator-body">
				<div className="row g-3">
					{/* Left Column: Settings */}
					<div className="col-12 col-lg-5 col-xl-4">
						<div className="generator-settings-panel">
							<div className="settings-panel-header">
								<span className="settings-title">⚙️ Generation Settings</span>
								<Button
									variant="link"
									size="sm"
									className="reset-settings-link"
									onClick={handleResetSettings}
									disabled={isRunning}
									title="Reset settings to defaults"
								>
									<FontAwesomeIcon icon={faRotateRight} /> Reset
								</Button>
							</div>

							{/* ── Rendering Flow Selector ── */}
							<div className="settings-section mb-3">
								<label className="form-label-custom mb-1">Rendering Flow</label>
								<div className="d-flex gap-3 mb-2">
									<Form.Check
										type="radio"
										id="flow-html-in-canvas-thumb"
										name="thumbRenderMethod"
										label="HTML-in-Canvas"
										checked={settings.renderMethod === 'html-in-canvas'}
										onChange={() => onSettingsChange({ ...settings, renderMethod: 'html-in-canvas' })}
										disabled={isRunning || !htmlInCanvasAvailable}
									/>
									<Form.Check
										type="radio"
										id="flow-dom-to-image-thumb"
										name="thumbRenderMethod"
										label="DOM-to-Image"
										checked={settings.renderMethod === 'dom-to-image'}
										onChange={() => onSettingsChange({ ...settings, renderMethod: 'dom-to-image' })}
										disabled={isRunning}
									/>
								</div>

								{!htmlInCanvasAvailable ? (
									<Alert variant="warning" className="p-2 small mb-0">
										<div className="d-flex justify-content-between align-items-center flex-wrap gap-1">
											<span>Chrome HTML-in-Canvas flag not enabled. Using DOM-to-Image.</span>
											<Button variant="outline-dark" size="sm" style={{ fontSize: '0.7rem' }} onClick={copyFlagUrl}>
												{copiedFlag ? 'Copied!' : 'Copy Flag URL'}
											</Button>
										</div>
									</Alert>
								) : (
									<div className="settings-hint">
										{settings.renderMethod === 'html-in-canvas'
											? 'Native Chrome layoutsubtree rendering (fast & pixel-accurate).'
											: 'Standard DOM-to-Image fallback capture.'}
									</div>
								)}
							</div>

							{/* Output resolutions */}
							<div className="settings-section mb-3">
								<label className="form-label-custom">Static Resolutions (PNG)</label>
								{settings.resolutions.map((res, i) => (
									<div key={i} className="resolution-row-box mb-2">
										<div className="d-flex align-items-center gap-2">
											<Form.Control
												type="number"
												size="sm"
												min={1}
												value={res.width}
												onChange={(e) => {
													const v = parseInt(e.target.value, 10)
													if (!isNaN(v) && v > 0) {
														onSettingsChange({
															...settings,
															resolutions: settings.resolutions.map((r, idx) => (idx === i ? { ...r, width: v } : r)),
														})
													}
												}}
												disabled={isRunning}
												className="res-input"
												placeholder="W"
											/>
											<span className="res-sep">×</span>
											<Form.Control
												type="number"
												size="sm"
												min={1}
												value={res.height}
												onChange={(e) => {
													const v = parseInt(e.target.value, 10)
													if (!isNaN(v) && v > 0) {
														onSettingsChange({
															...settings,
															resolutions: settings.resolutions.map((r, idx) => (idx === i ? { ...r, height: v } : r)),
														})
													}
												}}
												disabled={isRunning}
												className="res-input"
												placeholder="H"
											/>
											<Button
												variant="outline-danger"
												size="sm"
												className="btn-remove-res"
												onClick={() => {
													if (settings.resolutions.length <= 1) return
													onSettingsChange({
														...settings,
														resolutions: settings.resolutions.filter((_, idx) => idx !== i),
													})
												}}
												disabled={isRunning || settings.resolutions.length <= 1}
												title="Remove resolution"
											>
												<FontAwesomeIcon icon={faXmark} />
											</Button>
										</div>

										<Form.Check
											type="checkbox"
											id={`chk-cropped-${i}`}
											className="crop-checkbox mt-1"
											label={
												<span>
													Also generate cropped variant <span className="text-muted">(trims transparency)</span>
												</span>
											}
											checked={!!res.addCropped}
											onChange={() => {
												onSettingsChange({
													...settings,
													resolutions: settings.resolutions.map((r, idx) =>
														idx === i ? { ...r, addCropped: !r.addCropped } : r
													),
												})
											}}
											disabled={isRunning}
										/>
									</div>
								))}

								<Button
									variant="outline-secondary"
									size="sm"
									className="btn-add-res w-100 mt-1"
									onClick={() => {
										onSettingsChange({
											...settings,
											resolutions: [...settings.resolutions, { width: 1920, height: 1080, addCropped: false }],
										})
									}}
									disabled={isRunning}
								>
									+ Add Resolution
								</Button>
							</div>

							{/* ── Animated Thumbnail Settings (Non-realtime graphics) ── */}
							<div className="settings-section mb-3 border-top pt-3">
								<Form.Check
									type="switch"
									id="chk-animated"
									label={
										<span className="fw-semibold">
											<FontAwesomeIcon icon={faFilm} className="me-1 text-info" />
											Make animated thumbnails (WebP & GIF)
										</span>
									}
									checked={!!settings.generateAnimated}
									onChange={(e) => onSettingsChange({ ...settings, generateAnimated: e.target.checked })}
									disabled={isRunning}
									className="custom-switch mb-2"
								/>
								<div className="settings-hint mb-2">Only non-realtime OGrafs are supported.</div>

								{settings.generateAnimated && (
									<div className="animated-settings-box p-2 rounded bg-body-tertiary border border-secondary-subtle">
										<div className="d-flex align-items-center gap-3 mb-2">
											<label className="small text-muted mb-0" style={{ minWidth: '4.5rem' }}>
												Formats:
											</label>
											<Form.Check
												type="checkbox"
												id="chk-anim-webp"
												label="WebP (.webp)"
												checked={settings.animatedWebp !== false}
												onChange={(e) => onSettingsChange({ ...settings, animatedWebp: e.target.checked })}
												disabled={isRunning || (!settings.animatedGif && settings.animatedWebp !== false)}
												className="small mb-0"
											/>
											<Form.Check
												type="checkbox"
												id="chk-anim-gif"
												label="GIF (.gif)"
												checked={settings.animatedGif !== false}
												onChange={(e) => onSettingsChange({ ...settings, animatedGif: e.target.checked })}
												disabled={isRunning || (!settings.animatedWebp && settings.animatedGif !== false)}
												className="small mb-0"
											/>
										</div>

										<div className="d-flex align-items-center gap-2 mb-2">
											<label className="small text-muted mb-0" style={{ minWidth: '4.5rem' }}>
												Size:
											</label>
											<Form.Control
												type="number"
												size="sm"
												min={100}
												max={1920}
												value={settings.animatedResolution?.width || 640}
												onChange={(e) =>
													onSettingsChange({
														...settings,
														animatedResolution: {
															...settings.animatedResolution,
															width: parseInt(e.target.value, 10) || 640,
														},
													})
												}
												disabled={isRunning}
												className="res-input"
											/>
											<span className="res-sep">×</span>
											<Form.Control
												type="number"
												size="sm"
												min={100}
												max={1080}
												value={settings.animatedResolution?.height || 360}
												onChange={(e) =>
													onSettingsChange({
														...settings,
														animatedResolution: {
															...settings.animatedResolution,
															height: parseInt(e.target.value, 10) || 360,
														},
													})
												}
												disabled={isRunning}
												className="res-input"
											/>
										</div>

										<div className="d-flex align-items-center gap-2 mb-2">
											<label className="small text-muted mb-0" style={{ minWidth: '4.5rem' }}>
												Frame Rate:
											</label>
											<Form.Control
												type="number"
												size="sm"
												min={5}
												max={30}
												value={settings.animatedFps || 15}
												onChange={(e) =>
													onSettingsChange({
														...settings,
														animatedFps: parseInt(e.target.value, 10) || 15,
													})
												}
												disabled={isRunning}
												className="res-input"
												style={{ width: '5rem' }}
											/>
											<span className="small text-muted">fps</span>
										</div>

										<div className="d-flex align-items-center gap-2">
											<label className="small text-muted mb-0" style={{ minWidth: '4.5rem' }}>
												Hold Pause:
											</label>
											<Form.Control
												type="number"
												size="sm"
												min={0}
												max={10000}
												step={100}
												value={settings.animatedHoldDuration ?? 1000}
												onChange={(e) =>
													onSettingsChange({
														...settings,
														animatedHoldDuration: parseInt(e.target.value, 10) || 0,
													})
												}
												disabled={isRunning}
												className="res-input"
												style={{ width: '5rem' }}
											/>
											<span className="small text-muted">ms</span>
										</div>
									</div>
								)}
							</div>

							{/* Switches */}
							<div className="settings-switches-group mb-3 border-top pt-3">
								<Form.Check
									type="switch"
									id="chk-transparent"
									label="Transparent background (PNG/WebP alpha)"
									checked={settings.transparent}
									onChange={(e) => onSettingsChange({ ...settings, transparent: e.target.checked })}
									disabled={isRunning}
									className="custom-switch mb-2"
								/>
								<Form.Check
									type="switch"
									id="chk-force"
									label="Force overwrite existing thumbnails"
									checked={settings.forceRegenerate}
									onChange={(e) => onSettingsChange({ ...settings, forceRegenerate: e.target.checked })}
									disabled={isRunning}
									className="custom-switch mb-2"
								/>
								<Form.Check
									type="switch"
									id="chk-skip-animation"
									label="Use skipAnimation (static realtime)"
									checked={settings.skipAnimation}
									onChange={(e) => onSettingsChange({ ...settings, skipAnimation: e.target.checked })}
									disabled={isRunning}
									className="custom-switch mb-2"
								/>
							</div>

							{/* Settle delay */}
							<div className="settings-section mb-2">
								<label className="form-label-custom mb-1">Settle delay after play (realtime)</label>
								<div className="resolution-row-box">
									<div className="d-flex align-items-center gap-2">
										<Form.Control
											type="number"
											size="sm"
											min={0}
											max={30000}
											step={100}
											value={settings.captureDelay}
											onChange={(e) => {
												const v = parseInt(e.target.value, 10)
												if (!isNaN(v) && v >= 0) {
													onSettingsChange({ ...settings, captureDelay: v })
												}
											}}
											disabled={isRunning}
											className="res-input"
											style={{ width: '6rem' }}
										/>
										<span className="res-sep">ms</span>
									</div>
									<div className="settings-hint">Wait time after play before capturing static frame.</div>
								</div>
							</div>
						</div>
					</div>

					{/* Right Column: Actions, Status & Log */}
					<div className="col-12 col-lg-7 col-xl-8 generator-actions-col">
						<div className="generator-actions-panel">
							{/* Action Buttons Bar */}
							<div className="action-buttons-bar">
								{/* 1. Generate for All */}
								<Button
									variant="success"
									className="btn-action-primary"
									onClick={onGenerateAll}
									disabled={isRunning || totalGraphics === 0}
									title="Generate or regenerate thumbnails for all graphics"
								>
									<FontAwesomeIcon icon={faImages} /> Generate for All ({totalGraphics})
								</Button>

								{/* 2. Generate for Graphics with No Thumbnails */}
								<Button
									variant="primary"
									className="btn-action-secondary btn-action-no-thumb"
									onClick={onGenerateWithoutThumbnails}
									disabled={isRunning || noThumbnailsCount === 0}
									title="Generate thumbnails only for graphics that currently have no thumbnails"
								>
									<FontAwesomeIcon icon={faImage} /> No Thumbnails only ({noThumbnailsCount})
								</Button>

								{/* 3. Generate Missing Configured Resolutions */}
								<Button
									variant="outline-primary"
									className="btn-action-secondary"
									onClick={onGenerateMissingResolutions}
									disabled={isRunning || missingResolutionsCount === 0}
									title={`Generate thumbnails for graphics missing any configured resolution (${configuredResSummary})`}
								>
									<FontAwesomeIcon icon={faBolt} /> {missingResButtonLabel} ({missingResolutionsCount})
								</Button>

								{/* 4. Cancel or Delete All */}
								{isRunning ? (
									<Button
										variant="danger"
										className="btn-action-danger"
										onClick={onCancelGeneration}
										title="Cancel ongoing thumbnail generation"
									>
										<FontAwesomeIcon icon={faStop} /> Cancel Generation
									</Button>
								) : (
									<Button
										variant="outline-danger"
										className="btn-action-danger"
										onClick={() => setShowDeleteModal(true)}
										disabled={totalThumbnails === 0}
										title="Delete all generated thumbnails across all graphics"
									>
										<FontAwesomeIcon icon={faTrashCan} /> Delete All ({totalThumbnails})
									</Button>
								)}
							</div>

							{/* Progress Bar & Status Summary */}
							{showProgressBar && effectiveTotal > 0 && (
								<div className="progress-status-container mt-3">
									<div className="d-flex justify-content-between align-items-center mb-1">
										<span className="progress-label">
											{isRunning ? (
												<>
													<span className="spinner-grow spinner-grow-sm text-primary me-2" role="status" />
													Generating thumbnails…
												</>
											) : (
												'Generation Status'
											)}
										</span>
										<div className="d-flex gap-2 align-items-center">
											{effectiveDone > 0 && (
												<Badge bg="success" className="status-summary-badge">
													<FontAwesomeIcon icon={faCircleCheck} className="me-1" />
													{effectiveDone} done
												</Badge>
											)}
											{effectiveError > 0 && (
												<Badge bg="danger" className="status-summary-badge">
													<FontAwesomeIcon icon={faCircleExclamation} className="me-1" />
													{effectiveError} error(s)
												</Badge>
											)}
											<span className="text-muted small">
												{effectiveProcessed}/{effectiveTotal} processed
											</span>
										</div>
									</div>

									<ProgressBar
										animated={isRunning}
										now={effectiveTotal > 0 ? (effectiveProcessed / effectiveTotal) * 100 : 0}
										variant={effectiveError > 0 ? 'warning' : 'primary'}
										className="custom-generator-progressbar"
									/>
								</div>
							)}

							{/* Activity Log Terminal */}
							<div className="generator-terminal-wrapper mt-3">
								<div className="terminal-header">
									<div className="d-flex align-items-center gap-2">
										<FontAwesomeIcon icon={faTerminal} className="terminal-icon" />
										<span className="terminal-title">Activity Log</span>
									</div>
									{globalLog.length > 0 && (
										<Button
											variant="link"
											size="sm"
											className="terminal-clear-btn"
											onClick={onClearLog}
											disabled={isRunning}
										>
											Clear
										</Button>
									)}
								</div>

								<div ref={logRef} className="generator-terminal-box">
									{globalLog.length > 0 ? (
										globalLog.map((line, idx) => (
											<div
												key={idx}
												className={`log-line ${
													line.startsWith('✗') || line.includes('Error')
														? 'log-error'
														: line.startsWith('✓')
														? 'log-success'
														: line.startsWith('Skipped')
														? 'log-skipped'
														: ''
												}`}
											>
												{line}
											</div>
										))
									) : (
										<div className="log-placeholder">Ready. Click an action above to start generation.</div>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Delete All Confirmation Modal */}
			<Modal
				show={showDeleteModal}
				onHide={() => !isDeletingAll && setShowDeleteModal(false)}
				centered
				className="custom-dark-modal"
			>
				<Modal.Header closeButton={!isDeletingAll} className="modal-header-custom">
					<Modal.Title className="modal-title-custom">
						<FontAwesomeIcon icon={faTriangleExclamation} className="text-danger me-2" />
						Delete All Thumbnails?
					</Modal.Title>
				</Modal.Header>
				<Modal.Body className="modal-body-custom">
					<p>
						Are you sure you want to delete all <strong>{totalThumbnails}</strong> thumbnail image files across{' '}
						<strong>{totalGraphics}</strong> graphics?
					</p>
					<p className="text-muted small mb-0">
						This will permanently remove the thumbnail image files from disk and clear thumbnail entries in the manifest
						files.
					</p>
				</Modal.Body>
				<Modal.Footer className="modal-footer-custom">
					<Button variant="outline-secondary" onClick={() => setShowDeleteModal(false)} disabled={isDeletingAll}>
						Cancel
					</Button>
					<Button variant="danger" onClick={handleConfirmDeleteAll} disabled={isDeletingAll}>
						{isDeletingAll ? 'Deleting…' : 'Delete All Thumbnails'}
					</Button>
				</Modal.Footer>
			</Modal>
		</div>
	)
}
