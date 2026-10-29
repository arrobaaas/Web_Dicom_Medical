/**
 * AuthService
 * -----------
 * Encapsula la autenticación con Supabase Auth.
 *
 * Responsabilidades:
 *  - Iniciar y cerrar sesión (email + contraseña).
 *  - Exponer el usuario actual y notificar los cambios de sesión.
 *
 * No hay registro público: las cuentas (docentes / editores) se crean desde
 * el panel de Supabase. Así solo quien tenga cuenta puede subir casos, que es
 * lo que exigen las políticas RLS ("TO authenticated") de supabase/schema.sql.
 */
class AuthService {
  /** Traducción de los errores más habituales de Supabase Auth. */
  static #MENSAJES = Object.freeze({
    "Invalid login credentials": "Email o contraseña incorrectos.",
    "Email not confirmed": "Esta cuenta aún no ha confirmado su email.",
  });

  #auth; // supabase.auth

  /**
   * @param {Object} supabaseClient Cliente de Supabase (con .auth).
   */
  constructor(supabaseClient) {
    if (!supabaseClient?.auth) {
      throw new Error("AuthService: se requiere un cliente de Supabase.");
    }
    this.#auth = supabaseClient.auth;
  }

  /**
   * Inicia sesión con email y contraseña.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<Object>} Usuario autenticado.
   */
  async iniciarSesion(email, password) {
    if (!email || !password) {
      throw new Error("Introduce tu email y tu contraseña.");
    }
    const { data, error } = await this.#auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(AuthService.#traducir(error));
    return data.user;
  }

  /** Cierra la sesión actual. */
  async cerrarSesion() {
    const { error } = await this.#auth.signOut();
    if (error) throw new Error(`No se pudo cerrar la sesión: ${error.message}`);
  }

  /**
   * Usuario de la sesión guardada (o null si no hay sesión).
   * @returns {Promise<Object|null>}
   */
  async obtenerUsuario() {
    const { data, error } = await this.#auth.getSession();
    if (error) throw new Error(`No se pudo leer la sesión: ${error.message}`);
    return data.session?.user ?? null;
  }

  /**
   * Suscribe un callback a los cambios de sesión (login, logout, expiración).
   * @param {(usuario: Object|null) => void} callback
   * @returns {() => void} Función para cancelar la suscripción.
   */
  alCambiar(callback) {
    // OJO: el callback NO debe hacer await de otras llamadas a Supabase,
    // porque supabase-js lo ejecuta mientras mantiene un bloqueo interno.
    const { data } = this.#auth.onAuthStateChange((_evento, sesion) => {
      callback(sesion?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }

  static #traducir(error) {
    return AuthService.#MENSAJES[error.message] ?? error.message;
  }
}

// Exportación estilo módulo
export default AuthService;
export { AuthService };
