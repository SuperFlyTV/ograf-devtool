import * as React from 'react'
import { Modal, Button, Form, ProgressBar, Alert } from 'react-bootstrap'
import domtoimage from 'dom-to-image-more'
import { SettingsContext } from '../contexts/SettingsContext.js'

export function VideoExportModal({ show, onHide, rendererRef, previewContainerRef, graphic }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext?.settings || {}

	const duration = settings.duration || 5000
	const defaultFps = settings.quantizeFps > 0 ? settings.quantizeFps : 30

	const [fps, setFps] = React.useState(defaultFps)
	const [includeBackground, setIncludeBackground] = React.useState(true)
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

	const handleExport = async () => {
		if (!rendererRef.current) return

		setIsExporting(true)
		setErrorText('')
		setStatusText('Initializing recorder...')
		setProgress(0)

		try {
			const width = settings.width || 1920
			const height = settings.height || 1080
			const frameDurationMs = 1000 / fps
			const totalFrames = Math.ceil(duration / frameDurationMs) + 1

			// Target element for frame capture
			const captureElement = previewContainerRef.current || rendererRef.current.layer?.element

			if (!captureElement) {
				throw new Error('Render container element not found.')
			}

			// Offscreen recording canvas
			const recordCanvas = document.createElement('canvas')
			recordCanvas.width = width
			recordCanvas.height = height
			const ctx = recordCanvas.getContext('2d')

			// Stream & MediaRecorder setup
			let stream
			if (recordCanvas.captureStream) {
				stream = recordCanvas.captureStream(0) // manual frame capture
			} else {
				throw new Error('Canvas captureStream is not supported by your browser.')
			}

			const videoTrack = stream.getVideoTracks()[0]

			let mimeType = 'video/webm;codecs=vp9'
			if (!MediaRecorder.isTypeSupported(mimeType)) {
				mimeType = 'video/webm;codecs=vp8'
				if (!MediaRecorder.isTypeSupported(mimeType)) {
					mimeType = 'video/webm'
				}
			}

			const recorder = new MediaRecorder(stream, { mimeType })
			const recordedChunks = []

			recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) {
					recordedChunks.push(e.data)
				}
			}

			const recordingFinished = new Promise((resolve) => {
				recorder.onstop = () => resolve()
			})

			recorder.start()

			// Loop through frames
			for (let i = 0; i < totalFrames; i++) {
				const currentTime = Math.min(i * frameDurationMs, duration)
				setStatusText(`Rendering frame ${i + 1} of ${totalFrames} (${Math.round((currentTime / 1000) * 10) / 10}s)...`)
				setProgress(Math.round(((i + 1) / totalFrames) * 100))

				// Move renderer playhead to timestamp
				await rendererRef.current.gotoTime(currentTime)

				// Capture frame
				const frameCanvas = await domtoimage.toCanvas(captureElement, {
					width,
					height,
					bgcolor: includeBackground ? null : '#00000000',
				})

				// Draw to offscreen canvas
				ctx.clearRect(0, 0, width, height)
				ctx.drawImage(frameCanvas, 0, 0, width, height)

				if (videoTrack && videoTrack.requestFrame) {
					videoTrack.requestFrame()
				}

				// Allow UI paint & recorder frame processing
				await new Promise((resolve) => setTimeout(resolve, 30))
			}

			setStatusText('Finalizing video file...')
			recorder.stop()
			await recordingFinished

			const blob = new Blob(recordedChunks, { type: mimeType })
			const url = URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.style.display = 'none'
			a.href = url
			const graphicName = graphic?.name || graphic?.manifest?.name || 'timeline'
			a.download = `${graphicName}-timeline-export.webm`
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

	return (
		<Modal show={show} onHide={isExporting ? null : onHide} backdrop={isExporting ? 'static' : true} centered>
			<Modal.Header closeButton={!isExporting}>
				<Modal.Title>🎥 Export Timeline as Video</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{errorText && <Alert variant="danger">{errorText}</Alert>}

				{!isExporting && statusText.includes('complete') && <Alert variant="success">{statusText}</Alert>}

				<Form>
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

					<Form.Group className="mb-3">
						<Form.Check
							type="checkbox"
							label="Include Background Layer in Export"
							checked={includeBackground}
							onChange={(e) => setIncludeBackground(e.target.checked)}
							disabled={isExporting}
						/>
					</Form.Group>

					<Form.Group className="mb-3">
						<Form.Label>Output Resolution & Duration</Form.Label>
						<div>
							<strong>
								{settings.width || 1920} × {settings.height || 1080}
							</strong>{' '}
							— Duration: <strong>{(duration / 1000).toFixed(2)}s</strong> ({Math.ceil(duration / (1000 / fps))} frames at {fps} fps)
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
				<Button variant="primary" onClick={handleExport} disabled={isExporting}>
					{isExporting ? 'Exporting...' : '🎥 Export WebM Video'}
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
