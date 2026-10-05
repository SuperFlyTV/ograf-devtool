import * as React from 'react'
import { Modal, Button, Form, ProgressBar, Alert, Row, Col, InputGroup } from 'react-bootstrap'
import {
	Output,
	BufferTarget,
	CanvasSource,
	WebMOutputFormat,
	Mp4OutputFormat,
	MovOutputFormat,
	MkvOutputFormat,
	canEncodeVideo,
} from 'mediabunny'
import { registerProresDecoder } from '@mediabunny/prores'
import JSZip from 'jszip'
import { isHtmlInCanvasSupported } from '../lib/frameCapture.js'
import { renderVideoFrames } from '../lib/VideoRenderer.js'
import { SettingsContext } from '../contexts/SettingsContext.js'
import { createGifWriter } from '../lib/encoders/gifEncoder.js'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faVideo,
	faBox,
	faImage,
	faFilm,
	faCopy,
	faCheck,
	faTriangleExclamation,
	faCircleInfo,
	faStop,
} from '@fortawesome/free-solid-svg-icons'

// Register ProRes decoder extension for Mediabunny
try {
	registerProresDecoder()
	console.log('ProRes decoder registered successfully.')
} catch (e) {
	console.warn('Failed to register ProRes decoder:', e)
}

// ─── Supported Container Formats ──────────────────────────────────────────────
const CONTAINER_DEFINITIONS = [
	{
		key: 'webm',
		label: 'WebM (.webm)',
		createFormat: (opts) => new WebMOutputFormat(opts),
	},
	{
		key: 'mp4',
		label: 'MP4 (.mp4)',
		createFormat: (opts) => new Mp4OutputFormat({ fastStart: 'in-memory', ...opts }),
	},
	{
		key: 'mov',
		label: 'QuickTime MOV (.mov)',
		createFormat: (opts) => new MovOutputFormat({ fastStart: 'in-memory', ...opts }),
	},
	{
		key: 'mkv',
		label: 'Matroska MKV (.mkv)',
		createFormat: (opts) => new MkvOutputFormat(opts),
	},
	{
		key: 'gif',
		label: 'Animated GIF (.gif)',
		ext: 'gif',
		createFormat: () => null,
	},
	{
		key: 'png-sequence',
		label: 'PNG Sequence (.zip)',
		ext: 'zip',
		createFormat: () => null,
	},
]

// ─── Codec Display Metadata ──────────────────────────────────────────────────
const CODEC_METADATA = {
	'prores-server': { label: 'Apple ProRes 4444, conversion via server' },
	'qtrle-server': {
		label: 'QuickTime Animation / QTRLE, conversion via server',
	},
	vp9: { label: 'VP9' },
	vp8: { label: 'VP8' },
	avc: { label: 'H.264 / AVC' },
	hevc: { label: 'H.265 / HEVC' },
	av1: { label: 'AV1' },
	prores: { label: 'Apple ProRes (in browser)' },
	png: { label: 'PNG' },
	gif: { label: 'GIF' },
}

const VIDEO_EXPORT_STORAGE_KEY = 'videoExportSettings'

function loadSavedExportSettings() {
	try {
		const raw = localStorage.getItem(VIDEO_EXPORT_STORAGE_KEY)
		return raw ? JSON.parse(raw) : {}
	} catch (_) {
		return {}
	}
}

function saveExportSettings(newValues) {
	try {
		const current = loadSavedExportSettings()
		localStorage.setItem(VIDEO_EXPORT_STORAGE_KEY, JSON.stringify({ ...current, ...newValues }))
	} catch (_) {}
}

function createAlphaMatteCanvas(sourceCanvas, width, height) {
	const matteCanvas = document.createElement('canvas')
	matteCanvas.width = width
	matteCanvas.height = height
	const ctx = matteCanvas.getContext('2d')
	ctx.drawImage(sourceCanvas, 0, 0, width, height)
	const imgData = ctx.getImageData(0, 0, width, height)
	const d = imgData.data
	for (let i = 0; i < d.length; i += 4) {
		const alpha = d[i + 3]
		// White on black: RGB = alpha, A = 255
		d[i] = alpha
		d[i + 1] = alpha
		d[i + 2] = alpha
		d[i + 3] = 255
	}
	ctx.putImageData(imgData, 0, 0)
	return matteCanvas
}

function triggerDownload(url, filename) {
	const a = document.createElement('a')
	a.style.display = 'none'
	a.href = url
	a.download = filename
	document.body.appendChild(a)
	a.click()
	setTimeout(() => {
		document.body.removeChild(a)
	}, 200)
}

/**
 * Creates a PNG sequence frame writer packaged into a ZIP archive.
 */
async function createPngSequenceWriter({ width, height, baseName = 'frame' }) {
	const encWidth = width - (width % 2)
	const encHeight = height - (height % 2)

	const canvas = document.createElement('canvas')
	canvas.width = encWidth
	canvas.height = encHeight

	const zip = new JSZip()

	return {
		canvas,
		width: encWidth,
		height: encHeight,
		ext: 'zip',
		mime: 'application/zip',
		isZip: true,
		addFrame: async (sourceCanvas, _timestampSec, _durationSec, frameIndex, totalFrames) => {
			const ctx = canvas.getContext('2d')
			ctx.clearRect(0, 0, encWidth, encHeight)
			ctx.drawImage(sourceCanvas, 0, 0, encWidth, encHeight)

			const digits = Math.max(4, String(totalFrames).length)
			const filename = `${baseName}_${String(frameIndex).padStart(digits, '0')}.png`

			const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
			zip.file(filename, blob)
		},
		finalize: async (onProgress) => {
			return zip.generateAsync(
				{
					type: 'blob',
					compression: 'STORE', // PNGs are already compressed; STORE is instant and uses less memory
				},
				onProgress
			)
		},
		cancel: async () => {},
	}
}

/**
 * Creates a non-realtime frame-accurate video writer using Mediabunny.
 */
async function createVideoWriter({ containerKey, codec, width, height, fps, hasAlpha, bitrate }) {
	// Ensure dimensions are even (required by video codecs like H.264 / VP9)
	const encWidth = width - (width % 2)
	const encHeight = height - (height % 2)

	const canvas = document.createElement('canvas')
	canvas.width = encWidth
	canvas.height = encHeight

	const target = new BufferTarget()
	const containerDef = CONTAINER_DEFINITIONS.find((c) => c.key === containerKey) || CONTAINER_DEFINITIONS[0]
	const format = containerDef.createFormat()

	const output = new Output({
		format,
		target,
	})

	const source = new CanvasSource(canvas, {
		codec,
		bitrate: bitrate || 12_000_000,
		alpha: hasAlpha ? 'keep' : 'discard',
	})

	output.addVideoTrack(source, {
		frameRate: fps,
		canBeTransparent: Boolean(hasAlpha),
	})

	await output.start()

	const ext = format.fileExtension.replace(/^\./, '')
	const mime = format.mimeType || 'video/webm'

	return {
		canvas,
		width: encWidth,
		height: encHeight,
		ext,
		mime,
		addFrame: async (sourceCanvas, timestampSec, durationSec) => {
			const ctx = canvas.getContext('2d')
			ctx.clearRect(0, 0, encWidth, encHeight)
			ctx.drawImage(sourceCanvas, 0, 0, encWidth, encHeight)
			await source.add(timestampSec, durationSec)
		},
		finalize: async () => {
			await output.finalize()
			if (!target.buffer || target.buffer.byteLength === 0) {
				throw new Error('Video encoder finalized without producing data.')
			}
			return new Blob([target.buffer], { type: mime })
		},
		cancel: async () => {
			try {
				await output.cancel()
			} catch (_) {}
		},
	}
}

/**
 * @param {object}  props
 * @param {boolean} props.show
 * @param {Function} props.onHide
 * @param {object}  props.graphic       Graphic entry (folderPath, manifest, …)
 * @param {Array}   [props.schedule]    Actions schedule from the timeline editor.
 * @param {object}  [props.data]        Current graphic data (form values). Defaults to {}.
 */
export function VideoExportModal({ show, onHide, graphic, schedule = [] }) {
	const settingsContext = React.useContext(SettingsContext)
	const settings = settingsContext?.settings || {}

	const duration = settings.duration || 5000
	const defaultFps = settings.quantizeFps > 0 ? settings.quantizeFps : 30
	const defaultBaseName = graphic?.manifest?.name || graphic?.name || 'graphic'

	const htmlInCanvasAvailable = React.useMemo(() => isHtmlInCanvasSupported(), [])
	const savedSettings = React.useMemo(() => loadSavedExportSettings(), [])

	// Configuration state
	const [fileName, setFileName] = React.useState(defaultBaseName)
	const fileNameRef = React.useRef(fileName)
	fileNameRef.current = fileName

	const [fps, setFps] = React.useState(defaultFps)
	const [renderWidth, setRenderWidth] = React.useState(settings.width || 1920)
	const [renderHeight, setRenderHeight] = React.useState(settings.height || 1080)
	const [selectedContainerKey, setSelectedContainerKey] = React.useState(
		() => savedSettings.selectedContainerKey || 'webm'
	)
	const [selectedCodec, setSelectedCodec] = React.useState(() => savedSettings.selectedCodec || 'vp9')
	const [codecSupport, setCodecSupport] = React.useState({})
	const [renderMethod, setRenderMethod] = React.useState(
		() => savedSettings.renderMethod || (htmlInCanvasAvailable ? 'html-in-canvas' : 'dom-to-image')
	)

	// Background & Alpha modes:
	// If format has alpha: 'transparent' | 'color'
	// If format has no alpha: 'color' | 'color-and-alpha-matte'
	const [bgMode, setBgMode] = React.useState(() => savedSettings.bgMode || 'transparent')
	const [bgColor, setBgColor] = React.useState(() => savedSettings.bgColor || '#000000')

	const isPngSequence = selectedContainerKey === 'png-sequence'
	const isGif = selectedContainerKey === 'gif'
	const isServerProres = selectedContainerKey === 'mov' && selectedCodec === 'prores-server'
	const isServerQtrle = selectedContainerKey === 'mov' && selectedCodec === 'qtrle-server'
	const isServerConvert = isServerProres || isServerQtrle

	// Query supported codecs from the currently selected container format:
	const currentContainerDef = React.useMemo(
		() => CONTAINER_DEFINITIONS.find((c) => c.key === selectedContainerKey) || CONTAINER_DEFINITIONS[0],
		[selectedContainerKey]
	)

	const currentFormat = React.useMemo(
		() => (currentContainerDef.createFormat ? currentContainerDef.createFormat() : null),
		[currentContainerDef]
	)

	const supportedCodecsForContainer = React.useMemo(() => {
		if (isPngSequence) return ['png']
		if (isGif) return ['gif']
		if (!currentFormat) return []
		const codecs = currentFormat.getSupportedVideoCodecs()
		if (selectedContainerKey === 'mov') {
			return ['prores-server', 'qtrle-server', ...codecs]
		}
		return codecs
	}, [isPngSequence, isGif, currentFormat, selectedContainerKey])

	const currentExt = currentContainerDef.ext || (currentFormat ? currentFormat.fileExtension.replace(/^\./, '') : 'webm')

	// Check which codecs are supported by the browser's WebCodecs encoder
	React.useEffect(() => {
		let isMounted = true
		const checkCodecs = async () => {
			const results = { png: true, gif: true, 'prores-server': true, 'qtrle-server': true }
			const allCodecs = ['vp9', 'vp8', 'avc', 'hevc', 'av1', 'prores']
			for (const codec of allCodecs) {
				try {
					results[codec] = await canEncodeVideo(codec, {
						width: renderWidth || 1920,
						height: renderHeight || 1080,
						frameRate: fps || 30,
					})
				} catch (_) {
					results[codec] = false
				}
			}
			if (isMounted) {
				setCodecSupport(results)
			}
		}
		checkCodecs()
		return () => {
			isMounted = false
		}
	}, [renderWidth, renderHeight, fps])

	// Auto-select valid codec when container changes
	React.useEffect(() => {
		if (isPngSequence) {
			setSelectedCodec('png')
		} else if (isGif) {
			setSelectedCodec('gif')
		} else if (!supportedCodecsForContainer.includes(selectedCodec)) {
			const preferred =
				supportedCodecsForContainer.find((c) => codecSupport[c] !== false) || supportedCodecsForContainer[0]
			if (preferred) {
				setSelectedCodec(preferred)
				saveExportSettings({ selectedCodec: preferred })
			}
		}
	}, [isPngSequence, isGif, supportedCodecsForContainer, selectedCodec, codecSupport])

	// Alpha transparency is supported for PNG sequence, Animated GIF, server ProRes/QTRLE, and VP9 in WebM / Matroska
	const formatHasAlpha =
		isPngSequence ||
		isGif ||
		isServerConvert ||
		Boolean((selectedContainerKey === 'webm' || selectedContainerKey === 'mkv') && selectedCodec === 'vp9')

	// Ensure bgMode is valid whenever format selection changes, and auto-select transparent when switching to format with alpha
	const prevFormatRef = React.useRef({ container: selectedContainerKey, codec: selectedCodec })

	// Export progress and player state
	const [isExporting, setIsExporting] = React.useState(false)
	const [progress, setProgress] = React.useState(0)
	const [statusText, setStatusText] = React.useState('')
	const [errorText, setErrorText] = React.useState('')
	const [copiedFlag, setCopiedFlag] = React.useState(false)
	const [renderedVideos, setRenderedVideos] = React.useState(null) // { mainUrl, mainExt, isZip?, previewUrl?, matteUrl?, matteExt? }

	const abortControllerRef = React.useRef(null)
	const activeWritersRef = React.useRef(null)

	// Synchronize defaults on modal show
	React.useEffect(() => {
		if (show) {
			const initialName = graphic?.manifest?.name || graphic?.name || 'graphic'
			setFileName(initialName)
			setFps(settings.quantizeFps > 0 ? settings.quantizeFps : 30)
			setRenderWidth(settings.width || 1920)
			setRenderHeight(settings.height || 1080)
			setIsExporting(false)
			setProgress(0)
			setStatusText('')
			setErrorText('')
			setRenderedVideos(null)
			const latest = loadSavedExportSettings()
			if (latest.selectedContainerKey) setSelectedContainerKey(latest.selectedContainerKey)
			if (latest.selectedCodec) setSelectedCodec(latest.selectedCodec)
			if (latest.bgMode) setBgMode(latest.bgMode)
			if (latest.bgColor) setBgColor(latest.bgColor)
			if (latest.renderMethod) setRenderMethod(latest.renderMethod)
			prevFormatRef.current = {
				container: latest.selectedContainerKey || 'webm',
				codec: latest.selectedCodec || 'vp9',
			}
		}
	}, [show, settings, graphic, htmlInCanvasAvailable])

	// Ensure bgMode is valid whenever format selection changes
	React.useEffect(() => {
		const prev = prevFormatRef.current
		const formatChanged = prev.container !== selectedContainerKey || prev.codec !== selectedCodec
		prevFormatRef.current = { container: selectedContainerKey, codec: selectedCodec }

		if (formatHasAlpha) {
			if (bgMode === 'color-and-alpha-matte' || (formatChanged && bgMode === 'color')) {
				setBgMode('transparent')
				saveExportSettings({ bgMode: 'transparent' })
			}
		} else {
			if (bgMode === 'transparent') {
				setBgMode('color')
				saveExportSettings({ bgMode: 'color' })
			}
		}
	}, [selectedContainerKey, selectedCodec, formatHasAlpha, bgMode])

	const handleCancel = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort()
		}
		try {
			activeWritersRef.current?.mainWriter?.cancel()
			activeWritersRef.current?.matteWriter?.cancel()
		} catch (_) {}
		setIsExporting(false)
		setStatusText('Export cancelled.')
	}

	const handleExport = async () => {
		if (!graphic?.manifest) return

		const abortController = new AbortController()
		abortControllerRef.current = abortController

		setIsExporting(true)
		setErrorText('')
		setStatusText(
			isPngSequence
				? 'Initializing PNG sequence renderer...'
				: isGif
				? 'Initializing GIF encoder...'
				: isServerProres
				? 'Initializing WebM encoder for server ProRes conversion...'
				: isServerQtrle
				? 'Initializing WebM encoder for server QuickTime Animation (QTRLE) conversion...'
				: 'Initializing Mediabunny encoder...'
		)
		setProgress(0)
		setRenderedVideos(null)

		const activeRenderMethod =
			htmlInCanvasAvailable && renderMethod === 'html-in-canvas' ? 'html-in-canvas' : 'dom-to-image'
		const width = parseInt(renderWidth, 10) || 1920
		const height = parseInt(renderHeight, 10) || 1080
		const validFps = Math.max(1, parseInt(fps, 10) || 30)
		const frameDurationSec = 1 / validFps
		const frameDurationMs = 1000 / validFps
		const totalFrames = Math.ceil(duration / frameDurationMs) + 1

		const ext = currentExt
		const currentBaseName = fileNameRef.current?.trim() || defaultBaseName

		let mainWriter = null
		let matteWriter = null

		try {
			const isDualExport = !isPngSequence && !isGif && !isServerConvert && !formatHasAlpha && bgMode === 'color-and-alpha-matte'
			const isTransparent = formatHasAlpha && bgMode === 'transparent'

			// ── Setup Non-Realtime Video / Frame Writers ─────────────────────────
			if (isPngSequence) {
				mainWriter = await createPngSequenceWriter({
					width,
					height,
					baseName: currentBaseName,
				})
			} else if (isGif) {
				mainWriter = await createGifWriter({
					width,
					height,
					fps: validFps,
					transparent: isTransparent,
					loopCount: 0,
				})
			} else if (isServerConvert) {
				// Render locally to WebM VP9 (with alpha transparency), then convert to ProRes/QTRLE via server FFmpeg
				mainWriter = await createVideoWriter({
					containerKey: 'webm',
					codec: 'vp9',
					width,
					height,
					fps: validFps,
					hasAlpha: isTransparent,
				})
			} else {
				mainWriter = await createVideoWriter({
					containerKey: selectedContainerKey,
					codec: selectedCodec,
					width,
					height,
					fps: validFps,
					hasAlpha: isTransparent,
				})

				if (isDualExport) {
					matteWriter = await createVideoWriter({
						containerKey: selectedContainerKey,
						codec: selectedCodec,
						width,
						height,
						fps: validFps,
						hasAlpha: false,
					})
				}
			}

			activeWritersRef.current = { mainWriter, matteWriter }

			// ── Determine renderer background color ───────────────────────────────
			const rendererBgColor =
				(formatHasAlpha && bgMode === 'color') || (!formatHasAlpha && bgMode === 'color') ? bgColor : null

			// Scratch canvas for compositing solid background if needed
			const fillCanvas = document.createElement('canvas')
			fillCanvas.width = mainWriter.width
			fillCanvas.height = mainWriter.height
			const fillCtx = fillCanvas.getContext('2d')

			let firstFramePreviewUrl = null

			// ── Render and encode frames non-realtime ─────────────────────────────
			await renderVideoFrames({
				graphic,
				settings,
				schedule,
				fps: validFps,
				width: mainWriter.width,
				height: mainWriter.height,
				bgcolor: rendererBgColor,
				renderMethod: activeRenderMethod,
				signal: abortController.signal,
				onProgress: (frameIndex, _total, timestampMs) => {
					if (abortController.signal.aborted) return
					setStatusText(
						`Capturing frame ${frameIndex + 1} of ${totalFrames} (${Math.round((timestampMs / 1000) * 10) / 10}s / ${(
							duration / 1000
						).toFixed(1)}s)…`
					)
					setProgress(Math.round(((frameIndex + 1) / totalFrames) * 100))
				},
				onFrame: async (frameCanvas, frameIndex) => {
					if (abortController.signal.aborted) return

					const timestampSec = frameIndex * frameDurationSec

					if (frameIndex === 0) {
						try {
							firstFramePreviewUrl = frameCanvas.toDataURL('image/png')
						} catch (_) {}
					}

					if (isDualExport) {
						// 1. Color Fill video
						fillCtx.fillStyle = bgColor
						fillCtx.fillRect(0, 0, mainWriter.width, mainWriter.height)
						fillCtx.drawImage(frameCanvas, 0, 0, mainWriter.width, mainWriter.height)
						await mainWriter.addFrame(fillCanvas, timestampSec, frameDurationSec, frameIndex, totalFrames)

						// 2. Transparency Matte video (white on black)
						const matteCanvas = createAlphaMatteCanvas(frameCanvas, mainWriter.width, mainWriter.height)
						await matteWriter.addFrame(matteCanvas, timestampSec, frameDurationSec, frameIndex, totalFrames)
					} else if (!isTransparent && rendererBgColor === null) {
						fillCtx.fillStyle = bgColor
						fillCtx.fillRect(0, 0, mainWriter.width, mainWriter.height)
						fillCtx.drawImage(frameCanvas, 0, 0, mainWriter.width, mainWriter.height)
						await mainWriter.addFrame(fillCanvas, timestampSec, frameDurationSec, frameIndex, totalFrames)
					} else {
						await mainWriter.addFrame(frameCanvas, timestampSec, frameDurationSec, frameIndex, totalFrames)
					}
				},
			})

			if (abortController.signal.aborted) return

			// ── Finalize video container muxing / ZIP packaging ───────────────────
			setStatusText(
				isPngSequence
					? 'Packaging ZIP archive...'
					: isGif
					? 'Encoding and finalizing GIF...'
					: isServerConvert
					? 'Finalizing WebM render for server conversion...'
					: 'Finalizing video file(s)...'
			)

			const rawMainBlob = await mainWriter.finalize(
				isPngSequence
					? (metadata) => {
							if (abortController.signal.aborted) return
							setStatusText(`Compressing ZIP: ${Math.round(metadata.percent)}%...`)
							setProgress(Math.round(metadata.percent))
					  }
					: undefined
			)

			let mainBlob = rawMainBlob

			// ── If Server conversion was requested (ProRes 4444 or QTRLE), convert WebM to MOV on server ──
			if (isServerConvert) {
				if (abortController.signal.aborted) return
				if (!rawMainBlob || rawMainBlob.size === 0) {
					throw new Error('Rendered WebM file is empty.')
				}
				const targetFormat = isServerProres ? 'prores' : 'qtrle'
				const label = isServerProres ? 'ProRes 4444' : 'QuickTime Animation (QTRLE)'
				setStatusText(`Uploading WebM (${Math.round(rawMainBlob.size / 1024)} KB) to server for ${label} conversion...`)

				const arrayBuffer = await rawMainBlob.arrayBuffer()

				const convertRes = await fetch(`/api/convert/webm-to-mov?format=${targetFormat}`, {
					method: 'POST',
					headers: {
						'Content-Type': 'video/webm',
					},
					body: arrayBuffer,
					signal: abortController.signal,
				})

				if (!convertRes.ok) {
					let errMsg = `${label} conversion failed on server (HTTP ${convertRes.status})`
					try {
						const json = await convertRes.json()
						if (json.error) errMsg = json.error
					} catch (_) {
						errMsg = await convertRes.text()
					}
					throw new Error(errMsg)
				}

				setStatusText(`Receiving converted ${label} MOV from server...`)
				mainBlob = await convertRes.blob()
			}

			let matteBlob = null
			if (isDualExport && matteWriter) {
				matteBlob = await matteWriter.finalize()
			}

			if (abortController.signal.aborted) return

			// ── Build URLs and trigger downloads ──────────────────────────────────
			const mainUrl = URL.createObjectURL(mainBlob)
			const mainDownloadName = `${currentBaseName}.${ext}`

			if (isDualExport && matteBlob) {
				const matteUrl = URL.createObjectURL(matteBlob)
				const matteDownloadName = `${currentBaseName}_a.${ext}`

				triggerDownload(mainUrl, mainDownloadName)
				triggerDownload(matteUrl, matteDownloadName)

				setRenderedVideos({
					mainUrl,
					mainExt: ext,
					matteUrl,
					matteExt: ext,
					isZip: false,
					isGif: false,
				})
			} else {
				triggerDownload(mainUrl, mainDownloadName)
				setRenderedVideos({
					mainUrl,
					mainExt: ext,
					isZip: isPngSequence,
					isGif,
					previewUrl: firstFramePreviewUrl,
				})
			}

			setStatusText(
				isPngSequence
					? 'Export complete! ZIP archive downloaded.'
					: isGif
					? 'Export complete! Animated GIF downloaded.'
					: isServerProres
					? 'Export complete! ProRes MOV downloaded.'
					: 'Export complete! Video downloaded.'
			)
			setIsExporting(false)
		} catch (err) {
			if (err.name === 'AbortError' || abortController.signal.aborted) {
				setStatusText('Export cancelled.')
			} else {
				console.error('Video Export Error:', err)
				setErrorText(err.message || 'Failed to export video.')
			}
			setIsExporting(false)
		} finally {
			activeWritersRef.current = null
		}
	}

	const copyFlagUrl = () => {
		navigator.clipboard?.writeText('chrome://flags/#canvas-draw-element').then(() => {
			setCopiedFlag(true)
			setTimeout(() => setCopiedFlag(false), 3000)
		})
	}

	const effectiveBaseName = fileName.trim() || defaultBaseName

	return (
		<Modal
			show={show}
			onHide={isExporting ? handleCancel : onHide}
			backdrop="static"
			centered
			size="lg"
			dialogClassName="custom-dark-modal video-export-dark-modal"
		>
			<Modal.Header closeButton={!isExporting} className="modal-header-custom">
				<Modal.Title className="modal-title-custom">
					<FontAwesomeIcon icon={faVideo} className="me-2 text-muted" />
					Export Timeline as Video
				</Modal.Title>
			</Modal.Header>
			<Modal.Body className="modal-body-custom">
				{errorText && <Alert variant="danger">{errorText}</Alert>}

				{/* ── Render Method Banner / Notification ── */}
				{!htmlInCanvasAvailable ? (
					<Alert variant="warning" className="d-flex flex-column gap-2">
						<div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
							<div>
								<strong>HTML-in-Canvas is not enabled in this browser.</strong>
								<div className="small text-muted mt-1">
									HTML-in-Canvas provides native frame rendering with accurate CSS and transparency in Google Chrome.
									Falling back to <code>dom-to-image-more</code>, which may not render the video accurately.
								</div>
							</div>
							<Button variant="outline-dark" size="sm" onClick={copyFlagUrl}>
								{copiedFlag ? (
									<>
										<FontAwesomeIcon icon={faCheck} className="me-1 text-success" />
										Copied URL!
									</>
								) : (
									<>
										<FontAwesomeIcon icon={faCopy} className="me-1" />
										Copy chrome://flags URL
									</>
								)}
							</Button>
						</div>
						<div className="small text-muted border-top pt-1">
							To enable: open <code>chrome://flags/#canvas-draw-element</code> in Chrome, enable it, and restart your
							browser.
						</div>
					</Alert>
				) : (
					<Alert variant="success" className="py-2 small d-flex align-items-center justify-content-between">
						<div>
							<strong>HTML-in-Canvas rendering supported!</strong> Chrome native <code>drawElementImage</code> is
							available.
						</div>
					</Alert>
				)}

				{/* ── Video Player / ZIP / GIF Preview after render ── */}
				{renderedVideos && !isExporting && (
					<div className="mb-4 border border-secondary-subtle rounded p-3 bg-body-tertiary">
						<h6 className="fw-bold mb-3 d-flex align-items-center gap-2">
							{renderedVideos.isZip ? (
								<>
									<FontAwesomeIcon icon={faBox} />
									Exported ZIP Preview
								</>
							) : renderedVideos.isGif ? (
								<>
									<FontAwesomeIcon icon={faImage} />
									Exported GIF Preview
								</>
							) : (
								<>
									<FontAwesomeIcon icon={faFilm} />
									Exported Video Preview
								</>
							)}
						</h6>

						{renderedVideos.isZip ? (
							<div>
								<div className="fw-semibold small mb-1">PNG Sequence Preview (Frame 1):</div>
								<div className="d-flex justify-content-center align-items-center p-2 border border-secondary-subtle rounded bg-dark bg-opacity-75">
									<div
										className="checkered-bg border border-secondary-subtle rounded overflow-hidden shadow-sm"
										style={{ display: 'inline-flex', maxWidth: '100%', lineHeight: 0 }}
									>
										{renderedVideos.previewUrl ? (
											<img
												src={renderedVideos.previewUrl}
												alt="First frame preview"
												style={{ maxWidth: '100%', maxHeight: '300px', display: 'block' }}
											/>
										) : (
											<div className="p-4 text-muted">ZIP package ready for download</div>
										)}
									</div>
								</div>
								<div className="small text-muted mt-1 text-center">
									Preview of frame 1 (all {Math.ceil(duration / (1000 / (fps || 30))) + 1} frames packed in ZIP)
								</div>
								<div className="d-flex gap-2 mt-2">
									<Button
										variant="primary"
										size="sm"
										onClick={() => triggerDownload(renderedVideos.mainUrl, `${effectiveBaseName}.zip`)}
									>
										⬇️ Download {effectiveBaseName}.zip
									</Button>
								</div>
							</div>
						) : renderedVideos.isGif ? (
							<div>
								<div className="fw-semibold small mb-1">Animated GIF Preview:</div>
								<div className="d-flex justify-content-center align-items-center p-2 border border-secondary-subtle rounded bg-dark bg-opacity-75">
									<div
										className="checkered-bg border border-secondary-subtle rounded overflow-hidden shadow-sm"
										style={{ display: 'inline-flex', maxWidth: '100%', lineHeight: 0 }}
									>
										<img
											src={renderedVideos.mainUrl}
											alt="Exported GIF preview"
											style={{ maxWidth: '100%', maxHeight: '300px', display: 'block' }}
										/>
									</div>
								</div>
								<div className="d-flex gap-2 mt-2">
									<Button
										variant="primary"
										size="sm"
										onClick={() =>
											triggerDownload(renderedVideos.mainUrl, `${effectiveBaseName}.${renderedVideos.mainExt}`)
										}
									>
										⬇️ Download {effectiveBaseName}.${renderedVideos.mainExt}
									</Button>
								</div>
							</div>
						) : renderedVideos.matteUrl ? (
							<Row>
								<Col md={6} className="mb-3 mb-md-0">
									<div className="fw-semibold small mb-1">Color Fill Video:</div>
									<div className="d-flex justify-content-center align-items-center p-2 border border-secondary-subtle rounded bg-dark bg-opacity-75">
										<div
											className="checkered-bg border border-secondary-subtle rounded overflow-hidden shadow-sm"
											style={{ display: 'inline-flex', maxWidth: '100%', lineHeight: 0 }}
										>
											<video
												src={renderedVideos.mainUrl}
												controls
												autoPlay
												loop
												muted
												playsInline
												style={{ maxWidth: '100%', maxHeight: '240px', display: 'block' }}
											/>
										</div>
									</div>
									<Button
										variant="outline-primary"
										size="sm"
										className="mt-2 w-100"
										onClick={() =>
											triggerDownload(renderedVideos.mainUrl, `${effectiveBaseName}.${renderedVideos.mainExt}`)
										}
									>
										⬇️ Download {effectiveBaseName}.{renderedVideos.mainExt}
									</Button>
								</Col>
								<Col md={6}>
									<div className="fw-semibold small mb-1">Transparency Clip:</div>
									<div className="d-flex justify-content-center align-items-center p-2 border border-secondary-subtle rounded bg-dark bg-opacity-75">
										<div
											className="border border-secondary-subtle rounded overflow-hidden shadow-sm bg-black"
											style={{ display: 'inline-flex', maxWidth: '100%', lineHeight: 0 }}
										>
											<video
												src={renderedVideos.matteUrl}
												controls
												autoPlay
												loop
												muted
												playsInline
												style={{ maxWidth: '100%', maxHeight: '240px', display: 'block' }}
											/>
										</div>
									</div>
									<Button
										variant="outline-primary"
										size="sm"
										className="mt-2 w-100"
										onClick={() =>
											triggerDownload(renderedVideos.matteUrl, `${effectiveBaseName}_a.${renderedVideos.matteExt}`)
										}
									>
										⬇️ Download {effectiveBaseName}_a.{renderedVideos.matteExt}
									</Button>
								</Col>
							</Row>
						) : (
							<div>
								<div className="fw-semibold small mb-1">Rendered Video:</div>
								<div className="d-flex justify-content-center align-items-center p-2 border border-secondary-subtle rounded bg-dark bg-opacity-75">
									<div
										className="checkered-bg border border-secondary-subtle rounded overflow-hidden shadow-sm"
										style={{ display: 'inline-flex', maxWidth: '100%', lineHeight: 0 }}
									>
										<video
											src={renderedVideos.mainUrl}
											controls
											autoPlay
											loop
											muted
											playsInline
											style={{ maxWidth: '100%', maxHeight: '300px', display: 'block' }}
										/>
									</div>
								</div>
								<div className="d-flex gap-2 mt-2">
									<Button
										variant="primary"
										size="sm"
										onClick={() =>
											triggerDownload(renderedVideos.mainUrl, `${effectiveBaseName}.${renderedVideos.mainExt}`)
										}
									>
										⬇️ Download {effectiveBaseName}.${renderedVideos.mainExt}
									</Button>
								</div>
							</div>
						)}
					</div>
				)}

				<Form>
					{/* ── Rendering Flow Selector ── */}
					{htmlInCanvasAvailable && (
						<>
							<Form.Group className="mb-2">
								<Form.Label className="fw-semibold">Rendering Flow</Form.Label>
								<div className="d-flex gap-3">
									<Form.Check
										type="radio"
										id="flow-html-in-canvas"
										name="renderMethod"
										label="HTML-in-Canvas"
										checked={renderMethod === 'html-in-canvas'}
										onChange={() => {
											setRenderMethod('html-in-canvas')
											saveExportSettings({ renderMethod: 'html-in-canvas' })
										}}
										disabled={isExporting}
									/>
									<Form.Check
										type="radio"
										id="flow-dom-to-image"
										name="renderMethod"
										label="DOM-to-Image"
										checked={renderMethod === 'dom-to-image'}
										onChange={() => {
											setRenderMethod('dom-to-image')
											saveExportSettings({ renderMethod: 'dom-to-image' })
										}}
										disabled={isExporting}
									/>
								</div>
							</Form.Group>
							<Alert variant="info" className="py-2 small mb-3">
								{renderMethod === 'html-in-canvas' ? (
									<>
										ℹ️ <strong>HTML-in-Canvas:</strong> Fast, pixel-accurate frame rendering with native CSS and
										transparency support (Chrome only).
									</>
								) : (
									<>
										ℹ️ <strong>DOM-to-Image:</strong> Universal fallback supported across all browsers, but complex
										styling or animations may produce visual artifacts.
									</>
								)}
							</Alert>
						</>
					)}

					{/* ── Render Resolution & Frame Rate ── */}
					<Row className="mb-3">
						<Col sm={4}>
							<Form.Label className="fw-semibold">Render Width (px)</Form.Label>
							<Form.Control
								type="number"
								min={16}
								max={7680}
								step={2}
								value={renderWidth}
								onChange={(e) => setRenderWidth(Math.max(2, parseInt(e.target.value, 10) || 0))}
								disabled={isExporting}
							/>
						</Col>
						<Col sm={4}>
							<Form.Label className="fw-semibold">Render Height (px)</Form.Label>
							<Form.Control
								type="number"
								min={16}
								max={4320}
								step={2}
								value={renderHeight}
								onChange={(e) => setRenderHeight(Math.max(2, parseInt(e.target.value, 10) || 0))}
								disabled={isExporting}
							/>
						</Col>
						<Col sm={4}>
							<Form.Label className="fw-semibold">Frame Rate (FPS)</Form.Label>
							<Form.Control
								type="number"
								min={1}
								max={120}
								step={1}
								value={fps}
								onChange={(e) => setFps(Math.max(1, parseInt(e.target.value, 10) || 1))}
								disabled={isExporting}
							/>
							<div className="d-flex gap-1 mt-1">
								{[24, 25, 30, 50, 60].map((presetFps) => (
									<Button
										key={presetFps}
										variant={fps === presetFps ? 'primary' : 'outline-secondary'}
										size="sm"
										style={{ padding: '0.1rem 0.35rem', fontSize: '0.7rem' }}
										onClick={() => setFps(presetFps)}
										disabled={isExporting}
									>
										{presetFps}
									</Button>
								))}
							</div>
						</Col>
					</Row>

					{/* ── Container Format & Video Codec ── */}
					<Row className="mb-3">
						<Col sm={6}>
							<Form.Label className="fw-semibold">Export Format</Form.Label>
							<Form.Select
								value={selectedContainerKey}
								onChange={(e) => {
									const newKey = e.target.value
									setSelectedContainerKey(newKey)
									saveExportSettings({ selectedContainerKey: newKey })
								}}
								disabled={isExporting}
							>
								{CONTAINER_DEFINITIONS.map((c) => (
									<option key={c.key} value={c.key}>
										{c.label}
									</option>
								))}
							</Form.Select>
						</Col>
						<Col sm={6}>
							<Form.Label className="fw-semibold">Codec / Format</Form.Label>
							<Form.Select
								value={selectedCodec}
								onChange={(e) => {
									const newCodec = e.target.value
									setSelectedCodec(newCodec)
									saveExportSettings({ selectedCodec: newCodec })
								}}
								disabled={isExporting || isPngSequence || isGif}
							>
								{supportedCodecsForContainer.map((codec) => {
									const info = CODEC_METADATA[codec] || { label: codec.toUpperCase() }
									// console.log('info', info)
									let supportsAlpha = false
									if (selectedContainerKey === 'webm' && codec === 'vp9') supportsAlpha = true
									else if (selectedContainerKey === 'mkv' && codec === 'vp9') supportsAlpha = true
									else if (selectedContainerKey === 'mov' && codec === 'prores-server') supportsAlpha = true
									else if (selectedContainerKey === 'mov' && codec === 'qtrle-server') supportsAlpha = true
									else if (selectedContainerKey === 'gif' && codec === 'gif') supportsAlpha = true
									else if (selectedContainerKey === 'png-sequence' && codec === 'png') supportsAlpha = true

									const isSupportedByBrowser = codecSupport[codec] !== false

									return (
										<option key={codec} value={codec}>
											{info.label}
											{supportsAlpha ? ' (supports transparency)' : ''}
											{!isSupportedByBrowser ? ' – [Browser encoder unsupported]' : ''}
										</option>
									)
								})}
							</Form.Select>
						</Col>
					</Row>

					{isServerConvert && (
						<Alert variant="info" className="py-2 small mb-3">
							<FontAwesomeIcon icon={faCircleInfo} className="me-2 text-info" />
							<strong>Server-side {isServerProres ? 'ProRes 4444' : 'QuickTime Animation (QTRLE)'} Conversion:</strong>{' '}
							The graphic video is first rendered in the browser, then sent to the server to be converted into a
							QuickTime (<code>.mov</code>) file.
						</Alert>
					)}

					{!isPngSequence && !isGif && !isServerConvert && codecSupport[selectedCodec] === false && (
						<Alert variant="warning" className="py-2 small">
							<FontAwesomeIcon icon={faTriangleExclamation} className="me-2 text-warning" />
							Your browser / GPU reported that it may not support encoding with{' '}
							<strong>{CODEC_METADATA[selectedCodec]?.label || selectedCodec.toUpperCase()}</strong>. If the export
							fails, please select another codec (such as VP9 or H.264).
						</Alert>
					)}

					{/* ── Background & Alpha Channel Options ── */}
					<Form.Group className="mb-3 border border-secondary-subtle rounded p-3 bg-body-tertiary">
						<Form.Label className="fw-semibold d-block">
							{formatHasAlpha ? 'Background & Transparency' : 'Alpha & Background Options (No Alpha in Codec)'}
						</Form.Label>

						{formatHasAlpha ? (
							<div className="d-flex align-items-center gap-3 flex-wrap">
								<Form.Check
									type="radio"
									id="bg-transparent"
									name="bgMode"
									label="Transparent Alpha"
									checked={bgMode === 'transparent'}
									onChange={() => {
										setBgMode('transparent')
										saveExportSettings({ bgMode: 'transparent' })
									}}
									disabled={isExporting}
								/>
								<div className="d-flex align-items-center gap-2">
									<Form.Check
										type="radio"
										id="bg-color"
										name="bgMode"
										label="Solid Color"
										checked={bgMode === 'color'}
										onChange={() => {
											setBgMode('color')
											saveExportSettings({ bgMode: 'color' })
										}}
										disabled={isExporting}
									/>
									{bgMode === 'color' && (
										<input
											type="color"
											value={bgColor}
											onChange={(e) => {
												const newCol = e.target.value
												setBgColor(newCol)
												saveExportSettings({ bgColor: newCol })
											}}
											disabled={isExporting}
											style={{
												width: '2.5rem',
												height: '1.8rem',
												padding: '0.1rem',
												border: '1px solid var(--app-border-color)',
												borderRadius: '4px',
												background: 'transparent',
												cursor: 'pointer',
											}}
										/>
									)}
								</div>
							</div>
						) : (
							<div>
								<div className="text-muted small mb-2">
									The selected video codec does not support embedded alpha channels. Choose how to export:
								</div>
								<div className="d-flex flex-column gap-2">
									<div className="d-flex align-items-center gap-2">
										<Form.Check
											type="radio"
											id="bg-color-noalpha"
											name="bgMode"
											label="Solid Color Background"
											checked={bgMode === 'color'}
											onChange={() => {
												setBgMode('color')
												saveExportSettings({ bgMode: 'color' })
											}}
											disabled={isExporting}
										/>
										{bgMode === 'color' && (
											<input
												type="color"
												value={bgColor}
												onChange={(e) => {
													const newCol = e.target.value
													setBgColor(newCol)
													saveExportSettings({ bgColor: newCol })
												}}
												disabled={isExporting}
												style={{
													width: '2.5rem',
													height: '1.8rem',
													padding: '0.1rem',
													border: '1px solid var(--app-border-color)',
													borderRadius: '4px',
													background: 'transparent',
													cursor: 'pointer',
												}}
											/>
										)}
									</div>

									<div className="d-flex align-items-center gap-2">
										<Form.Check
											type="radio"
											id="bg-dual-matte"
											name="bgMode"
											label={`Color clip + Separate transparency clip (${effectiveBaseName}.${currentExt} and ${effectiveBaseName}_a.${currentExt})`}
											checked={bgMode === 'color-and-alpha-matte'}
											onChange={() => {
												setBgMode('color-and-alpha-matte')
												saveExportSettings({ bgMode: 'color-and-alpha-matte' })
											}}
											disabled={isExporting}
										/>
										{bgMode === 'color-and-alpha-matte' && (
											<input
												type="color"
												value={bgColor}
												onChange={(e) => {
													const newCol = e.target.value
													setBgColor(newCol)
													saveExportSettings({ bgColor: newCol })
												}}
												disabled={isExporting}
												title="Background color for fill clip"
												style={{
													width: '2.5rem',
													height: '1.8rem',
													padding: '0.1rem',
													border: '1px solid var(--app-border-color)',
													borderRadius: '4px',
													background: 'transparent',
													cursor: 'pointer',
												}}
											/>
										)}
									</div>
								</div>
							</div>
						)}
					</Form.Group>

					{/* ── Summary info ── */}
					<div className="text-muted small mb-3">
						Output:{' '}
						<strong className="text-body-emphasis">
							{renderWidth} × {renderHeight}
						</strong>{' '}
						px @ <strong className="text-body-emphasis">{fps} fps</strong> — Duration:{' '}
						<strong className="text-body-emphasis">{(duration / 1000).toFixed(2)}s</strong> (
						{Math.ceil(duration / (1000 / (fps || 30))) + 1} frames)
					</div>

					{/* ── File Name Input (always editable even during rendering) ── */}
					<Form.Group className="mb-0">
						<Form.Label className="fw-semibold">File Name</Form.Label>
						<InputGroup>
							<Form.Control
								type="text"
								placeholder="Enter export file name"
								value={fileName}
								onChange={(e) => setFileName(e.target.value)}
							/>
							<InputGroup.Text className="bg-body-secondary text-body border-secondary-subtle">
								.{currentExt}
							</InputGroup.Text>
						</InputGroup>
						{!formatHasAlpha && bgMode === 'color-and-alpha-matte' && (
							<Form.Text className="text-muted">
								Transparency clip will be saved as{' '}
								<code>
									{effectiveBaseName}_a.{currentExt}
								</code>
							</Form.Text>
						)}
					</Form.Group>
				</Form>

				{isExporting && (
					<div className="mt-3">
						<div className="mb-1 text-muted small">{statusText}</div>
						<ProgressBar animated now={progress} label={`${progress}%`} />
					</div>
				)}
			</Modal.Body>
			<Modal.Footer className="modal-footer-custom">
				<Button variant={isExporting ? 'danger' : 'secondary'} onClick={isExporting ? handleCancel : onHide}>
					{isExporting ? (
						<>
							<FontAwesomeIcon icon={faStop} className="me-2" />
							Cancel Render
						</>
					) : renderedVideos ? (
						'Close'
					) : (
						'Cancel'
					)}
				</Button>
				<Button variant="primary" onClick={handleExport} disabled={isExporting}>
					{isExporting ? (
						'Exporting…'
					) : (
						<>
							<FontAwesomeIcon icon={faVideo} className="me-2" />
							Export {currentExt.toUpperCase()}
						</>
					)}
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
