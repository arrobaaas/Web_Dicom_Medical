/**
 * DicomViewerEngine
 * -----------------
 * Encapsula el visor de imágenes médicas de la app PACS (Cornerstone legacy).
 *
 * Responsabilidades:
 *  - Gestionar el contenedor donde Cornerstone dibuja el canvas.
 *  - Cargar archivos DICOM (.dcm) por URL.
 *  - Windowing (ventana / nivel = contraste y brillo).
 *  - Zoom, pan, inversión de grises y reset.
 *
 * Regla de la arquitectura: el resto de la app NO toca `cornerstone`
 * directamente; todo pasa por esta clase.
 *
 * Requiere que estos scripts clásicos estén cargados ANTES de main.js
 * (ver index.html): cornerstone, dicomParser y cornerstoneWADOImageLoader.
 *
 * IMPORTANTE: el elemento recibido debe ser un <div>, no un <canvas>.
 * Cornerstone crea su propio <canvas> dentro del contenedor.
 */

/** Error propio para distinguir fallos del visor de otros errores. */
class DicomViewerError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "DicomViewerError";
    this.cause = cause;
  }
}

class DicomViewerEngine {
  // --- Constantes de la clase ------------------------------------------------
  static MIN_SCALE = 0.1;
  static MAX_SCALE = 20;

  /** Presets de ventana típicos de TAC (unidades Hounsfield). No aplican a RX. */
  static WL_PRESETS = Object.freeze({
    pulmon: { ww: 1500, wc: -600 },
    mediastino: { ww: 350, wc: 50 },
    hueso: { ww: 2000, wc: 300 },
    cerebro: { ww: 80, wc: 40 },
  });

  /** El loader se configura una sola vez por página, aunque haya varias instancias. */
  static #loaderConfigurado = false;

  // --- Estado privado --------------------------------------------------------
  #element; // <div> contenedor del visor
  #cs; // window.cornerstone
  #loader; // window.cornerstoneWADOImageLoader
  #image = null; // imagen mostrada actualmente
  #loadToken = 0; // evita condiciones de carrera si se hacen clics rápidos
  #drag = null; // arrastre en curso: { modo, x, y }
  #resizeObserver = null;
  #onChange; // callback opcional invocado en cada render

  /**
   * @param {HTMLElement} element Contenedor DIV del visor.
   * @param {{onChange?: (estado: object) => void}} [options]
   * @throws {DicomViewerError} Si el elemento no es válido o falta Cornerstone.
   */
  constructor(element, { onChange = null } = {}) {
    if (!(element instanceof HTMLElement)) {
      throw new DicomViewerError("DicomViewerEngine: se requiere un elemento HTML válido.");
    }
    if (element instanceof HTMLCanvasElement) {
      throw new DicomViewerError(
        "DicomViewerEngine: el contenedor debe ser un <div>, no un <canvas>."
      );
    }
    if (!window.cornerstone || !window.cornerstoneWADOImageLoader || !window.dicomParser) {
      throw new DicomViewerError(
        "Cornerstone no está cargado. Revisa los <script> de js/vendor/ en index.html."
      );
    }

    this.#element = element;
    this.#cs = window.cornerstone;
    this.#loader = window.cornerstoneWADOImageLoader;
    this.#onChange = onChange;

    DicomViewerEngine.#configurarLoader(this.#cs, this.#loader, window.dicomParser);

    this.#cs.enable(this.#element);
    this.#enlazarEventos();
  }

  // --- Configuración del loader (una sola vez) -------------------------------
  static #configurarLoader(cs, loader, parser) {
    if (DicomViewerEngine.#loaderConfigurado) return;

    loader.external.cornerstone = cs;
    loader.external.dicomParser = parser;

    // Rutas absolutas a partir de la URL de la página: sirven igual en
    // localhost y en GitHub Pages (https://usuario.github.io/Web_Dicom_Medical/).
    const base = document.baseURI;

    loader.webWorkerManager.initialize({
      maxWebWorkers: Math.max(1, (navigator.hardwareConcurrency || 2) - 1),
      startWebWorkersOnDemand: true,
      webWorkerPath: new URL("js/vendor/cornerstoneWADOImageLoaderWebWorker.min.js", base).href,
      taskConfiguration: {
        decodeTask: {
          codecsPath: new URL("js/vendor/cornerstoneWADOImageLoaderCodecs.min.js", base).href,
          initializeCodecsOnStartup: false,
          usePDFJS: false,
          strict: false,
        },
      },
    });

    DicomViewerEngine.#loaderConfigurado = true;
  }

  // --- API pública: carga ----------------------------------------------------
  /**
   * Descarga y muestra un archivo .dcm.
   * @param {string} dicomUrl URL accesible desde el navegador (pública o firmada).
   * @returns {Promise<boolean>} true si se mostró; false si otra carga más reciente la reemplazó.
   * @throws {DicomViewerError}
   */
  async renderDicom(dicomUrl) {
    if (!dicomUrl || typeof dicomUrl !== "string") {
      throw new DicomViewerError("La URL del archivo DICOM está vacía o no es válida.");
    }

    const token = ++this.#loadToken;
    try {
      // El prefijo "wadouri:" le dice a Cornerstone que es un .dcm por HTTP.
      const image = await this.#cs.loadImage(`wadouri:${dicomUrl}`);
      if (token !== this.#loadToken) return false; // llegó tarde: hay una carga más nueva

      this.#cs.displayImage(this.#element, image);
      this.#image = image;
      return true;
    } catch (err) {
      if (token !== this.#loadToken) return false;
      throw new DicomViewerError(
        "No se pudo cargar el archivo DICOM (revisa la URL firmada, CORS o que el archivo sea válido).",
        err
      );
    }
  }

  /** Quita la imagen actual y deja el visor vacío. */
  clear() {
    this.#loadToken++;
    this.#image = null;
    this.#cs.disable(this.#element);
    this.#cs.enable(this.#element);
    this.#onChange?.(this.getState());
  }

  // --- API pública: manipulación de la imagen --------------------------------
  /**
   * Fija ventana / nivel (contraste y brillo).
   * @param {number} windowWidth Ancho de la ventana (WW).
   * @param {number} windowLevel Nivel / centro de la ventana (WC).
   */
  setWindowing(windowWidth, windowLevel) {
    const vp = this.#viewport();
    if (!vp) return;
    vp.voi.windowWidth = Math.max(1, windowWidth);
    vp.voi.windowCenter = windowLevel;
    this.#cs.setViewport(this.#element, vp);
  }

  /** Aplica un preset de WL_PRESETS por nombre ('pulmon', 'hueso', ...). */
  applyPreset(nombre) {
    const preset = DicomViewerEngine.WL_PRESETS[nombre];
    if (!preset) throw new DicomViewerError(`Preset desconocido: "${nombre}"`);
    this.setWindowing(preset.ww, preset.wc);
  }

  /**
   * Zoom multiplicativo.
   * @param {number} factor >1 acerca, <1 aleja (ej. 1.2 o 1/1.2).
   */
  zoom(factor = 1.2) {
    const vp = this.#viewport();
    if (!vp) return;
    vp.scale = Math.min(
      DicomViewerEngine.MAX_SCALE,
      Math.max(DicomViewerEngine.MIN_SCALE, vp.scale * factor)
    );
    this.#cs.setViewport(this.#element, vp);
  }

  /**
   * Desplaza la imagen.
   * @param {number} dx Píxeles de pantalla en X.
   * @param {number} dy Píxeles de pantalla en Y.
   */
  pan(dx = 0, dy = 0) {
    const vp = this.#viewport();
    if (!vp) return;
    // La traslación de Cornerstone está en píxeles de imagen, no de pantalla.
    vp.translation.x += dx / vp.scale;
    vp.translation.y += dy / vp.scale;
    this.#cs.setViewport(this.#element, vp);
  }

  /** Alterna la inversión de grises (útil en RX). */
  toggleInvert() {
    const vp = this.#viewport();
    if (!vp) return;
    vp.invert = !vp.invert;
    this.#cs.setViewport(this.#element, vp);
  }

  /** Vuelve a zoom, posición, contraste e inversión originales. */
  reset() {
    if (this.#image) this.#cs.reset(this.#element);
  }

  /** Estado actual del visor (para overlays y toolbars). */
  getState() {
    const vp = this.#viewport();
    if (!vp) return { loaded: false };
    return {
      loaded: true,
      windowWidth: Math.round(vp.voi.windowWidth),
      windowCenter: Math.round(vp.voi.windowCenter),
      scale: vp.scale,
      invert: vp.invert,
    };
  }

  /** Libera listeners y recursos. Llamar al destruir la vista. */
  destroy() {
    this.#resizeObserver?.disconnect();
    const el = this.#element;
    el.removeEventListener("pointerdown", this.#onPointerDown);
    el.removeEventListener("pointermove", this.#onPointerMove);
    el.removeEventListener("pointerup", this.#onPointerUp);
    el.removeEventListener("pointercancel", this.#onPointerUp);
    el.removeEventListener("wheel", this.#onWheel);
    el.removeEventListener("contextmenu", this.#onContextMenu);
    el.removeEventListener("cornerstoneimagerendered", this.#onRendered);
    this.#cs.disable(el);
    this.#image = null;
  }

  // --- Internos ---------------------------------------------------------------
  /** Copia del viewport actual, o null si no hay imagen cargada. */
  #viewport() {
    return this.#image ? this.#cs.getViewport(this.#element) : null;
  }

  #enlazarEventos() {
    const el = this.#element;
    el.addEventListener("pointerdown", this.#onPointerDown);
    el.addEventListener("pointermove", this.#onPointerMove);
    el.addEventListener("pointerup", this.#onPointerUp);
    el.addEventListener("pointercancel", this.#onPointerUp);
    // passive:false para poder usar preventDefault() y que la página no haga scroll al hacer zoom
    el.addEventListener("wheel", this.#onWheel, { passive: false });
    el.addEventListener("contextmenu", this.#onContextMenu);
    el.addEventListener("cornerstoneimagerendered", this.#onRendered);

    // Reajusta el canvas si cambia el tamaño del contenedor (diseño responsivo).
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#image) this.#cs.resize(this.#element, false);
    });
    this.#resizeObserver.observe(el);
  }

  // Handlers como arrow functions: conservan `this` y se pueden remover en destroy().
  #onPointerDown = (e) => {
    if (!this.#image) return;
    this.#element.setPointerCapture(e.pointerId);
    // Clic derecho = pan; cualquier otro botón / dedo = windowing.
    this.#drag = { modo: e.button === 2 ? "pan" : "window", x: e.clientX, y: e.clientY };
  };

  #onPointerMove = (e) => {
    if (!this.#drag) return;
    const dx = e.clientX - this.#drag.x;
    const dy = e.clientY - this.#drag.y;
    this.#drag.x = e.clientX;
    this.#drag.y = e.clientY;

    if (this.#drag.modo === "pan") {
      this.pan(dx, dy);
      return;
    }

    // Horizontal -> ancho de ventana (contraste); vertical -> centro (brillo).
    // Se escala con el ancho actual para que el ajuste sea cómodo en cualquier rango.
    const vp = this.#viewport();
    if (!vp) return;
    const k = Math.max(1, vp.voi.windowWidth / 256);
    this.setWindowing(vp.voi.windowWidth + dx * k, vp.voi.windowCenter + dy * k);
  };

  #onPointerUp = (e) => {
    this.#drag = null;
    if (this.#element.hasPointerCapture?.(e.pointerId)) {
      this.#element.releasePointerCapture(e.pointerId);
    }
  };

  #onWheel = (e) => {
    if (!this.#image) return;
    e.preventDefault();
    this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  #onContextMenu = (e) => e.preventDefault(); // el clic derecho se usa para pan

  #onRendered = () => {
    this.#onChange?.(this.getState());
  };
}

// Exportación estilo módulo (main.js usa el export por defecto)
export default DicomViewerEngine;
export { DicomViewerEngine, DicomViewerError };
