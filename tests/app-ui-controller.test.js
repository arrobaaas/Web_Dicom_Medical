import { describe, it, expect, vi, beforeEach } from "vitest";
import AppUIController from "../js/app-ui-controller.js";
import PatientModel from "../js/patient-model.js";

function montarDom() {
  document.body.innerHTML = `
    <span id="contador"></span>
    <table><tbody id="tabla"></tbody></table>
    <section id="visor">
      <p id="info"></p>
      <div id="toolbar"><button data-accion="zoom-in"></button><button data-accion="reset"></button></div>
      <select id="preset"><option value="original"></option><option value="pulmon"></option><option value="personalizada"></option></select>
      <div id="estado"><p id="estado-texto"></p></div>
      <div id="cortes" hidden><span id="cortes-texto"></span><input id="slider" type="range"></div>
      <div id="si"></div><div id="sd"></div><div id="ii"></div><div id="id"></div>
    </section>`;
  const $ = (id) => document.getElementById(id);
  return {
    tablaCuerpo: $("tabla"),
    contador: $("contador"),
    visorSeccion: $("visor"),
    visorEstado: $("estado"),
    visorEstadoTexto: $("estado-texto"),
    visorInfo: $("info"),
    visorToolbar: $("toolbar"),
    visorPreset: $("preset"),
    cortes: $("cortes"),
    cortesTexto: $("cortes-texto"),
    cortesSlider: $("slider"),
    overlay: { supIzq: $("si"), supDer: $("sd"), infIzq: $("ii"), infDer: $("id") },
  };
}

const fila = (cambios = {}) => ({
  id: crypto.randomUUID(),
  paciente_id_anonimo: "PAC-001",
  modalidad: "TAC",
  patologia: "Neumonía",
  descripcion_clinica: "Descripción",
  archivo_dicom_path: "pac-001.dcm",
  ...cambios,
});

function crearControlador({ filas = [fila()], engine = null, repo = {} } = {}) {
  const elementos = montarDom();
  const supabaseRepository = {
    obtenerTodos: vi.fn(async () => filas),
    obtenerUrlsDicom: vi.fn(async () => ["https://x/a.dcm"]),
    ...repo,
  };
  const ui = new AppUIController({
    patientModel: PatientModel,
    supabaseRepository,
    elementos,
    dicomViewerEngine: engine,
  });
  return { ui, elementos, supabaseRepository };
}

function crearMotorFalso(meta = {}) {
  return {
    constructor: { WL_PRESETS: { pulmon: { nombre: "Pulmón" } } },
    clear: vi.fn(),
    renderSerie: vi.fn(async () => true),
    getMetadata: vi.fn(() => ({ modalidad: "CT", unidadesHounsfield: true, ...meta })),
    zoom: vi.fn(),
    reset: vi.fn(),
    irACorte: vi.fn(),
    applyPreset: vi.fn(),
    restoreDefaultWindowing: vi.fn(),
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // jsdom no implementa matchMedia (la app la usa para el scroll en móvil)
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe("lista de casos", () => {
  it("renderiza una fila por caso y el contador", async () => {
    const { ui, elementos } = crearControlador({
      filas: [fila(), fila({ paciente_id_anonimo: "PAC-002" })],
    });
    await ui.cargarYRenderizar();
    expect(elementos.tablaCuerpo.querySelectorAll("tr[tabindex]")).toHaveLength(2);
    expect(elementos.contador.textContent).toBe("2 casos");
  });

  it("SEGURIDAD: el contenido de la base se muestra como texto, nunca como HTML (XSS)", async () => {
    const ataque = '<img src=x onerror="window.__xss = true">';
    const { ui, elementos } = crearControlador({
      filas: [fila({ patologia: ataque, descripcion_clinica: ataque })],
    });
    await ui.cargarYRenderizar();

    expect(elementos.tablaCuerpo.querySelector("img")).toBeNull();
    expect(elementos.tablaCuerpo.textContent).toContain(ataque);
    expect(window.__xss).toBeUndefined();
  });

  it("descarta filas inválidas sin romper la lista", async () => {
    const { ui, elementos } = crearControlador({ filas: [fila(), fila({ modalidad: "???" })] });
    await ui.cargarYRenderizar();
    expect(elementos.tablaCuerpo.querySelectorAll("tr[tabindex]")).toHaveLength(1);
  });

  it("muestra un mensaje si no hay casos y otro si falla la carga", async () => {
    const vacio = crearControlador({ filas: [] });
    await vacio.ui.cargarYRenderizar();
    expect(vacio.elementos.tablaCuerpo.textContent).toMatch(/no hay casos/);

    const roto = crearControlador({
      repo: { obtenerTodos: vi.fn(async () => Promise.reject(new Error("sin red"))) },
    });
    await roto.ui.cargarYRenderizar();
    expect(roto.elementos.tablaCuerpo.textContent).toMatch(/sin red/);
  });

  it("marca la serie con una etiqueta y avisa si falta el archivo", async () => {
    const { ui, elementos } = crearControlador({
      filas: [fila({ archivo_dicom_path: "casos/x/" }), fila({ archivo_dicom_path: null })],
    });
    await ui.cargarYRenderizar();
    const texto = elementos.tablaCuerpo.textContent;
    expect(texto).toMatch(/Serie/);
    expect(texto).toMatch(/Sin archivo DICOM/);
  });
});

describe("abrir un caso en el visor", () => {
  it("clic en la fila: pide las URLs, renderiza la serie y marca la fila activa", async () => {
    const engine = crearMotorFalso();
    const { ui, elementos, supabaseRepository } = crearControlador({ engine });
    await ui.cargarYRenderizar();

    const tr = elementos.tablaCuerpo.querySelector("tr[tabindex]");
    tr.click();
    await vi.waitFor(() => expect(engine.renderSerie).toHaveBeenCalledWith(["https://x/a.dcm"]));

    expect(supabaseRepository.obtenerUrlsDicom).toHaveBeenCalledWith("pac-001.dcm");
    expect(engine.clear).toHaveBeenCalled();
    expect(tr.getAttribute("aria-current")).toBe("true");
    expect(elementos.visorInfo.textContent).toBe("PAC-001 · TAC · Neumonía");
  });

  it("presets: activos en TAC con UH, desactivados en RX o en capturas sin UH", async () => {
    const abrir = async (cambios, meta) => {
      const engine = crearMotorFalso(meta);
      const { ui, elementos } = crearControlador({ engine, filas: [fila(cambios)] });
      await ui.cargarYRenderizar();
      await ui.navegarAlVisor(ui.pacientes[0]);
      return elementos.visorPreset;
    };
    expect((await abrir({}, {})).disabled).toBe(false);
    expect((await abrir({ modalidad: "RX" }, {})).disabled).toBe(true);
    const captura = await abrir({}, { unidadesHounsfield: false });
    expect(captura.disabled).toBe(true);
    expect(captura.title).toMatch(/Hounsfield/);
  });

  it("muestra el error si la carga falla", async () => {
    const engine = crearMotorFalso();
    engine.renderSerie.mockRejectedValueOnce(new Error("CORS bloqueado"));
    const { ui, elementos } = crearControlador({ engine });
    await ui.cargarYRenderizar();
    await ui.navegarAlVisor(ui.pacientes[0]);
    expect(elementos.visorEstadoTexto.textContent).toBe("CORS bloqueado");
    expect(elementos.visorEstado.classList.contains("hidden")).toBe(false);
  });

  it("sin motor (Cornerstone no cargó) avisa en vez de romper", async () => {
    const { ui, elementos } = crearControlador({ engine: null });
    await ui.cargarYRenderizar();
    await ui.navegarAlVisor(ui.pacientes[0]);
    expect(elementos.visorEstadoTexto.textContent).toMatch(/no está disponible/);
  });
});

describe("overlay y barra de cortes", () => {
  const estado = (cambios = {}) => ({
    loaded: true,
    windowWidth: 1500,
    windowCenter: -600,
    scale: 1.5,
    invert: false,
    ventana: "pulmon",
    corte: 3,
    totalCortes: 29,
    cortesCargados: 29,
    ...cambios,
  });

  it("escribe W/L, nombre de la ventana y número de corte; sincroniza el selector", () => {
    const { ui, elementos } = crearControlador({ engine: crearMotorFalso() });
    ui.renderizarOverlay(estado());
    expect(elementos.overlay.infIzq.textContent).toBe("W 1500  L -600\nVentana pulmón");
    expect(elementos.overlay.infDer.textContent).toMatch(/^Corte 3 \/ 29/);
    expect(elementos.visorPreset.value).toBe("pulmon");
    expect(elementos.cortes.hidden).toBe(false);
    expect(elementos.cortesSlider.max).toBe("29");
  });

  it("oculta la barra con una sola imagen y muestra el % durante la precarga", () => {
    const { ui, elementos } = crearControlador({ engine: crearMotorFalso() });
    ui.renderizarOverlay(estado({ totalCortes: 1, corte: 1 }));
    expect(elementos.cortes.hidden).toBe(true);

    ui.renderizarOverlay(estado({ cortesCargados: 10, totalCortes: 40 }));
    expect(elementos.cortesTexto.textContent).toBe("25%");
  });

  it("al mover la barra pide el corte correspondiente (base 0)", () => {
    const engine = crearMotorFalso();
    const { elementos } = crearControlador({ engine });
    elementos.cortesSlider.max = "29";
    elementos.cortesSlider.value = "12";
    elementos.cortesSlider.dispatchEvent(new Event("input"));
    expect(engine.irACorte).toHaveBeenCalledWith(11);
  });
});
