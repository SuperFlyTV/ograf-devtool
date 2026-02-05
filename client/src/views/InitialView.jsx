import * as React from 'react'
import { Button } from 'react-bootstrap'
import { fileHandler } from '../FileHandler'
import superFlyLogoUrl from '../assets/SuperFly.tv_Logo_2020_v02.png'
import ografLogoUrl from '../assets/ograf_logo_colour_draft.svg'
import { serviceWorkerHandler } from '../ServiceWorkerHandler'

export function InitialView({ onGraphicsFolder }) {
	const [isDragging, setIsDragging] = React.useState(false)
	const [error, setError] = React.useState(null)

	const handleFolderSelect = React.useCallback(
		async (dirHandle) => {
			try {
				fileHandler.dirHandle = dirHandle
				onGraphicsFolder({
					graphicsList: await fileHandler.listGraphics(),
					graphicsFolderName: fileHandler.dirHandle.name,
				})
			} catch (err) {
				console.error(err)
				setError(err.message)
			}
		},
		[onGraphicsFolder]
	)

	const handleDragOver = React.useCallback((e) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}, [])

	const handleDragEnter = React.useCallback((e) => {
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
		async (e) => {
			e.preventDefault()
			e.stopPropagation()
			setIsDragging(false)
			setError(null)

			try {
				// Get the first item from the drop
				const items = e.dataTransfer.items
				if (items && items.length > 0) {
					const item = items[0]

					// Check if the browser supports getAsFileSystemHandle
					if (item.getAsFileSystemHandle) {
						const handle = await item.getAsFileSystemHandle()
						if (handle.kind === 'directory') {
							await handleFolderSelect(handle)
						} else {
							setError('Please drop a folder, not a file')
						}
					} else {
						setError('Drag and drop folders is not supported in this browser. Please use the button instead.')
					}
				}
			} catch (err) {
				console.error(err)
				setError(err.message || 'Failed to process dropped folder')
			}
		},
		[handleFolderSelect]
	)

	return (
		<div
			className={`initial-hero ${isDragging ? 'dragging' : ''}`}
			onDragOver={handleDragOver}
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
		>
			<div className="initial-hero-content">
				<div>
					<h1>
						<img src={ografLogoUrl} alt="Ograf" height="50" />
						<br />
						OGraf DevTool
					</h1>
				</div>
				<div>
					<p>
						This is a tool to help with developing <b>OGraf Graphics</b>.
					</p>
					<p>It has a control GUI that renders the OGraf Graphics directly from your local hard drive.</p>

					<p>
						<i>
							If you haven't already got any Ograf Graphics locally,
							<br /> you can download some examples&nbsp;
							<a
								href={`https://download-directory.github.io/?url=${encodeURIComponent(
									'https://github.com/ebu/ograf/tree/main/v1/examples'
								)}`}
								target="_blank"
							>
								here
							</a>
							!
						</i>
					</p>

					<p>
						Start the DevTool by selecting a folder that contains Ograf Graphics in any of its subfolders.
					</p>
					<p>
						<strong>Drag and drop a folder here</strong> or click the button below:
					</p>
					{error && (
						<div className="alert alert-danger" role="alert">
							{error}
						</div>
					)}
					<p>
						<Button
							onClick={() => {
								setError(null)
								fileHandler
									.init()
									.then(async () => {
										await handleFolderSelect(fileHandler.dirHandle)
									})
									.catch((err) => {
										console.error(err)
										setError(err.message)
									})
							}}
						>
							Select local folder
						</Button>
					</p>
					<p>
						Developed with ❤️ <br /> by{' '}
						<a href="https://SuperFly.tv">
							<img src={superFlyLogoUrl} alt="SuperFly.tv" height="50" />
						</a>
					</p>

					<p>
						Source code for this app can be found at
						<br />
						<a href="https://github.com/SuperFlyTV/ograf-devtool" target="_blank">
							https://github.com/SuperFlyTV/ograf-devtool
						</a>
					</p>
					<div>
						<TroubleShoot />
					</div>
				</div>
			</div>
		</div>
	)
}
export function TroubleShoot() {
	const [message, setMessage] = React.useState('')
	return (
		<>
			If you have issues, try to do a full reload by following these steps:
			<div>
				<div>
					<b>Step 1:</b>
					<Button
						size="sm"
						variant="secondary"
						onClick={() => {
							serviceWorkerHandler.broadcastToSW.postMessage({
								type: 'unregister',
							})

							navigator.serviceWorker.getRegistrations().then(async (registrations) => {
								for (const sw of registrations) {
									await sw.unregister()
								}
								localStorage.clear()
								setMessage('Service Worker unregistered. Please do a hard reload now.')
							})
						}}
					>
						Click here to clear some cached data.
					</Button>
				</div>
				{message ? <div className="alert alert-success">{message}</div> : null}

				<div>
					<b>Step 2:</b> To a "Hard Reload" by right-clicking on the <br />
					reload button in your browser and selecting "Hard reload"
				</div>
			</div>
		</>
	)
}
