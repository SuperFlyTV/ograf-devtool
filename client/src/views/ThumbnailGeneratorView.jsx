import * as React from 'react'
import { Button, Form, Table, Badge, ProgressBar } from 'react-bootstrap'
import { Link } from 'react-router'
import { fileHandler } from '../FileHandler.js'
import { generateThumbnailsForGraphic } from '../lib/ThumbnailGenerator.js'
import { graphicResourcePath } from '../lib/lib.js'

// ─── Persisted settings ───────────────────────────────────────────────────────

const SETTINGS_STORAGE_KEY = 'thumbnailGeneratorSettings'

function getDefaultThumbnailSettings() {
	return {
		resolutions: [{ width: 1280, height: 720, addCropped: true }],
		transparent: true,
		forceRegenerate: false,
		captureDelay: 1000,
		skipAnimation: true,
	}
}

function loadPersistedSettings() {
	try {
		const s = localStorage.getItem(SETTINGS_STORAGE_KEY)
		if (s) return { ...getDefaultThumbnailSettings(), ...JSON.parse(s) }
	} catch (_) {}
	return getDefaultThumbnailSettings()
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ThumbnailGeneratorView({ graphicsList, onRefresh, onCloseFolder, graphicsFolderName }) {
	const [settings, setSettings] = React.useState(loadPersistedSettings)

	const onSettingsChange = React.useCallback((newSettings) => {
		setSettings(newSettings)
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings))
	}, [])

	// Per-graphic status map: path → { status, message }
	const [statuses, setStatuses] = React.useState(() =>
		Object.fromEntries((graphicsList ?? []).map((g) => [g.path, { status: 'idle', message: '' }]))
	)

	// Per-graphic version counter — incremented after successful generation so
	// thumbnail <img> tags re-fetch the newly written files from disk.
	const [previewVersions, setPreviewVersions] = React.useState(() =>
		Object.fromEntries((graphicsList ?? []).map((g) => [g.path, 0]))
	)

	const bumpPreviewVersion = React.useCallback((path) => {
		setPreviewVersions((prev) => ({ ...prev, [path]: (prev[path] ?? 0) + 1 }))
	}, [])

	const setGraphicStatus = React.useCallback((path, update) => {
		setStatuses((prev) => ({ ...prev, [path]: { ...prev[path], ...update } }))
	}, [])

	const [isRunning, setIsRunning] = React.useState(false)
	const [globalLog, setGlobalLog] = React.useState([])
	const logRef = React.useRef(null)

	const appendLog = React.useCallback((msg) => {
		setGlobalLog((prev) => [...prev.slice(-299), msg])
	}, [])

	// Auto-scroll the log to the bottom when new lines arrive
	React.useEffect(() => {
		if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
	}, [globalLog])

	// ── Core: run generation for a list of graphics ───────────────────────────
	const runGeneration = React.useCallback(
		async (graphicsToProcess) => {
			if (isRunning) return
			setIsRunning(true)

			try {
				for (const graphic of graphicsToProcess) {
					if (!graphic.manifest) {
						setGraphicStatus(graphic.path, { status: 'error', message: 'No valid manifest' })
						continue
					}

					// Skip if all resolutions already have thumbnails (and not forcing)
					if (!settings.forceRegenerate && graphic.manifest.thumbnails?.length) {
						const existingFiles = new Set((graphic.manifest.thumbnails ?? []).map((t) => t.file))
						const allExist = settings.resolutions.every((r) =>
							existingFiles.has(`thumbnails/${r.width}x${r.height}.png`)
						)
						if (allExist) {
							setGraphicStatus(graphic.path, {
								status: 'skipped',
								message: 'All thumbnails already exist — enable "Force regenerate" to overwrite',
							})
							appendLog(`Skipped "${graphic.manifest.name}" — all thumbnails already exist`)
							continue
						}
					}

					setGraphicStatus(graphic.path, { status: 'running', message: 'Starting…' })
					appendLog(`Generating thumbnails for "${graphic.manifest.name}"…`)

					try {
						const newThumbnails = await generateThumbnailsForGraphic({
							graphic,
							thumbnailSettings: settings,
							onProgress: (msg) => {
								setGraphicStatus(graphic.path, { status: 'running', message: msg })
								appendLog(`  ${msg}`)
							},
							writeFileFn: async (path, blob) => {
								await fileHandler.writeFile(path, blob)
							},
						})

						// Merge new entries into manifest, replacing any that were just regenerated
						const keptThumbnails = (graphic.manifest.thumbnails ?? []).filter(
							(existing) => !newThumbnails.some((n) => n.file === existing.file)
						)
						const updatedManifest = {
							...graphic.manifest,
							thumbnails: [...keptThumbnails, ...newThumbnails],
						}
						await fileHandler.writeManifest(graphic, updatedManifest)
						// Update local manifest reference so subsequent skip-checks see new state
						graphic.manifest = updatedManifest

						setGraphicStatus(graphic.path, {
							status: 'done',
							message: `Generated ${newThumbnails.length} thumbnail(s)`,
						})
						bumpPreviewVersion(graphic.path)
						appendLog(`✓ "${graphic.manifest.name}" — ${newThumbnails.length} thumbnail(s) written`)
					} catch (err) {
						console.error(err)
						setGraphicStatus(graphic.path, { status: 'error', message: err.message })
						appendLog(`✗ Error for "${graphic.manifest?.name ?? graphic.path}": ${err.message}`)
					}
				}
			} catch (err) {
				console.error(err)
				appendLog(`Session error: ${err.message}`)
			} finally {
				setIsRunning(false)
				appendLog('Done.')
			}
		},
		[isRunning, settings, setGraphicStatus, bumpPreviewVersion, appendLog]
	)

	const handleGenerateAll = React.useCallback(() => {
		runGeneration(graphicsList ?? [])
	}, [runGeneration, graphicsList])

	const handleGenerateOne = React.useCallback((graphic) => runGeneration([graphic]), [runGeneration])

	const doneCount = Object.values(statuses).filter((s) => s.status === 'done' || s.status === 'skipped').length
	const errorCount = Object.values(statuses).filter((s) => s.status === 'error').length
	const total = graphicsList?.length ?? 0

	return (
		<div className="container-fluid">
			<div className="list-graphics card">
				{/* ── Header ── */}
				<div className="card-header d-flex align-items-center gap-2 flex-wrap">
					<h2 className="me-auto mb-0">Generate Thumbnails — "{graphicsFolderName}"</h2>
					<Button variant="secondary" size="sm" onClick={onRefresh} disabled={isRunning}>
						Refresh list
					</Button>
					<Button variant="secondary" size="sm" onClick={onCloseFolder} disabled={isRunning}>
						Pick another folder
					</Button>
					<Link to="/">
						<Button variant="outline-primary" size="sm">
							← List view
						</Button>
					</Link>
					<Link to="/thumbnails">
						<Button variant="outline-primary" size="sm">
							Thumbnail preview
						</Button>
					</Link>
				</div>

				<div className="card-body">
					<div className="row g-3">
						{/* ── Settings ── */}
						<div className="col-12 col-md-4">
							<ThumbnailSettings settings={settings} onChange={onSettingsChange} disabled={isRunning} />
						</div>

						{/* ── Actions + log ── */}
						<div className="col-12 col-md-8">
							<div className="d-flex gap-2 flex-wrap mb-3 align-items-center">
								<Button variant="success" onClick={handleGenerateAll} disabled={isRunning || !graphicsList?.length}>
									{isRunning ? '⏳ Running…' : `🖼️ Generate All (${total})`}
								</Button>
								{total > 0 && (
									<small className="text-muted">
										{doneCount}/{total} done{errorCount > 0 && `, ${errorCount} error(s)`}
									</small>
								)}
							</div>

							{isRunning && (
								<ProgressBar
									animated
									now={total > 0 ? ((doneCount + errorCount) / total) * 100 : 0}
									label={`${doneCount + errorCount}/${total}`}
									className="mb-3"
								/>
							)}

							{globalLog.length > 0 && (
								<div
									ref={logRef}
									style={{
										fontFamily: 'monospace',
										fontSize: '0.75rem',
										maxHeight: '12rem',
										overflowY: 'auto',
										background: '#111',
										color: '#bfb',
										padding: '0.5rem 0.75rem',
										borderRadius: '4px',
									}}
								>
									{globalLog.map((line, i) => (
										<div key={i}>{line}</div>
									))}
								</div>
							)}
						</div>
					</div>

					{/* ── Graphics table ── */}
					{graphicsList?.length > 0 ? (
						<Table striped bordered size="sm" className="mt-3">
							<thead>
								<tr>
									<th>Graphic</th>
									<th>Existing thumbnails in manifest</th>
									<th>Status</th>
									<th></th>
								</tr>
							</thead>
							<tbody>
								{graphicsList.map((graphic) => (
									<GraphicRow
										key={graphic.path}
										graphic={graphic}
										status={statuses[graphic.path] ?? { status: 'idle', message: '' }}
										previewVersion={previewVersions[graphic.path] ?? 0}
										onGenerate={() => handleGenerateOne(graphic)}
										isRunning={isRunning}
									/>
								))}
							</tbody>
						</Table>
					) : (
						<p className="mt-3 text-muted">No graphics found in the selected folder.</p>
					)}
				</div>
			</div>
		</div>
	)
}

// ─── Per-graphic table row ────────────────────────────────────────────────────

function GraphicRow({ graphic, status, previewVersion, onGenerate, isRunning }) {
	const existingThumbnails = graphic.manifest?.thumbnails ?? []

	return (
		<tr>
			<td style={{ whiteSpace: 'nowrap' }}>
				<div>
					<strong>{graphic.manifest?.name ?? graphic.path}</strong>
				</div>
				<small className="text-muted">{graphic.path}</small>
			</td>
			<td>
				{existingThumbnails.length > 0 ? (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
						{existingThumbnails.map((t, i) => {
							const filePath = graphic.folderPath + t.file
							// Serve via the service-worker LOCAL prefix; ?v= busts browser cache
							const src = graphicResourcePath(filePath) + `?v=${previewVersion}`
							const label = t.resolution ? `${t.resolution.width}×${t.resolution.height}` : t.file
							return (
								<div key={i} style={{ textAlign: 'center' }}>
									<a href={src} target="_blank" rel="noreferrer" title={`Open ${t.file} in new tab`}>
										<img
											src={src}
											alt={label}
											style={{
												height: '72px',
												width: 'auto',
												maxWidth: '180px',
												objectFit: 'contain',
												border: '1px solid #444',
												borderRadius: '3px',
												background: 'repeating-conic-gradient(#888 0% 25%, #555 0% 50%) 0 0 / 12px 12px',
												display: 'block',
											}}
										/>
									</a>
									<small className="text-muted" style={{ fontSize: '0.7rem' }}>
										{label}
									</small>
								</div>
							)
						})}
					</div>
				) : (
					<span className="text-muted">—</span>
				)}
			</td>
			<td>
				<StatusBadge status={status} />
			</td>
			<td style={{ whiteSpace: 'nowrap' }}>
				<Button
					size="sm"
					variant="outline-success"
					onClick={onGenerate}
					disabled={isRunning || !graphic.manifest}
					title={!graphic.manifest ? 'Cannot generate: manifest has errors' : undefined}
				>
					Generate
				</Button>
			</td>
		</tr>
	)
}

function StatusBadge({ status }) {
	switch (status.status) {
		case 'idle':
			return <Badge bg="secondary">Idle</Badge>
		case 'pending':
			return <Badge bg="info">Pending…</Badge>
		case 'skipped':
			return (
				<>
					<Badge bg="secondary">Skipped</Badge> <small>{status.message}</small>
				</>
			)
		case 'running':
			return (
				<>
					<Badge bg="primary">Running</Badge> <small>{status.message}</small>
				</>
			)
		case 'done':
			return (
				<>
					<Badge bg="success">Done</Badge> <small>{status.message}</small>
				</>
			)
		case 'error':
			return (
				<>
					<Badge bg="danger">Error</Badge> <small className="text-danger">{status.message}</small>
				</>
			)
		default:
			return null
	}
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function ThumbnailSettings({ settings, onChange, disabled }) {
	const { resolutions, transparent, forceRegenerate, captureDelay, skipAnimation } = settings

	const update = (field, value) => onChange({ ...settings, [field]: value })

	const addResolution = () =>
		onChange({ ...settings, resolutions: [...resolutions, { width: 1920, height: 1080, addCropped: false }] })

	const removeResolution = (i) => {
		if (resolutions.length <= 1) return
		onChange({ ...settings, resolutions: resolutions.filter((_, idx) => idx !== i) })
	}

	const updateResolution = (i, field, raw) => {
		const v = parseInt(raw, 10)
		if (!isNaN(v) && v > 0)
			onChange({ ...settings, resolutions: resolutions.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)) })
	}

	const toggleAddCropped = (i) =>
		onChange({
			...settings,
			resolutions: resolutions.map((r, idx) => (idx === i ? { ...r, addCropped: !r.addCropped } : r)),
		})

	return (
		<div className="card h-100">
			<div className="card-header">
				<strong>Settings</strong>
			</div>
			<div className="card-body">
				{/* Resolutions */}
				<Form.Label>
					<strong>Output resolutions</strong>
				</Form.Label>
				{resolutions.map((res, i) => (
					<div key={i} className="mb-2">
						<div className="d-flex align-items-center gap-1 mb-1">
							<Form.Control
								type="number"
								size="sm"
								min={1}
								value={res.width}
								onChange={(e) => updateResolution(i, 'width', e.target.value)}
								disabled={disabled}
								style={{ width: '5.5rem' }}
							/>
							<span>×</span>
							<Form.Control
								type="number"
								size="sm"
								min={1}
								value={res.height}
								onChange={(e) => updateResolution(i, 'height', e.target.value)}
								disabled={disabled}
								style={{ width: '5.5rem' }}
							/>
							<Button
								variant="outline-danger"
								size="sm"
								onClick={() => removeResolution(i)}
								disabled={disabled || resolutions.length <= 1}
								title="Remove"
							>
								✕
							</Button>
						</div>
						<Form.Check
							type="checkbox"
							id={`chk-cropped-${i}`}
							label={
								<span style={{ fontSize: '0.8rem' }}>
									Also save cropped variant <span className="text-muted">(trims transparent border pixels)</span>
								</span>
							}
							checked={!!res.addCropped}
							onChange={() => toggleAddCropped(i)}
							disabled={disabled}
							className="ms-1"
						/>
					</div>
				))}
				<Button variant="outline-secondary" size="sm" onClick={addResolution} disabled={disabled} className="mb-3">
					+ Add resolution
				</Button>

				{/* Transparent background */}
				<Form.Check
					type="switch"
					id="chk-transparent"
					label="Transparent background (PNG alpha)"
					checked={transparent}
					onChange={(e) => update('transparent', e.target.checked)}
					disabled={disabled}
					className="mb-2"
				/>

				{/* Force regenerate */}
				<Form.Check
					type="switch"
					id="chk-force"
					label="Force regenerate existing thumbnails"
					checked={forceRegenerate}
					onChange={(e) => update('forceRegenerate', e.target.checked)}
					disabled={disabled}
					className="mb-2"
				/>

				{/* Skip animation */}
				<Form.Check
					type="switch"
					id="chk-skip-animation"
					label={<>Use skipAnimation</>}
					checked={skipAnimation}
					onChange={(e) => update('skipAnimation', e.target.checked)}
					disabled={disabled}
					className="mb-2"
				/>

				{/* Settle delay */}
				<Form.Group className="mb-2">
					<Form.Label className="small mb-1">
						<strong>Settle delay after play (ms)</strong>
					</Form.Label>
					<Form.Control
						type="number"
						size="sm"
						min={0}
						max={30000}
						step={100}
						value={captureDelay}
						onChange={(e) => {
							const v = parseInt(e.target.value, 10)
							if (!isNaN(v) && v >= 0) update('captureDelay', v)
						}}
						disabled={disabled}
						style={{ width: '8rem' }}
					/>
					<Form.Text className="text-muted">
						Wait this long after playAction() before capturing — lets animations reach their first frame.
					</Form.Text>
				</Form.Group>

				<hr />
				<div className="alert alert-warning p-2 small mb-2">
					⚠️ Thumbnails are rendered using{' '}
					<a href="https://github.com/1904labs/dom-to-image-more" target="_blank" rel="noreferrer">
						dom-to-image-more
					</a>
					, which serialises the DOM to SVG/canvas. Complex CSS effects, WebGL content, video elements, and certain
					Shadow DOM structures may not render with full fidelity.
				</div>
				<div className="alert alert-info p-2 small mb-0">
					Thumbnails are written to a <code>thumbnails/</code> sub-folder inside each graphic's folder and the manifest
					is updated automatically.
				</div>
			</div>
		</div>
	)
}
