/**
 * Gives captions the skin's face, ink and plate.
 *
 * The browser draws captions itself and only takes styling from a `::cue` rule in the same tree as the video.
 * Media components such as <mux-video> keep their video in a shadow root, out of reach of the skin's stylesheet,
 * so the rule is handed to whichever tree the video lives in, with the values of the skin's caption properties
 * (`--scry-caption-font`, `--scry-caption-color`, `--scry-caption-plate`) written into it.
 */
export class CaptionStyle {
  #sheet: CSSStyleSheet | null = null;
  #root: Document | ShadowRoot | null = null;

  /** Whether a rule has been placed yet. */
  get applied(): boolean {
    return this.#root !== null;
  }

  /** Write the rule from `container`'s current properties into the tree `video` lives in. */
  apply(video: HTMLVideoElement | null, container: HTMLElement): void {
    if (!video || typeof CSSStyleSheet === 'undefined' || !('replaceSync' in CSSStyleSheet.prototype)) return;

    const style = getComputedStyle(container);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const root = video.getRootNode() as Document | ShadowRoot;
    const selector = root instanceof ShadowRoot ? 'video::cue' : '.media-skin[data-scry-stone] video::cue';

    this.#sheet ??= new CSSStyleSheet();
    this.#sheet.replaceSync(
      `${selector} { font-family: ${read('--scry-caption-font', 'inherit')}; color: ${read('--scry-caption-color', 'white')}; background-color: ${read('--scry-caption-plate', 'rgb(0 0 0 / 0.7)')}; }`
    );

    if (this.#root === root) return;

    this.remove();
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.#sheet];
    this.#root = root;
  }

  remove(): void {
    if (this.#root && this.#sheet) {
      this.#root.adoptedStyleSheets = this.#root.adoptedStyleSheets.filter((sheet) => sheet !== this.#sheet);
    }

    this.#root = null;
  }
}
