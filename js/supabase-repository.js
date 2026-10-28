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
  // 2. Storage: archivos .dicom
  // --------------------------------------------------------

  /** Sube un archivo .dcm al bucket 'dicom'. */
  async subirDicom(fileName, file) {
    const { data, error } = await this.client.storage
      .from("dicom")
      .upload(fileName, file);

    if (error) throw new Error(`Error al subir DICOM ${fileName}: ${error.message}`);
    return data;
  }

  /** Genera la URL pública (o firmada) de un archivo DICOM. */
  obtenerUrlDicom(fileName) {
    return this.client.storage.from("dicom").getPublicUrl(fileName);
  }
}

// Exportación estilo módulo
export default SupabaseRepository;
export { SupabaseRepository };
