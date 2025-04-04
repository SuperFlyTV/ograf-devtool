import * as React from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { fileHandler } from './FileHandler'
import { serviceWorkerHandler } from './ServiceWorkerHandler.js'
import { InitialView, TroubleShoot } from './views/InitialView'
import { ListGraphics } from './views/ListGraphics'
import { GraphicTester } from './views/GraphicTester.jsx'

export function App() {
	//  ----------- Initialize ServiceWorker -----------
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

	const [graphicsList, setGraphicsList] = React.useState(null)
	const [graphicsFolderName, setGraphicsFolderName] = React.useState(null)
	const onRefreshGraphics = React.useCallback(() => {
		setGraphicsList(false)
		fileHandler.listGraphics().then(setGraphicsList).catch(console.error)
	}, [])

	const [initialized, setInitialized] = React.useState(false)

	// Initializing Service Worker:
	if (!serviceWorker) {
		if (!navigator.serviceWorker) {
			return (
				<div className="container">
					<div className="alert alert-danger">
						<p>Sorry, this tool uses Service Workers to function, which are not supported in your browser.</p>
						<p>Please use a browser that supports Service Workers.</p>
					</div>
				</div>
			)
		}
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
						<span>Initializing Service Worker, please wait..</span>
						<p>
							<i>If this message doesn't disappear, please reload the page.</i>
						</p>
					</div>
				)}

				<div>
					<TroubleShoot />
				</div>
			</div>
		)
	}
	// Select Graphics folder:
	if (!graphicsList) {
		return (
			<>
				<InitialView
					onGraphicsFolder={({ graphicsList, graphicsFolderName }) => {
						setGraphicsList(graphicsList)
						setGraphicsFolderName(graphicsFolderName)
					}}
				/>
			</>
		)
	}

	return (
		<>
			<BrowserRouter>
				<Routes>
					<Route
						path="/"
						element={
							<ListGraphics
								graphicsList={graphicsList}
								onRefresh={onRefreshGraphics}
								graphicsFolderName={graphicsFolderName}
								onCloseFolder={() => {
									setGraphicsList(null)
									setGraphicsFolderName(null)
									fileHandler.close()
								}}
							/>
						}
					/>
					<Route path="/graphic/*" element={<GraphicTester graphicsList={graphicsList} />} />
				</Routes>
			</BrowserRouter>
		</>
	)
}
