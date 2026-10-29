/**
 * Cliente de Supabase simulado: solo lo que usa SupabaseRepository.
 * Las consultas son "thenables" encadenables que resuelven a `resultado`.
 */
import { vi } from "vitest";

export function crearConsulta(resultado = { data: [], error: null }) {
  const q = {};
  for (const m of ["select", "order", "eq", "insert", "update", "delete", "single"]) {
    q[m] = vi.fn(() => q);
  }
  q.then = (ok, ko) => Promise.resolve(resultado).then(ok, ko);
  return q;
}

export function crearClienteFalso({ consulta = crearConsulta(), bucket = {} } = {}) {
  const bucketFalso = {
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
    createSignedUrl: vi.fn(async (ruta) => ({ data: { signedUrl: `https://firmada/${ruta}` }, error: null })),
    createSignedUrls: vi.fn(async (rutas) => ({
      data: rutas.map((path) => ({ path, signedUrl: `https://firmada/${path}`, error: null })),
      error: null,
    })),
    ...bucket,
  };
  return {
    from: vi.fn(() => consulta),
    storage: { from: vi.fn(() => bucketFalso) },
    consulta,
    bucket: bucketFalso,
  };
}
