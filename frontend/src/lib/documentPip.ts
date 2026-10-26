/** Document Picture-in-Picture (Chrome/Edge 116+): a small always-on-top window. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

const api = (): DocumentPictureInPicture | undefined =>
  (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;

export const isDocumentPipSupported = () => Boolean(api());

/** Opens the floating window and copies this page's styles into it. */
export async function openDocumentPip(size: { width: number; height: number }): Promise<Window | null> {
  const pip = api();
  if (!pip) return null;
  const win = await pip.requestWindow(size);
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
      const style = win.document.createElement("style");
      // The PiP document has no base URL, so make asset URLs absolute.
      style.textContent = css.replace(/url\((["']?)\//g, `url($1${window.location.origin}/`);
      win.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = win.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        win.document.head.appendChild(link);
      }
    }
  }
  win.document.body.className = "pip-body";
  // The app keeps a scrollbar on every page so widths don't jump; the floating window has nothing to scroll.
  win.document.documentElement.style.overflow = "hidden";
  win.document.documentElement.style.scrollbarGutter = "auto";
  return win;
}
