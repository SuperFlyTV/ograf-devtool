import * as React from 'react'
import { Button } from 'react-bootstrap'
import { fileHandler } from '../FileHandler'
import superFlyLogoUrl from '../assets/SuperFly.tv_Logo_2020_v02.png'
import ografLogoUrl from '../assets/ograf_logo_colour_draft.svg'

export function InitialView({ setGraphicsList }) {
	return (
		<div className="initial-hero">
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
					<p>It has a control GUI and renders the OGraf Graphics, directly from your local hard drive.</p>

					<p>
						<i>
							If you haven't already got any Ograf Graphics locally,
							<br /> you can download some examples&nbsp;
							<a
								href={`https://download-directory.github.io/?url=${encodeURIComponent(
									'https://github.com/ebu/ograf/tree/main/v1-draft-0/examples'
								)}`}
								target="_blank"
							>
								here
							</a>
							!
						</i>
					</p>

					<p>Start the DevTool by selecting a folder that contains Ograf Graphics in any of its subfolders.</p>
					<p>
						<Button
							onClick={() => {
								fileHandler
									.init()
									.then((graphics) => {
										console.log('graphics', graphics)
										setGraphicsList(graphics)
									})
									.catch(console.error)
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
