import * as React from 'react'
import {
	setupSchemaValidator,
	validateGraphicModule,
	testGraphicModule,
	testGraphicManifestFileNames,
	normalizeIssue,
} from '../lib/graphic/verify.js'
import { applyAutoFix } from '../lib/graphic/autoFix.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'
import { Button } from 'react-bootstrap'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBolt, faCheck, faCircleCheck, faCircleXmark, faCircleInfo } from '@fortawesome/free-solid-svg-icons'
import { usePromise } from '../lib/lib.js'

export function GraphicIssues({ manifest, graphic, onIssuesChanged }) {
	const [manifestIssues, setManifestIssues] = React.useState([])
	const [graphicModuleErrors, setGraphicModuleErrors] = React.useState([])
	const [graphicModuleTestErrorLog, setGraphicModuleTestErrorLog] = React.useState(null)
	const [fixingIssueId, setFixingIssueId] = React.useState(null)
	const [fixMessage, setFixMessage] = React.useState(null)

	const graphicManifestFileErrors = React.useMemo(() => {
		return (testGraphicManifestFileNames(graphic) || []).map((i) => normalizeIssue(i, 'error'))
	}, [graphic?.path])

	React.useEffect(() => {
		const graphicPath = ResourceProvider.graphicPath(graphic?.folderPath, manifest?.main)

		ResourceProvider.loadGraphic(graphicPath)
			.then((elementName) => {
				const element = document.createElement(elementName)
				if (manifest) {
					const modIssues = (validateGraphicModule(element, manifest) || []).map((i) => normalizeIssue(i, 'error'))
					setGraphicModuleErrors(modIssues)
				} else {
					setGraphicModuleErrors([])
				}
			})
			.catch((e) => {
				console.error(e)
				setGraphicModuleErrors([normalizeIssue(`Error loading graphic: ${e.message || e}`, 'error')])
			})
	}, [graphic?.path, manifest])

	const validator = usePromise(async () => {
		return setupSchemaValidator()
	}, [])

	const runGraphicTest = React.useCallback(() => {
		testGraphicModule(graphic, manifest, (testLog, status) => {
			setGraphicModuleTestErrorLog({ testLog, status })
		})
	}, [graphic, manifest])

	const runValidation = React.useCallback(async () => {
		if (!validator?.value || !manifest) return
		try {
			const result = await validator.value(manifest, graphic)
			const normalized = (result || []).map((i) => normalizeIssue(i, 'error'))
			setManifestIssues(normalized)
			if (onIssuesChanged) {
				onIssuesChanged(normalized)
			}
		} catch (err) {
			setManifestIssues([normalizeIssue(`Validator Error: ${err.message || err}`, 'error')])
		}
	}, [validator, manifest, graphic, onIssuesChanged])

	React.useEffect(() => {
		let isCancelled = false
		if (!validator) {
			setManifestIssues([normalizeIssue('Loading schema validator...', 'info')])
			return
		}
		if (!manifest) {
			setManifestIssues([normalizeIssue('No manifest loaded', 'error')])
			return
		}
		if (validator.error) {
			setManifestIssues([normalizeIssue(`Validator Error: ${validator.error}`, 'error')])
			return
		}

		Promise.resolve(validator.value(manifest, graphic))
			.then((issues) => {
				if (isCancelled) return
				const normalized = (issues || []).map((i) => normalizeIssue(i, 'error'))
				setManifestIssues(normalized)
			})
			.catch((err) => {
				if (isCancelled) return
				setManifestIssues([normalizeIssue(`Validator Error: ${err.message || err}`, 'error')])
			})

		return () => {
			isCancelled = true
		}
	}, [manifest, validator, graphic])

	const allManifestIssues = [...graphicManifestFileErrors, ...manifestIssues]
	const manifestErrors = allManifestIssues.filter((i) => i.severity === 'error')
	const manifestWarnings = allManifestIssues.filter((i) => i.severity === 'warning')
	const manifestInfos = allManifestIssues.filter((i) => i.severity === 'info')

	const moduleErrors = graphicModuleErrors.filter((i) => i.severity === 'error')
	const moduleWarnings = graphicModuleErrors.filter((i) => i.severity === 'warning')

	const hasErrors = manifestErrors.length > 0 || moduleErrors.length > 0
	const hasWarnings = manifestWarnings.length > 0 || moduleWarnings.length > 0
	const hasInfos = manifestInfos.length > 0

	const allIssuesList = [...allManifestIssues, ...graphicModuleErrors]
	const fixableIssues = allIssuesList.filter((i) => i.fixable)

	const handleApplyFix = React.useCallback(
		async (issue) => {
			const key = issue.fixId || issue.id || issue.message
			setFixingIssueId(key)
			setFixMessage(null)
			try {
				const success = await applyAutoFix(graphic, issue)
				if (success) {
					setFixMessage({ type: 'success', text: `Successfully applied fix: ${issue.fixLabel || 'Fix'}` })
					await runValidation()
				} else {
					setFixMessage({ type: 'warning', text: 'Could not automatically apply this fix.' })
				}
			} catch (err) {
				console.error('Error applying auto-fix:', err)
				setFixMessage({ type: 'danger', text: `Auto-fix failed: ${err.message || err}` })
			} finally {
				setFixingIssueId(null)
			}
		},
		[graphic, runValidation]
	)

	const handleFixAll = React.useCallback(async () => {
		setFixingIssueId('ALL')
		setFixMessage(null)
		let applied = 0
		try {
			for (const issue of fixableIssues) {
				const success = await applyAutoFix(graphic, issue)
				if (success) applied++
			}
			if (applied > 0) {
				setFixMessage({ type: 'success', text: `Successfully applied ${applied} auto-fix(es)!` })
				await runValidation()
			} else {
				setFixMessage({ type: 'warning', text: 'No fixes could be automatically applied.' })
			}
		} catch (err) {
			console.error('Error applying all auto-fixes:', err)
			setFixMessage({ type: 'danger', text: `Auto-fix all failed: ${err.message || err}` })
		} finally {
			setFixingIssueId(null)
		}
	}, [fixableIssues, graphic, runValidation])

	if (!validator) {
		return <div className="text-muted small p-2">Loading schema validator...</div>
	}

	return (
		<div className="graphic-issues-container">
			{fixMessage && (
				<div
					className={`alert alert-${fixMessage.type} p-2 small mb-2 d-flex align-items-center justify-content-between`}
				>
					<span>{fixMessage.text}</span>
					<button
						type="button"
						className="btn-close btn-close-sm"
						onClick={() => setFixMessage(null)}
						aria-label="Close"
					/>
				</div>
			)}

			{/* Single Graphic "Fix All" Header Button */}
			{fixableIssues.length > 1 && (
				<div className="d-flex align-items-center justify-content-between p-2 mb-2 rounded bg-primary-subtle border border-primary-subtle flex-wrap gap-2">
					<span className="small text-primary-emphasis fw-semibold">
						<FontAwesomeIcon icon={faBolt} className="me-1" />
						{fixableIssues.length} issues can be automatically fixed
					</span>
					<Button
						variant="primary"
						size="sm"
						className="py-0 px-2 fs-8 fw-semibold"
						disabled={fixingIssueId !== null}
						onClick={handleFixAll}
					>
						{fixingIssueId === 'ALL' ? (
							'Fixing All…'
						) : (
							<>
								<FontAwesomeIcon icon={faBolt} className="me-1" />
								Fix All ({fixableIssues.length})
							</>
						)}
					</Button>
				</div>
			)}

			{/* Manifest Errors */}
			{manifestErrors.length > 0 && (
				<div className="alert alert-danger p-2 small mb-2">
					<strong className="text-danger-emphasis">Errors in Graphics manifest:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{manifestErrors.map((issue, i) => (
							<li key={i} className="mb-1 d-flex align-items-start justify-content-between gap-2">
								<span>{linebreaks(issue.message)}</span>
								{issue.fixable && (
									<Button
										variant="outline-danger"
										size="sm"
										className="py-0 px-2 fs-8 flex-shrink-0"
										disabled={fixingIssueId === (issue.fixId || issue.id || issue.message) || fixingIssueId === 'ALL'}
										onClick={() => handleApplyFix(issue)}
										title={issue.fixLabel || 'Auto-fix'}
									>
										{fixingIssueId === (issue.fixId || issue.id || issue.message) ? (
											'Fixing…'
										) : (
											<>
												<FontAwesomeIcon icon={faBolt} className="me-1" />
												{issue.fixLabel || 'Fix'}
											</>
										)}
									</Button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Module Errors */}
			{moduleErrors.length > 0 && (
				<div className="alert alert-danger p-2 small mb-2">
					<strong className="text-danger-emphasis">Issues with Graphic module:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{moduleErrors.map((issue, i) => (
							<li key={i} className="mb-1">
								{linebreaks(issue.message)}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Manifest / Module Warnings */}
			{(manifestWarnings.length > 0 || moduleWarnings.length > 0) && (
				<div className="alert alert-warning p-2 small mb-2">
					<strong className="text-warning-emphasis">Warnings:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{[...manifestWarnings, ...moduleWarnings].map((issue, i) => (
							<li key={i} className="mb-1 d-flex align-items-start justify-content-between gap-2">
								<span>{linebreaks(issue.message)}</span>
								{issue.fixable && (
									<Button
										variant="outline-warning"
										size="sm"
										className="py-0 px-2 fs-8 flex-shrink-0"
										disabled={fixingIssueId === (issue.fixId || issue.id || issue.message) || fixingIssueId === 'ALL'}
										onClick={() => handleApplyFix(issue)}
										title={issue.fixLabel || 'Auto-fix'}
									>
										{fixingIssueId === (issue.fixId || issue.id || issue.message) ? (
											'Fixing…'
										) : (
											<>
												<FontAwesomeIcon icon={faBolt} className="me-1" />
												{issue.fixLabel || 'Fix'}
											</>
										)}
									</Button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Manifest Info Notices */}
			{manifestInfos.length > 0 && (
				<div className="alert alert-info p-2 small mb-2">
					<strong className="text-info-emphasis">Notices & Best Practices:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{manifestInfos.map((issue, i) => (
							<li key={i} className="mb-1 d-flex align-items-start justify-content-between gap-2">
								<span>{linebreaks(issue.message)}</span>
								{issue.fixable && (
									<Button
										variant="outline-info"
										size="sm"
										className="py-0 px-2 fs-8 flex-shrink-0"
										disabled={fixingIssueId === (issue.fixId || issue.id || issue.message) || fixingIssueId === 'ALL'}
										onClick={() => handleApplyFix(issue)}
										title={issue.fixLabel || 'Auto-fix'}
									>
										{fixingIssueId === (issue.fixId || issue.id || issue.message) ? (
											'Fixing…'
										) : (
											<>
												<FontAwesomeIcon icon={faBolt} className="me-1" />
												{issue.fixLabel || 'Fix'}
											</>
										)}
									</Button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{/* No errors state */}
			{!hasErrors && !hasWarnings && (
				<div className="alert alert-success d-flex align-items-center justify-content-between flex-wrap gap-2 p-2 small mb-2">
					<span className="fw-medium">
						<FontAwesomeIcon icon={faCheck} className="me-1 text-success" />
						No errors found in manifest or code
					</span>
					<Button variant="outline-light" size="sm" className="btn-test-indepth" onClick={() => runGraphicTest()}>
						Run in-depth test
					</Button>
				</div>
			)}

			{/* In-depth test log output */}
			{graphicModuleTestErrorLog && (
				<div
					className={`in-depth-test-card rounded p-2 mt-2 ${
						graphicModuleTestErrorLog.status === true
							? 'border-success'
							: graphicModuleTestErrorLog.status === false
							? 'border-danger'
							: 'border-info'
					}`}
				>
					<div className="d-flex align-items-center justify-content-between mb-1 pb-1 border-bottom border-secondary-subtle">
						<span className="fw-bold fs-7">
							{graphicModuleTestErrorLog.status === true ? (
								<>
									<FontAwesomeIcon icon={faCircleCheck} className="text-success me-1" />
									In-Depth Test Passed
								</>
							) : graphicModuleTestErrorLog.status === false ? (
								<>
									<FontAwesomeIcon icon={faCircleXmark} className="text-danger me-1" />
									In-Depth Test Failed
								</>
							) : (
								<>
									<FontAwesomeIcon icon={faCircleInfo} className="text-info me-1" />
									Test In Progress
								</>
							)}
						</span>
						<Button
							variant="outline-secondary"
							size="sm"
							className="py-0 px-2 fs-8"
							onClick={() => setGraphicModuleTestErrorLog(null)}
						>
							Dismiss
						</Button>
					</div>
					<div className="in-depth-log-wrapper">
						<pre className="in-depth-log-content mb-0">{graphicModuleTestErrorLog.testLog}</pre>
					</div>
				</div>
			)}
		</div>
	)
}

function linebreaks(str) {
	if (typeof str !== 'string') return str
	return str.split('\n').map((line, i) => {
		return (
			<span key={i}>
				{line}
				<br />
			</span>
		)
	})
}
