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
// TODO (producción): mover la anon key a variables de entorno / .env
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Clases de dominio y repositorio (Fase 3)
import PatientModel from './patient-model.js';
import SupabaseRepository from './supabase-repository.js';
import { AppUIController } from './app-ui-controller.js';

// Configuración de Supabase (proyecto: fbkasxnzaaedcatuimgt)
const SUPABASE_URL = 'https://fbkasxnzaaedcatuimgt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZia2FzeG56YWFlZGNhdHVpbWd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMjYwMzQsImV4cCI6MjEwODgwMjAzNH0.9qWPttSqv78pP116TzGJ2ybRC3dbZxVhoyjIBSQfZOg';

const supabase = createClient(SUPABASE_ANON_KEY, SUPABASE_URL);

const supabaseRepository = new SupabaseRepository(supabase);

const appController = new AppUIController({
    patientModel: PatientModel,
    supabaseRepository: supabaseRepository,
    elementos: {
        tablaCuerpo: document.getElementById('tabla-cuerpo'),
    },
});

// Inicialización de la app
document.addEventListener('DOMContentLoaded', async () => {
    await appController.cargarYRenderizar();
});
