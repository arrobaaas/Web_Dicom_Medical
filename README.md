# 🏥 Web_Dicom_Medical — PACS Web App

Plataforma web tipo PACS (Picture Archiving and Communication System) para la
gestión y visualización de imágenes médicas en formato DICOM, orientada a
estudiantes de ciencias de la salud.

## Objetivo
Permitir el listado de casos clínicos con:
- **ID anónimo de paciente** (ej. `PAC-001`)
- **Modalidad** (RX, TAC, MRI, US, NM, PT, OTHER)
- **Patología** y **descripción clínica**

...junto con la visualización de los archivos `.dcm` asociados directamente en
el navegador (windowing, zoom, pan, inversión y presets de ventana para TAC).

## Stack
- Paradigma: Programación Orientada a Objetos (clases ES6+, módulos ES)
- Frontend: HTML5, CSS3, Tailwind CSS (CDN)
- Visor médico: Cornerstone.js (legacy) en Canvas, encapsulado en `DicomViewerEngine`
- Backend / Cloud: Supabase (PostgreSQL + Storage + Auth)
- Deploy: GitHub Pages (estático)

## Arquitectura (clases)
| Clase | Archivo | Responsabilidad |
|-------|---------|-----------------|
| `PatientModel` | `js/patient-model.js` | Modelo de dominio de un caso clínico |
| `SupabaseRepository` | `js/supabase-repository.js` | Queries a `pacientes` y archivos en Storage |
| `DicomViewerEngine` | `js/dicom-viewer-engine.js` | Carga y manipulación de la imagen DICOM |
| `AppUIController` | `js/app-ui-controller.js` | Eventos del DOM, tabla y visor |
| `AuthService` | `js/auth-service.js` | Inicio y cierre de sesión (Supabase Auth) |
| `CaseFormController` | `js/case-form-controller.js` | Diálogos de login y alta de casos |

`js/main.js` instancia las clases e inyecta las dependencias.

## Puesta en marcha
1. **Librerías del visor** (se sirven en local desde `js/vendor/`):
   ```bash
   bash scripts/descargar-vendor.sh
   ```
2. **Supabase:** en el panel del proyecto → *SQL Editor*, ejecuta
   `supabase/schema.sql` completo (es idempotente).
3. **Archivo de prueba:** en *Storage* → bucket `dicom`, sube un `.dcm` con el
   nombre exacto `pac-001.dcm`.
4. **Cuentas de docentes (Fase 5):** en *Authentication → Users → Add user*
   crea cada cuenta con email y contraseña (marca *Auto Confirm User*).
   Después, en *Authentication → Sign In / Providers*, **desactiva
   "Allow new users to sign up"**: si no, cualquiera podría registrarse con la
   anon key y obtener permisos de escritura.
5. **Servidor local** (los módulos ES no funcionan abriendo el HTML con `file://`):
   ```bash
   python3 -m http.server 8000
   ```
   y abre <http://localhost:8000>.

## Seguridad
- La anon key de `js/main.js` es pública por diseño; lo que protege los datos
  son las políticas RLS de `supabase/schema.sql`.
- Lectura de casos y archivos: cualquiera. Escritura (crear, editar, borrar,
  subir): solo usuarios autenticados, y el registro público debe estar desactivado.
- El bucket `dicom` limita en el servidor el tamaño (50 MB) y el tipo
  (`application/dicom`).
- Antes de subir, la app comprueba la firma `DICM` y avisa si la cabecera
  contiene nombre o fecha de nacimiento del paciente.
- Usa solo estudios **anonimizados**: nunca subas DICOM con datos reales de pacientes.

## Estado del proyecto
- [x] Fase 1 — Repositorio Git/GitHub inicializado
- [x] Fase 2 — Base de datos y Storage en Supabase (tabla, RLS, bucket privado)
- [x] Fase 3 — `PatientModel`, `SupabaseRepository` y tabla de pacientes
- [x] Fase 4 — Visor DICOM (`DicomViewerEngine`)
- [x] Fase 5 — Autenticación y subida de `.dcm` con metadatos
- [ ] Fase 6 — Deploy en GitHub Pages y pruebas
