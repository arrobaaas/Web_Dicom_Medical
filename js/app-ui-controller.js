/**
 * AppUIController
 * ---------------
 * Capa de presentación / UI de la aplicación.
 *
 * Responsabilidades:
 *  - Escuchar eventos del DOM (clicks, teclado, toolbar del visor, etc.).
 *  - Renderizar la tabla de pacientes (id, modalidad, patología, descripción).
 *  - Abrir el visor DICOM para un caso y mostrar su estado y su overlay.
 *
 * Recibe las dependencias (PatientModel, SupabaseRepository, DicomViewerEngine)
 * por inyección para facilitar pruebas unitarias.
 */

/** Color del distintivo de cada modalidad (clases completas para Tailwind). */
const COLORES_MODALIDAD = Object.freeze({
  TAC: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  RX: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  MRI: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  US: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
});
const COLOR_MODALIDAD_POR_DEFECTO = "bg-slate-500/15 text-slate-300 ring-slate-500/30";

/** Clases de una fila según esté seleccionada o no. */
const FILA_BASE = "cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500";
const FILA_INACTIVA = "bg-slate-900 hover:bg-slate-800";
const FILA_ACTIVA = "bg-sky-500/10 ring-1 ring-sky-500/40";

class AppUIController {
  /**
   * @param {Object} opciones Configuración de la UI.
   * @param {typeof PatientModel} opciones.patientModel Clase de dominio (inyección).
   * @param {SupabaseRepository} opciones.supabaseRepository Repositorio de datos (inyección).
   * @param {Object} [opciones.elementos] Referencias del DOM: tablaCuerpo, contador,
   *   visorSeccion, visorEstado, visorEstadoTexto, visorInfo, visorToolbar, visorPreset
   *   y overlay = { supIzq, supDer, infIzq, infDer }.
   * @param {DicomViewerEngine|null} [opciones.dicomViewerEngine] Motor del visor (puede ser null
   *   si Cornerstone no cargó; la lista clínica sigue funcionando).
   */
  constructor({ patientModel, supabaseRepository, elementos = {}, dicomViewerEngine = null }) {
    this.patientModel = patientModel;
    this.supabaseRepository = supabaseRepository;
    this.elementos = elementos;
    this.dicomViewerEngine = dicomViewerEngine;

    // Cache de pacientes renderizados y caso abierto en el visor
    this.pacientes = [];
    this.pacienteActivo = null;
    this.filas = new Map(); // id del paciente -> <tr>

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
    this.#filaMensaje("Cargando casos…");
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
   * Renderiza la tabla de pacientes. Cada fila es seleccionable con clic o teclado.
   * Se construye con la API del DOM y textContent (NO con innerHTML) para
   * evitar XSS: los datos vienen de la base y cualquiera podría haberlos escrito.
   * @param {PatientModel[]} pacientes Lista de pacientes a mostrar.
   */
  renderizarTabla(pacientes) {
    const tbody = this.elementos.tablaCuerpo;
    if (!tbody) return;

    tbody.replaceChildren(); // limpia filas previas
    this.filas.clear();
    this.#actualizarContador(pacientes.length);

    if (pacientes.length === 0) {
      this.#filaMensaje("Aún no hay casos clínicos registrados.");
      return;
    }

    pacientes.forEach((paciente) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.className = `${FILA_BASE} ${FILA_INACTIVA}`;
      tr.setAttribute("aria-label", `Abrir estudio de ${paciente.getNombrePaciente()}`);

      // ID anónimo
      const tdId = this.#celda("pl-3 pr-2 py-3 align-top rounded-l-lg w-px whitespace-nowrap");
      tdId.classList.add("font-mono", "text-xs", "text-slate-300");
      tdId.textContent = paciente.getNombrePaciente();

      // Modalidad (distintivo de color)
      const tdModalidad = this.#celda("px-2 py-3 align-top w-px");
      const badge = document.createElement("span");
      badge.className =
        "inline-block rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide ring-1 ring-inset " +
        (COLORES_MODALIDAD[paciente.modalidad] ?? COLOR_MODALIDAD_POR_DEFECTO);
      badge.textContent = paciente.modalidad;
      tdModalidad.appendChild(badge);

      // Patología + descripción clínica (recortada a 2 líneas; completa en el tooltip)
      const tdTexto = this.#celda("pl-2 pr-3 py-3 align-top rounded-r-lg");
      const patologia = document.createElement("p");
      patologia.className = "font-medium text-slate-100";
      patologia.textContent = paciente.patologia;
      const descripcion = document.createElement("p");
      descripcion.className = "mt-0.5 text-xs text-slate-400 line-clamp-2";
      descripcion.textContent = paciente.descripcionClinica ?? "Sin descripción clínica";
      descripcion.title = paciente.descripcionClinica ?? "";
      tdTexto.append(patologia, descripcion);

      if (!paciente.tieneDicom()) {
        const aviso = document.createElement("p");
        aviso.className = "mt-1 text-[0.7rem] text-amber-400/80";
        aviso.textContent = "Sin archivo DICOM";
        tdTexto.appendChild(aviso);
      }

      tr.append(tdId, tdModalidad, tdTexto);

      const abrir = () => this.navegarAlVisor(paciente);
      tr.addEventListener("click", abrir);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          abrir();
        }
      });

      this.filas.set(paciente.id, tr);
      tbody.appendChild(tr);
    });

    this.#marcarFilaActiva();
  }

  /** Muestra un mensaje de error en la tabla (ej. fallo de red). */
  renderizarError(mensaje) {
    this.#actualizarContador(null);
    this.#filaMensaje(`No se pudo cargar la lista: ${mensaje}`, "text-red-400");
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
    this.pacienteActivo = paciente;
    this.#marcarFilaActiva();
    this.#mostrarInfo(paciente);

    const engine = this.dicomViewerEngine;
    if (!engine) {
      this.#mostrarEstado("El visor DICOM no está disponible (¿faltan las librerías de js/vendor?).", true);
      return;
    }

    // Se vacía el visor para que no quede debajo la imagen del caso anterior
    // (ni mientras carga, ni si la nueva carga falla).
    engine.clear();
    this.#configurarPresets(paciente);

    if (!paciente.tieneDicom()) {
      this.#mostrarEstado("Este caso todavía no tiene un archivo DICOM asociado.", true);
      return;
    }

    this.#mostrarEstado("Cargando estudio…");
    // En móvil la lista y el visor están apilados: se baja hasta el visor.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      this.elementos.visorSeccion?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    try {
      const url = await this.supabaseRepository.obtenerUrlDicom(paciente.archivoDicomPath);
      const mostrada = await engine.renderDicom(url);
      if (mostrada) this.#ocultarEstado(); // si devolvió false, otra carga más reciente manda
    } catch (error) {
      console.error("Error al cargar DICOM del paciente:", error);
      this.#mostrarEstado(error.message, true);
    }
  }

  /**
   * Abre en el visor el caso con ese UUID (si está en la lista cargada).
   * @param {string} id UUID del paciente.
   */
  abrirPorId(id) {
    const paciente = this.pacientes.find((p) => p.id === id);
    if (paciente) this.navegarAlVisor(paciente);
  }

  /** Conecta los botones de la toolbar y el selector de ventana con el motor. */
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

    // El selector NO guarda estado propio: tras aplicar la ventana, el motor
    // vuelve a renderizar y renderizarOverlay() sincroniza el valor mostrado.
    visorPreset?.addEventListener("change", (e) => {
      const engine = this.dicomViewerEngine;
      if (!engine) return;
      const valor = e.target.value;
      if (valor === "original") engine.restoreDefaultWindowing();
      else if (valor !== "personalizada") engine.applyPreset(valor);
    });
  }

  /**
   * Pinta el overlay de las 4 esquinas y sincroniza el selector de ventana.
   * Se pasa como onChange del motor, así que se ejecuta en cada render.
   * @param {object} estado Resultado de DicomViewerEngine.getState().
   */
  renderizarOverlay(estado) {
    const { overlay = {}, visorPreset } = this.elementos;
    const escribir = (el, lineas) => {
      if (el) el.textContent = lineas.filter(Boolean).join("\n");
    };

    if (!estado.loaded) {
      Object.values(overlay).forEach((el) => escribir(el, []));
      return;
    }

    const paciente = this.pacienteActivo;
    const meta = this.dicomViewerEngine?.getMetadata() ?? {};

    escribir(overlay.supIzq, [paciente?.getNombrePaciente(), paciente?.patologia]);
    escribir(overlay.supDer, [
      [meta.modalidad, meta.regionAnatomica].filter(Boolean).join(" · "),
      meta.descripcionEstudio,
      meta.descripcionSerie,
      AppUIController.#formatearFechaDicom(meta.fechaEstudio),
    ]);
    escribir(overlay.infIzq, [
      `W ${estado.windowWidth}  L ${estado.windowCenter}`,
      this.#nombreVentana(estado.ventana),
    ]);
    escribir(overlay.infDer, [
      meta.filas && meta.columnas ? `${meta.columnas} × ${meta.filas}` : null,
      meta.grosorCorte ? `Corte ${meta.grosorCorte} mm` : null,
      `Zoom ${estado.scale.toFixed(2)}×${estado.invert ? "  · Invertido" : ""}`,
    ]);

    if (visorPreset) visorPreset.value = estado.ventana;
  }

  // ---------------------------------------------------------
  // Utilidades privadas de UI
  // ---------------------------------------------------------

  /**
   * Los presets usan unidades Hounsfield: solo se habilitan para TAC.
   * @param {PatientModel} paciente Caso que se va a abrir.
   */
  #configurarPresets(paciente) {
    const select = this.elementos.visorPreset;
    if (!select) return;
    select.value = "original";
    select.disabled = !paciente.admitePresetsHounsfield();
    select.title = select.disabled ? "Los presets de ventana solo aplican a TAC" : "";
  }

  /** Texto legible de la ventana activa para el overlay. */
  #nombreVentana(clave) {
    if (clave === "original") return "Ventana original";
    if (clave === "personalizada") return "Ventana personalizada";
    const preset = this.dicomViewerEngine?.constructor.WL_PRESETS[clave];
    return preset ? `Ventana ${preset.nombre.toLowerCase()}` : null;
  }

  /** 'AAAAMMDD' (formato DICOM) -> 'DD/MM/AAAA'. */
  static #formatearFechaDicom(fecha) {
    if (!/^\d{8}$/.test(fecha ?? "")) return null;
    return `${fecha.slice(6, 8)}/${fecha.slice(4, 6)}/${fecha.slice(0, 4)}`;
  }

  #marcarFilaActiva() {
    this.filas.forEach((tr, id) => {
      const activa = id === this.pacienteActivo?.id;
      tr.className = `${FILA_BASE} ${activa ? FILA_ACTIVA : FILA_INACTIVA}`;
      tr.setAttribute("aria-current", activa ? "true" : "false");
    });
  }

  #actualizarContador(total) {
    const el = this.elementos.contador;
    if (!el) return;
    el.textContent = total === null ? "" : `${total} ${total === 1 ? "caso" : "casos"}`;
  }

  #mostrarEstado(mensaje, esError = false) {
    const { visorEstado, visorEstadoTexto } = this.elementos;
    if (!visorEstado) return;
    (visorEstadoTexto ?? visorEstado).textContent = mensaje;
    visorEstado.classList.remove("hidden");
    visorEstado.classList.toggle("text-red-400", esError);
    visorEstado.classList.toggle("text-slate-500", !esError);
  }

  #ocultarEstado() {
    this.elementos.visorEstado?.classList.add("hidden");
  }

  #mostrarInfo(paciente) {
    const el = this.elementos.visorInfo;
    if (!el) return;
    el.textContent = [paciente.getNombrePaciente(), paciente.modalidad, paciente.patologia].join(" · ");
    el.title = paciente.descripcionClinica ?? "";
  }

  #celda(clases) {
    const td = document.createElement("td");
    td.className = clases;
    return td;
  }

  /** Reemplaza el contenido de la tabla por una única fila de mensaje. */
  #filaMensaje(mensaje, clase = "text-slate-500") {
    const tbody = this.elementos.tablaCuerpo;
    if (!tbody) return;
    const tr = document.createElement("tr");
    const td = this.#celda(`px-3 py-6 text-center text-sm ${clase}`);
    td.colSpan = 3;
    td.textContent = mensaje;
    tr.appendChild(td);
    tbody.replaceChildren(tr);
  }
}

// Exportación estilo módulo
export default AppUIController;
export { AppUIController };
