import { describe, it, expect, vi, beforeEach } from "vitest";
import CaseFormController from "../js/case-form-controller.js";
import PatientModel from "../js/patient-model.js";

// jsdom no implementa <dialog>.showModal()/close()
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

function montarDom() {
  document.body.innerHTML = `
    <button id="btn-login"></button>
    <div id="sesion" hidden><span id="email"></span>
      <button id="btn-nuevo"></button><button id="btn-salir"></button></div>
    <dialog id="dlg-login"><form id="form-login">
      <input name="email"><input name="password">
      <p id="err-login" hidden></p><button id="btn-entrar">Entrar</button></form></dialog>
    <dialog id="dlg-subida"><form id="form-subida">
      <input id="archivo" type="file" multiple>
      <p id="info" hidden></p><p id="aviso" hidden></p>
      <input id="id" name="paciente_id_anonimo">
      <select id="modalidad" name="modalidad"></select>
      <input name="patologia"><textarea name="descripcion_clinica"></textarea>
      <p id="err-subida" hidden></p><button id="btn-subir">Subir caso</button>
      <button type="button" data-cerrar>Cancelar</button></form></dialog>`;
  const $ = (id) => document.getElementById(id);
  return {
    btnLogin: $("btn-login"),
    sesionActiva: $("sesion"),
    sesionEmail: $("email"),
    btnNuevoCaso: $("btn-nuevo"),
    btnLogout: $("btn-salir"),
    dialogoLogin: $("dlg-login"),
    formLogin: $("form-login"),
    errorLogin: $("err-login"),
    btnEnviarLogin: $("btn-entrar"),
    dialogoSubida: $("dlg-subida"),
    formSubida: $("form-subida"),
    inputArchivo: $("archivo"),
    inputId: $("id"),
    selectModalidad: $("modalidad"),
    infoArchivo: $("info"),
    avisoIdentificativo: $("aviso"),
    errorSubida: $("err-subida"),
    btnEnviarSubida: $("btn-subir"),
  };
}

/** Archivo falso: el inspector simulado devuelve su `info`. */
const dcm = (name, info = {}) => ({ name, size: 1000, info: { modalidadDicom: "CT", ...info } });

function crear({ usuario = { email: "docente@ejemplo.com" }, ids = ["PAC-001"], repo = {} } = {}) {
  const el = montarDom();
  let notificar;
  const authService = {
    alCambiar: vi.fn((cb) => (notificar = cb)),
    obtenerUsuario: vi.fn(async () => usuario),
    iniciarSesion: vi.fn(async () => ({})),
    cerrarSesion: vi.fn(async () => {}),
  };
  const supabaseRepository = {
    validarArchivoDicom: vi.fn(),
    registrarCaso: vi.fn(async () => ({ id: "nuevo" })),
    ...repo,
  };
  const inspector = {
    inspeccionarArchivo: vi.fn(async (f) => {
      if (f.info.error) throw new Error(f.info.error);
      return f.info;
    }),
  };
  const onCasoCreado = vi.fn();
  const ctrl = new CaseFormController({
    authService,
    supabaseRepository,
    patientModel: PatientModel,
    inspector,
    elementos: el,
    obtenerIdsExistentes: () => ids,
    onCasoCreado,
  });
  return { ctrl, el, authService, supabaseRepository, inspector, onCasoCreado, notificar: (u) => notificar(u) };
}

/** Simula elegir archivos en el <input type="file"> y espera la inspección. */
async function elegir(el, archivos) {
  Object.defineProperty(el.inputArchivo, "files", { value: archivos, configurable: true });
  el.inputArchivo.dispatchEvent(new Event("change"));
  await new Promise((r) => setTimeout(r, 0));
}

const enviar = async (form) => {
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("sesión", () => {
  it("muestra 'Iniciar sesión' sin usuario y 'Nuevo caso' con usuario", async () => {
    const { ctrl, el, notificar } = crear({ usuario: null });
    await ctrl.iniciar();
    expect(el.btnLogin.hidden).toBe(false);
    expect(el.sesionActiva.hidden).toBe(true);

    notificar({ email: "docente@ejemplo.com" });
    expect(el.btnLogin.hidden).toBe(true);
    expect(el.sesionActiva.hidden).toBe(false);
    expect(el.sesionEmail.textContent).toBe("docente@ejemplo.com");
  });

  it("si la sesión caduca con el formulario abierto, lo cierra", async () => {
    const { ctrl, el, notificar } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    expect(el.dialogoSubida.open).toBe(true);
    notificar(null);
    expect(el.dialogoSubida.open).toBe(false);
  });

  it("muestra el error de login y restaura el botón", async () => {
    const { ctrl, el, authService } = crear({ usuario: null });
    authService.iniciarSesion.mockRejectedValueOnce(new Error("Email o contraseña incorrectos."));
    await ctrl.iniciar();
    el.btnLogin.click();
    await enviar(el.formLogin);
    expect(el.errorLogin.hidden).toBe(false);
    expect(el.errorLogin.textContent).toBe("Email o contraseña incorrectos.");
    expect(el.btnEnviarLogin.disabled).toBe(false);
    expect(el.btnEnviarLogin.textContent).toBe("Entrar");
  });
});

describe("formulario de nuevo caso", () => {
  it("al abrirse propone el siguiente ID libre y ofrece las modalidades del modelo", async () => {
    const { ctrl, el } = crear({ ids: ["PAC-001", "PAC-004"] });
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    expect(el.inputId.value).toBe("PAC-005");
    expect([...el.selectModalidad.options].map((o) => o.value)).toEqual(PatientModel.MODALIDADES);
  });

  it("rellena la modalidad desde la cabecera DICOM (CT -> TAC, MR -> MRI)", async () => {
    const { ctrl, el } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("a.dcm", { modalidadDicom: "MR" })]);
    expect(el.selectModalidad.value).toBe("MRI");
    expect(el.infoArchivo.textContent).toMatch(/^DICOM válido · MR/);
  });

  it("serie: ordena los archivos de forma natural e informa del número de cortes", async () => {
    const { ctrl, el, supabaseRepository } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("corte_10.dcm"), dcm("corte_2.dcm"), dcm("corte_1.dcm")]);
    expect(el.infoArchivo.textContent).toMatch(/Serie DICOM válida · 3 cortes/);

    el.formSubida.elements.patologia.value = "Tumor de Pancoast";
    await enviar(el.formSubida);
    const [payload, archivos] = supabaseRepository.registrarCaso.mock.calls[0];
    expect(archivos.map((a) => a.name)).toEqual(["corte_1.dcm", "corte_2.dcm", "corte_10.dcm"]);
    expect(payload).toMatchObject({ paciente_id_anonimo: "PAC-002", modalidad: "TAC" });
  });

  it.each(["Anonymized", "ANONYMOUS", "anónimo", "^"])(
    "no avisa si el nombre del paciente es un marcador de anonimización (%s)",
    async (nombre) => {
      const { ctrl, el } = crear();
      await ctrl.iniciar();
      el.btnNuevoCaso.click();
      await elegir(el, [dcm("a.dcm", { nombrePaciente: nombre })]);
      expect(el.avisoIdentificativo.hidden).toBe(true);
    }
  );

  it("avisa si algún corte trae nombre o fecha de nacimiento reales", async () => {
    const { ctrl, el } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("1.dcm"), dcm("2.dcm", { nombrePaciente: "Perez^Juan", fechaNacimiento: "19700101" })]);
    expect(el.avisoIdentificativo.hidden).toBe(false);
    expect(el.avisoIdentificativo.textContent).toMatch(/Perez\^Juan/);
    expect(el.avisoIdentificativo.textContent).toMatch(/19700101/);
  });

  it("un solo archivo inválido invalida la serie e indica cuál es", async () => {
    const { ctrl, el, supabaseRepository } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("1.dcm"), dcm("foto.dcm", { error: "no tiene la firma DICM" })]);
    expect(el.errorSubida.textContent).toBe("foto.dcm: no tiene la firma DICM");

    el.formSubida.elements.patologia.value = "X";
    await enviar(el.formSubida);
    expect(supabaseRepository.registrarCaso).not.toHaveBeenCalled();
  });

  it("no sube si el ID ya existe ni si los datos no validan", async () => {
    const { ctrl, el, supabaseRepository } = crear({ ids: ["PAC-001"] });
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("a.dcm")]);

    el.inputId.value = "pac-001";
    el.formSubida.elements.patologia.value = "X";
    await enviar(el.formSubida);
    expect(el.errorSubida.textContent).toBe("Ya existe un caso con el ID PAC-001.");

    el.inputId.value = "PAC-009";
    el.formSubida.elements.patologia.value = "";
    await enviar(el.formSubida);
    expect(el.errorSubida.textContent).toMatch(/patología es obligatoria/);
    expect(supabaseRepository.registrarCaso).not.toHaveBeenCalled();
  });

  it("al subir con éxito cierra el diálogo y notifica el caso creado", async () => {
    const { ctrl, el, onCasoCreado } = crear();
    await ctrl.iniciar();
    el.btnNuevoCaso.click();
    await elegir(el, [dcm("a.dcm")]);
    el.formSubida.elements.patologia.value = "Neumonía";
    await enviar(el.formSubida);
    expect(el.dialogoSubida.open).toBe(false);
    expect(onCasoCreado).toHaveBeenCalledWith({ id: "nuevo" });
  });
});
