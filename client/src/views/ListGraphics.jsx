import * as React from 'react'
import { Table, Button, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { TopBanner } from '../components/common/TopBanner.jsx'
import { CapabilityBadge } from '../components/common/CapabilityBadge.jsx'
import { ThumbnailPreview } from '../components/common/ThumbnailPreview.jsx'
import { RetryImage } from '../components/common/RetryImage.jsx'
import { IssueBadgeList, getGraphicIssueCounts } from '../components/common/IssueBadgeList.jsx'
import { GraphicIssues } from '../components/GraphicIssues.jsx'
import { AllGraphicsIssuesSection } from '../components/AllGraphicsIssuesSection.jsx'
import { ThemeContext } from '../contexts/ThemeContext.jsx'
import { computeGraphicDateColors } from '../lib/graphic/modifiedDateColors.js'
import {
	ThumbnailGeneratorSection,
	loadPersistedSettings,
	SETTINGS_STORAGE_KEY,
	hasNoThumbnails,
	graphicHasResolution,
	isGraphicMissingConfiguredResolutions,
} from '../components/ThumbnailGeneratorSection.jsx'
import { fileHandler } from '../FileHandler.js'
import {
	generateThumbnailsForGraphic,
	getOutdatedThumbnailsForGraphic,
	replaceOutdatedThumbnailsForGraphic,
} from '../lib/ThumbnailGenerator.js'
import { graphicResourcePath } from '../lib/lib.js'
import { ManualThumbnailModal } from '../components/ManualThumbnailModal.jsx'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
	faArrowsRotate,
	faList,
	faTableCellsLarge,
	faImages,
	faMagnifyingGlass,
	faXmark,
	faCheck,
	faRotateRight,
	faTriangleExclamation,
	faClock,
	faFolderOpen,
	faPlus,
} from '@fortawesome/free-solid-svg-icons'

function formatLastModified(timestamp) {
	if (!timestamp) return '—'
	const d = new Date(timestamp)
	if (isNaN(d.getTime())) return '—'
	return d.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function StatusBadge({ status }) {
	if (!status || status.status === 'idle') {
		return <span className="badge bg-secondary status-badge-item">Idle</span>
	}
	switch (status.status) {
		case 'pending':
			return <span className="badge bg-info status-badge-item">Pending…</span>
		case 'skipped':
			return (
				<span className="badge bg-secondary status-badge-item" title={status.message}>
					Skipped
				</span>
			)
		case 'running':
			return (
				<span className="badge bg-primary status-badge-item" title={status.message}>
					<span className="spinner-border spinner-border-sm me-1" role="status" />
					{status.message || 'Running…'}
				</span>
			)
		case 'done':
			return (
				<span className="badge bg-success status-badge-item" title={status.message}>
					<FontAwesomeIcon icon={faCheck} className="me-1" />
					Done
				</span>
			)
		case 'error':
			return (
				<span className="badge bg-danger status-badge-item" title={status.message}>
					<FontAwesomeIcon icon={faTriangleExclamation} className="me-1" />
					Error
				</span>
			)
		default:
			return null
	}
}

function GenerateButton({ graphic, settings, onGenerate, onReplace, isOutdated = false, isRunning }) {
	if (!graphic.manifest) {
		return (
			<Button size="sm" variant="outline-secondary" disabled title="Cannot generate: manifest has errors">
				Generate
			</Button>
		)
	}

	if (isOutdated) {
		return (
			<Button
				size="sm"
				variant="outline-warning"
				className="btn-row-generate"
				onClick={() => onReplace?.(graphic)}
				disabled={isRunning}
				title="Existing thumbnail(s) are older than graphic files — click to replace"
			>
				<FontAwesomeIcon icon={faRotateRight} className="me-1" />
				Replace
			</Button>
		)
	}

	const allExist = !isGraphicMissingConfiguredResolutions(graphic, settings)

	return (
		<Button
			size="sm"
			variant={allExist ? 'outline-warning' : 'outline-success'}
			className="btn-row-generate"
			onClick={() => onGenerate(allExist)}
			disabled={isRunning}
			title={
				allExist
					? 'All configured thumbnails exist in manifest — force regenerate'
					: 'Generate thumbnails for this graphic'
			}
		>
			<FontAwesomeIcon icon={allExist ? faRotateRight : faImages} className="me-1" />
			{allExist ? 'Regen' : 'Generate'}
		</Button>
	)
}

const VIEW_MODE_STORAGE_KEY = 'ograf-graphics-view-mode'

function loadPersistedViewMode() {
	try {
		const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY)
		if (saved === 'grid' || saved === 'table') {
			return saved
		}
	} catch (_) {}
	return 'table'
}

const SORT_STORAGE_KEY = 'ograf-graphics-sort'
const VALID_SORT_FIELDS = ['name', 'path', 'capabilities', 'lastModified']
const VALID_SORT_DIRECTIONS = ['asc', 'desc']

function loadPersistedSort() {
	try {
		const saved = localStorage.getItem(SORT_STORAGE_KEY)
		if (saved) {
			const parsed = JSON.parse(saved)
			if (parsed && VALID_SORT_FIELDS.includes(parsed.field) && VALID_SORT_DIRECTIONS.includes(parsed.direction)) {
				return parsed
			}
		}
	} catch (_) {}
	return { field: 'name', direction: 'asc' }
}

export function ListGraphics({
	graphicsList,
	onRefresh,
	onCloseFolder,
	graphicsFolderName,
	graphicsSource = 'local',
	searchQuery: controlledSearchQuery,
	onSearchQueryChange,
}) {
	const navigate = useNavigate()
	const [searchParams, setSearchParams] = useSearchParams()

	const { isDark } = React.useContext(ThemeContext)
	const dateColorMapper = React.useMemo(() => {
		return computeGraphicDateColors(graphicsList, isDark)
	}, [graphicsList, isDark])

	const isGeneratorOpen = searchParams.get('generator') === 'true'

	const [viewMode, setViewModeState] = React.useState(loadPersistedViewMode)
	const prevViewModeRef = React.useRef(null)

	// When opening thumbnail generator, force list (table) view and remember prior view mode;
	// when closing, restore the prior view mode.
	React.useEffect(() => {
		if (isGeneratorOpen) {
			if (prevViewModeRef.current === null) {
				prevViewModeRef.current = viewMode
			}
			if (viewMode !== 'table') {
				setViewModeState('table')
			}
		} else {
			if (prevViewModeRef.current !== null) {
				const restoreMode = prevViewModeRef.current
				prevViewModeRef.current = null
				setViewModeState(restoreMode)
				try {
					localStorage.setItem(VIEW_MODE_STORAGE_KEY, restoreMode)
				} catch (_) {}
			}
		}
	}, [isGeneratorOpen])

	const setViewMode = React.useCallback(
		(mode) => {
			setViewModeState(mode)
			if (isGeneratorOpen) {
				prevViewModeRef.current = mode
			}
			try {
				localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode)
			} catch (_) {}
		},
		[isGeneratorOpen]
	)

	const [localSearchQuery, setLocalSearchQuery] = React.useState('')
	const searchQuery = controlledSearchQuery !== undefined ? controlledSearchQuery : localSearchQuery
	const setSearchQuery = onSearchQueryChange || setLocalSearchQuery
	const [sortState, setSortState] = React.useState(loadPersistedSort)
	const sortField = sortState.field
	const sortDirection = sortState.direction

	const handleSort = React.useCallback((field) => {
		setSortState((prev) => {
			const nextDirection =
				prev.field === field ? (prev.direction === 'asc' ? 'desc' : 'asc') : field === 'lastModified' ? 'desc' : 'asc'
			const next = { field, direction: nextDirection }
			try {
				localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next))
			} catch (_) {}
			return next
		})
	}, [])

	const handleSortChange = React.useCallback((field, direction) => {
		const next = { field, direction }
		setSortState(next)
		try {
			localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(next))
		} catch (_) {}
	}, [])

	// Filter graphics by search query (name, path, id)
	const filteredGraphics = React.useMemo(() => {
		if (!graphicsList) return []
		const q = searchQuery.trim().toLowerCase()
		if (!q) return graphicsList

		return graphicsList.filter((g) => {
			const name = (g.manifest?.name || '').toLowerCase()
			const path = (g.path || '').toLowerCase()
			const id = (g.manifest?.id || '').toLowerCase()
			return name.includes(q) || path.includes(q) || id.includes(q)
		})
	}, [graphicsList, searchQuery])

	// Sort filtered graphics (matches table display order)
	const sortedGraphics = React.useMemo(() => {
		const list = [...filteredGraphics]

		list.sort((a, b) => {
			let aVal, bVal

			switch (sortField) {
				case 'name':
					aVal = (a.manifest?.name || a.path || '').toLowerCase()
					bVal = (b.manifest?.name || b.path || '').toLowerCase()
					break
				case 'lastModified':
					aVal = a.lastModified || 0
					bVal = b.lastModified || 0
					break
				case 'capabilities': {
					const getRank = (g) => (g.manifest?.supportsRealTime ? 2 : 0) + (g.manifest?.supportsNonRealTime ? 1 : 0)
					aVal = getRank(a)
					bVal = getRank(b)
					break
				}
				case 'path':
				default:
					aVal = (a.path || '').toLowerCase()
					bVal = (b.path || '').toLowerCase()
					break
			}

			if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
			if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
			return 0
		})

		return list
	}, [filteredGraphics, sortField, sortDirection])

	const [allIssuesExpanded, setAllIssuesExpanded] = React.useState(false)
	const [expandedIssueRows, setExpandedIssueRows] = React.useState(new Set())
	const [isRefreshing, setIsRefreshing] = React.useState(false)

	// ─── Thumbnail Generator State ─────────────────────────────────────────────
	const [settings, setSettings] = React.useState(loadPersistedSettings)
	const onSettingsChange = React.useCallback((newSettings) => {
		setSettings(newSettings)
		try {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings))
		} catch (_) {}
	}, [])

	const [statuses, setStatuses] = React.useState(() =>
		Object.fromEntries((graphicsList ?? []).map((g) => [g.path, { status: 'idle', message: '' }]))
	)

	// Per-graphic preview version to bust cache when generated
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
	const [batchProgress, setBatchProgress] = React.useState(null)
	const abortRef = React.useRef(false)
	const [globalLog, setGlobalLog] = React.useState([])

	const appendLog = React.useCallback((msg) => {
		setGlobalLog((prev) => [...prev.slice(-299), msg])
	}, [])

	const handleClearLog = React.useCallback(() => {
		setGlobalLog([])
	}, [])

	// ─── Outdated Thumbnails Tracking ─────────────────────────────────────────
	const [outdatedGraphicsCount, setOutdatedGraphicsCount] = React.useState(0)
	const [outdatedGraphicsSet, setOutdatedGraphicsSet] = React.useState(() => new Set())

	const checkOutdatedThumbnails = React.useCallback(async () => {
		if (!graphicsList?.length) {
			setOutdatedGraphicsSet(new Set())
			setOutdatedGraphicsCount(0)
			return
		}
		const outdatedSet = new Set()
		for (const graphic of graphicsList) {
			if (!graphic.manifest?.thumbnails?.length) continue
			try {
				const outdated = await getOutdatedThumbnailsForGraphic(graphic, graphicsList)
				if (outdated.length > 0) {
					outdatedSet.add(graphic.path)
				}
			} catch (_) {}
		}
		setOutdatedGraphicsSet(outdatedSet)
		setOutdatedGraphicsCount(outdatedSet.size)
	}, [graphicsList])

	React.useEffect(() => {
		let cancelled = false
		checkOutdatedThumbnails()
		return () => {
			cancelled = true
		}
	}, [checkOutdatedThumbnails, previewVersions, isGeneratorOpen])

	React.useEffect(() => {
		if (typeof fileHandler !== 'undefined' && fileHandler?.listenToFileChanges) {
			const sub = fileHandler.listenToFileChanges(() => {
				checkOutdatedThumbnails()
			})
			return () => sub.stop()
		}
	}, [checkOutdatedThumbnails])

	// ─── Core Generation Runner ───────────────────────────────────────────────
	const runGeneration = React.useCallback(
		async (graphicsToProcess, force = false) => {
			if (isRunning || !graphicsToProcess?.length) return
			setIsRunning(true)
			abortRef.current = false

			const total = graphicsToProcess.length
			let processed = 0
			let done = 0
			let errors = 0
			setBatchProgress({ total, processed: 0, doneCount: 0, errorCount: 0 })

			// Mark all graphics in this run as pending initially
			setStatuses((prev) => {
				const next = { ...prev }
				for (const g of graphicsToProcess) {
					next[g.path] = { status: 'pending', message: 'Pending…' }
				}
				return next
			})

			try {
				for (const graphic of graphicsToProcess) {
					if (abortRef.current) {
						appendLog('[Cancelled] Generation cancelled by user.')
						setStatuses((prev) => {
							const next = { ...prev }
							for (const g of graphicsToProcess) {
								if (next[g.path]?.status === 'pending') {
									next[g.path] = { status: 'idle', message: 'Cancelled' }
								}
							}
							return next
						})
						break
					}

					if (!graphic.manifest) {
						setGraphicStatus(graphic.path, { status: 'error', message: 'No valid manifest' })
						errors++
						processed++
						setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
						continue
					}

					// Skip if all configured resolutions already have entries in the manifest (and not forcing)
					if (!force && !settings.forceRegenerate && graphic.manifest.thumbnails?.length) {
						const allExist = !isGraphicMissingConfiguredResolutions(graphic, settings)
						if (allExist) {
							setGraphicStatus(graphic.path, {
								status: 'skipped',
								message: 'All configured thumbnails already exist in manifest',
							})
							appendLog(
								`Skipped "${
									graphic.manifest.name || graphic.path
								}" — all configured thumbnails already exist in manifest`
							)
							done++
							processed++
							setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
							continue
						}
					}

					setGraphicStatus(graphic.path, { status: 'running', message: 'Starting…' })
					appendLog(`Generating thumbnails for "${graphic.manifest.name || graphic.path}"…`)

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

						if (abortRef.current) {
							appendLog('[Cancelled] Generation cancelled.')
							break
						}

						// Merge new entries into manifest, replacing any entries for files matching newly generated ones
						const keptThumbnails = (graphic.manifest.thumbnails ?? []).filter(
							(existing) =>
								!newThumbnails.some((n) => n.file === (typeof existing === 'string' ? existing : existing.file))
						)
						const updatedManifest = {
							...graphic.manifest,
							thumbnails: [...keptThumbnails, ...newThumbnails],
						}
						await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
						graphic.manifest = updatedManifest

						setGraphicStatus(graphic.path, {
							status: 'done',
							message: `Generated ${newThumbnails.length} thumbnail(s)`,
						})
						bumpPreviewVersion(graphic.path)
						appendLog(`✓ "${graphic.manifest.name || graphic.path}" — ${newThumbnails.length} thumbnail(s) written`)

						done++
						processed++
						setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
					} catch (err) {
						console.error(err)
						setGraphicStatus(graphic.path, { status: 'error', message: err.message })
						appendLog(`✗ Error for "${graphic.manifest?.name ?? graphic.path}": ${err.message}`)

						errors++
						processed++
						setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
					}
				}
			} catch (err) {
				console.error(err)
				appendLog(`Session error: ${err.message}`)
			} finally {
				setIsRunning(false)
				abortRef.current = false
				appendLog('Done.')
				if (onRefresh) {
					try {
						await onRefresh()
					} catch (_) {}
				}
			}
		},
		[isRunning, settings, setGraphicStatus, bumpPreviewVersion, appendLog, onRefresh]
	)

	const handleGenerateAll = React.useCallback(() => {
		runGeneration(sortedGraphics ?? [], false)
	}, [runGeneration, sortedGraphics])

	const handleGenerateWithoutThumbnails = React.useCallback(() => {
		if (!sortedGraphics) return
		const noThumbGraphics = sortedGraphics.filter((g) => hasNoThumbnails(g))
		runGeneration(noThumbGraphics, false)
	}, [runGeneration, sortedGraphics])

	const handleGenerateMissingResolutions = React.useCallback(() => {
		if (!sortedGraphics) return
		const missingResGraphics = sortedGraphics.filter((g) => isGraphicMissingConfiguredResolutions(g, settings))
		runGeneration(missingResGraphics, false)
	}, [runGeneration, sortedGraphics, settings])

	const runReplaceThumbnails = React.useCallback(
		async (graphicsToProcess) => {
			if (isRunning || !graphicsToProcess?.length) return
			setIsRunning(true)
			abortRef.current = false

			appendLog('Checking for outdated thumbnails…')

			const targets = []
			for (const graphic of graphicsToProcess) {
				if (!graphic.manifest) continue
				try {
					const outdated = await getOutdatedThumbnailsForGraphic(graphic, graphicsList)
					if (outdated.length > 0) {
						targets.push({ graphic, outdated })
					}
				} catch (err) {
					console.warn('Error checking outdated thumbnails for', graphic.path, err)
				}
			}

			if (targets.length === 0) {
				appendLog('✓ All existing thumbnails are up to date.')
				setIsRunning(false)
				return
			}

			const total = targets.length
			let processed = 0
			let done = 0
			let errors = 0
			setBatchProgress({ total, processed: 0, doneCount: 0, errorCount: 0 })

			// Mark all target graphics as pending
			setStatuses((prev) => {
				const next = { ...prev }
				for (const { graphic } of targets) {
					next[graphic.path] = { status: 'pending', message: 'Pending…' }
				}
				return next
			})

			appendLog(`Found ${total} graphic(s) with outdated thumbnails to replace.`)

			try {
				for (const { graphic, outdated } of targets) {
					if (abortRef.current) {
						appendLog('[Cancelled] Thumbnail replacement cancelled by user.')
						setStatuses((prev) => {
							const next = { ...prev }
							for (const { graphic: g } of targets) {
								if (next[g.path]?.status === 'pending') {
									next[g.path] = { status: 'idle', message: 'Cancelled' }
								}
							}
							return next
						})
						break
					}

					setGraphicStatus(graphic.path, {
						status: 'running',
						message: `Replacing ${outdated.length} thumbnail(s)…`,
					})
					appendLog(
						`Replacing ${outdated.length} outdated thumbnail(s) for "${graphic.manifest.name || graphic.path}"…`
					)

					try {
						const replacedResults = await replaceOutdatedThumbnailsForGraphic({
							graphic,
							outdatedThumbnails: outdated,
							thumbnailSettings: settings,
							onProgress: (msg) => {
								setGraphicStatus(graphic.path, { status: 'running', message: msg })
								appendLog(`  ${msg}`)
							},
							writeFileFn: async (path, blob) => {
								await fileHandler.writeFile(path, blob)
							},
						})

						if (abortRef.current) {
							appendLog('[Cancelled] Thumbnail replacement cancelled.')
							break
						}

						// Merge resolution back into manifest for any replaced thumbnails
						const updatedThumbnails = (graphic.manifest.thumbnails || []).map((existing) => {
							const existingFile = typeof existing === 'string' ? existing : existing.file
							const replaced = replacedResults.find((r) => r.file === existingFile)
							if (replaced) {
								return typeof existing === 'object'
									? { ...existing, resolution: replaced.resolution }
									: { file: replaced.file, resolution: replaced.resolution }
							}
							return existing
						})

						const updatedManifest = {
							...graphic.manifest,
							thumbnails: updatedThumbnails,
						}
						await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
						graphic.manifest = updatedManifest

						setGraphicStatus(graphic.path, {
							status: 'done',
							message: `Replaced ${replacedResults.length} thumbnail(s)`,
						})
						bumpPreviewVersion(graphic.path)
						appendLog(`✓ "${graphic.manifest.name || graphic.path}" — ${replacedResults.length} thumbnail(s) replaced`)

						done++
						processed++
						setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
					} catch (err) {
						console.error(err)
						setGraphicStatus(graphic.path, { status: 'error', message: err.message })
						appendLog(`✗ Error for "${graphic.manifest?.name ?? graphic.path}": ${err.message}`)

						errors++
						processed++
						setBatchProgress({ total, processed, doneCount: done, errorCount: errors })
					}
				}
			} catch (err) {
				console.error(err)
				appendLog(`Session error: ${err.message}`)
			} finally {
				setIsRunning(false)
				abortRef.current = false
				appendLog('Done.')
				checkOutdatedThumbnails()
				if (onRefresh) {
					try {
						await onRefresh()
					} catch (_) {}
				}
			}
		},
		[
			isRunning,
			settings,
			graphicsList,
			setGraphicStatus,
			bumpPreviewVersion,
			appendLog,
			checkOutdatedThumbnails,
			onRefresh,
		]
	)

	const handleReplaceThumbnails = React.useCallback(() => {
		runReplaceThumbnails(sortedGraphics ?? [])
	}, [runReplaceThumbnails, sortedGraphics])

	const displayedOutdatedCount = React.useMemo(() => {
		return (sortedGraphics ?? []).filter((g) => outdatedGraphicsSet.has(g.path)).length
	}, [sortedGraphics, outdatedGraphicsSet])

	const handleReplaceOne = React.useCallback((graphic) => runReplaceThumbnails([graphic]), [runReplaceThumbnails])

	const handleCancelGeneration = React.useCallback(() => {
		abortRef.current = true
		appendLog('Cancelling generation…')
	}, [appendLog])

	const handleGenerateOne = React.useCallback(
		(graphic, force = false) => runGeneration([graphic], force),
		[runGeneration]
	)

	const handleDeleteThumbnail = React.useCallback(
		async (graphic, thumbnail) => {
			if (isRunning) return
			const file = typeof thumbnail === 'string' ? thumbnail : thumbnail.file
			const filePath = graphic.folderPath + file
			try {
				await fileHandler.deleteFile(filePath)
			} catch (err) {
				console.error('Failed to delete thumbnail file:', err)
			}
			// Remove entry from manifest
			const updatedManifest = {
				...graphic.manifest,
				thumbnails: (graphic.manifest?.thumbnails ?? []).filter((t) => {
					const tf = typeof t === 'string' ? t : t.file
					return tf !== file
				}),
			}
			await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
			graphic.manifest = updatedManifest
			bumpPreviewVersion(graphic.path)
			appendLog(`Deleted thumbnail "${file}" for "${graphic.manifest?.name || graphic.path}"`)

			if (onRefresh) {
				try {
					await onRefresh()
				} catch (_) {}
			}
		},
		[isRunning, bumpPreviewVersion, appendLog, onRefresh]
	)

	// ─── Manual Thumbnail ─────────────────────────────────────────────────────
	const [manualThumbnailTarget, setManualThumbnailTarget] = React.useState(null)

	const handleSaveManualThumbnail = React.useCallback(
		async ({ graphic, relativeFilePath, resolution, blob }) => {
			await fileHandler.writeFile(graphic.folderPath + relativeFilePath, blob)

			const newEntry = { file: relativeFilePath, resolution }
			const existing = graphic.manifest?.thumbnails ?? []
			let replaced = false
			const thumbnails = existing.map((t) => {
				const tf = typeof t === 'string' ? t : t.file
				if (tf === relativeFilePath) {
					replaced = true
					return typeof t === 'object' ? { ...t, ...newEntry } : newEntry
				}
				return t
			})
			if (!replaced) thumbnails.push(newEntry)

			const updatedManifest = { ...graphic.manifest, thumbnails }
			await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
			graphic.manifest = updatedManifest
			bumpPreviewVersion(graphic.path)
			appendLog(
				`✓ Added thumbnail "${relativeFilePath}" (${resolution.width}×${resolution.height}) for "${
					graphic.manifest?.name || graphic.path
				}"`
			)

			if (onRefresh) {
				try {
					await onRefresh()
				} catch (_) {}
			}
		},
		[bumpPreviewVersion, appendLog, onRefresh]
	)

	const handleDeleteAllThumbnails = React.useCallback(async () => {
		if (isRunning || !sortedGraphics?.length) return
		setIsRunning(true)
		appendLog('Deleting all thumbnails across displayed graphics…')
		try {
			for (const graphic of sortedGraphics) {
				if (!graphic.manifest?.thumbnails?.length) continue
				for (const t of graphic.manifest.thumbnails) {
					const file = typeof t === 'string' ? t : t.file
					try {
						await fileHandler.deleteFile(graphic.folderPath + file)
					} catch (err) {
						console.error('Failed to delete file:', err)
					}
				}
				const updatedManifest = {
					...graphic.manifest,
					thumbnails: [],
				}
				await fileHandler.writeManifest(graphic, updatedManifest, graphic.manifestFormatting)
				graphic.manifest = updatedManifest
				bumpPreviewVersion(graphic.path)
			}
			appendLog('✓ All thumbnails deleted successfully.')
		} catch (err) {
			console.error('Failed to delete all thumbnails:', err)
			appendLog(`✗ Error during delete all: ${err.message}`)
		} finally {
			setIsRunning(false)
			if (onRefresh) {
				try {
					await onRefresh()
				} catch (_) {}
			}
		}
	}, [isRunning, sortedGraphics, bumpPreviewVersion, appendLog, onRefresh])

	const toggleGenerator = React.useCallback(() => {
		const next = new URLSearchParams(searchParams)
		if (isGeneratorOpen) {
			next.delete('generator')
		} else {
			next.set('generator', 'true')
		}
		setSearchParams(next, { replace: true })
	}, [isGeneratorOpen, searchParams, setSearchParams])

	const handleRefresh = React.useCallback(async () => {
		if (!onRefresh) return
		setIsRefreshing(true)
		try {
			await onRefresh()
		} finally {
			setIsRefreshing(false)
		}
	}, [onRefresh])

	const isRemote = graphicsSource === 'remote'

	// Calculate graphics with issues count to decide if "Expand all issues" button is shown
	const graphicsWithIssuesCount = React.useMemo(() => {
		if (!graphicsList) return 0
		return graphicsList.filter((g) => getGraphicIssueCounts(g).hasIssues).length
	}, [graphicsList])

	const renderSortHeader = (field, label, className = '') => {
		const isActive = sortField === field
		const headerTitle =
			field === 'lastModified'
				? `Click to sort by ${label} • Background: Toned-down Blue (Today), Grayish (This week), Default (Older)`
				: `Click to sort by ${label}`
		return (
			<th onClick={() => handleSort(field)} className={`sortable-th ${className}`} title={headerTitle}>
				<span>{label}</span>
				<span className={`sort-indicator ${isActive ? 'active' : ''}`}>
					{isActive ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
				</span>
			</th>
		)
	}

	const renderGenerateThumbnailButton = () => {
		if (isRemote) {
			return (
				<OverlayTrigger
					placement="top"
					overlay={<Tooltip>Thumbnail generation is only available for local folders.</Tooltip>}
				>
					<span className="d-inline-block">
						<Button
							variant="secondary"
							size="sm"
							disabled
							className="toolbar-btn"
							style={{ pointerEvents: 'none', opacity: 0.6 }}
						>
							<FontAwesomeIcon icon={faImages} /> Generate Thumbnails
						</Button>
					</span>
				</OverlayTrigger>
			)
		}

		return (
			<Button
				variant={isGeneratorOpen ? 'success' : 'outline-secondary'}
				size="sm"
				className={`toolbar-btn ${isGeneratorOpen ? 'generator-active-btn' : ''}`}
				onClick={toggleGenerator}
				title={isGeneratorOpen ? 'Hide thumbnail generator section' : 'Open thumbnail generator section'}
			>
				<FontAwesomeIcon icon={faImages} /> {isGeneratorOpen ? 'Close Generator' : 'Generate Thumbnails'}
			</Button>
		)
	}

	return (
		<div className="workspace-page-wrapper">
			{/* Top Header with Breadcrumbs, Switch Folder & Source */}
			<TopBanner folderName={graphicsFolderName} graphicsSource={graphicsSource} onCloseFolder={onCloseFolder} />

			<main className="workspace-page-content list-graphics-view">
				{/* Toolbar Card */}
				<div className="list-toolbar-card">
					<div className="list-toolbar">
						{/* Left: Refresh List & Search Input */}
						<div className="toolbar-left">
							{onRefresh && (
								<Button
									variant="outline-secondary"
									size="sm"
									className="toolbar-btn toolbar-btn-refresh"
									onClick={handleRefresh}
									disabled={isRefreshing}
									title="Refresh graphics from disk / remote"
								>
									<FontAwesomeIcon icon={faArrowsRotate} spin={isRefreshing} className="refresh-icon" />{' '}
									{isRefreshing ? 'Refreshing…' : 'Refresh'}
								</Button>
							)}

							<div className="search-box-container">
								<span className="search-icon">
									<FontAwesomeIcon icon={faMagnifyingGlass} />
								</span>
								<input
									type="text"
									className="search-input"
									placeholder="Filter graphics…"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
								/>
								{searchQuery && (
									<button
										type="button"
										className="search-clear-btn"
										onClick={() => setSearchQuery('')}
										title="Clear search"
									>
										<FontAwesomeIcon icon={faXmark} />
									</button>
								)}
							</div>

							<span className="results-counter">
								{searchQuery
									? `${sortedGraphics.length} of ${graphicsList?.length || 0} graphics`
									: `${graphicsList?.length || 0} ${graphicsList?.length === 1 ? 'graphic' : 'graphics'}`}
							</span>
						</div>

						{/* Right Toolbar Actions */}
						<div className="toolbar-right">
							{renderGenerateThumbnailButton()}

							{/* Expand/Collapse All Issues button (only present when >1 graphic has issues and not in thumbnail mode) */}
							{!isGeneratorOpen && graphicsWithIssuesCount > 1 && (
								<button
									type="button"
									className="expand-all-issues-btn"
									onClick={() => setAllIssuesExpanded((prev) => !prev)}
								>
									<span>{allIssuesExpanded ? '▲ Collapse All Issues' : '▼ Expand All Issues'}</span>
								</button>
							)}

							{/* Grid View Sort Selector */}
							{viewMode === 'grid' && (
								<div className="grid-sort-controls d-flex align-items-center">
									<select
										id="gridSortSelect"
										className="form-select form-select-sm toolbar-select"
										value={`${sortField}-${sortDirection}`}
										onChange={(e) => {
											const [f, d] = e.target.value.split('-')
											handleSortChange(f, d)
										}}
										title="Sort graphics in grid view"
									>
										<option value="name-asc">Sort: Name (A → Z)</option>
										<option value="name-desc">Sort: Name (Z → A)</option>
										<option value="lastModified-desc">Sort: Modified (Newest)</option>
										<option value="lastModified-asc">Sort: Modified (Oldest)</option>
										<option value="capabilities-desc">Sort: Capabilities</option>
										<option value="path-asc">Sort: Path (A → Z)</option>
										<option value="path-desc">Sort: Path (Z → A)</option>
									</select>
								</div>
							)}

							{/* View Mode Toggle: List vs Grid */}
							<div className="view-mode-toggle" role="group" aria-label="View mode">
								<button
									type="button"
									className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
									onClick={() => setViewMode('table')}
									title="List / Table View"
								>
									<FontAwesomeIcon icon={faList} /> List
								</button>
								<button
									type="button"
									className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
									onClick={() => setViewMode('grid')}
									title="Grid View"
								>
									<FontAwesomeIcon icon={faTableCellsLarge} /> Grid
								</button>
							</div>
						</div>
					</div>
				</div>

				{/* ── Collapsible Thumbnail Generator Section ── */}
				{isGeneratorOpen && !isRemote && (
					<ThumbnailGeneratorSection
						graphicsList={sortedGraphics}
						settings={settings}
						onSettingsChange={onSettingsChange}
						isRunning={isRunning}
						statuses={statuses}
						batchProgress={batchProgress}
						previewVersions={previewVersions}
						globalLog={globalLog}
						onClearLog={handleClearLog}
						onGenerateAll={handleGenerateAll}
						onGenerateWithoutThumbnails={handleGenerateWithoutThumbnails}
						onGenerateMissingResolutions={handleGenerateMissingResolutions}
						onReplaceThumbnails={handleReplaceThumbnails}
						outdatedCount={displayedOutdatedCount}
						onCancelGeneration={handleCancelGeneration}
						onDeleteAllThumbnails={handleDeleteAllThumbnails}
						onClose={toggleGenerator}
					/>
				)}

				{/* Graphics List Contents */}
				{sortedGraphics.length > 0 ? (
					viewMode === 'table' ? (
						/* --- Table View --- */
						<div className="graphics-table-card">
							<div className="table-responsive">
								<Table hover className="graphics-dark-table align-middle">
									<thead>
										<tr>
											{isGeneratorOpen ? (
												<th style={{ minWidth: '220px' }}>Generated Thumbnails</th>
											) : (
												<th style={{ width: '100px' }}>Thumbnail</th>
											)}
											{renderSortHeader('name', 'Name')}
											{renderSortHeader('path', 'Path')}
											{!isGeneratorOpen && renderSortHeader('capabilities', 'Capabilities')}
											{renderSortHeader('lastModified', 'Modified')}
											{!isGeneratorOpen && <th style={{ minWidth: '160px' }}>Validation</th>}
											{isGeneratorOpen && <th style={{ width: '120px' }}>Status</th>}
											<th style={{ width: isGeneratorOpen ? '320px' : '90px' }}>Actions</th>
										</tr>
									</thead>
									<tbody>
										{sortedGraphics.map((graphic, i) => {
											const hasId = !!graphic.manifest?.id
											const hasVersion = !!graphic.manifest?.version
											const tooltipText =
												hasId || hasVersion ? (
													<Tooltip id={`tooltip-id-${i}`}>
														{hasId && (
															<div>
																<strong>ID:</strong> {graphic.manifest.id}
															</div>
														)}
														{hasVersion && (
															<div>
																<strong>Version:</strong> {graphic.manifest.version}
															</div>
														)}
													</Tooltip>
												) : null

											const status = statuses[graphic.path] ?? { status: 'idle', message: '' }
											const existingThumbs = graphic.manifest?.thumbnails ?? []
											const isRowExpanded = allIssuesExpanded || expandedIssueRows.has(graphic.path)
											const dateInfo = dateColorMapper.getColorInfo(graphic.path)

											return (
												<React.Fragment key={graphic.path}>
													<tr className={status.status === 'running' ? 'row-running-highlight' : ''}>
														{/* Thumbnail Column */}
														{isGeneratorOpen ? (
															<td className="thumbnail-mode-thumbs-cell">
																{existingThumbs.length > 0 ? (
																	<div className="thumbnail-mode-gallery">
																		{existingThumbs.map((t, idx) => {
																			const file = typeof t === 'string' ? t : t.file
																			const extMatch =
																				typeof file === 'string' ? file.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/) : null
																			const format = extMatch ? extMatch[1].toLowerCase() : ''
																			const isAnimated = format === 'gif' || format === 'webp'
																			const filePath = graphic.folderPath + file
																			const src =
																				graphicResourcePath(filePath) + `?v=${previewVersions[graphic.path] || 0}`
																			const resLabel =
																				typeof t === 'object' && t?.resolution?.width && t?.resolution?.height
																					? `${t.resolution.width}×${t.resolution.height}`
																					: file

																			return (
																				<div
																					key={idx}
																					className={`thumb-item-chip ${isAnimated ? 'thumb-item-animated' : ''}`}
																				>
																					<a
																						href={src}
																						target="_blank"
																						rel="noreferrer"
																						title={`Open ${file} in new tab`}
																					>
																						<RetryImage src={src} alt={resLabel} className="thumb-item-img" />
																					</a>
																					<div className="thumb-item-footer">
																						<span className="thumb-item-label" title={file}>
																							{resLabel} {format ? `(${format.toUpperCase()})` : ''}
																						</span>
																						<button
																							type="button"
																							className="thumb-item-del-btn"
																							onClick={() => handleDeleteThumbnail(graphic, t)}
																							disabled={isRunning}
																							title={`Delete ${file}`}
																						>
																							<FontAwesomeIcon icon={faXmark} />
																						</button>
																					</div>
																				</div>
																			)
																		})}
																	</div>
																) : (
																	<span className="no-thumbnails-label">No thumbnails</span>
																)}
															</td>
														) : (
															<td>
																<ThumbnailPreview
																	graphic={graphic}
																	thumbnails={graphic.manifest?.thumbnails}
																	folderPath={graphic.folderPath}
																	alt={graphic.manifest?.name || graphic.path}
																	size="table"
																	graphicsSource={graphicsSource}
																	onRefresh={onRefresh}
																/>
															</td>
														)}

														{/* Name & ID */}
														<td className="graphic-title-cell">
															<div className="graphic-name">
																{tooltipText ? (
																	<OverlayTrigger placement="top" overlay={tooltipText}>
																		<span style={{ cursor: 'help' }}>{graphic.manifest?.name ?? graphic.path}</span>
																	</OverlayTrigger>
																) : (
																	<span>{graphic.manifest?.name ?? graphic.path}</span>
																)}
															</div>
															{(hasId || hasVersion) && (
																<div className="graphic-meta-chips">
																	{hasId && <span className="meta-chip">id: {graphic.manifest.id}</span>}
																	{hasVersion && <span className="meta-chip">v{graphic.manifest.version}</span>}
																</div>
															)}
														</td>

														{/* Manifest Path */}
														<td className="graphic-path-cell">
															<code>{graphic.path}</code>
														</td>

														{/* Capabilities (Hidden in thumbnail mode) */}
														{!isGeneratorOpen && (
															<td>
																<CapabilityBadge
																	supportsRealTime={graphic.manifest?.supportsRealTime}
																	supportsNonRealTime={graphic.manifest?.supportsNonRealTime}
																/>
															</td>
														)}

														{/* Modified Date  */}
														{
															<td
																className="graphic-date-cell"
																style={{
																	backgroundColor: dateInfo.cellBg,
																}}
																title={dateInfo.tooltip}
															>
																{formatLastModified(graphic.lastModified)}
															</td>
														}

														{/* Issues (Hidden in thumbnail mode) */}
														{!isGeneratorOpen && (
															<td>
																<IssueBadgeList
																	graphic={graphic}
																	isExpanded={isRowExpanded}
																	onToggleExpanded={() => {
																		setExpandedIssueRows((prev) => {
																			const next = new Set(prev)
																			if (next.has(graphic.path)) {
																				next.delete(graphic.path)
																			} else {
																				next.add(graphic.path)
																			}
																			return next
																		})
																	}}
																	hidePanel={true}
																/>
															</td>
														)}

														{/* Status Badge (Shown in thumbnail mode) */}
														{isGeneratorOpen && (
															<td className="graphic-status-cell">
																<StatusBadge status={status} />
															</td>
														)}

														{/* Action Buttons */}
														<td className="graphic-action-cell">
															<div className="d-flex align-items-center gap-1 flex-wrap justify-content-end">
																{isGeneratorOpen && (
																	<GenerateButton
																		graphic={graphic}
																		settings={settings}
																		isOutdated={outdatedGraphicsSet.has(graphic.path)}
																		onGenerate={(force) => handleGenerateOne(graphic, force)}
																		onReplace={() => handleReplaceOne(graphic)}
																		isRunning={isRunning}
																	/>
																)}
																{isGeneratorOpen && (
																	<Button
																		size="sm"
																		variant="outline-secondary"
																		className="btn-row-manual-thumbnail"
																		onClick={() => setManualThumbnailTarget(graphic)}
																		disabled={isRunning || !graphic.manifest}
																		title={
																			!graphic.manifest
																				? 'Cannot add thumbnail: manifest has errors'
																				: 'Add a thumbnail manually by dropping or pasting an image'
																		}
																	>
																		<FontAwesomeIcon icon={faPlus} className="me-1" />
																		Add thumbnail manually
																	</Button>
																)}
																<Link to={`/graphic${graphic.path}`}>
																	<Button variant="primary" size="sm" className="action-btn">
																		Open
																	</Button>
																</Link>
															</div>
														</td>
													</tr>

													{/* Expanded Issues Subrow */}
													{isRowExpanded && !isGeneratorOpen && (
														<tr className="graphic-issues-subrow" key={`${graphic.path}-issues`}>
															<td colSpan={7} className="graphic-issues-subrow-td">
																<div className="graphic-issues-subrow-content">
																	{graphic.manifestParseError && (
																		<div className="alert alert-danger p-2 small mb-2">
																			<strong>Manifest Parse Error:</strong>
																			<div>{graphic.manifestParseError.toString()}</div>
																		</div>
																	)}
																	{graphic.warnings?.map((warning, wi) => (
																		<div className="alert alert-warning p-2 small mb-2" key={wi}>
																			<strong>Warning:</strong> {warning}
																		</div>
																	))}
																	<GraphicIssues
																		manifest={graphic.manifest}
																		graphic={graphic}
																		onIssuesChanged={() => {
																			if (onRefresh) onRefresh()
																		}}
																	/>
																</div>
															</td>
														</tr>
													)}
												</React.Fragment>
											)
										})}
									</tbody>
								</Table>
							</div>
						</div>
					) : (
						/* --- Grid View --- */
						<div className="graphics-cards-grid">
							{sortedGraphics.map((graphic) => {
								const hasVersion = !!graphic.manifest?.version
								const status = statuses[graphic.path] ?? { status: 'idle', message: '' }
								const dateInfo = dateColorMapper.getColorInfo(graphic.path)

								return (
									<div
										key={graphic.path}
										className={`graphic-grid-card ${status.status === 'running' ? 'card-running-highlight' : ''}`}
										onClick={() => navigate(`/graphic${graphic.path}`)}
									>
										<div className="card-preview-section">
											<ThumbnailPreview
												graphic={graphic}
												thumbnails={graphic.manifest?.thumbnails}
												folderPath={graphic.folderPath}
												alt={graphic.manifest?.name || graphic.path}
												size="card"
												disableHover={true}
												graphicsSource={graphicsSource}
												onRefresh={onRefresh}
											/>
										</div>

										<div className="card-info-section">
											<div className="card-title-row">
												<h3 className="card-graphic-name" title={graphic.manifest?.name || graphic.path}>
													{graphic.manifest?.name || graphic.path}
												</h3>
												{hasVersion && (
													<span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>
														v{graphic.manifest.version}
													</span>
												)}
											</div>

											<div className="card-path-code" title={graphic.path}>
												{graphic.path}
											</div>
										</div>

										{isGeneratorOpen ? (
											<div className="card-generator-status-row">
												<StatusBadge status={status} />
											</div>
										) : (
											<div className="card-meta-row">
												<CapabilityBadge
													supportsRealTime={graphic.manifest?.supportsRealTime}
													supportsNonRealTime={graphic.manifest?.supportsNonRealTime}
												/>
												<IssueBadgeList graphic={graphic} forceExpanded={allIssuesExpanded ? true : undefined} />
											</div>
										)}

										<div className="card-footer-row">
											<span
												className="card-date"
												style={
													dateInfo.cellBg !== 'transparent'
														? {
																backgroundColor: dateInfo.cellBg,
																padding: '2px 6px',
																borderRadius: '4px',
														  }
														: undefined
												}
												title={dateInfo.tooltip}
											>
												<FontAwesomeIcon icon={faClock} className="me-1 text-muted" />
												{formatLastModified(graphic.lastModified)}
											</span>
											<div className="d-flex gap-1 align-items-center">
												{isGeneratorOpen && (
													<div onClick={(e) => e.stopPropagation()}>
														<GenerateButton
															graphic={graphic}
															settings={settings}
															onGenerate={(force) => handleGenerateOne(graphic, force)}
															isRunning={isRunning}
														/>
													</div>
												)}
												<Button
													variant="primary"
													size="sm"
													onClick={(e) => {
														e.stopPropagation()
														navigate(`/graphic${graphic.path}`)
													}}
												>
													Select →
												</Button>
											</div>
										</div>
									</div>
								)
							})}
						</div>
					)
				) : (
					/* --- Empty State --- */
					<div className="graphics-empty-state">
						<span className="empty-icon">
							<FontAwesomeIcon icon={searchQuery ? faMagnifyingGlass : faFolderOpen} />
						</span>
						<h2 className="empty-title">
							{searchQuery ? 'No matching graphics found' : 'No graphics found in folder'}
						</h2>
						<p className="empty-desc">
							{searchQuery
								? `No graphics match your query "${searchQuery}". Try searching with a different term.`
								: `No *.ograf.json graphic files were found in the selected folder "${graphicsFolderName}".`}
						</p>
						<div className="empty-actions">
							{searchQuery ? (
								<Button variant="outline-secondary" size="sm" onClick={() => setSearchQuery('')}>
									Clear Search Filter
								</Button>
							) : (
								<Button variant="primary" size="sm" onClick={onCloseFolder}>
									Pick Another Folder
								</Button>
							)}
						</div>
					</div>
				)}

				{/* ── Expandable All Issues Section at the bottom of the list view ── */}
				{graphicsList && graphicsList.length > 0 && (
					<AllGraphicsIssuesSection
						graphicsList={graphicsList}
						graphicsFolderName={graphicsFolderName}
						onRefresh={onRefresh}
						searchQuery={searchQuery}
					/>
				)}
			</main>

			<ManualThumbnailModal
				show={!!manualThumbnailTarget}
				graphic={manualThumbnailTarget}
				onHide={() => setManualThumbnailTarget(null)}
				onSave={handleSaveManualThumbnail}
			/>
		</div>
	)
}
