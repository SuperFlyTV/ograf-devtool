import React from 'react'
import { getDefaultDataFromSchema, validateGDDSchema } from 'ograf-form'
// import { validateSchema } from './gdd/schema-validate'

export const OGrafForm = (props) => {
	let schema
	let errorString = ''
	try {
		if (typeof props.schema === 'string') schema = JSON.parse(props.schema)
		else schema = props.schema
	} catch (err) {
		schema = {}
		console.error(err)
		errorString = `There was an error parsing the schema: ${err}`
	}

	/** Ref to the form component */
	const formRef = React.useRef()
	/** State to hold the data */
	const [data, setData] = React.useState(() =>
		// Use default data from schema as initial data:
		props.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {}
	)

	const prevPropsDataJsonRef = React.useRef(JSON.stringify(props.data))

	// Sync internal data state if props.data changes externally
	React.useEffect(() => {
		const json = JSON.stringify(props.data)
		if (prevPropsDataJsonRef.current !== json) {
			prevPropsDataJsonRef.current = json
			setData(props.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {})
		}
	}, [props.data, schema])

	/** Callback when the data changes */
	const onDataChange = React.useCallback(
		(newData) => {
			prevPropsDataJsonRef.current = JSON.stringify(newData)
			setData(newData)
			props.setData(newData)
		},
		[props]
	)

	// Set up listener for when the data has changed in the form:
	React.useLayoutEffect(() => {
		if (formRef.current) {
			const listener = (e) => {
				onDataChange(e.detail.value)
			}
			formRef.current.addEventListener('change', listener)
			return () => formRef.current.removeEventListener('change', listener)
		}
	})
	// (Optional) Set up listener for whenever user is editing (ie every key)
	// React.useLayoutEffect(() => {
	//   if (formRef.current) {
	//     const listener = (e) => onDataChange(e.target.value);
	//     formRef.current.addEventListener("keyup", listener);
	//     return () => formRef.current.removeEventListener("keyup", listener);
	//   }
	// });

	if (errorString) return <div>{errorString}</div>

	try {
		validateGDDSchema(schema)
	} catch (err) {
		console.error(err)
		return `${err}`
	}

	return (
		<div>
			<superflytv-ograf-form
				ref={formRef}
				schema={JSON.stringify(schema)}
				value={JSON.stringify(data)}
			></superflytv-ograf-form>
		</div>
	)
}
