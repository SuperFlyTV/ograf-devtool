import * as React from 'react'
import { Card, Button, Badge, Alert } from 'react-bootstrap'
import { issueTracker } from '../renderer/IssueTracker.js'

const classToTagName = new WeakMap()
let staticControllerId = 0

/**
 * Ensures a custom element class is registered with customElements.define exactly once,
 * returning the registered tag name.
 */
export function getOrDefineCustomElement(componentClass, exportName = 'controller') {
	if (typeof customElements !== 'undefined') {
		if (typeof customElements.getName === 'function') {
			const existingName = customElements.getName(componentClass)
			if (existingName) return existingName
		}
	}
	if (classToTagName.has(componentClass)) {
		return classToTagName.get(componentClass)
	}

	const sanitizedExport = String(exportName)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '-')
	let tagName = `ograf-ctrl-${sanitizedExport}`
	if (typeof customElements !== 'undefined' && customElements.get(tagName)) {
		tagName = `ograf-ctrl-${sanitizedExport}-${++staticControllerId}`
	}

	try {
		customElements.define(tagName, componentClass)
		classToTagName.set(componentClass, tagName)
		return tagName
	} catch (e) {
		console.warn(`Failed to define custom element ${tagName}:`, e)
		if (classToTagName.has(componentClass)) {
			return classToTagName.get(componentClass)
		}
		throw e
	}
}

const STORAGE_PREFIX = 'ograf.customControllers.collapsed'

function getStoredCollapseState(graphicId) {
	if (!graphicId) return null
	try {
		const raw = localStorage.getItem(`${STORAGE_PREFIX}.${graphicId}`)
		return raw ? JSON.parse(raw) : null
	} catch (_e) {
		return null
	}
}

function setStoredCollapseState(graphicId, state) {
	if (!graphicId) return
	try {
		localStorage.setItem(`${STORAGE_PREFIX}.${graphicId}`, JSON.stringify(state))
	} catch (_e) {
		// Ignore storage errors
	}
}

/**
 * Renders the Custom Controllers panel in GraphicsTester.
 *
 * Filters controllers matching the current renderType ('realtime' or 'non-realtime').
 * If none are found, renders nothing (null).
 * If found, renders independent collapsible panels with state persisted in localStorage.
 */
export function CustomControllersPanel({
	controllers = [],
	renderType = 'realtime',
	rendererRef,
	data,
	onDataChange,
	playTime,
	setPlayTime,
	schedule,
	setActionsSchedule,
	graphicId,
	reloadKey = 0,
}) {
	// Filter strictly by the current render mode:
	const filteredControllers = React.useMemo(() => {
		return (controllers || []).filter((c) => {
			if (!c || !c.supportedRenderTypes || !Array.isArray(c.supportedRenderTypes)) return false
			return c.supportedRenderTypes.includes(renderType)
		})
	}, [controllers, renderType])

	// Collapse state: map of controller id -> boolean (true = open, false = collapsed)
	const [openState, setOpenState] = React.useState(() => {
		const stored = getStoredCollapseState(graphicId)
		if (stored && typeof stored === 'object') return stored

		// Default: open if exactly 1 controller, collapsed if multiple
		if (filteredControllers.length === 1) {
			return { [filteredControllers[0].id]: true }
		}
		return {}
	})

	// When controllers or graphicId changes, re-sync collapse state if not previously set
	React.useEffect(() => {
		const stored = getStoredCollapseState(graphicId)
		if (stored && typeof stored === 'object') {
			setOpenState(stored)
		} else {
			if (filteredControllers.length === 1) {
				setOpenState({ [filteredControllers[0].id]: true })
			} else {
				setOpenState({})
			}
		}
	}, [graphicId, filteredControllers.length])

	const toggleController = React.useCallback(
		(ctrlId) => {
			setOpenState((prev) => {
				const next = { ...prev, [ctrlId]: !prev[ctrlId] }
				setStoredCollapseState(graphicId, next)
				return next
			})
		},
		[graphicId]
	)

	// If no custom controllers match the current mode, don't display anything to the user
	if (!filteredControllers.length) {
		return null
	}

	console.log('filteredControllers', filteredControllers)

	return (
		<div className="custom-controllers-section control-section-card rounded p-3 mt-3">
			<div className="d-flex justify-content-between align-items-center mb-2">
				<h6 className="section-card-title mb-0">Custom Controllers</h6>
				<Badge bg="secondary" className="fw-normal">
					{filteredControllers.length}
				</Badge>
			</div>

			<div className="d-flex flex-column gap-2">
				{filteredControllers.map((ctrl) => {
					const isOpen = Boolean(openState[ctrl.id])
					return (
						<SingleCustomControllerCard
							key={ctrl.id}
							controller={ctrl}
							isOpen={isOpen}
							onToggle={() => toggleController(ctrl.id)}
							rendererRef={rendererRef}
							data={data}
							onDataChange={onDataChange}
							renderType={renderType}
							playTime={playTime}
							setPlayTime={setPlayTime}
							schedule={schedule}
							setActionsSchedule={setActionsSchedule}
							reloadKey={reloadKey}
						/>
					)
				})}
			</div>
		</div>
	)
}

function SingleCustomControllerCard({
	controller,
	isOpen,
	onToggle,
	rendererRef,
	data,
	onDataChange,
	renderType,
	playTime,
	setPlayTime,
	schedule,
	setActionsSchedule,
	reloadKey,
}) {
	const containerRef = React.useRef(null)
	const [error, setError] = React.useState(null)
	const mountedElementRef = React.useRef(null)
	const dataRef = React.useRef(data)
	dataRef.current = data

	// Helper to unwrap LayerHandler's { value: ... } return wrapper
	const unwrap = (res) => (res && typeof res === 'object' && 'value' in res ? res.value : res)

	// Mount and load the custom element when expanded
	React.useEffect(() => {
		if (!isOpen || !containerRef.current) {
			return
		}

		let element = null
		let isDisposed = false
		setError(null)

		try {
			const tagName = getOrDefineCustomElement(controller.componentClass, controller.id)
			element = document.createElement(tagName)
			element.setAttribute('data-ograf-controller', controller.id)
			element.style.display = 'block'
			element.style.width = '100%'

			// Initialize 'value' attribute before load
			const initialSerialized =
				typeof dataRef.current === 'string' ? dataRef.current : JSON.stringify(dataRef.current || {})
			element.setAttribute('value', initialSerialized)
			try {
				element.value = dataRef.current || {}
			} catch (_) {}

			// Listen for 'change' events emitted by the custom controller when it modifies data
			const handleChange = (event) => {
				const detail = event?.detail
				let newValue
				if (detail && typeof detail === 'object' && 'value' in detail) {
					newValue = detail.value
				} else if (detail !== undefined && detail !== null) {
					newValue = detail
				} else {
					newValue = element.value
				}
				if (typeof newValue === 'string') {
					try {
						newValue = JSON.parse(newValue)
					} catch (_) {}
				}
				if (newValue && typeof newValue === 'object' && onDataChange) {
					onDataChange(newValue)
				}
			}
			element.addEventListener('change', handleChange)

			containerRef.current.innerHTML = ''
			containerRef.current.appendChild(element)
			mountedElementRef.current = element

			// Track event listeners registered by this controller on Renderer
			const registeredListeners = []
			const addListener = (eventType, listener) => {
				registeredListeners.push({ eventType, listener })
				rendererRef.current?.on(eventType, listener)
			}
			const removeListener = (eventType, listener) => {
				rendererRef.current?.off(eventType, listener)
			}

			// Build ograf bridge interface
			const ograf = {
				playAction: async (params = {}) => {
					const res = await rendererRef.current?.playAction(params)
					return unwrap(res)
				},
				stopAction: async (params = {}) => {
					const res = await rendererRef.current?.stopAction(params)
					return unwrap(res)
				},
				updateAction: async (params = {}) => {
					if (params && params.data && onDataChange) {
						onDataChange(params.data)
					}
					const res = await rendererRef.current?.updateAction(params)
					return unwrap(res)
				},
				customAction: async (arg1, arg2) => {
					let actionId
					let payload
					if (typeof arg1 === 'object' && arg1 !== null && 'id' in arg1) {
						actionId = arg1.id
						payload = arg1.payload
					} else {
						actionId = arg1
						payload = arg2
					}
					const res = await rendererRef.current?.customAction(actionId, payload)
					return unwrap(res)
				},
				goToTime: async (arg) => {
					const timestamp =
						typeof arg === 'object' && arg !== null && 'timestamp' in arg ? arg.timestamp : Number(arg)
					const res = await rendererRef.current?.gotoTime(timestamp)
					if (setPlayTime) {
						setPlayTime(timestamp)
					}
					return unwrap(res)
				},
				setActionsSchedule: async (arg) => {
					const scheduleArray = Array.isArray(arg) ? arg : arg?.schedule || []
					const res = await rendererRef.current?.setActionsSchedule(scheduleArray)
					if (setActionsSchedule) {
						setActionsSchedule(scheduleArray)
					}
					return unwrap(res)
				},
				on: addListener,
				off: removeListener,
				addListener,
				removeListener,
				addEventListener: addListener,
				removeEventListener: removeListener,
			}

			// Invoke load() on custom element
			if (typeof element.load === 'function') {
				Promise.resolve(
					element.load({
						ograf,
						data: dataRef.current || {},
						renderType,
					})
				).catch((err) => {
					if (!isDisposed) {
						console.error(`Error loading custom controller ${controller.name}:`, err)
						setError(err.message || String(err))
						issueTracker.addError(`Custom controller [${controller.name}] load error: ${err.message || err}`)
					}
				})
			}

			return () => {
				isDisposed = true
				element.removeEventListener('change', handleChange)
				for (const { eventType, listener } of registeredListeners) {
					rendererRef.current?.off(eventType, listener)
				}
				if (element) {
					try {
						if (typeof element.dispose === 'function') {
							element.dispose().catch((err) => {
								console.error(`Error disposing custom controller ${controller.name}:`, err)
							})
						}
					} catch (e) {
						console.error(`Error disposing custom controller ${controller.name}:`, e)
					}
					if (containerRef.current && containerRef.current.contains(element)) {
						containerRef.current.removeChild(element)
					}
				}
				mountedElementRef.current = null
			}
		} catch (err) {
			console.error(`Failed to instantiate custom controller ${controller.name}:`, err)
			setError(err.message || String(err))
			issueTracker.addError(`Failed to instantiate custom controller [${controller.name}]: ${err.message || err}`)
		}
	}, [isOpen, controller, renderType, rendererRef, onDataChange, setPlayTime, setActionsSchedule, reloadKey])

	// When data changes in parent, update the element's 'value' attribute and notify onUpdatedData
	React.useEffect(() => {
		const element = mountedElementRef.current
		if (isOpen && element) {
			const serialized = typeof data === 'string' ? data : JSON.stringify(data || {})
			if (element.getAttribute('value') !== serialized) {
				element.setAttribute('value', serialized)
			}
			try {
				if (JSON.stringify(element.value) !== JSON.stringify(data)) {
					element.value = data
				}
			} catch (_) {}

			if (typeof element.onUpdatedData === 'function') {
				try {
					element.onUpdatedData({ data }).catch((err) => {
						console.error(`Error in ${controller.name}.onUpdatedData():`, err)
					})
				} catch (err) {
					console.error(`Error invoking ${controller.name}.onUpdatedData():`, err)
				}
			}
		}
	}, [isOpen, data, controller.name])

	return (
		<Card className="custom-controller-card border">
			<Card.Header
				className="d-flex align-items-center justify-content-between p-2"
				style={{ cursor: 'pointer', userSelect: 'none' }}
				onClick={onToggle}
			>
				<div className="d-flex flex-column text-truncate me-2">
					<div className="fw-semibold text-truncate">{controller.name}</div>
					{controller.description && (
						<div className="text-muted small text-truncate" title={controller.description}>
							{controller.description}
						</div>
					)}
				</div>
				<Button
					variant="outline-secondary"
					size="sm"
					className="py-0 px-2 border-0"
					onClick={(e) => {
						e.stopPropagation()
						onToggle()
					}}
					aria-label={isOpen ? 'Collapse controller' : 'Expand controller'}
				>
					{isOpen ? '▲' : '▼'}
				</Button>
			</Card.Header>

			{isOpen && (
				<Card.Body className="p-2">
					{error && (
						<Alert variant="danger" className="py-1 px-2 mb-2 small">
							<strong>Controller Error:</strong> {error}
						</Alert>
					)}
					<div ref={containerRef} className="custom-controller-dom-container" />
				</Card.Body>
			)}
		</Card>
	)
}
