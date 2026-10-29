/**
 * PatientModel
 * ------------
 * Modelo de dominio que encapsula los datos de un paciente / caso clínico
 * dentro de la lista clínica.
 *
 * Responsabilidades:
 *  - Encapsular los atributos del paciente (id, modalidad, patología, etc.).
 *  - Transformar una fila cruda de Supabase (snake_case) a un objeto de dominio.
 *  - Serializar el modelo a JSON / payload para persistencia o API.
 *
 * Nota: la capa de acceso a datos (SupabaseRepository) se encarga de las
 *       peticiones; este modelo es agnóstico y solo expone su estado.
 *
 * Sobre `dicomUrl`: el modelo guarda la RUTA del archivo en Storage
 * (`archivoDicomPath`), no una URL. El bucket es privado y las URLs firmadas
 * caducan, así que la URL se genera justo antes de abrir el visor con
 * `SupabaseRepository.obtenerUrlDicom(paciente.archivoDicomPath)`.
 */
class PatientModel {
  /** Modalidades admitidas (deben coincidir con el CHECK de supabase/schema.sql). */
  static MODALIDADES = Object.freeze(["RX", "TAC", "MRI", "US", "NM", "PT", "OTHER"]);

  /**
   * @param {Object} params Datos del paciente.
   * @param {string} params.id UUID del registro (PK).
   * @param {string} params.paciente_id_anonimo Identificador anónimo (ej. "PAC-001").
   * @param {string} params.modalidad Modalidad del estudio (RX, TAC, MRI...).
   * @param {string} params.patologia Patología (ej. "Neumonía Basal Derecha").
   * @param {string} [params.descripcion_clinica] Descripción clínica.
   * @param {string} [params.archivo_dicom_path] Ruta del archivo .dcm en Storage.
   * @param {string} [params.created_at] Timestamp de creación (ISO string).
   */
  constructor({
    id,
    paciente_id_anonimo,
    modalidad,
    patologia,
    descripcion_clinica = null,
    archivo_dicom_path = null,
    created_at = null,
  }) {
    // Validaciones de dominio mínimas (buenas prácticas + manejo de errores)
    if (!id) throw new Error("PatientModel: falta el campo obligatorio 'id'.");
    if (!paciente_id_anonimo) throw new Error("PatientModel: falta el campo obligatorio 'paciente_id_anonimo'.");
    if (!modalidad) throw new Error("PatientModel: falta el campo obligatorio 'modalidad'.");
    if (!patologia) throw new Error("PatientModel: falta el campo obligatorio 'patologia'.");
    if (!PatientModel.MODALIDADES.includes(modalidad)) {
      throw new Error(`PatientModel: modalidad no válida '${modalidad}'.`);
    }

    this.id = id;
    this.pacienteIdAnonimo = paciente_id_anonimo;
    this.modalidad = modalidad;
    this.patologia = patologia;
    this.descripcionClinica = descripcion_clinica;
    this.archivoDicomPath = archivo_dicom_path;
    this.createdAt = created_at;
  }

  /**
   * Crea un PatientModel a partir de una fila de la tabla `pacientes` en Supabase.
   * @param {Object} row Fila cruda (snake_case) de PostgreSQL.
   * @returns {PatientModel|null} Instancia de dominio o null si la fila es inválida.
   */
  static fromSupabase(row) {
    if (!row) return null;

    try {
      return new PatientModel({
        id: row.id,
        paciente_id_anonimo: row.paciente_id_anonimo,
        modalidad: row.modalidad,
        patologia: row.patologia,
        descripcion_clinica: row.descripcion_clinica,
        archivo_dicom_path: row.archivo_dicom_path,
        created_at: row.created_at,
      });
    } catch (error) {
      // Manejo de errores: una fila malformada no debe romper toda la lista.
      console.error("Error al construir PatientModel desde Supabase:", error.message);
      return null;
    }
  }

  /**
   * Serializa el modelo a un objeto plano (formato JSON / API).
   * @returns {Object} Representación serializable del paciente.
   */
  toJSON() {
    return {
      id: this.id,
      paciente_id_anonimo: this.pacienteIdAnonimo,
      modalidad: this.modalidad,
      patologia: this.patologia,
      descripcion_clinica: this.descripcionClinica,
      archivo_dicom_path: this.archivoDicomPath,
      created_at: this.createdAt,
    };
  }

  /**
   * Nombre legible para mostrar en la lista clínica (ID anónimo del paciente).
   * @returns {string} Paciente ID anónimo.
   */
  getNombrePaciente() {
    return this.pacienteIdAnonimo;
  }

  /** @returns {boolean} true si el caso tiene un archivo .dcm asociado. */
  tieneDicom() {
    return Boolean(this.archivoDicomPath);
  }

  /**
   * Los presets de ventana (pulmón, hueso...) usan unidades Hounsfield,
   * que solo tienen sentido en TAC.
   * @returns {boolean}
   */
  admitePresetsHounsfield() {
    return this.modalidad === "TAC";
  }
}

// Exportación estilo módulo (para usar con `<script type="module">` o bundler)
export default PatientModel;
export { PatientModel };
