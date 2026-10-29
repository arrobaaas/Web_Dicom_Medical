/**
 * CaseFormController
 * ------------------
 * UI de la Fase 5: inicio de sesión y alta de casos clínicos.
 *
 * Responsabilidades:
 *  - Mostrar el estado de la sesión en el header (Iniciar sesión / Nuevo caso / Salir).
 *  - Gestionar el diálogo de login.
 *  - Gestionar el diálogo "Nuevo caso": inspeccionar el .dcm elegido,
 *    validar los metadatos y registrar el caso (Storage + tabla `pacientes`).
 *
 * Se separa de AppUIController para que cada controlador tenga una sola
 * responsabilidad: aquél muestra casos, éste los crea.
 */
class CaseFormController {
  /** Valores de PatientName (0010,0010) que ya indican anonimización. */
  static #NOMBRES_ANONIMOS = /^(anonymi[sz]ed|anonymous|anon[^a-z]*|an[oó]nimo|unknown|\^*)$/i;

  #auth;
  #repo;
  #modelo; // clase PatientModel (métodos estáticos de validación)
  #inspector; // clase DicomViewerEngine (inspeccionarArchivo)
  #el;
  #obtenerIdsExistentes;
  #onCasoCreado;

  #usuario = null;
  #inspeccion = null; // { archivos, info } de la última selección inspeccionada
  #seleccionToken = 0; // descarta inspecciones de una selección ya reemplazada

  /**
   * @param {Object} opciones
   * @param {AuthService} opciones.authService
   * @param {SupabaseRepository} opciones.supabaseRepository
   * @param {typeof PatientModel} opciones.patientModel
   * @param {typeof DicomViewerEngine} opciones.inspector Clase con inspeccionarArchivo().
   * @param {Object} opciones.elementos Referencias del DOM (ver main.js).
   * @param {() => string[]} [opciones.obtenerIdsExistentes] IDs anónimos ya usados.
   * @param {(fila: Object) => (void|Promise<void>)} [opciones.onCasoCreado]
   */
  constructor({
    authService,
    supabaseRepository,
    patientModel,
    inspector,
    elementos,
    obtenerIdsExistentes = () => [],
    onCasoCreado = () => {},
  }) {
    if (!authService || !supabaseRepository || !patientModel || !inspector || !elementos) {
      throw new Error("CaseFormController: faltan dependencias.");
    }
    this.#auth = authService;
    this.#repo = supabaseRepository;
    this.#modelo = patientModel;
    this.#inspector = inspector;
    this.#el = elementos;
    this.#obtenerIdsExistentes = obtenerIdsExistentes;
    this.#onCasoCreado = onCasoCreado;

    this.#poblarModalidades();
    this.#enlazarEventos();
  }

  /** Lee la sesión guardada y se suscribe a sus cambios. */
  async iniciar() {
    this.#auth.alCambiar((usuario) => this.#renderizarSesion(usuario));
    try {
      this.#renderizarSesion(await this.#auth.obtenerUsuario());
    } catch (error) {
      console.error(error.message);
      this.#renderizarSesion(null);
    }
  }

  // ---------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------

  #enlazarEventos() {
    const el = this.#el;

    el.btnLogin.addEventListener("click", () => this.#abrirDialogo(el.dialogoLogin, el.errorLogin));
    el.btnNuevoCaso.addEventListener("click", () => this.#abrirSubida());
    el.btnLogout.addEventListener("click", () => this.#cerrarSesion());

    el.formLogin.addEventListener("submit", (e) => this.#enviarLogin(e));
    el.formSubida.addEventListener("submit", (e) => this.#enviarSubida(e));
    el.inputArchivo.addEventListener("change", () => this.#alElegirArchivo());

    // Botones "Cancelar" (data-cerrar) de ambos diálogos
    document.querySelectorAll("[data-cerrar]").forEach((boton) =>
      boton.addEventListener("click", () => boton.closest("dialog")?.close())
    );
  }

  async #enviarLogin(e) {
    e.preventDefault();
    const { formLogin, dialogoLogin, errorLogin, btnEnviarLogin } = this.#el;
    const datos = new FormData(formLogin);

    await this.#conCarga(btnEnviarLogin, "Entrando…", errorLogin, async () => {
      await this.#auth.iniciarSesion(datos.get("email"), datos.get("password"));
      formLogin.reset();
      dialogoLogin.close();
    });
  }

  async #cerrarSesion() {
    try {
      await this.#auth.cerrarSesion();
    } catch (error) {
      console.error(error.message);
    }
  }

  #abrirSubida() {
    const { formSubida, inputId, dialogoSubida, errorSubida } = this.#el;
    formSubida.reset();
    this.#inspeccion = null;
    this.#renderizarInspeccion(null);
    inputId.value = this.#modelo.siguienteIdAnonimo(this.#obtenerIdsExistentes());
    this.#abrirDialogo(dialogoSubida, errorSubida);
  }

  /**
   * Archivos elegidos, ordenados por nombre con orden "natural"
   * (corte_2 antes que corte_10): ese será el orden de la serie.
   */
  #archivosElegidos() {
    return [...this.#el.inputArchivo.files].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
  }

  /** Inspecciona los .dcm en cuanto se eligen y rellena la modalidad. */
  async #alElegirArchivo() {
    const { selectModalidad, errorSubida } = this.#el;
    const archivos = this.#archivosElegidos();
    const token = ++this.#seleccionToken;
    this.#inspeccion = null;
    this.#renderizarInspeccion(null);
    this.#mostrarError(errorSubida, null);
    if (archivos.length === 0) return;

    try {
      // Se inspeccionan TODOS: un solo archivo no DICOM rompería la serie.
      const infos = [];
      for (const archivo of archivos) {
        this.#repo.validarArchivoDicom(archivo);
        try {
          infos.push(await this.#inspector.inspeccionarArchivo(archivo));
        } catch (error) {
          throw new Error(`${archivo.name}: ${error.message}`);
        }
      }
      if (token !== this.#seleccionToken) return; // se eligió otra cosa mientras tanto

      const info = { ...infos[0], totalArchivos: archivos.length };
      // Si algún corte trae nombre / fecha de nacimiento, se avisa igual.
      info.nombrePaciente = infos.find((i) => i.nombrePaciente)?.nombrePaciente ?? null;
      info.fechaNacimiento = infos.find((i) => i.fechaNacimiento)?.fechaNacimiento ?? null;

      this.#inspeccion = { archivos, info };
      const modalidad = this.#modelo.modalidadDesdeCodigoDicom(info.modalidadDicom);
      if (modalidad) selectModalidad.value = modalidad;
      this.#renderizarInspeccion(info);
    } catch (error) {
      this.#mostrarError(errorSubida, error.message);
    }
  }

  async #enviarSubida(e) {
    e.preventDefault();
    const { formSubida, dialogoSubida, errorSubida, btnEnviarSubida } = this.#el;
    this.#mostrarError(errorSubida, null);

    if (!this.#usuario) {
      this.#mostrarError(errorSubida, "Tu sesión ha caducado. Vuelve a iniciar sesión.");
      return;
    }
    const archivos = this.#archivosElegidos();
    const inspeccionados = this.#inspeccion?.archivos ?? [];
    const coinciden =
      archivos.length > 0 &&
      archivos.length === inspeccionados.length &&
      archivos.every((a, i) => a === inspeccionados[i]);
    if (!coinciden) {
      this.#mostrarError(errorSubida, "Selecciona archivos DICOM válidos.");
      return;
    }

    let payload;
    try {
      const datos = new FormData(formSubida);
      payload = this.#modelo.validarNuevoCaso({
        paciente_id_anonimo: datos.get("paciente_id_anonimo"),
        modalidad: datos.get("modalidad"),
        patologia: datos.get("patologia"),
        descripcion_clinica: datos.get("descripcion_clinica"),
      });
    } catch (error) {
      this.#mostrarError(errorSubida, error.message);
      return;
    }

    // Comprobación previa (la base de datos también lo impide con UNIQUE)
    if (this.#obtenerIdsExistentes().includes(payload.paciente_id_anonimo)) {
      this.#mostrarError(errorSubida, `Ya existe un caso con el ID ${payload.paciente_id_anonimo}.`);
      return;
    }

    await this.#conCarga(btnEnviarSubida, "Subiendo…", errorSubida, async () => {
      const fila = await this.#repo.registrarCaso(payload, archivos, (n, total) => {
        if (total > 1) btnEnviarSubida.textContent = `Subiendo ${n}/${total}…`;
      });
      dialogoSubida.close();
      await this.#onCasoCreado(fila);
    });
  }

  // ---------------------------------------------------------
  // Render
  // ---------------------------------------------------------

  #renderizarSesion(usuario) {
    this.#usuario = usuario;
    const { btnLogin, sesionActiva, sesionEmail, dialogoSubida } = this.#el;
    btnLogin.hidden = Boolean(usuario);
    sesionActiva.hidden = !usuario;
    sesionEmail.textContent = usuario?.email ?? "";
    if (!usuario && dialogoSubida.open) dialogoSubida.close();
  }

  /** Resumen de la cabecera DICOM + aviso si contiene datos identificativos. */
  #renderizarInspeccion(info) {
    const { infoArchivo, avisoIdentificativo } = this.#el;
    infoArchivo.hidden = !info;
    avisoIdentificativo.hidden = true;
    if (!info) return;

    const prefijo = info.totalArchivos > 1
      ? `Serie DICOM válida · ${info.totalArchivos} cortes · `
      : "DICOM válido · ";
    infoArchivo.textContent =
      prefijo +
      [info.modalidadDicom, info.regionAnatomica, info.descripcionEstudio].filter(Boolean).join(" · ");

    // Nombre o fecha de nacimiento en la cabecera = posible dato real.
    // Los marcadores típicos de las herramientas de anonimización no cuentan.
    const nombreReal =
      info.nombrePaciente && !CaseFormController.#NOMBRES_ANONIMOS.test(info.nombrePaciente);
    const datos = [
      nombreReal && `nombre «${info.nombrePaciente}»`,
      info.fechaNacimiento && `fecha de nacimiento ${info.fechaNacimiento}`,
    ].filter(Boolean);
    if (datos.length) {
      avisoIdentificativo.hidden = false;
      avisoIdentificativo.textContent =
        `La cabecera contiene ${datos.join(" y ")}. Comprueba que es un paciente ` +
        "ficticio o anonimiza el archivo antes de subirlo.";
    }
  }

  #poblarModalidades() {
    const select = this.#el.selectModalidad;
    select.replaceChildren(
      ...this.#modelo.MODALIDADES.map((m) => new Option(m, m))
    );
  }

  // ---------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------

  #abrirDialogo(dialogo, elError) {
    this.#mostrarError(elError, null);
    dialogo.showModal();
  }

  #mostrarError(el, mensaje) {
    if (!el) return;
    el.hidden = !mensaje;
    el.textContent = mensaje ?? "";
  }

  /** Ejecuta una acción con el botón deshabilitado y muestra el error si falla. */
  async #conCarga(boton, textoCarga, elError, accion) {
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = textoCarga;
    this.#mostrarError(elError, null);
    try {
      await accion();
    } catch (error) {
      console.error(error);
      this.#mostrarError(elError, error.message);
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  }
}

// Exportación estilo módulo
export default CaseFormController;
export { CaseFormController };
