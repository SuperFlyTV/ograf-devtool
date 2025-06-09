import * as React from 'react'
import { Table, Button } from 'react-bootstrap'
import { Link } from 'react-router'
import { GraphicIssues } from '../components/GraphicIssues'

export function ListGraphics({ graphicsList, onRefresh, onCloseFolder, graphicsFolderName }) {
	return (
		<div className="container-md">
			<div className="list-graphics card">
				<div>
					<h2>Local folder "{graphicsFolderName}"</h2>
					<Button
						onClick={() => {
							onRefresh()
						}}
					>
						Refresh list
					</Button>
					<Button
						onClick={() => {
							onCloseFolder()
						}}
					>
						Pick another folder
					</Button>
				</div>

				{graphicsList.length > 0 ? (
					<Table striped bordered>
						<thead>
							<tr>
								<th>Path</th>
								<th>Name</th>
								<th>ID</th>
								<th>Capabilities</th>
								<th>Issues</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{graphicsList.map((graphic, i) => {
								return (
									<tr key={graphic.path}>
										<td>{graphic.path}</td>
										<td>{graphic.manifest?.name}</td>
										<td>
											{graphic.manifest?.id}
											{graphic.manifest?.version ? ` (version ${graphic.manifest?.version})` : ''}
										</td>
										<td>
											<ul>
												{graphic.manifest?.supportsRealTime ? <li>🏃 Realtime rendering</li> : null}
												{graphic.manifest?.supportsNonRealTime ? <li>🧍 Non-Realtime rendering</li> : null}
											</ul>
										</td>
										<td>
											{graphic.manifestParseError ? (
												<div className="alert alert-danger">
													<div>Error parsing manifest.json:</div>
													<div>{graphic.manifestParseError.toString()}</div>
												</div>
											) : null}
											<GraphicIssues manifest={graphic.manifest} graphic={graphic} />
										</td>
										<td>
											<Link to={`graphic${graphic.path}`}>
												<Button>Select</Button>
											</Link>
										</td>
									</tr>
								)
							})}
						</tbody>
					</Table>
				) : (
					<div>
						<p>No graphics found in the selected folder (nor any of its subfolders).</p>
						<p>Please reload the page to try again.</p>
					</div>
				)}
			</div>
		</div>
	)
}
