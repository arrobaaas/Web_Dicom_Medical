/**
 * Genera en memoria un archivo DICOM Part 10 mínimo (Explicit VR Little Endian)
 * para los tests, sin depender de imágenes reales.
 */
import { Blob as NodeBlob } from "node:buffer";

const EXPLICIT_VR_LITTLE_ENDIAN = "1.2.840.10008.1.2.1";

/** Elemento con VR de longitud corta (2 bytes), valor rellenado a longitud par. */
function elemento(grupo, elem, vr, valor) {
  let texto = String(valor);
  if (texto.length % 2) texto += vr === "UI" ? "\0" : " ";
  const datos = Buffer.from(texto, "latin1");
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt16LE(grupo, 0);
  cabecera.writeUInt16LE(elem, 2);
  cabecera.write(vr, 4, "latin1");
  cabecera.writeUInt16LE(datos.length, 6);
  return Buffer.concat([cabecera, datos]);
}

/**
 * @param {Object} [tags] Valores de cabecera opcionales.
 * @param {string} [tags.modalidad]
 * @param {string} [tags.nombrePaciente]
 * @param {string} [tags.fechaNacimiento] AAAAMMDD
 * @param {string} [tags.regionAnatomica]
 * @param {string} [tags.descripcionEstudio]
 * @returns {Uint8Array}
 */
export function crearDicom(tags = {}) {
  const partes = [
    Buffer.alloc(128), // preámbulo
    Buffer.from("DICM", "latin1"),
    elemento(0x0002, 0x0010, "UI", EXPLICIT_VR_LITTLE_ENDIAN),
  ];
  const opcionales = [
    [0x0008, 0x0060, "CS", tags.modalidad],
    [0x0008, 0x1030, "LO", tags.descripcionEstudio],
    [0x0010, 0x0010, "PN", tags.nombrePaciente],
    [0x0010, 0x0030, "DA", tags.fechaNacimiento],
    [0x0018, 0x0015, "CS", tags.regionAnatomica],
  ];
  for (const [g, e, vr, v] of opcionales) {
    if (v !== undefined) partes.push(elemento(g, e, vr, v));
  }
  return new Uint8Array(Buffer.concat(partes));
}

/**
 * Archivo con la API de File que usa la app (name, size, arrayBuffer).
 * Se usa el Blob de Node porque el de jsdom no implementa arrayBuffer().
 */
export function archivo(bytes, nombre = "corte.dcm") {
  const blob = new NodeBlob([bytes]);
  return Object.assign(blob, { name: nombre });
}
