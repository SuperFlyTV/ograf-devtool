import * as React from 'react'
import { fileHandler } from './FileHandler'
import { serviceWorkerHandler } from './ServiceWorkerHandler.js'
import { InitialView, TroubleShoot } from './views/InitialView'
import { ListGraphics } from './views/ListGraphics'
import { GraphicTester } from './views/GraphicTester.jsx'

export function App() {
	const [graphics, setGraphics] = React.useState(false)
	const [selectedGraphic, setSelectedGraphic] = React.useState(null)

	const [serviceWorker, setServiceWorker] = React.useState(null)
	const [serviceWorkerError, setServiceWorkerError] = React.useState(null)

	// Initialize Service Worker:
	React.useEffect(() => {
		if (!serviceWorker) {
			serviceWorkerHandler
				.init(fileHandler)
				.then((sw) => {
					setServiceWorker(sw)
				})

				.catch((e) => {
					setServiceWorker(null)
					setServiceWorkerError(e)
					console.error(e)
				})
		}
	}, [serviceWorker])

	const onSelectGraphic = React.useCallback((graphic) => {
		setSelectedGraphic(graphic)
	}, [])
	const onRefreshGraphics = React.useCallback(() => {
		setGraphics(false)
		fileHandler.listGraphics().then(setGraphics).catch(console.error)
	}, [])

	React.useEffect(() => {
		const onLostAccessEvent = () => {
			// This is called if the fileHandler has lost access to the directory.
			setGraphics(false)
		}
		fileHandler.on('lostAccess', onLostAccessEvent)
		return () => {
			fileHandler.off('lostAccess', onLostAccessEvent)
		}
	}, [])

	if (!serviceWorker) {
		return (
			<div className="container">
				{serviceWorkerError ? (
					<div className="alert alert-danger">
						<p>There was an error Initializing the web page.</p>
						<p>Error details: {serviceWorkerError.message}</p>
						<p>Please try to reload the page, it might help fixing this issue.</p>
					</div>
				) : (
					<div className="alert alert-info">
						<span>Initializing, please wait..</span>
					</div>
				)}

				<div>
					<TroubleShoot />
				</div>
			</div>
		)
	}

	return (
		<>
			{selectedGraphic ? (
				<GraphicTester
					graphic={selectedGraphic}
					onExit={() => {
						setSelectedGraphic(null)
					}}
				/>
			) : graphics ? (
				<ListGraphics graphics={graphics} onSelect={onSelectGraphic} onRefresh={onRefreshGraphics} />
			) : (
				<InitialView setGraphics={setGraphics} />
			)}
		</>
	)
}
