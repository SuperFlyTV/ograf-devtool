import * as React from 'react'
import { Button } from 'react-bootstrap'
import { GDDGUI } from '../lib/GDD/gdd-gui.jsx'
import { getDefaultDataFromSchema } from '../lib/GDD/gdd/data.js'

export function GraphicAction({ action, onAction }) {
	const initialData = action.schema ? getDefaultDataFromSchema(action.schema) : {}
	const schema = action.schema

	const [data, setData] = React.useState(initialData)

	const onDataSave = (d) => {
		setData(JSON.parse(JSON.stringify(d)))
	}

	return (
		<div className="graphics-action card">
			<div className="card-header">
				<h5>{action.name ?? action.id}</h5>
			</div>
			<div className="card-body">
				<div>{schema && <GDDGUI schema={schema} data={data} setData={onDataSave} />}</div>
				<Button
					onClick={(e) => {
						onAction(action.id, data, e)
					}}
				>
					{action.name}
				</Button>
			</div>
		</div>
	)
}
