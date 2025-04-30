import * as React from 'react'
import { setupSchemaValidator, validateGraphicModule, testGraphicModule } from '../lib/graphic/verify.js'
import { usePromise } from '../lib/lib.js'
import { ResourceProvider } from '../renderer/ResourceProvider.js'
import { Button } from 'react-bootstrap'

export function GraphicIssues({ manifest, graphic }) {
	const [graphicManifestErrors, setGraphicManifestErrors] = React.useState([])
	const [graphicModuleErrors, setGraphicModuleErrors] = React.useState([])
	const [graphicModuleTestErrorLog, setGraphicModuleTestErrorLog] = React.useState(null)

	// console.log('graphic', graphic)

	React.useEffect(() => {
		const graphicPath = ResourceProvider.graphicPath(graphic.path, manifest?.main)

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
		const errors = validator.value(manifest)

		setGraphicManifestErrors((prevValue) => {
			if (JSON.stringify(prevValue) !== JSON.stringify(errors)) {
				return errors
			} else {
				return prevValue
			}
		})
	}, [manifest, validator])

	if (!validator) {
		return <div>Loading schema validator...</div>
	}

	return (
		<>
			{graphicManifestErrors.length ? (
				<div className="alert alert-danger">
					<div>Found issues in the Graphics manifest:</div>
					<div>
						<ul>
							{graphicManifestErrors.map((str, i) => {
								return <li key={i}>{str}</li>
							})}
						</ul>
					</div>
				</div>
			) : null}
			{graphicModuleErrors.length ? (
				<div className="alert alert-danger">
					<div>Found issues with the Graphic module:</div>
					<div>
						<ul>
							{graphicModuleErrors.map((str, i) => {
								return <li key={i}>{str}</li>
							})}
						</ul>
					</div>
				</div>
			) : null}

			{graphicManifestErrors.length === 0 && graphicModuleErrors.length === 0 ? (
				<>
					<span>No issues found in the graphic manifest or code 👍</span>
					<div>
						<Button variant="outline-secondary" size="sm" onClick={() => runGraphicTest()}>
							Run in-depth test
						</Button>
					</div>
				</>
			) : null}

			{graphicModuleTestErrorLog ? (
				<div
					className={`alert ${
						graphicModuleTestErrorLog.status === true
							? 'alert-success'
							: graphicModuleTestErrorLog.status === false
							? 'alert-danger'
							: 'alert-info'
					}`}
				>
					<div>Test results:</div>
					<div>
						<pre>{graphicModuleTestErrorLog.testLog}</pre>
					</div>
				</div>
			) : null}
		</>
	)
}
