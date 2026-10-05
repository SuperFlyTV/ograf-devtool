import { pathJoin, graphicResourcePath } from '../lib/lib.js'

export class ResourceProvider {
	static graphicPath(basePath, graphicPath) {
		return pathJoin(basePath, graphicPath ?? 'graphic.mjs')
	}

	static async loadGraphic(graphicPath) {
		const result = await this.loadGraphicModule(graphicPath)
		return result.elementName
	}

	static async loadGraphicModule(graphicPath) {
		const componentId = 'graphic-component' + staticComponentId++

		const { defaultExport, customControllers } = await this.fetchModule(graphicPath, componentId)
		customElements.define(componentId, defaultExport)

		return {
			elementName: componentId,
			defaultExport,
			customControllers,
		}
	}

	static async fetchModule(graphicPath, componentId) {
		// Add a querystring, just to disable caching:
		const modulePath = graphicResourcePath(graphicPath) + `?componentId=${componentId}` // `${this.serverApiUrl}/serverApi/v1/graphics/graphic/${id}/${version}/graphic`

		// Load the Graphic module:
		const module = await import(/* @vite-ignore */ modulePath)

		if (!module.default) {
			console.log('module', module)

			const exportKeys = Object.keys(module)

			if (exportKeys.length) {
				throw new Error(
					`The Graphic is expected to export a class as a default export. ${
						exportKeys.length === 1
							? `Instead there is a export called "${exportKeys[0]}". Change this to be "export default ${exportKeys[0]}".`
							: `Instead there are named exports: ${exportKeys.join(', ')}.`
					}`
				)
			} else {
				throw new Error('Module expected to export a class as a default export (no exports found)')
			}
		}
		if (typeof module.default !== 'function') {
			console.log('module', module)
			throw new Error('The Graphic is expected to default export a class')
		}

		const customControllers = this.extractCustomControllers(module)

		return {
			defaultExport: module.default,
			customControllers,
		}
	}

	static extractCustomControllers(module) {
		const controllers = []
		for (const [exportKey, exp] of Object.entries(module)) {
			if (!exp || exportKey === 'default') continue
			if (exp.type === 'user-interface') {
				const rawTypes = exp.supportedRenderType !== undefined ? exp.supportedRenderType : exp.supportedRenterType
				let supportedRenderTypes = []
				if (Array.isArray(rawTypes)) {
					supportedRenderTypes = rawTypes
				} else if (typeof rawTypes === 'string') {
					supportedRenderTypes = [rawTypes]
				} else {
					supportedRenderTypes = []
				}

				controllers.push({
					id: exportKey,
					exportName: exportKey,
					componentClass: exp,
					name: typeof exp.name === 'string' && exp.name !== exportKey ? exp.name : (exp.name || exportKey),
					description: typeof exp.description === 'string' ? exp.description : '',
					supportedRenderTypes,
				})
			}
		}
		return controllers
	}
}
let staticComponentId = 0
