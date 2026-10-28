/**
 * AppUIController
 * ---------------
 * Capa de presentación / UI de la aplicación.
 *
 * Responsabilidades:
 *  - Escuchar eventos del DOM (clicks, toolbar del visor, etc.).
 *  - Renderizar la tabla de pacientes (id, modalidad, patología).
 *  - Abrir el visor DICOM para un caso y mostrar su estado.
 *
 * Recibe las dependencias (PatientModel, SupabaseRepository, DicomViewerEngine)
 * por inyección para facilitar pruebas unitarias.
 */
class AppUIController {
  /**
   * @param {Object} opciones Configuración de la UI.
   * @param {typeof PatientModel} opciones.patientModel Clase de dominio (inyección).
   * @param {SupabaseRepository} opciones.supabaseRepository Repositorio de datos (inyección).
   * @param {Object} [opciones.elementos] Referencias del DOM:
   *   tablaCuerpo, visorSeccion, visorEstado, visorOverlay, visorInfo, visorToolbar, visorPreset.
   * @param {DicomViewerEngine|null} [opciones.dicomViewerEngine] Motor del visor (puede ser null
   *   si Cornerstone no cargó; la lista clínica sigue funcionando).
   */
  constructor({ patientModel, supabaseRepository, elementos = {}, dicomViewerEngine = null }) {
    this.patientModel = patientModel;
    this.supabaseRepository = supabaseRepository;
    this.elementos = elementos;
    this.dicomViewerEngine = dicomViewerEngine;

    // Cache de pacientes renderizados
    this.pacientes = [];

    this.#enlazarToolbar();
  }

  // ---------------------------------------------------------
  // Lista clínica
  // ---------------------------------------------------------

  /**
   * Carga los pacientes desde el repositorio y renderiza la tabla.
   * Orquesta el flujo completo: fetch -> modelo -> render.
   */
  async cargarYRenderizar() {
    try {
      const filas = await this.supabaseRepository.obtenerTodos();
      this.pacientes = filas
        .map((fila) => this.patientModel.fromSupabase(fila))
        .filter((paciente) => paciente !== null);

      this.renderizarTabla(this.pacientes);
    } catch (error) {
      console.error("Error al cargar la lista clínica:", error.message);
      this.renderizarError(error.message);
    }
  }

  /**
   * Renderiza la tabla de pacientes.
   * Se construye con la API del DOM y textContent (NO con innerHTML) para
   * evitar XSS: los datos vienen de la base y cualquiera podría haberlos escrito.
   * @param {PatientModel[]} pacientes Lista de pacientes a mostrar.
   */
  renderizarTabla(pacientes) {
    const tbody = this.elementos.tablaCuerpo;
    if (!tbody) return;

    tbody.replaceChildren(); // limpia filas previas

    if (pacientes.length === 0) {
      this.#filaMensaje(tbody, "Aún no hay casos clínicos registrados.");
      return;
    }

    pacientes.forEach((paciente) => {
      const tr = document.createElement("tr");

      [paciente.getNombrePaciente(), paciente.modalidad, paciente.patologia].forEach((texto) => {
        const td = document.createElement("td");
        td.className = "px-4 py-2";
        td.textContent = texto;
        tr.appendChild(td);
      });

      const tdAccion = document.createElement("td");
      tdAccion.className = "px-4 py-2";

      const boton = document.createElement("button");
      boton.type = "button";
      boton.className =
        "btn-ver-dicom px-3 py-1 rounded bg-blue-700 text-white hover:bg-blue-800 " +
        "focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50";
      boton.textContent = "Ver DICOM";
      boton.dataset.id = paciente.id;
      boton.addEventListener("click", () => this.navegarAlVisor(paciente));

      tdAccion.appendChild(boton);
      tr.appendChild(tdAccion);
      tbody.appendChild(tr);
    });
  }

  /** Muestra un mensaje de error en la tabla (ej. fallo de red). */
  renderizarError(mensaje) {
    const tbody = this.elementos.tablaCuerpo;
    if (!tbody) return;
    tbody.replaceChildren();
    this.#filaMensaje(tbody, `No se pudo cargar la lista: ${mensaje}`, "text-red-600");
  }

  // ---------------------------------------------------------
  // Visor DICOM
  // ---------------------------------------------------------

  /**
   * Abre el estudio de un paciente en el visor.
   * Flujo: path en BD -> URL firmada (Storage) -> DicomViewerEngine.renderDicom().
   * @param {PatientModel} paciente Caso a visualizar.
   */
  async navegarAlVisor(paciente) {
    const engine = this.dicomViewerEngine;
    if (!engine) {
      this.#mostrarEstado("El visor DICOM no está disponible (¿faltan las librerías de js/vendor?).", true);
      return;
    }
    if (!paciente.archivoDicomPath) {
      this.#mostrarEstado("Este caso todavía no tiene un archivo DICOM asociado.", true);
      return;
    }

    this.#mostrarInfo(paciente);
    this.#mostrarEstado("Cargando estudio…");
    this.elementos.visorSeccion?.scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const url = await this.supabaseRepository.obtenerUrlDicom(paciente.archivoDicomPath);
      const mostrada = await engine.renderDicom(url);
      if (mostrada) this.#ocultarEstado(); // si devolvió false, otra carga más reciente manda
    } catch (error) {
      console.error("Error al cargar DICOM del paciente:", error);
      this.#mostrarEstado(`⚠️ ${error.message}`, true);
    }
  }

  /** Conecta los botones de la toolbar y el selector de presets con el motor. */
  #enlazarToolbar() {
    const { visorToolbar, visorPreset } = this.elementos;

    visorToolbar?.addEventListener("click", (e) => {
      const accion = e.target.closest("[data-accion]")?.dataset.accion;
      const engine = this.dicomViewerEngine;
      if (!accion || !engine) return;

      const acciones = {
        "zoom-in": () => engine.zoom(1.2),
        "zoom-out": () => engine.zoom(1 / 1.2),
        invertir: () => engine.toggleInvert(),
        reset: () => engine.reset(),
      };
      acciones[accion]?.();
    });

    visorPreset?.addEventListener("change", (e) => {
      if (e.target.value) this.dicomViewerEngine?.applyPreset(e.target.value);
    });
  }

  /** Actualiza el texto superpuesto (WW/WC/zoom). Se pasa como onChange del motor. */
  renderizarOverlay(estado) {
    const el = this.elementos.visorOverlay;
    if (!el) return;
    el.textContent = estado.loaded
      ? `WW: ${estado.windowWidth}   WC: ${estado.windowCenter}\nZoom: ${estado.scale.toFixed(2)}x`
      : "";
  }

  // ---------------------------------------------------------
  // Utilidades privadas de UI
  // ---------------------------------------------------------

  #mostrarEstado(mensaje, esError = false) {
    const el = this.elementos.visorEstado;
    if (!el) return;
    el.textContent = mensaje;
    el.classList.remove("hidden");
    el.classList.toggle("text-red-400", esError);
    el.classList.toggle("text-gray-400", !esError);
  }

  #ocultarEstado() {
    this.elementos.visorEstado?.classList.add("hidden");
  }

  #mostrarInfo(paciente) {
    const el = this.elementos.visorInfo;
    if (!el) return;
    const partes = [paciente.getNombrePaciente(), paciente.modalidad, paciente.patologia];
    el.textContent = partes.join(" · ");
    el.title = paciente.descripcionClinica ?? "";
  }

  #filaMensaje(tbody, mensaje, clase = "text-gray-500") {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = `px-4 py-3 ${clase}`;
    td.textContent = mensaje;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// Exportación estilo módulo
export default AppUIController;
export { AppUIController };
