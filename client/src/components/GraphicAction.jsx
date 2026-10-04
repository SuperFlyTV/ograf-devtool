import * as React from 'react'
import { Button } from 'react-bootstrap'
import { OGrafForm } from '../lib/GDD/ograf-form.jsx'
import { getDefaultDataFromSchema } from 'ograf-form'

export function GraphicAction({ action, onAction }) {
	const initialData = action.schema ? getDefaultDataFromSchema(action.schema) : {}
	const schema = action.schema

	const [data, setData] = React.useState(initialData)

	const onDataSave = (d) => {
		setData(JSON.parse(JSON.stringify(d)))
	}

	const hasSchema = Boolean(
		schema &&
			typeof schema === 'object' &&
			((schema.properties && Object.keys(schema.properties).length > 0) ||
				(schema.fields && Object.keys(schema.fields).length > 0) ||
				(Array.isArray(schema.items) && schema.items.length > 0))
	)

	if (!hasSchema) {
		return (
			<Button
				variant="outline-info"
				size="sm"
				className="graphic-custom-action-btn fw-semibold"
				onClick={(e) => {
					onAction(action.id, data, e)
				}}
				title={action.description || action.name || action.id}
			>
				{action.name ?? action.id}
			</Button>
		)
	}

	return (
		<div className="graphics-action-card p-3 rounded mb-2">
			<div className="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary-subtle">
				<span className="fw-semibold text-light fs-7">{action.name ?? action.id}</span>
			</div>
			<div className="graphics-manifest-schema mb-2">
				<OGrafForm schema={schema} data={data} setData={onDataSave} />
			</div>
			<Button
				variant="primary"
				size="sm"
				className="w-100 fw-semibold"
				onClick={(e) => {
					onAction(action.id, data, e)
				}}
			>
				{action.name ?? action.id}
			</Button>
		</div>
	)
}
