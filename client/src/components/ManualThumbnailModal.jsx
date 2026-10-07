import * as React from 'react'
import { Modal, Button, Form, Alert, Spinner } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faUpload,
	faImage,
	faXmark,
	faCheck,
	faPaste,
	faTriangleExclamation,
	faArrowsRotate,
} from '@fortawesome/free-solid-svg-icons'

function formatBytes(bytes) {
	if (!bytes || bytes === 0) return '0 B'
	const k = 1024
	const sizes = ['B', 'KB', 'MB', 'GB']
	const i = Math.floor(Math.log(bytes) / Math.log(k))
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function ManualThumbnailModal({ show, graphic, onHide, onSave }) {
	const [imageBlob, setImageBlob] = React.useState(null)
	const [previewUrl, setPreviewUrl] = React.useState(null)
	const [imageMeta, setImageMeta] = React.useState(null) // { width, height, size, type, originalName }
	const [relativeFilePath, setRelativeFilePath] = React.useState('')
	const [widthInput, setWidthInput] = React.useState('')
	const [heightInput, setHeightInput] = React.useState('')
	const [isDragging, setIsDragging] = React.useState(false)
	const [error, setError] = React.useState(null)
	const [isSaving, setIsSaving] = React.useState(false)

	const fileInputRef = React.useRef(null)

	// Clean up object URL when changed or unmounted
	React.useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl)
			}
		}
	}, [previewUrl])

	// Reset state when modal opens or graphic changes
	React.useEffect(() => {
		if (show) {
			setImageBlob(null)
			setPreviewUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev)
				return null
			})
			setImageMeta(null)
			setRelativeFilePath('')
			setWidthInput('')
			setHeightInput('')
			setIsDragging(false)
			setError(null)
			setIsSaving(false)
		}
	}, [show, graphic?.path])

	const processImageFile = React.useCallback((file) => {
		setError(null)
		if (!file) return

		const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
		const validExts = /\.(png|jpe?g|webp|gif)$/i

		if (!validTypes.includes(file.type) && !validExts.test(file.name || '')) {
			setError('Unsupported file type. Please use PNG, JPEG, WebP, or GIF.')
			return
		}

		const objectUrl = URL.createObjectURL(file)
		const img = new Image()

		img.onload = () => {
			const naturalWidth = img.naturalWidth
			const naturalHeight = img.naturalHeight

			setPreviewUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev)
				return objectUrl
			})
			setImageBlob(file)

			const originalName = file.name || ''
			const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/)
			const ext = extMatch
				? extMatch[1].toLowerCase()
				: file.type === 'image/jpeg'
				? 'jpg'
				: file.type === 'image/webp'
				? 'webp'
				: file.type === 'image/gif'
				? 'gif'
				: 'png'

			// If pasted generic name or no filename, suggest width x height
			const isGenericPastedName = !originalName || originalName === 'image.png' || originalName === 'blob'
			const sanitizedBase = isGenericPastedName
				? `${naturalWidth}x${naturalHeight}.${ext}`
				: originalName.replace(/[^a-zA-Z0-9._-]/g, '_')

			setRelativeFilePath(`thumbnails/${sanitizedBase}`)
			setWidthInput(String(naturalWidth))
			setHeightInput(String(naturalHeight))

			setImageMeta({
				width: naturalWidth,
				height: naturalHeight,
				size: file.size,
				type: file.type || `image/${ext}`,
				originalName: file.name || 'Pasted image',
			})
		}

		img.onerror = () => {
			URL.revokeObjectURL(objectUrl)
			setError('Failed to load image. The file might be corrupted.')
		}

		img.src = objectUrl
	}, [])

	// Clipboard paste listener
	React.useEffect(() => {
		if (!show) return

		const handlePaste = (e) => {
			// Don't intercept paste if user is typing in a text/number input
			const target = e.target
			if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
				// Only intercept if clipboard actually has an image
				const items = e.clipboardData?.items || []
				const hasImageItem = Array.from(items).some((item) => item.type.startsWith('image/'))
				if (!hasImageItem) {
					return
				}
			}

			const items = e.clipboardData?.items
			if (items) {
				for (const item of items) {
					if (item.type.startsWith('image/')) {
						const file = item.getAsFile()
						if (file) {
							e.preventDefault()
							processImageFile(file)
							return
						}
					}
				}
			}

			const files = e.clipboardData?.files
			if (files && files.length > 0 && files[0].type.startsWith('image/')) {
				e.preventDefault()
				processImageFile(files[0])
			}
		}

		window.addEventListener('paste', handlePaste)
		return () => window.removeEventListener('paste', handlePaste)
	}, [show, processImageFile])

	// Drag & drop handlers
	const handleDragOver = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragLeave = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}, [])

	const handleDrop = React.useCallback(
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragging(false)
			const files = e.dataTransfer?.files
			if (files && files.length > 0) {
				processImageFile(files[0])
			}
		},
		[processImageFile]
	)

	const handleFileSelect = React.useCallback(
		(e) => {
			const files = e.target?.files
			if (files && files.length > 0) {
				processImageFile(files[0])
			}
		},
		[processImageFile]
	)

	const handleResetImage = React.useCallback(() => {
		setImageBlob(null)
		setPreviewUrl((prev) => {
			if (prev) URL.revokeObjectURL(prev)
			return null
		})
		setImageMeta(null)
		setRelativeFilePath('')
		setWidthInput('')
		setHeightInput('')
		setError(null)
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}, [])

	// Check if this path would overwrite an existing thumbnail in the manifest
	const willReplaceExisting = React.useMemo(() => {
		if (!graphic?.manifest?.thumbnails || !relativeFilePath) return false
		const clean = relativeFilePath.trim().replace(/^\/+/, '')
		return graphic.manifest.thumbnails.some((t) => {
			const f = typeof t === 'string' ? t : t.file
			return f === clean
		})
	}, [graphic?.manifest?.thumbnails, relativeFilePath])

	const handleSave = async () => {
		if (!imageBlob || !relativeFilePath || !widthInput || !heightInput) {
			setError('Please specify the file path and valid resolution dimensions.')
			return
		}

		const parsedW = parseInt(widthInput, 10)
		const parsedH = parseInt(heightInput, 10)

		if (isNaN(parsedW) || parsedW <= 0 || isNaN(parsedH) || parsedH <= 0) {
			setError('Width and height must be positive numbers.')
			return
		}

		const cleanPath = relativeFilePath.trim().replace(/^\/+/, '')
		if (!cleanPath) {
			setError('Please enter a valid file path.')
			return
		}

		setIsSaving(true)
		setError(null)

		try {
			await onSave({
				graphic,
				relativeFilePath: cleanPath,
				resolution: { width: parsedW, height: parsedH },
				blob: imageBlob,
			})
			onHide()
		} catch (err) {
			console.error('Failed to save manual thumbnail:', err)
			setError(err.message || 'Failed to save thumbnail.')
		} finally {
			setIsSaving(false)
		}
	}

	const graphicTitle = graphic?.manifest?.name || graphic?.path || 'Graphic'

	return (
		<Modal
			show={show}
			onHide={() => !isSaving && onHide()}
			backdrop={isSaving ? 'static' : true}
			centered
			size="lg"
			className="custom-app-modal manual-thumbnail-modal"
		>
			<Modal.Header closeButton={!isSaving} className="modal-header-custom">
				<Modal.Title className="modal-title-custom">
					<FontAwesomeIcon icon={faImage} className="me-2 text-primary" />
					Add Thumbnail Manually
				</Modal.Title>
			</Modal.Header>

			<Modal.Body className="modal-body-custom">
				<div className="mb-3">
					<div className="fw-semibold text-truncate mb-1" title={graphicTitle}>
						Target Graphic: <span className="text-body-highlight">{graphicTitle}</span>
					</div>
					{graphic?.path && <code className="small text-muted d-block text-truncate">{graphic.path}</code>}
				</div>

				{error && (
					<Alert variant="danger" className="py-2 px-3 small d-flex align-items-center gap-2">
						<FontAwesomeIcon icon={faTriangleExclamation} />
						<div className="flex-grow-1">{error}</div>
					</Alert>
				)}

				{!imageBlob ? (
					/* Drop Zone & Paste Area */
					<div
						className={`manual-thumb-dropzone ${isDragging ? 'drag-active' : ''}`}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
						onClick={() => fileInputRef.current?.click()}
					>
						<input
							type="file"
							ref={fileInputRef}
							accept="image/png,image/jpeg,image/webp,image/gif"
							style={{ display: 'none' }}
							onChange={handleFileSelect}
						/>
						<div className="dropzone-icon mb-2">
							<FontAwesomeIcon icon={faUpload} size="2x" />
						</div>
						<div className="dropzone-main-text fw-semibold mb-1">Drop an image file here, or click to browse</div>
						<div className="dropzone-sub-text small text-muted mb-2">
							<FontAwesomeIcon icon={faPaste} className="me-1" />
							Or press <kbd>Ctrl+V</kbd> / <kbd>Cmd+V</kbd> to paste from clipboard
						</div>
						<div className="dropzone-badges d-flex gap-1 justify-content-center">
							<span className="badge bg-secondary-subtle text-secondary-emphasis">PNG</span>
							<span className="badge bg-secondary-subtle text-secondary-emphasis">JPEG</span>
							<span className="badge bg-secondary-subtle text-secondary-emphasis">WebP</span>
							<span className="badge bg-secondary-subtle text-secondary-emphasis">GIF</span>
						</div>
					</div>
				) : (
					/* Image Preview and Settings Form */
					<div className="manual-thumb-configured">
						<div className="row g-3">
							<div className="col-md-5">
								<div className="manual-thumb-preview-card">
									<div className="manual-thumb-preview-box">
										<img src={previewUrl} alt="Thumbnail preview" className="manual-thumb-preview-img" />
									</div>
									<div className="mt-2 d-flex justify-content-between align-items-center">
										<div className="small text-muted">
											{imageMeta && (
												<span>
													{imageMeta.width}×{imageMeta.height} px • {formatBytes(imageMeta.size)}
												</span>
											)}
										</div>
										<Button
											variant="outline-danger"
											size="sm"
											className="py-0 px-2"
											onClick={handleResetImage}
											disabled={isSaving}
											title="Choose a different image"
										>
											<FontAwesomeIcon icon={faXmark} className="me-1" />
											Change
										</Button>
									</div>
								</div>
							</div>

							<div className="col-md-7">
								<Form.Group className="mb-3">
									<Form.Label className="small fw-semibold mb-1">Relative File Path</Form.Label>
									<Form.Control
										type="text"
										size="sm"
										value={relativeFilePath}
										onChange={(e) => setRelativeFilePath(e.target.value)}
										placeholder="e.g. thumbnails/1280x720.png"
										disabled={isSaving}
									/>
									<Form.Text className="text-muted small">
										File will be written into the graphic's folder on disk.
									</Form.Text>
								</Form.Group>

								<div className="row g-2 mb-3">
									<div className="col-6">
										<Form.Group>
											<Form.Label className="small fw-semibold mb-1">Width (px)</Form.Label>
											<Form.Control
												type="number"
												size="sm"
												min="1"
												value={widthInput}
												onChange={(e) => setWidthInput(e.target.value)}
												disabled={isSaving}
											/>
										</Form.Group>
									</div>
									<div className="col-6">
										<Form.Group>
											<Form.Label className="small fw-semibold mb-1">Height (px)</Form.Label>
											<Form.Control
												type="number"
												size="sm"
												min="1"
												value={heightInput}
												onChange={(e) => setHeightInput(e.target.value)}
												disabled={isSaving}
											/>
										</Form.Group>
									</div>
									<Form.Text className="text-muted small">
										Resolution written to the manifest. Auto-detected from image dimensions.
									</Form.Text>
								</div>

								{willReplaceExisting && (
									<Alert variant="warning" className="py-2 px-3 small mb-0">
										<FontAwesomeIcon icon={faTriangleExclamation} className="me-2" />
										An existing thumbnail entry for <code>{relativeFilePath}</code> will be replaced.
									</Alert>
								)}
							</div>
						</div>
					</div>
				)}
			</Modal.Body>

			<Modal.Footer className="modal-footer-custom">
				<Button variant="outline-secondary" size="sm" onClick={onHide} disabled={isSaving}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={handleSave}
					disabled={isSaving || !imageBlob || !relativeFilePath.trim()}
				>
					{isSaving ? (
						<>
							<Spinner size="sm" className="me-1" />
							Saving…
						</>
					) : (
						<>
							<FontAwesomeIcon icon={faCheck} className="me-1" />
							Save Thumbnail
						</>
					)}
				</Button>
			</Modal.Footer>
		</Modal>
	)
}
