import { pathJoin, graphicResourcePath } from '../lib/lib.js'
import {} from '../lib/lib'

export class ResourceProvider {
	static graphicPath(basePath, graphicPath) {
		return pathJoin(basePath, graphicPath ?? 'graphic.mjs')
	}

	static async loadGraphic(graphicPath) {
		const componentId = 'graphic-component' + staticComponentId++

		const webComponent = await this.fetchModule(graphicPath, componentId)
		customElements.define(componentId, webComponent)

		return componentId
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

		return module.default
	}
}
let staticComponentId = 0
