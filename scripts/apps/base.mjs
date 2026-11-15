/** ApplicationV2 that builds its own DOM instead of using templates. Subclasses implement `build()`. */
export class DomApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["kgst-app"],
    window: { resizable: true }
  };

  /** @abstract */
  async build(context, options) {
    return document.createElement("div");
  }

  async _renderHTML(context, options) {
    return this.build(context, options);
  }

  _replaceHTML(result, content, options) {
    content.replaceChildren(result);
  }
}
