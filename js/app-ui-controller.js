/**
 * AppUIController
 * ---------------
 * Capa de presentación / UI de la aplicación.
 *
 * Responsabilidades:
 *  - Escuchar eventos del DOM (clicks, etc.).
 *  - Renderizar la tabla de pacientes (id, modalidad, patología).
 *  - Navegar entre la vista de lista clínica y la vista del visor DICOM.
 *
 * Recibe las dependencias (PatientModel, SupabaseRepository) por inyección
 * de dependencias para facilitar pruebas unitarias.
 */
class AppUIController {
  /**
   * @param {Object} opciones Configuración de la UI.
   * @param {PatientModel} opciones.patientModel Modelo de dominio (inyección).
   * @param {SupabaseRepository} opciones.supabaseRepository Repositorio de datos (inyección).
   * @param {Object} [opciones.elementos] Referencias del DOM.
   */
  constructor({ patientModel, supabaseRepository, elementos = {} }) {
    this.patientModel = patientModel;
    this.supabaseRepository = supabaseRepository;
    this.elementos = elementos;

    // Cache de pacientes renderizados
    this.pacientes = [];
  }

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
   * Renderiza la tabla de pacientes con:
   *  - ID de paciente
   *  - Modalidad
   *  - Patología
   *  - Acción para abrir el visor DICOM
   * @param {PatientModel[]} pacientes Lista de pacientes a mostrar.
   */
  renderizarTabla(pacientes) {
    const tbody = this.elementos.tablaCuerpo;
    if (!tbody) return;

    tbody.innerHTML = ""; // Limpia filas previas

    pacientes.forEach((paciente) => {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${paciente.getNombrePaciente()}</td>
        <td>${paciente.modalidad}</td>
        <td>${paciente.patologia}</td>
        <td>
          <button class="btn-ver-dicom" data-id="${paciente.id}">
            Ver DICOM
          </button>
        </td>
      `;

      // Delegación de eventos: un solo listener para todos los botones
      tr.querySelector(".btn-ver-dicom")?.addEventListener("click", () => {
        this.navegarAlVisor(paciente);
      });

      tbody.appendChild(tr);
    });
  }

  /** Muestra un mensaje de error en la tabla (ej. fallo de red). */
  renderizarError(mensaje) {
    const tbody = this.elementos.tablaCuerpo;
    if (tbody) tbody.innerHTML = `<tr><td colspan="4">${mensaje}</td></tr>`;
  }

  /** Navega a la vista del visor DICOM para un paciente. */
  navegarAlVisor(paciente) {
    // TODO (Fase 4): integración con DicomViewerEngine
    console.log("Ver DICOM del paciente:", paciente.toJSON());
  }
}

// Exportación estilo módulo
export default AppUIController;
export { AppUIController };
