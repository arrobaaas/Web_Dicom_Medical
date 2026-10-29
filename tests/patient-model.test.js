import { describe, it, expect, vi } from "vitest";
import PatientModel from "../js/patient-model.js";

const filaValida = {
  id: "8c1f0d2e-0000-4000-8000-000000000001",
  paciente_id_anonimo: "PAC-001",
  modalidad: "TAC",
  patologia: "TAC de cerebro (muestra)",
  descripcion_clinica: "Corte axial",
  archivo_dicom_path: "pac-001.dcm",
  created_at: "2026-10-28T20:00:00Z",
};

describe("PatientModel.fromSupabase", () => {
  it("convierte una fila snake_case en un modelo camelCase", () => {
    const p = PatientModel.fromSupabase(filaValida);
    expect(p).toBeInstanceOf(PatientModel);
    expect(p.pacienteIdAnonimo).toBe("PAC-001");
    expect(p.archivoDicomPath).toBe("pac-001.dcm");
    expect(p.getNombrePaciente()).toBe("PAC-001");
  });

  it("devuelve null (sin lanzar) si la fila es inválida, para no romper la lista", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(PatientModel.fromSupabase({ ...filaValida, modalidad: "XYZ" })).toBeNull();
    expect(PatientModel.fromSupabase({ ...filaValida, patologia: "" })).toBeNull();
    expect(PatientModel.fromSupabase(null)).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("toJSON() devuelve el formato de la tabla (ida y vuelta)", () => {
    expect(PatientModel.fromSupabase(filaValida).toJSON()).toEqual(filaValida);
  });
});

describe("tieneDicom / esSerie / admitePresetsHounsfield", () => {
  const crear = (cambios) => PatientModel.fromSupabase({ ...filaValida, ...cambios });

  it("distingue corte suelto, serie y caso sin archivo", () => {
    expect(crear({}).esSerie()).toBe(false);
    expect(crear({ archivo_dicom_path: "casos/pancoast/" }).esSerie()).toBe(true);
    expect(crear({ archivo_dicom_path: null }).tieneDicom()).toBe(false);
    expect(crear({ archivo_dicom_path: null }).esSerie()).toBe(false);
  });

  it("solo TAC admite presets en unidades Hounsfield", () => {
    expect(crear({ modalidad: "TAC" }).admitePresetsHounsfield()).toBe(true);
    expect(crear({ modalidad: "RX" }).admitePresetsHounsfield()).toBe(false);
  });
});

describe("PatientModel.modalidadDesdeCodigoDicom", () => {
  it.each([
    ["CT", "TAC"],
    ["ct", "TAC"],
    ["MR", "MRI"],
    ["CR", "RX"],
    ["DX", "RX"],
    ["US", "US"],
    ["SR", "OTHER"],
  ])("%s -> %s", (codigo, esperado) => {
    expect(PatientModel.modalidadDesdeCodigoDicom(codigo)).toBe(esperado);
  });

  it("devuelve null si la cabecera no trae modalidad", () => {
    expect(PatientModel.modalidadDesdeCodigoDicom(null)).toBeNull();
  });
});

describe("PatientModel.siguienteIdAnonimo", () => {
  it("propone el siguiente número libre con 3 dígitos", () => {
    expect(PatientModel.siguienteIdAnonimo([])).toBe("PAC-001");
    expect(PatientModel.siguienteIdAnonimo(["PAC-001", "PAC-002"])).toBe("PAC-003");
  });

  it("usa el máximo (no el total) e ignora IDs con otro formato", () => {
    expect(PatientModel.siguienteIdAnonimo(["PAC-007", "PAC-002", "CASO-X"])).toBe("PAC-008");
    expect(PatientModel.siguienteIdAnonimo(["PAC-999"])).toBe("PAC-1000");
  });
});

describe("PatientModel.validarNuevoCaso", () => {
  it("normaliza: recorta espacios, pasa el ID a mayúsculas y vacía la descripción en blanco", () => {
    expect(
      PatientModel.validarNuevoCaso({
        paciente_id_anonimo: "  pac-002 ",
        modalidad: "TAC",
        patologia: "  Tumor de Pancoast ",
        descripcion_clinica: "   ",
      })
    ).toEqual({
      paciente_id_anonimo: "PAC-002",
      modalidad: "TAC",
      patologia: "Tumor de Pancoast",
      descripcion_clinica: null,
    });
  });

  it("reúne todos los errores en un solo mensaje (uno por línea)", () => {
    let mensaje = "";
    try {
      PatientModel.validarNuevoCaso({ paciente_id_anonimo: "x", modalidad: "CT", patologia: "" });
    } catch (e) {
      mensaje = e.message;
    }
    const lineas = mensaje.split("\n");
    expect(lineas).toHaveLength(3);
    expect(mensaje).toMatch(/ID anónimo/);
    expect(mensaje).toMatch(/modalidad/);
    expect(mensaje).toMatch(/patología es obligatoria/);
  });

  it("rechaza IDs con caracteres no permitidos y textos demasiado largos", () => {
    const base = { paciente_id_anonimo: "PAC-002", modalidad: "TAC", patologia: "X" };
    expect(() => PatientModel.validarNuevoCaso({ ...base, paciente_id_anonimo: "PAC 002" })).toThrow();
    expect(() => PatientModel.validarNuevoCaso({ ...base, patologia: "a".repeat(201) })).toThrow(/200/);
    expect(() =>
      PatientModel.validarNuevoCaso({ ...base, descripcion_clinica: "a".repeat(2001) })
    ).toThrow(/2000/);
  });
});
