/**
 * SupabaseRepository
 * ------------------
 * Encapsula el acceso a datos de la aplicación PACS.
 *
 * Responsabilidades:
 *  - Ejecutar queries contra la tabla `pacientes` (CRUD).
 *  - Gestionar el upload / download de archivos .dcm en Supabase Storage.
 *
 * Recibe un cliente de Supabase (instancia de `@supabase/supabase-js`) a través
 * del constructor, de esta forma la capa de datos queda desacoplada del dominio.
 */

/** Nombre del bucket de Storage donde viven los archivos .dcm (privado). */
const DICOM_BUCKET = "dicom";

class SupabaseRepository {
  /**
   * @param {Object} supabaseClient Cliente de Supabase (con .from() y .storage).
   */
  constructor(supabaseClient) {
    if (!supabaseClient) {
      throw new Error("SupabaseRepository: se requiere un cliente de Supabase.");
    }
    this.client = supabaseClient;
  }

  // ---------------------------------------------------------
  // 1. Pacientes: CRUD sobre la tabla `pacientes`
  // --------------------------------------------------------

  /** Obtiene todos los pacientes / casos clínicos. */
  async obtenerTodos() {
    const { data, error } = await this.client
      .from("pacientes")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Error al obtener pacientes: ${error.message}`);
    return data ?? [];
  }

  /** Obtiene un paciente por su UUID. */
  async obtenerPorId(id) {
    const { data, error } = await this.client
      .from("pacientes")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw new Error(`Error al obtener paciente ${id}: ${error.message}`);
    return data;
  }

  /** Registra un nuevo paciente / caso clínico. */
  async crearPaciente(paciente) {
    const { data, error } = await this.client
      .from("pacientes")
      .insert(paciente)
      .select()
      .single();

    if (error) throw new Error(`Error al crear paciente: ${error.message}`);
    return data;
  }

  /** Actualiza un paciente existente. */
  async actualizarPaciente(id, cambios) {
    const { data, error } = await this.client
      .from("pacientes")
      .update(cambios)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar paciente ${id}: ${error.message}`);
    return data;
  }

  /** Elimina un paciente. */
  async eliminarPaciente(id) {
    const { error } = await this.client.from("pacientes").delete().eq("id", id);
    if (error) throw new Error(`Error al eliminar paciente ${id}: ${error.message}`);
    return true;
  }

  // ---------------------------------------------------------
  // 2. Storage: archivos .dcm
  // --------------------------------------------------------

  /** Sube un archivo .dcm al bucket 'dicom'. */
  async subirDicom(fileName, file) {
    const { data, error } = await this.client.storage
      .from(DICOM_BUCKET)
      .upload(fileName, file);

    if (error) throw new Error(`Error al subir DICOM ${fileName}: ${error.message}`);
    return data;
  }

  /**
   * Genera una URL FIRMADA (temporal) para descargar un .dcm.
   *
   * El bucket 'dicom' es privado (public = false en schema.sql), por lo que
   * getPublicUrl() NO sirve: devolvería una URL que responde 400/404.
   * createSignedUrl() sí funciona porque la política `dicom_public_read`
   * permite SELECT sobre storage.objects de ese bucket.
   *
   * OJO: este método ahora es ASÍNCRONO y devuelve un string (la URL).
   *
   * @param {string} filePath Ruta del archivo dentro del bucket (archivo_dicom_path).
   * @param {number} [expiraEnSegundos=3600] Vigencia de la URL.
   * @returns {Promise<string>} URL firmada lista para el visor.
   */
  async obtenerUrlDicom(filePath, expiraEnSegundos = 3600) {
    if (!filePath) {
      throw new Error("obtenerUrlDicom: este caso no tiene archivo DICOM asociado.");
    }

    const { data, error } = await this.client.storage
      .from(DICOM_BUCKET)
      .createSignedUrl(filePath, expiraEnSegundos);

    if (error) throw new Error(`Error al firmar URL de ${filePath}: ${error.message}`);
    return data.signedUrl;
  }
}

// Exportación estilo módulo
export default SupabaseRepository;
export { SupabaseRepository };
