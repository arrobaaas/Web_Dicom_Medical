/**
 * main.js
 * -------
 * Punto de entrada de la aplicación PACS Web.
 *
 * Responsabilidades:
 *  - Instanciar los clientes y repositorios (inyección de dependencias).
 *  - Registrar el AppUIController.
 *  - Ejecutar la carga inicial de la lista clínica.
 */

// Cliente de Supabase (Fase 2)
// Versión fijada: un rango como "@2" podría cambiar sin aviso y romper la app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Clases de dominio, repositorio, visor y UI
import PatientModel from './patient-model.js';
import SupabaseRepository from './supabase-repository.js';
import AppUIController from './app-ui-controller.js';
import DicomViewerEngine from './dicom-viewer-engine.js';
import AuthService from './auth-service.js';
import CaseFormController from './case-form-controller.js';

// Configuración de Supabase (proyecto: fbkasxnzaaedcatuimgt)
// La anon key está pensada para ser pública: lo que protege tus datos son las
// políticas RLS (supabase/schema.sql), no ocultar esta clave.
const SUPABASE_URL = 'https://fbkasxnzaaedcatuimgt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZia2FzeG56YWFlZGNhdHVpbWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMjYwMzQsImV4cCI6MjEwODgwMjAzNH0.9qWPttSqv78pP116TzGJ2ybRC3dbZxVhoyjIBSQfZOg';

// OJO: el orden correcto es (URL, KEY). Antes estaban invertidos.
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseRepository = new SupabaseRepository(supabase);
const authService = new AuthService(supabase);

// Referencias del DOM
const elementos = {
    tablaCuerpo:      document.getElementById('tabla-cuerpo'),
    contador:         document.getElementById('lista-contador'),
    visorSeccion:     document.getElementById('visor-dicom'),
    visorDicomCanvas: document.getElementById('visor-dicom-canvas'),
    visorEstado:      document.getElementById('visor-dicom-estado'),
    visorEstadoTexto: document.getElementById('visor-dicom-estado-texto'),
    visorInfo:        document.getElementById('visor-dicom-info'),
    visorToolbar:     document.getElementById('visor-toolbar'),
    visorPreset:      document.getElementById('visor-preset'),
    // Barra de cortes (series)
    cortes:           document.getElementById('visor-cortes'),
    cortesTexto:      document.getElementById('visor-cortes-texto'),
    cortesSlider:     document.getElementById('visor-cortes-slider'),
    // Textos superpuestos en las 4 esquinas de la imagen
    overlay: {
        supIzq: document.getElementById('overlay-sup-izq'),
        supDer: document.getElementById('overlay-sup-der'),
        infIzq: document.getElementById('overlay-inf-izq'),
        infDer: document.getElementById('overlay-inf-der'),
    },
};

// El visor puede fallar (p. ej. faltan los archivos de js/vendor). Si pasa,
// la lista clínica debe seguir funcionando y el usuario ve un mensaje claro.
let dicomViewerEngine = null;
try {
    dicomViewerEngine = new DicomViewerEngine(
        document.getElementById('visor-dicom-canvas'),
        // appController se declara más abajo; esta función solo se ejecuta
        // cuando ya existe (al renderizar una imagen).
        { onChange: (estado) => appController.renderizarOverlay(estado) }
    );
} catch (error) {
    console.error('No se pudo inicializar el visor DICOM:', error);
    if (elementos.visorEstado) {
        elementos.visorEstadoTexto.textContent = error.message;
        elementos.visorEstado.classList.add('text-red-400');
    }
}

const appController = new AppUIController({
    patientModel: PatientModel,
    supabaseRepository,
    elementos,
    dicomViewerEngine,
});

// Fase 5: sesión y alta de casos
const byId = (id) => document.getElementById(id);
const caseFormController = new CaseFormController({
    authService,
    supabaseRepository,
    patientModel: PatientModel,
    inspector: DicomViewerEngine,
    elementos: {
        btnLogin:            byId('btn-login'),
        sesionActiva:        byId('sesion-activa'),
        sesionEmail:         byId('sesion-email'),
        btnNuevoCaso:        byId('btn-nuevo-caso'),
        btnLogout:           byId('btn-logout'),
        dialogoLogin:        byId('dialogo-login'),
        formLogin:           byId('form-login'),
        errorLogin:          byId('login-error'),
        btnEnviarLogin:      byId('btn-enviar-login'),
        dialogoSubida:       byId('dialogo-subida'),
        formSubida:          byId('form-subida'),
        inputArchivo:        byId('subida-archivo'),
        inputId:             byId('subida-id'),
        selectModalidad:     byId('subida-modalidad'),
        infoArchivo:         byId('subida-info'),
        avisoIdentificativo: byId('subida-aviso'),
        errorSubida:         byId('subida-error'),
        btnEnviarSubida:     byId('btn-enviar-subida'),
    },
    obtenerIdsExistentes: () => appController.pacientes.map((p) => p.pacienteIdAnonimo),
    // Tras crear un caso: recargar la lista y abrirlo directamente en el visor
    onCasoCreado: async (fila) => {
        await appController.cargarYRenderizar();
        appController.abrirPorId(fila.id);
    },
});

// Inicialización de la app (los módulos ES ya se ejecutan con el DOM listo)
await Promise.all([caseFormController.iniciar(), appController.cargarYRenderizar()]);
