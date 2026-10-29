import { describe, it, expect, vi } from "vitest";
import AuthService from "../js/auth-service.js";

function crearAuthFalso(sobrescribir = {}) {
  return {
    signInWithPassword: vi.fn(async () => ({ data: { user: { email: "a@b.c" } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    ...sobrescribir,
  };
}

describe("AuthService", () => {
  it("exige un cliente con .auth", () => {
    expect(() => new AuthService({})).toThrow(/cliente/);
  });

  it("iniciarSesion() recorta el email y devuelve el usuario", async () => {
    const auth = crearAuthFalso();
    const usuario = await new AuthService({ auth }).iniciarSesion("  a@b.c ", "secreto");
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.c", password: "secreto" });
    expect(usuario.email).toBe("a@b.c");
  });

  it("no llama a Supabase si faltan datos", async () => {
    const auth = crearAuthFalso();
    await expect(new AuthService({ auth }).iniciarSesion("", "x")).rejects.toThrow(/email/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("traduce los errores conocidos de Supabase Auth", async () => {
    const auth = crearAuthFalso({
      signInWithPassword: vi.fn(async () => ({
        data: {},
        error: { message: "Invalid login credentials" },
      })),
    });
    await expect(new AuthService({ auth }).iniciarSesion("a@b.c", "mala")).rejects.toThrow(
      "Email o contraseña incorrectos."
    );
  });

  it("obtenerUsuario() devuelve null sin sesión y el usuario con sesión", async () => {
    const sin = new AuthService({ auth: crearAuthFalso() });
    await expect(sin.obtenerUsuario()).resolves.toBeNull();

    const con = new AuthService({
      auth: crearAuthFalso({
        getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1" } } }, error: null })),
      }),
    });
    await expect(con.obtenerUsuario()).resolves.toEqual({ id: "u1" });
  });

  it("alCambiar() entrega solo el usuario (o null) y permite cancelar la suscripción", () => {
    const unsubscribe = vi.fn();
    let disparar;
    const auth = crearAuthFalso({
      onAuthStateChange: vi.fn((cb) => {
        disparar = cb;
        return { data: { subscription: { unsubscribe } } };
      }),
    });
    const callback = vi.fn();
    const cancelar = new AuthService({ auth }).alCambiar(callback);

    disparar("SIGNED_IN", { user: { id: "u1" } });
    disparar("SIGNED_OUT", null);
    expect(callback.mock.calls).toEqual([[{ id: "u1" }], [null]]);

    cancelar();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
