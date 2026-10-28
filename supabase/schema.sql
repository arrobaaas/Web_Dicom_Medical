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
    modalidad TEXT NOT NULL CHECK (modalidad IN ('RX', 'TAC', 'MRI', 'CT', 'US', 'NM', 'PT', 'OTHER')),
    patologia TEXT NOT NULL,
    descripcion_clinica TEXT,
    archivo_dicom_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Habilitar Row Level Security
ALTER TABLE public.pacientes ENABLE ROW LEVEL SECURITY;

-- 3. Políticas RLS (DROP + CREATE para ser re-ejecutables / idempotentes)
DROP POLICY IF EXISTS "pacientes_select_policy" ON public.pacientes;
CREATE POLICY "pacientes_select_policy" ON public.pacientes
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "pacientes_insert_policy" ON public.pacientes;
CREATE POLICY "pacientes_insert_policy" ON public.pacientes
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "pacientes_update_policy" ON public.pacientes;
CREATE POLICY "pacientes_update_policy" ON public.pacientes
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS "pacientes_delete_policy" ON public.pacientes;
CREATE POLICY "pacientes_delete_policy" ON public.pacientes
    FOR DELETE USING (true);

-- 4. Bucket de Storage para archivos .dcm
INSERT INTO storage.buckets (id, name, public)
VALUES ('dicom', 'dicom', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Política de lectura para el bucket 'dicom'
--    (PostgreSQL no permite IF NOT EXISTS en CREATE POLICY, por eso usamos DROP primero)
DROP POLICY IF EXISTS "dicom_public_read" ON storage.objects;
CREATE POLICY "dicom_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'dicom');

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
    ('PAC-001', 'TAC', 'Neumonía basal derecha', 'Caso de prueba para el visor DICOM', 'pac-001.dcm')
ON CONFLICT (paciente_id_anonimo) DO NOTHING;
