import * as React from 'react'
import { Modal, Button, Form, ProgressBar, Alert } from 'react-bootstrap'
import { resolveBgcolor } from '../lib/frameCapture.js'
import { renderVideoFrames } from '../lib/VideoRenderer.js'
import { SettingsContext } from '../contexts/SettingsContext.js'

// ─── Supported export formats ────────────────────────────────────────────────
//
// MediaRecorder MIME types are tested at runtime; only types the browser
// actually supports will be offered.  We define the full candidate list here
// in priority order.

const FORMAT_CANDIDATES = [
	{ label: 'WebM – VP9 (best quality, transparent alpha)', mime: 'video/webm;codecs=vp9', ext: 'webm' },
	{ label: 'WebM – VP8', mime: 'video/webm;codecs=vp8', ext: 'webm' },
	{ label: 'WebM – AV1', mime: 'video/webm;codecs=av1', ext: 'webm' },
	{ label: 'WebM (browser default codec)', mime: 'video/webm', ext: 'webm' },
	{ label: 'MP4 – H.264 (AVC)', mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
	{ label: 'MP4 (browser default codec)', mime: 'video/mp4', ext: 'mp4' },
	{ label: 'Ogg – Theora', mime: 'video/ogg;codecs=theora', ext: 'ogv' },
]

function getSupportedFormats() {
	if (typeof MediaRecorder === 'undefined') return FORMAT_CANDIDATES
	return FORMAT_CANDIDATES.filter((f) => MediaRecorder.isTypeSupported(f.mime))
}

// ─── Background setting helpers ───────────────────────────────────────────────

const DEFAULT_BG = { type: 'transparent' }

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * @param {object}  props
 * @param {boolean} props.show
 * @param {Function} props.onHide
 * @param {object}  props.graphic       Graphic entry (folderPath, manifest, …)
 * @param {Array}   props.schedule      Actions schedule from the timeline editor.
 *                                      Passed as-is to setActionsSchedule on the
 *                                      off-screen renderer so the exported video
 *                                      reflects the same action timing as the preview.
 * @param {object}  [props.data]        Current graphic data (form values). Defaults to {}.
 */
export function VideoExportModal({ show, onHide, graphic, schedule = [], data = {} }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext?.settings || {}

	const duration = settings.duration || 5000
	const defaultFps = settings.quantizeFps > 0 ? settings.quantizeFps : 30

	// Supported formats are computed once (stable across renders)
	const supportedFormats = React.useMemo(() => getSupportedFormats(), [])

	const [fps, setFps] = React.useState(defaultFps)
	const [selectedMime, setSelectedMime] = React.useState(() => supportedFormats[0]?.mime ?? 'video/webm')
	const [background, setBackground] = React.useState(DEFAULT_BG) // { type: 'transparent' } | { type: 'color', value: '#hex' }
	const [isExporting, setIsExporting] = React.useState(false)
	const [progress, setProgress] = React.useState(0)
	const [statusText, setStatusText] = React.useState('')
	const [errorText, setErrorText] = React.useState('')

	React.useEffect(() => {
		if (show) {
			setFps(settings.quantizeFps > 0 ? settings.quantizeFps : 30)
			setIsExporting(false)
			setProgress(0)
			setStatusText('')
			setErrorText('')
		}
	}, [show, settings])

	// Keep selectedMime valid if supportedFormats ever changes
	React.useEffect(() => {
		if (supportedFormats.length && !supportedFormats.find((f) => f.mime === selectedMime)) {
			setSelectedMime(supportedFormats[0].mime)
		}
	}, [supportedFormats, selectedMime])

	const selectedFormat = supportedFormats.find((f) => f.mime === selectedMime) ?? supportedFormats[0]

	const handleExport = async () => {
		if (!graphic?.manifest) return

		setIsExporting(true)
		setErrorText('')
		setStatusText('Initializing renderer...')
		setProgress(0)

		try {
			const width = settings.width || 1920
			const height = settings.height || 1080
			const frameDurationMs = 1000 / fps
			const totalFrames = Math.ceil(duration / frameDurationMs) + 1
			const bgcolor = resolveBgcolor(background)

			// ── Offscreen recording canvas ────────────────────────────────────
			const recordCanvas = document.createElement('canvas')
			recordCanvas.width = width
			recordCanvas.height = height
			const ctx = recordCanvas.getContext('2d')

			// ── MediaRecorder setup ───────────────────────────────────────────
			if (!recordCanvas.captureStream) {
				throw new Error('Canvas captureStream is not supported by your browser.')
			}
			const stream = recordCanvas.captureStream(0) // manual frame stepping
			const videoTrack = stream.getVideoTracks()[0]

			const mimeType = selectedFormat?.mime ?? 'video/webm'
			const recorder = new MediaRecorder(stream, { mimeType })
			const recordedChunks = []

			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) recordedChunks.push(e.data)
			}
			const recordingFinished = new Promise((resolve) => {
				recorder.onstop = () => resolve()
			})
			recorder.start()

			// ── Render frames via off-screen Renderer ─────────────────────────
			await renderVideoFrames({
				graphic,
				settings,
				schedule,
				data,
				fps,
				bgcolor,
				onProgress: (frameIndex, _total, timestampMs) => {
					setStatusText(
						`Rendering frame ${frameIndex + 1} of ${totalFrames} (${Math.round((timestampMs / 1000) * 10) / 10}s)…`
					)
					setProgress(Math.round(((frameIndex + 1) / totalFrames) * 100))
				},
				onFrame: async (frameCanvas) => {
					// Composite onto the recording canvas
					ctx.clearRect(0, 0, width, height)
					ctx.drawImage(frameCanvas, 0, 0, width, height)

					// Commit frame to the MediaRecorder stream
					if (videoTrack?.requestFrame) videoTrack.requestFrame()

					// Yield to the browser so the recorder can process the frame
					await new Promise((resolve) => setTimeout(resolve, 30))
				},
			})

			// ── Finalize ─────────────────────────────────────────────────────
			setStatusText('Finalizing video file...')
			recorder.stop()
			await recordingFinished

			const ext = selectedFormat?.ext ?? 'webm'
			const blob = new Blob(recordedChunks, { type: mimeType })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.style.display = 'none'
			a.href = url
			const graphicName = graphic?.manifest?.name || graphic?.name || 'timeline'
			a.download = `${graphicName}-timeline-export.${ext}`
			document.body.appendChild(a)
			a.click()
			setTimeout(() => {
				document.body.removeChild(a)
				URL.revokeObjectURL(url)
			}, 100)

			setStatusText('Export complete! Video downloaded.')
			setIsExporting(false)
		} catch (err) {
			console.error('Video Export Error:', err)
			setErrorText(err.message || 'Failed to export video.')
			setIsExporting(false)
		}
	}

	const bgColor = background.type === 'color' ? background.value || '#000000' : '#000000'

	return (
		<Modal show={show} onHide={isExporting ? null : onHide} backdrop={isExporting ? 'static' : true} centered>
			<Modal.Header closeButton={!isExporting}>
				<Modal.Title>🎥 Export Timeline as Video</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{errorText && <Alert variant="danger">{errorText}</Alert>}

				{!isExporting && statusText.includes('complete') && <Alert variant="success">{statusText}</Alert>}

				<Form>
					{/* ── Frame rate ── */}
					<Form.Group className="mb-3">
						<Form.Label>Frame Rate (FPS)</Form.Label>
						<Form.Select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={isExporting}>
							<option value={24}>24 FPS (Film)</option>
							<option value={25}>25 FPS (PAL Broadcast)</option>
							<option value={30}>30 FPS (NTSC Broadcast)</option>
							<option value={50}>50 FPS (High Motion PAL)</option>
							<option value={60}>60 FPS (High Motion)</option>
						</Form.Select>
					</Form.Group>

					{/* ── Export format ── */}
					<Form.Group className="mb-3">
						<Form.Label>Export Format</Form.Label>
						{supportedFormats.length > 0 ? (
							<Form.Select
								value={selectedMime}
								onChange={(e) => setSelectedMime(e.target.value)}
								disabled={isExporting}
							>
								{supportedFormats.map((f) => (
									<option key={f.mime} value={f.mime}>
										{f.label}
									</option>
								))}
							</Form.Select>
						) : (
							<Form.Control plaintext readOnly defaultValue="No supported formats detected" className="text-danger" />
						)}
						<Form.Text className="text-muted">Only formats supported by your browser are listed.</Form.Text>
					</Form.Group>

					{/* ── Background ── */}
					<Form.Group className="mb-3">
						<Form.Label>Background</Form.Label>
						<div className="d-flex align-items-center gap-3 flex-wrap">
							<Form.Check
								type="radio"
								id="bg-transparent"
								name="background"
								label="Transparent"
								checked={background.type === 'transparent'}
								onChange={() => setBackground({ type: 'transparent' })}
								disabled={isExporting}
							/>
							<Form.Check
								type="radio"
								id="bg-color"
								name="background"
								label="Color"
								checked={background.type === 'color'}
								onChange={() => setBackground({ type: 'color', value: bgColor })}
								disabled={isExporting}
							/>
							{background.type === 'color' && (
								<input
									type="color"
									value={bgColor}
									onChange={(e) => setBackground({ type: 'color', value: e.target.value })}
									disabled={isExporting}
									style={{
										width: '2.5rem',
										height: '2rem',
										padding: '0.1rem',
										border: '1px solid #ccc',
										borderRadius: '4px',
										cursor: 'pointer',
									}}
									title="Pick background colour"
								/>
							)}
						</div>
						{background.type === 'transparent' && (
							<Form.Text className="text-muted">
								Transparent output is only preserved by formats that support an alpha channel (e.g. VP9 WebM).
							</Form.Text>
						)}
					</Form.Group>

					{/* ── Resolution & duration info ── */}
					<Form.Group className="mb-3">
						<Form.Label>Output Resolution &amp; Duration</Form.Label>
						<div>
							<strong>
								{settings.width || 1920} × {settings.height || 1080}
							</strong>{' '}
							— Duration: <strong>{(duration / 1000).toFixed(2)}s</strong> ({Math.ceil(duration / (1000 / fps))}{' '}
							frames at {fps} fps)
						</div>
					</Form.Group>
				</Form>

				{isExporting && (
					<div className="mt-3">
						<div className="mb-1 text-muted">{statusText}</div>
						<ProgressBar animated now={progress} label={`${progress}%`} />
					</div>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button variant="secondary" onClick={onHide} disabled={isExporting}>
					{statusText.includes('complete') ? 'Close' : 'Cancel'}
				</Button>
				<Button variant="primary" onClick={handleExport} disabled={isExporting || supportedFormats.length === 0}>
					{isExporting ? 'Exporting...' : `🎥 Export ${selectedFormat?.ext?.toUpperCase() ?? 'Video'}`}
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
