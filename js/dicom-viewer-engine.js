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
    cerebro: { ww: 80, wc: 40, nombre: "Cerebro" },
    pulmon: { ww: 1500, wc: -600, nombre: "Pulmón" },
    mediastino: { ww: 350, wc: 50, nombre: "Mediastino" },
    hueso: { ww: 2000, wc: 300, nombre: "Hueso" },
  });

  /** El loader se configura una sola vez por página, aunque haya varias instancias. */
  static #loaderConfigurado = false;

  // --- Estado privado --------------------------------------------------------
  #element; // <div> contenedor del visor
  #cs; // window.cornerstone
  #loader; // window.cornerstoneWADOImageLoader
  #image = null; // imagen mostrada actualmente
  #defaultVoi = null; // ventana original del archivo: { ww, wc }
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

    // Usamos la build "NoWebWorkers" del loader: decodifica en el hilo principal,
    // por lo que no hay que configurar rutas de workers ni de códecs.
    // Para imágenes sueltas es más que suficiente. Si más adelante abres series
    // enormes o muy comprimidas, se puede migrar a la build con workers.

    DicomViewerEngine.#loaderConfigurado = true;
  }

  // --- Inspección de archivos locales (antes de subirlos) ---------------------
  /**
   * Lee la cabecera de un .dcm local sin mostrarlo.
   * Comprueba la firma "DICM" (bytes 128-131 de un DICOM Part 10) y extrae
   * los datos útiles para el formulario y para detectar datos identificativos.
   *
   * @param {File} archivo
   * @returns {Promise<object>} { modalidadDicom, nombrePaciente, idPaciente,
   *   fechaNacimiento, descripcionEstudio, regionAnatomica }
   * @throws {DicomViewerError} Si no es un DICOM válido.
   */
  static async inspeccionarArchivo(archivo) {
    if (!window.dicomParser) {
      throw new DicomViewerError("dicomParser no está cargado (revisa js/vendor/).");
    }

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const firma = String.fromCharCode(...bytes.subarray(128, 132));
    if (firma !== "DICM") {
      throw new DicomViewerError(
        "El archivo no es un DICOM válido (no tiene la firma «DICM»)."
      );
    }

    let ds;
    try {
      // untilTag: se detiene antes de los píxeles; solo interesa la cabecera.
      ds = window.dicomParser.parseDicom(bytes, { untilTag: "x7fe00010" });
    } catch (err) {
      throw new DicomViewerError("No se pudo leer la cabecera DICOM.", err);
    }

    const tag = (t) => ds.string(t)?.trim() || null;
    return {
      modalidadDicom: tag("x00080060"),
      nombrePaciente: tag("x00100010"),
      idPaciente: tag("x00100020"),
      fechaNacimiento: tag("x00100030"),
      descripcionEstudio: tag("x00081030"),
      regionAnatomica: tag("x00180015"),
    };
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

      // La ventana original (la que trae el propio .dcm) se guarda ANTES de
      // mostrar la imagen, para que el primer render ya la conozca.
      const porDefecto = this.#cs.getDefaultViewportForImage(this.#element, image);
      this.#defaultVoi = { ww: porDefecto.voi.windowWidth, wc: porDefecto.voi.windowCenter };
      this.#image = image;
      this.#cs.displayImage(this.#element, image);
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
    this.#defaultVoi = null;
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

  /** Vuelve a la ventana original del archivo, sin tocar zoom ni posición. */
  restoreDefaultWindowing() {
    if (this.#defaultVoi) this.setWindowing(this.#defaultVoi.ww, this.#defaultVoi.wc);
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
      ventana: this.#ventanaActual(vp),
    };
  }

  /**
   * Metadatos DICOM útiles para el overlay (leídos de la cabecera del archivo).
   * @returns {object|null} null si no hay imagen cargada.
   */
  getMetadata() {
    if (!this.#image) return null;
    const ds = this.#image.data; // DataSet de dicomParser (loader wadouri)
    const tag = (t) => ds?.string(t)?.trim() || null;
    return {
      modalidad: tag("x00080060"),
      regionAnatomica: tag("x00180015"),
      descripcionEstudio: tag("x00081030"),
      descripcionSerie: tag("x0008103e"),
      fechaEstudio: tag("x00080020"), // formato DICOM: AAAAMMDD
      grosorCorte: tag("x00180050"),
      filas: this.#image.rows,
      columnas: this.#image.columns,
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
  /**
   * Nombre de la ventana activa: 'original', una clave de WL_PRESETS o
   * 'personalizada'. Así la UI muestra lo que realmente se ve, no el último
   * preset elegido.
   */
  #ventanaActual(vp) {
    const ww = Math.round(vp.voi.windowWidth);
    const wc = Math.round(vp.voi.windowCenter);
    const coincide = (v) => v && Math.round(v.ww) === ww && Math.round(v.wc) === wc;

    if (coincide(this.#defaultVoi)) return "original";
    const preset = Object.entries(DicomViewerEngine.WL_PRESETS).find(([, v]) => coincide(v));
    return preset ? preset[0] : "personalizada";
  }

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
