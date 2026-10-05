// This is an example of a custom controller interface:
// Last updated: 2026-10-05

export default class MyOGraf extends HTMLElement {
  // not covered in this file, following the usual ograf specification
}

/**
 * This is an off-spec web component, used to display a custom user interface for controlling graphics.
 * It is identified as a user interface component by its static type 'user-interface'.
 *
 * The Controller might track the graphics "data state". If so, it'll set this components 'value' attribute whenever the data changes (as well as initially).
 * And this component will emit a 'change' event with event.detail.value whenever we want to change the data state.
 */
export class UserInterface extends HTMLElement {
  /** This must be 'user-interface' */
  static type = "user-interface";

  /** Display name */
  static name = "My UserInterface";
  /** Display description */
  static description = "A user interface that can control graphics";

  /** Which render-types are supported by this user interface */
  static supportedRenterType = ["realtime"]; // 'realtime', 'non-realtime'

  static get observedAttributes() {
    return ["value"];
  }

  constructor() {
    super();

    // this.value contains the data state, as defined in the ograf manifest.
    this.value = {};
  }
  get value() {
    const value = this.getAttribute("value");
    if (value === "") return undefined;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  }
  set value(value) {
    this.setAttribute(
      "value",
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  attributeChangedCallback(name, oldValue, newValue) {
    // is called if an observedAttribute changes.
    if (name === "value") {
      // handle change
    }
  }

  connectedCallback() {
    // This is called when the component is added to the DOM.
  }

  /**
   * The load() method is called by the controller when the component has been mounted into the DOM.
   * It will only ever be called once by the controller.
   * Before this is called, the WebComponent will do basically nothing (No loading of resources etc).
   * @returns {Promise<void>} A promise that resolves when the component has finished loading.
   */
  async load({ ograf, renderType = "realtime" } = {}) {
    if (renderType !== "realtime")
      throw new Error("Only realtime render type is supported");

    // We will emit the 'change' event when this.value changes.
    // The controller will then store that state object, and distribute it to any other components.
    // this.dispatchEvent(new CustomEvent("change", {
    //   bubbles: true,
    //   cancelable: false,
    //   detail,
    // }))

    // The ograf interface mimics the one for the main ograf web component.
    // The host controller then abstracts the calls and forwards them to the end ograf graphic.
    // eg:
    // await this.ograf.playAction()
    // await this.ograf.stopAction()
    // await this.ograf.updateAction()
    // await this.ograf.customAction()
    // await this.ograf.goToTime()
    // await this.ograf.setActionsSchedule()

    this.ograf = ograf;

    // When the controller executes an action on the graphic, it'll notify us using the events below:
    // Note that the events will be emitted, even when it is OUR component that called an action.

    // These are called _before_ an action is sent to a ograf graphic:
    this.ograf.on("playActionStart", (event) => {}); // event: StartEvent
    this.ograf.on("stopActionStart", (event) => {}); // event: StartEvent
    this.ograf.on("updateActionStart", (event) => {}); // event: StartEvent
    this.ograf.on("customActionStart", (event) => {}); // event: StartEvent
    this.ograf.on("goToTimeStart", (event) => {}); // event: StartEvent
    this.ograf.on("setActionsScheduleStart", (event) => {}); // event: StartEvent

    // Where StartEvent has detail: { commandId, arg }

    // These are called _after_ an action has been sent to a graphic (ie when the Promise has been resolved)
    this.ograf.on("playActionEnd", (event) => {}); // event: EndEvent
    this.ograf.on("stopActionEnd", (event) => {}); // event: EndEvent
    this.ograf.on("updateActionEnd", (event) => {}); // event: EndEvent
    this.ograf.on("customActionEnd", (event) => {}); // event: EndEvent
    this.ograf.on("goToTimeEnd", (event) => {}); // event: EndEvent
    this.ograf.on("setActionsScheduleEnd", (event) => {}); // event: EndEvent

    // Aliases to the End events:
    this.ograf.on("playAction", (event) => {}); // event: EndEvent
    this.ograf.on("stopAction", (event) => {}); // event: EndEvent
    this.ograf.on("updateAction", (event) => {}); // event: EndEvent
    this.ograf.on("customAction", (event) => {}); // event: EndEvent
    this.ograf.on("goToTime", (event) => {}); // event: EndEvent
    this.ograf.on("setActionsSchedule", (event) => {}); // event: EndEvent

    // Where EndEvent has detail: { commandId, arg, result }
  }

  /**
   * Called when the component is about to be removed from the DOM.
   * @returns {Promise<void>} A promise that resolves when the component has finished disposing.
   */
  async dispose() {
    //
  }
}

function getStartEvent(eventType, commandId, arg) {
  return new CustomEvent(eventType, {
    bubbles: true,
    cancelable: false,
    detail: {
      commandId,
      arg,
    },
  });
}
function getEndEvent(eventType, commandId, arg, result) {
  return new CustomEvent(eventType, {
    bubbles: true,
    cancelable: false,
    detail: {
      commandId,
      arg,
      result,
    },
  });
}
