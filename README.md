# 🏥 Web_Dicom_Medical — PACS Web App

Plataforma web tipo PACS (Picture Archiving and Communication System) para la
gestión y visualización de imágenes médicas en formato DICOM.

## Objetivo
Permitir el listado de casos clínicos con:
- **ID de paciente**
- **Modalidad** (RX, TAC, MRI, etc.)
- **Patología** (Neumonía, Neoplasia, etc.)

...junto con la visualización de los archivos `.dcm` asociados.

## Stack
- Frontend: HTML5, CSS3, Tailwind CSS
- Visor médico: Cornerstone.js / DWV (Canvas)
- Backend / Cloud: Supabase (PostgreSQL + Storage + Auth)
- Deploy: GitHub Pages

## Estado del proyecto
- [x] Fase 1 — Repositorio Git/GitHub inicializado
- [ ] Fase 2 — Base de datos y Storage en Supabase
- [ ] Fase 3 — Modelos base y render de lista clínica
- [ ] Fase 4 — Visor DICOM (`DicomViewerEngine`)
- [ ] Fase 5 — Subida / autenticación
- [ ] Fase 6 — Deploy en GitHub Pages
