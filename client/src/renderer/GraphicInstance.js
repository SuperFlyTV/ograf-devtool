let graphicInstanceId = 0
export class GraphicInstance {
	constructor(id, version, element) {
		this.id = `${graphicInstanceId++}`
		this.element = element
		this.graphicId = id
		this.graphicVersion = version
	}
}
