import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dicomParser from "dicom-parser";
import DicomViewerEngine, { DicomViewerError } from "../js/dicom-viewer-engine.js";
import { crearDicom, archivo } from "./helpers/dicom.js";

/** Cornerstone simulado con el estado mínimo de un viewport. */
function crearCornerstoneFalso() {
  let viewport = null;
  const porDefecto = () => ({
    voi: { windowWidth: 80, windowCenter: 40 },
    scale: 1,
    translation: { x: 0, y: 0 },
    invert: false,
  });
  return {
    enable: vi.fn(),
    disable: vi.fn(),
    resize: vi.fn(),
    loadAndCacheImage: vi.fn(async (imageId) => ({ imageId, rows: 512, columns: 512, data: null })),
    getDefaultViewportForImage: vi.fn(porDefecto),
    displayImage: vi.fn((_el, _img, vp) => {
      viewport = structuredClone(vp ?? porDefecto());
    }),
    getViewport: vi.fn(() => viewport && structuredClone(viewport)),
    setViewport: vi.fn((_el, vp) => {
      viewport = structuredClone(vp);
    }),
    reset: vi.fn(() => {
      viewport = porDefecto();
    }),
  };
}

let cs;
let contenedor;

beforeEach(() => {
  cs = crearCornerstoneFalso();
  window.cornerstone = cs;
  window.cornerstoneWADOImageLoader = { external: {} };
  window.dicomParser = dicomParser;
  // jsdom no implementa ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
});

afterEach(() => {
  contenedor.remove();
  delete window.cornerstone;
});

const urls = (n) => Array.from({ length: n }, (_, i) => `https://x/corte_${i + 1}.dcm`);
const idMostrado = () => cs.displayImage.mock.lastCall[1].imageId;

describe("constructor", () => {
  it("rechaza un <canvas> (Cornerstone necesita un contenedor)", () => {
    expect(() => new DicomViewerEngine(document.createElement("canvas"))).toThrow(DicomViewerError);
  });

  it("falla con un mensaje útil si Cornerstone no está cargado", () => {
    delete window.cornerstone;
    expect(() => new DicomViewerEngine(contenedor)).toThrow(/js\/vendor/);
  });

  it("habilita el contenedor y lo hace enfocable para el teclado", () => {
    new DicomViewerEngine(contenedor);
    expect(cs.enable).toHaveBeenCalledWith(contenedor);
    expect(contenedor.tabIndex).toBe(0);
  });
});

describe("carga de imágenes", () => {
  it("renderSerie() muestra el primer corte con el prefijo wadouri:", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await expect(motor.renderSerie(urls(3))).resolves.toBe(true);
    expect(idMostrado()).toBe("wadouri:https://x/corte_1.dcm");
    expect(motor.totalCortes).toBe(3);
  });

  it("rechaza URLs vacías", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await expect(motor.renderSerie([])).rejects.toThrow(DicomViewerError);
    await expect(motor.renderDicom("")).rejects.toThrow(DicomViewerError);
  });

  it("una carga lenta que llega tarde NO pisa a la más reciente", async () => {
    let liberarLenta;
    cs.loadAndCacheImage.mockImplementationOnce(
      (imageId) => new Promise((ok) => (liberarLenta = () => ok({ imageId, rows: 1, columns: 1 })))
    );
    const motor = new DicomViewerEngine(contenedor);

    const lenta = motor.renderDicom("https://x/lenta.dcm");
    await motor.renderDicom("https://x/rapida.dcm");
    liberarLenta();

    await expect(lenta).resolves.toBe(false);
    expect(idMostrado()).toBe("wadouri:https://x/rapida.dcm");
  });

  it("convierte los fallos de carga en DicomViewerError", async () => {
    cs.loadAndCacheImage.mockRejectedValueOnce(new Error("404"));
    const motor = new DicomViewerEngine(contenedor);
    await expect(motor.renderDicom("https://x/no-existe.dcm")).rejects.toThrow(DicomViewerError);
  });
});

describe("navegación por la serie", () => {
  it("irACorte() limita el índice y conserva zoom y ventana", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderSerie(urls(5));
    motor.zoom(2);
    motor.applyPreset("pulmon");

    await motor.irACorte(99);
    expect(idMostrado()).toBe("wadouri:https://x/corte_5.dcm");
    const vp = cs.displayImage.mock.lastCall[2];
    expect(vp.scale).toBe(2);
    expect(vp.voi).toEqual({ windowWidth: 1500, windowCenter: -600 });

    await motor.irACorte(-3);
    expect(motor.getState().corte).toBe(1);
  });

  it("la rueda cambia de corte (1 por clic) y Ctrl + rueda hace zoom", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderSerie(urls(10));
    const rueda = (opciones) =>
      contenedor.dispatchEvent(new WheelEvent("wheel", { cancelable: true, deltaMode: 0, ...opciones }));

    rueda({ deltaY: 100 });
    rueda({ deltaY: 100 });
    expect(motor.getState().corte).toBe(3);

    rueda({ deltaY: 40 }); // trackpad: se acumula sin cambiar de corte
    expect(motor.getState().corte).toBe(3);
    rueda({ deltaY: 60 });
    expect(motor.getState().corte).toBe(4);

    const escalaAntes = motor.getState().scale;
    rueda({ deltaY: -100, ctrlKey: true });
    expect(motor.getState().corte).toBe(4);
    expect(motor.getState().scale).toBeGreaterThan(escalaAntes);
  });

  it("con una sola imagen, la rueda hace zoom", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderDicom("https://x/uno.dcm");
    contenedor.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    expect(motor.getState().scale).toBeGreaterThan(1);
  });

  it("teclado: flechas, Inicio y Fin", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderSerie(urls(8));
    const tecla = (key) => contenedor.dispatchEvent(new KeyboardEvent("keydown", { key }));

    tecla("End");
    expect(motor.getState().corte).toBe(8);
    tecla("ArrowUp");
    expect(motor.getState().corte).toBe(7);
    tecla("Home");
    expect(motor.getState().corte).toBe(1);
  });
});

describe("ventana (W/L)", () => {
  it("getState().ventana refleja la ventana REAL: original, preset o personalizada", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderDicom("https://x/cerebro.dcm");
    expect(motor.getState().ventana).toBe("original");

    motor.applyPreset("hueso");
    expect(motor.getState().ventana).toBe("hueso");

    motor.setWindowing(123, 45);
    expect(motor.getState().ventana).toBe("personalizada");

    motor.restoreDefaultWindowing();
    expect(motor.getState().ventana).toBe("original");
  });

  it("el ancho de ventana nunca baja de 1 y un preset desconocido lanza error", async () => {
    const motor = new DicomViewerEngine(contenedor);
    await motor.renderDicom("https://x/a.dcm");
    motor.setWindowing(-50, 0);
    expect(motor.getState().windowWidth).toBe(1);
    expect(() => motor.applyPreset("inventado")).toThrow(/Preset desconocido/);
  });

  it("sin imagen cargada, las operaciones no hacen nada", () => {
    const motor = new DicomViewerEngine(contenedor);
    motor.zoom(2);
    motor.applyPreset("pulmon");
    expect(motor.getState()).toEqual({ loaded: false });
    expect(cs.setViewport).not.toHaveBeenCalled();
  });
});

describe("DicomViewerEngine.inspeccionarArchivo()", () => {
  it("lee modalidad, región, descripción y datos del paciente de la cabecera", async () => {
    const bytes = crearDicom({
      modalidad: "CT",
      regionAnatomica: "CHEST",
      descripcionEstudio: "TC torax",
      nombrePaciente: "Doe^John",
      fechaNacimiento: "19800101",
    });
    const info = await DicomViewerEngine.inspeccionarArchivo(archivo(bytes));
    expect(info).toMatchObject({
      modalidadDicom: "CT",
      regionAnatomica: "CHEST",
      descripcionEstudio: "TC torax",
      nombrePaciente: "Doe^John",
      fechaNacimiento: "19800101",
    });
  });

  it("rechaza archivos sin la firma DICM (p. ej. un PNG renombrado a .dcm)", async () => {
    const png = new Uint8Array(300);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    await expect(DicomViewerEngine.inspeccionarArchivo(archivo(png, "falso.dcm"))).rejects.toThrow(/DICM/);
  });
});
