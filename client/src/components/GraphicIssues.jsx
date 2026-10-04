import * as React from 'react'
import {
	setupSchemaValidator,
	validateGraphicModule,
	testGraphicModule,
	testGraphicManifestFileNames,
} from '../lib/graphic/verify.js'
import { usePromise } from '../lib/lib.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'
import { Button } from 'react-bootstrap'

export function GraphicIssues({ manifest, graphic }) {
	const [graphicManifestErrors, setGraphicManifestErrors] = React.useState([])
	const [graphicModuleErrors, setGraphicModuleErrors] = React.useState([])
	const [graphicModuleTestErrorLog, setGraphicModuleTestErrorLog] = React.useState(null)

	const graphicManifestFileErrors = testGraphicManifestFileNames(graphic)

	React.useEffect(() => {
		const graphicPath = ResourceProvider.graphicPath(graphic.folderPath, manifest?.main)

		ResourceProvider.loadGraphic(graphicPath)
			.then((elementName) => {
				// Add element to DOM:
				const element = document.createElement(elementName)

				// console.log('element', element)
				if (manifest) {
					setGraphicModuleErrors(validateGraphicModule(element, manifest))
				} else {
					setGraphicModuleErrors([])
				}
			})
			.catch((e) => {
				console.error(e)
				setGraphicModuleErrors([`Error loading graphic: ${e.message || e}`])
			})
	}, [graphic.path, manifest])

	const validator = usePromise(async () => {
		return setupSchemaValidator()
	}, [])

	const runGraphicTest = React.useCallback(() => {
		testGraphicModule(graphic, manifest, (testLog, status) => {
			setGraphicModuleTestErrorLog({ testLog, status })
		})
	}, [graphic, manifest])

	React.useEffect(() => {
		let isCancelled = false
		if (!validator) {
			setGraphicManifestErrors(['Loading schema validator...'])
			return
		}
		if (!manifest) {
			setGraphicManifestErrors(['No manifest loaded'])
			return
		}
		if (validator.error) {
			setGraphicManifestErrors([`Validator Error: ${validator.error}`])
			return
		}

		Promise.resolve(validator.value(manifest, graphic))
			.then((errors) => {
				if (isCancelled) return
				setGraphicManifestErrors((prevValue) => {
					if (JSON.stringify(prevValue) !== JSON.stringify(errors)) {
						return errors
					} else {
						return prevValue
					}
				})
			})
			.catch((err) => {
				if (isCancelled) return
				setGraphicManifestErrors([`Validator Error: ${err.message || err}`])
			})

		return () => {
			isCancelled = true
		}
	}, [manifest, validator, graphic])

	if (!validator) {
		return <div className="text-muted small p-2">Loading schema validator...</div>
	}

	return (
		<div className="graphic-issues-container">
			{graphicManifestErrors.length || graphicManifestFileErrors.length ? (
				<div className="alert alert-danger p-2 small mb-2">
					<strong className="text-danger-emphasis">Found issues in the Graphics manifest:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{graphicManifestFileErrors.map((str, i) => (
							<li key={i}>{linebreaks(str)}</li>
						))}
						{graphicManifestErrors.map((str, i) => (
							<li key={i}>{linebreaks(str)}</li>
						))}
					</ul>
				</div>
			) : null}
			{graphicModuleErrors.length ? (
				<div className="alert alert-danger p-2 small mb-2">
					<strong className="text-danger-emphasis">Found issues with the Graphic module:</strong>
					<ul className="mb-0 mt-1 ps-3">
						{graphicModuleErrors.map((str, i) => (
							<li key={i}>{linebreaks(str)}</li>
						))}
					</ul>
				</div>
			) : null}

			{graphicManifestErrors.length === 0 && graphicModuleErrors.length === 0 ? (
				<div className="alert alert-success d-flex align-items-center justify-content-between flex-wrap gap-2 p-2 small mb-2">
					<span className="fw-medium">✓ No issues found in manifest or code</span>
					<Button variant="outline-light" size="sm" className="btn-test-indepth" onClick={() => runGraphicTest()}>
						Run in-depth test
					</Button>
				</div>
			) : null}

			{graphicModuleTestErrorLog ? (
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
							{graphicModuleTestErrorLog.status === true
								? '✅ In-Depth Test Passed'
								: graphicModuleTestErrorLog.status === false
								? '❌ In-Depth Test Failed'
								: 'ℹ️ Test In Progress'}
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
			) : null}
		</div>
	)
}
function linebreaks(str) {
	return str.split('\n').map((line, i) => {
		return (
			<span key={i}>
				{line}
				<br />
			</span>
		)
	})
}
