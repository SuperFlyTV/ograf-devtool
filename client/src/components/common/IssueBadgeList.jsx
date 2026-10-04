import * as React from 'react'
import { Badge } from 'react-bootstrap'
import { GraphicIssues } from '../GraphicIssues.jsx'
import { setupSchemaValidator, testGraphicManifestFileNames, normalizeIssue } from '../../lib/graphic/verify.js'
import { usePromise } from '../../lib/lib.js'

export function getGraphicIssueCounts(graphic) {
	let errorCount = 0
	let warningCount = 0
	let infoCount = 0

	if (graphic.manifestParseError) {
		errorCount++
	}

	if (graphic.warnings && graphic.warnings.length > 0) {
		warningCount += graphic.warnings.length
	}

	if (graphic.manifestIssues && graphic.manifestIssues.length > 0) {
		for (const item of graphic.manifestIssues) {
			const issue = normalizeIssue(item, 'error')
			if (issue.severity === 'error') errorCount++
			else if (issue.severity === 'warning') warningCount++
			else if (issue.severity === 'info') infoCount++
		}
	} else if (graphic.manifestErrors && graphic.manifestErrors.length > 0) {
		errorCount += graphic.manifestErrors.length
	}

	// Filename error checks
	if (graphic.path && !graphic.path.endsWith('.ograf.json')) {
		errorCount++
	}

	return {
		errorCount,
		warningCount,
		infoCount,
		hasIssues: errorCount > 0 || warningCount > 0 || infoCount > 0,
	}
}

export function IssueBadgeList({
	graphic,
	forceExpanded,
	isExpanded: controlledIsExpanded,
	onToggleExpanded,
	hidePanel = false,
	onIssuesChanged,
	className = '',
}) {
	const [isLocallyExpanded, setIsLocallyExpanded] = React.useState(false)
	const [manifestIssues, setManifestIssues] = React.useState(graphic?.manifestIssues || [])

	const isExpanded =
		controlledIsExpanded !== undefined
			? controlledIsExpanded
			: forceExpanded !== undefined
			? forceExpanded
			: isLocallyExpanded

	const graphicManifestFileErrors = React.useMemo(() => {
		return (testGraphicManifestFileNames(graphic) || []).map((i) => normalizeIssue(i, 'error'))
	}, [graphic?.path])

	const validator = usePromise(async () => {
		return setupSchemaValidator()
	}, [])

	React.useEffect(() => {
		let isCancelled = false
		if (!validator?.value || !graphic?.manifest) {
			setManifestIssues([])
			return
		}

		Promise.resolve(validator.value(graphic.manifest, graphic))
			.then((issues) => {
				if (isCancelled) return
				const normalized = (issues || []).map((i) => normalizeIssue(i, 'error'))
				graphic.manifestIssues = normalized
				setManifestIssues(normalized)
				if (onIssuesChanged) {
					onIssuesChanged(normalized)
				}
			})
			.catch((_err) => {
				if (isCancelled) return
				const normalized = [normalizeIssue(`Validator error: ${_err.message || _err}`, 'error')]
				graphic.manifestIssues = normalized
				setManifestIssues(normalized)
				if (onIssuesChanged) {
					onIssuesChanged(normalized)
				}
			})

		return () => {
			isCancelled = true
		}
	}, [validator, graphic?.manifest, graphic, onIssuesChanged])

	const allIssues = [...graphicManifestFileErrors, ...manifestIssues]
	const errorCount =
		(graphic.manifestParseError ? 1 : 0) +
		allIssues.filter((i) => i.severity === 'error').length
	const warningCount =
		(graphic.warnings ? graphic.warnings.length : 0) +
		allIssues.filter((i) => i.severity === 'warning').length
	const infoCount = allIssues.filter((i) => i.severity === 'info').length

	const hasIssues = errorCount > 0 || warningCount > 0 || infoCount > 0

	const handleToggle = React.useCallback(
		(e) => {
			e.stopPropagation()
			if (onToggleExpanded) {
				onToggleExpanded(e)
			} else {
				setIsLocallyExpanded((prev) => !prev)
			}
		},
		[onToggleExpanded]
	)

	return (
		<div className={`issue-badge-list ${className}`}>
			<div className="issue-badge-row d-flex align-items-center gap-1 flex-wrap">
				{hasIssues ? (
					<>
						{errorCount > 0 && (
							<button
								type="button"
								className="badge-btn badge-btn-error"
								onClick={handleToggle}
								title="Click to view error details"
							>
								<span className="badge-icon">⛔</span>
								<span>
									{errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
								</span>
								<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
							</button>
						)}
						{warningCount > 0 && (
							<button
								type="button"
								className="badge-btn badge-btn-warning"
								onClick={handleToggle}
								title="Click to view warning details"
							>
								<span className="badge-icon">⚠️</span>
								<span>
									{warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
								</span>
								<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
							</button>
						)}
						{infoCount > 0 && errorCount === 0 && warningCount === 0 && (
							<button
								type="button"
								className="badge-btn badge-btn-info"
								onClick={handleToggle}
								title="Click to view notices"
							>
								<span className="badge-icon">ℹ️</span>
								<span>
									{infoCount} {infoCount === 1 ? 'Notice' : 'Notices'}
								</span>
								<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
							</button>
						)}
					</>
				) : (
					<button
						type="button"
						className="badge-btn badge-btn-valid"
						onClick={handleToggle}
						title="Click to view verification details or run in-depth test"
					>
						<span className="badge-icon">✓</span>
						<span>Valid</span>
						<span className="expand-indicator">{isExpanded ? '▲' : '▼'}</span>
					</button>
				)}
			</div>

			{!hidePanel && isExpanded && (
				<div className="issue-details-panel mt-2" onClick={(e) => e.stopPropagation()}>
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
						onIssuesChanged={(newIssues) => setManifestIssues(newIssues)}
					/>
				</div>
			)}
		</div>
	)
}
