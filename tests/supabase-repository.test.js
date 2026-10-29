import { describe, it, expect, vi } from "vitest";
import SupabaseRepository from "../js/supabase-repository.js";
import { crearClienteFalso, crearConsulta } from "./helpers/supabase-falso.js";

const archivoFalso = (nombre = "corte.dcm", size = 1024) => ({ name: nombre, size });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe("SupabaseRepository", () => {
  it("exige un cliente de Supabase", () => {
    expect(() => new SupabaseRepository()).toThrow(/cliente/);
  });

  describe("pacientes (tabla)", () => {
    it("obtenerTodos() consulta `pacientes` ordenado del más reciente al más antiguo", async () => {
      const filas = [{ id: "1" }, { id: "2" }];
      const cliente = crearClienteFalso({ consulta: crearConsulta({ data: filas, error: null }) });
      const repo = new SupabaseRepository(cliente);

      await expect(repo.obtenerTodos()).resolves.toEqual(filas);
      expect(cliente.from).toHaveBeenCalledWith("pacientes");
      expect(cliente.consulta.order).toHaveBeenCalledWith("created_at", { ascending: false });
    });

    it("obtenerTodos() convierte el error de Supabase en una excepción legible", async () => {
      const cliente = crearClienteFalso({
        consulta: crearConsulta({ data: null, error: { message: "sin conexión" } }),
      });
      await expect(new SupabaseRepository(cliente).obtenerTodos()).rejects.toThrow(
        "Error al obtener pacientes: sin conexión"
      );
    });

    it("crearPaciente() traduce la violación de UNIQUE (23505) a un mensaje claro", async () => {
      const cliente = crearClienteFalso({
        consulta: crearConsulta({ data: null, error: { code: "23505", message: "duplicate key" } }),
      });
      await expect(
        new SupabaseRepository(cliente).crearPaciente({ paciente_id_anonimo: "PAC-001" })
      ).rejects.toThrow("Ya existe un caso con el ID PAC-001.");
    });
  });

  describe("validarArchivoDicom()", () => {
    const repo = new SupabaseRepository(crearClienteFalso());

    it("rechaza archivos vacíos o ausentes", () => {
      expect(() => repo.validarArchivoDicom(null)).toThrow(/Selecciona/);
      expect(() => repo.validarArchivoDicom(archivoFalso("x.dcm", 0))).toThrow(/Selecciona/);
    });

    it("rechaza archivos de más de 50 MB", () => {
      expect(() => repo.validarArchivoDicom(archivoFalso("x.dcm", 51 * 1024 * 1024))).toThrow(/50 MB/);
      expect(() => repo.validarArchivoDicom(archivoFalso("x.dcm", 50 * 1024 * 1024))).not.toThrow();
    });
  });

  describe("registrarCaso()", () => {
    const payload = { paciente_id_anonimo: "PAC-002", modalidad: "TAC", patologia: "X" };

    it("un archivo: sube a casos/<uuid>.dcm como application/dicom y crea la fila", async () => {
      const cliente = crearClienteFalso({ consulta: crearConsulta({ data: { id: "nuevo" }, error: null }) });
      const fila = await new SupabaseRepository(cliente).registrarCaso(payload, archivoFalso());

      expect(fila).toEqual({ id: "nuevo" });
      const [ruta, , opciones] = cliente.bucket.upload.mock.calls[0];
      expect(ruta).toMatch(new RegExp(`^casos/${UUID.source}\\.dcm$`));
      expect(opciones).toEqual({ contentType: "application/dicom", upsert: false });
      expect(cliente.consulta.insert).toHaveBeenCalledWith({ ...payload, archivo_dicom_path: ruta });
    });

    it("una serie: sube corte_001..n en el orden recibido y guarda la carpeta (con '/')", async () => {
      const cliente = crearClienteFalso({ consulta: crearConsulta({ data: { id: "s" }, error: null }) });
      const progreso = vi.fn();
      const archivos = [archivoFalso("a.dcm"), archivoFalso("b.dcm"), archivoFalso("c.dcm")];

      await new SupabaseRepository(cliente).registrarCaso(payload, archivos, progreso);

      const rutas = cliente.bucket.upload.mock.calls.map(([ruta]) => ruta);
      const carpeta = rutas[0].replace(/corte_001\.dcm$/, "");
      expect(carpeta).toMatch(new RegExp(`^casos/${UUID.source}/$`));
      expect(rutas).toEqual([1, 2, 3].map((n) => `${carpeta}corte_00${n}.dcm`));
      expect(cliente.bucket.upload.mock.calls.map(([, f]) => f.name)).toEqual(["a.dcm", "b.dcm", "c.dcm"]);
      expect(progreso.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
      expect(cliente.consulta.insert).toHaveBeenCalledWith({ ...payload, archivo_dicom_path: carpeta });
    });

    it("si falla la inserción, borra TODOS los archivos subidos y propaga el error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const cliente = crearClienteFalso({
        consulta: crearConsulta({ data: null, error: { code: "23505", message: "dup" } }),
      });
      const repo = new SupabaseRepository(cliente);

      await expect(repo.registrarCaso(payload, [archivoFalso(), archivoFalso()])).rejects.toThrow(/Ya existe/);
      const subidas = cliente.bucket.upload.mock.calls.map(([ruta]) => ruta);
      expect(cliente.bucket.remove).toHaveBeenCalledWith(subidas);
    });

    it("si falla una subida intermedia, solo borra las que sí se subieron", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const upload = vi
        .fn()
        .mockResolvedValueOnce({ data: {}, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "cuota excedida" } });
      const cliente = crearClienteFalso({ bucket: { upload } });

      await expect(
        new SupabaseRepository(cliente).registrarCaso(payload, [archivoFalso(), archivoFalso(), archivoFalso()])
      ).rejects.toThrow(/cuota excedida/);
      expect(upload).toHaveBeenCalledTimes(2);
      expect(cliente.bucket.remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
      expect(cliente.consulta.insert).not.toHaveBeenCalled();
    });

    it("valida todos los archivos antes de subir nada", async () => {
      const cliente = crearClienteFalso();
      await expect(
        new SupabaseRepository(cliente).registrarCaso(payload, [archivoFalso(), archivoFalso("vacio.dcm", 0)])
      ).rejects.toThrow(/Selecciona/);
      expect(cliente.bucket.upload).not.toHaveBeenCalled();
    });
  });

  describe("obtenerUrlsDicom()", () => {
    it("ruta de archivo: devuelve una sola URL firmada", async () => {
      const cliente = crearClienteFalso();
      await expect(new SupabaseRepository(cliente).obtenerUrlsDicom("pac-001.dcm")).resolves.toEqual([
        "https://firmada/pac-001.dcm",
      ]);
      expect(cliente.bucket.list).not.toHaveBeenCalled();
    });

    it("carpeta: lista, descarta lo que no es .dcm y ordena de forma natural (2 antes que 10)", async () => {
      const list = vi.fn(async () => ({
        data: [{ name: "corte_10.dcm" }, { name: "leeme.txt" }, { name: "corte_2.DCM" }, { name: "corte_1.dcm" }],
        error: null,
      }));
      const cliente = crearClienteFalso({ bucket: { list } });

      const urls = await new SupabaseRepository(cliente).obtenerUrlsDicom("casos/x/");

      expect(list).toHaveBeenCalledWith("casos/x", expect.objectContaining({ limit: 1000 }));
      expect(cliente.bucket.createSignedUrls).toHaveBeenCalledWith(
        ["casos/x/corte_1.dcm", "casos/x/corte_2.DCM", "casos/x/corte_10.dcm"],
        3600
      );
      expect(urls).toHaveLength(3);
    });

    it("carpeta vacía o sin ruta: error explícito", async () => {
      const repo = new SupabaseRepository(crearClienteFalso());
      await expect(repo.obtenerUrlsDicom("casos/vacia/")).rejects.toThrow(/no contiene archivos/);
      await expect(repo.obtenerUrlsDicom(null)).rejects.toThrow(/no tiene archivo/);
    });

    it("si alguna URL no se pudo firmar, falla en vez de mostrar una serie incompleta", async () => {
      const cliente = crearClienteFalso({
        bucket: {
          list: vi.fn(async () => ({ data: [{ name: "a.dcm" }, { name: "b.dcm" }], error: null })),
          createSignedUrls: vi.fn(async () => ({
            data: [
              { path: "casos/x/a.dcm", signedUrl: "https://ok", error: null },
              { path: "casos/x/b.dcm", signedUrl: null, error: "Object not found" },
            ],
            error: null,
          })),
        },
      });
      await expect(new SupabaseRepository(cliente).obtenerUrlsDicom("casos/x/")).rejects.toThrow(
        /casos\/x\/b\.dcm/
      );
    });
  });
});
