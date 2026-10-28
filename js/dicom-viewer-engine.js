/**
 * DicomViewerEngine
 * ---------------
 * Encapsulates the medical image viewer of the PACS web app.
 *
 * Responsibilities:
 *  - Manage the canvas used by the viewer.
 *  - Load DICOM files (.dcm) via Cornerstone.
 *  - Adjust windowing (window/level) - contrast.
 *  - Zoom and pan.
 */
class DicomViewerEngine {
  constructor(canvas, options = {}) {
    if (!canvas) throw new Error('DicomViewerEngine: se requiere un canvas.');
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.options = { ...options };
    // Cornerstone expone su API global (window.cornerstone) cuando se carga vía script/CDN
    this.cornerstone = (typeof window !== 'undefined' && window.cornerstone) ? window.cornerstone : null;
    this.imageId = null;
  }

  /**
   * Activa Cornerstone sobre el canvas.
   * Debe llamarse antes de cargar/renderizar imágenes.
   */
  enable() {
    if (!this.cornerstone) throw new Error('DicomViewerEngine: Cornerstone no está disponible.');
    this.cornerstone.enable(this.canvas);
  }

  /**
   * Carga un archivo DICOM (por URL) y lo renderiza en el canvas.
   * @param {string} dicomUrl URL del recurso .dcm (puede ser presigned o public).
   * @returns {Promise} Imagen cargada por Cornerstone.
   */
  async renderDicom(dicomUrl) {
    if (!this.cornerstone) throw new Error('DicomViewerEngine: Cornerstone no está disponible.');
    const image = await this.cornerstone.loadImage(dicomUrl);
    this.imageId = image.imageId;
    return image;
  }

  /**
   * Ajusta el windowing (ancho de ventana / nivel) para mejorar el contraste.
   * @param {number} windowWidth Ancho de la ventana (mm o rango de HU).
   * @param {number} windowLevel Nivel de la ventana (HU).
   */
  async setWindowing(windowWidth, windowLevel) {
    if (!this.cornerstone) throw new Error('DicomViewerEngine: Cornerstone no está disponible.');
    // TODO(Fase 4): integrar herramienta WindowLevel de Cornerstone Tools
    //   - cornerstoneTools.enhanceViewport(viewport, toolGroup)
    //   - toolGroup.setToolEnabled(windowLevelTool, true)
    console.debug(`DicomViewerEngine.setWindowing -> width=${windowWidth}, level=${windowLevel}`);
  }

  /**
   * Acerca (zoom) la imagen.
   * @param {number} factor Factor de zoom (2 = alejamiento, 0.5 = acercamiento).
   */
  async zoom(factor = 2) {
    if (!this.cornerstone) throw new Error('DicomViewerEngine: Cornerstone no está disponible.');
    // TODO(Fase 4): integrar zoom via Cornerstone Tools
    console.debug(`DicomViewerEngine.zoom -> factor=${factor}`);
  }

  /**
   * Desplaza (pan) la imagen en el canvas.
   * @param {number} x Desplazamiento en X.
   * @param {number} y Desplazamiento en Y.
   */
  async pan(x = 0, y = 0) {
    if (!this.cornerstone) throw new Error('DicomViewerEngine: Cornerstone no está disponible.');
    // TODO(Fase 4): integrar pan via Cornerstone Tools
    console.debug(`DicomViewerEngine.pan -> x=${x}, y=${y}`);
  }
}

// Exportación estilo módulo
export default DicomViewerEngine;
export { DicomViewerEngine };
