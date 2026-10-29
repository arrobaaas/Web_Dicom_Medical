-- ============================================================
-- Fase 2: Esquema inicial de la tabla `pacientes`
-- + bucket de Storage para archivos DICOM
-- + caso de prueba para el visor (Fase 4)
-- Este archivo es idempotente: se puede ejecutar completo varias veces.
-- ============================================================

-- 1. Tabla principal de pacientes / casos clínicos
CREATE TABLE IF NOT EXISTS public.pacientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paciente_id_anonimo TEXT NOT NULL UNIQUE,
    modalidad TEXT NOT NULL,
    patologia TEXT NOT NULL,
    descripcion_clinica TEXT,
    archivo_dicom_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1b. Restricción de modalidades (se recrea para que también se aplique a
--     tablas creadas con una versión anterior de este script).
--     'CT' era un duplicado de 'TAC': se normaliza antes de recrear el CHECK.
UPDATE public.pacientes SET modalidad = 'TAC' WHERE modalidad = 'CT';
ALTER TABLE public.pacientes DROP CONSTRAINT IF EXISTS pacientes_modalidad_check;
ALTER TABLE public.pacientes ADD CONSTRAINT pacientes_modalidad_check
    CHECK (modalidad IN ('RX', 'TAC', 'MRI', 'US', 'NM', 'PT', 'OTHER'));

-- 2. Habilitar Row Level Security
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS (DROP + CREATE para ser re-ejecutables / idempotentes)
--    - Lectura: cualquiera (los estudiantes consultan casos sin iniciar sesión).
--    - Escritura: solo usuarios autenticados (Supabase Auth, Fase 5).
--    La anon key es pública, así que SIN el "TO authenticated" cualquier
--    visitante podría modificar o borrar todos los casos.
DROP POLICY IF EXISTS "pacientes_select_policy" ON public.pacientes;
CREATE POLICY "pacientes_select_policy" ON public.pacientes
    FOR SELECT TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "pacientes_insert_policy" ON public.pacientes;
CREATE POLICY "pacientes_insert_policy" ON public.pacientes
    FOR INSERT TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "pacientes_update_policy" ON public.pacientes;
CREATE POLICY "pacientes_update_policy" ON public.pacientes
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "pacientes_delete_policy" ON public.pacientes;
CREATE POLICY "pacientes_delete_policy" ON public.pacientes
    FOR DELETE TO authenticated
    USING (true);

-- 4. Bucket de Storage para archivos .dcm (PRIVADO: se accede con URLs firmadas)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dicom', 'dicom', false)
ON CONFLICT (id) DO NOTHING;

-- 4b. Límites del bucket aplicados por el servidor (Fase 5): aunque alguien
--     salte la validación del navegador, Storage rechaza archivos de más de
--     50 MB o con otro tipo MIME (la app sube con contentType application/dicom).
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/dicom']
WHERE id = 'dicom';

-- 5. Políticas del bucket 'dicom' sobre storage.objects
--    (PostgreSQL no permite IF NOT EXISTS en CREATE POLICY, por eso usamos DROP primero)

-- 5a. Lectura: necesaria para que createSignedUrl() funcione desde el navegador.
--     Se elimina también el nombre antiguo ("dicom_public_read"), que inducía
--     a error: el bucket NO es público.
DROP POLICY IF EXISTS "dicom_public_read" ON storage.objects;
DROP POLICY IF EXISTS "dicom_select" ON storage.objects;
CREATE POLICY "dicom_select" ON storage.objects
    FOR SELECT TO anon, authenticated
    USING (bucket_id = 'dicom');

-- 5b. Subida, reemplazo y borrado: solo usuarios autenticados (Fase 5).
DROP POLICY IF EXISTS "dicom_insert" ON storage.objects;
CREATE POLICY "dicom_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'dicom');

DROP POLICY IF EXISTS "dicom_update" ON storage.objects;
CREATE POLICY "dicom_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'dicom')
    WITH CHECK (bucket_id = 'dicom');

DROP POLICY IF EXISTS "dicom_delete" ON storage.objects;
CREATE POLICY "dicom_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'dicom');

-- ============================================================
-- 6. Caso de prueba (Fase 4)
--    IMPORTANTE: el archivo debe subirse a mano en
--    Supabase -> Storage -> bucket 'dicom' con EXACTAMENTE este nombre:
--    pac-001.dcm
--    ON CONFLICT evita duplicados si re-ejecutas el script.
-- ============================================================
INSERT INTO public.pacientes
    (paciente_id_anonimo, modalidad, patologia, descripcion_clinica, archivo_dicom_path)
VALUES
    ('PAC-001', 'TAC', 'TAC de cerebro (muestra)',
     'Corte axial de TAC craneal sin contraste. Caso de muestra para practicar ventanas (cerebro / hueso).',
     'pac-001.dcm')
-- DO UPDATE: si la fila ya existía con otros datos, se corrigen para que
-- coincidan con el archivo real (un TAC de cerebro).
ON CONFLICT (paciente_id_anonimo) DO UPDATE SET
    modalidad           = EXCLUDED.modalidad,
    patologia           = EXCLUDED.patologia,
    descripcion_clinica = EXCLUDED.descripcion_clinica,
    archivo_dicom_path  = EXCLUDED.archivo_dicom_path;
