/**
 * Descarga y normalización de índices de inflación.
 *
 * Funciona tanto en el build (Node) como en el navegador: ambas APIs
 * responden con `Access-Control-Allow-Origin: *`.
 */

/** Par [fecha, valor]. IPC usa "AAAA-MM"; ICL usa "AAAA-MM-DD". Ordenado ascendente. */
export type Punto = [fecha: string, valor: number];

export interface Indices {
  ipc: Punto[];
  icl: Punto[];
  /** Momento en que se obtuvieron los datos (ISO 8601). */
  actualizado: string;
}

/** IPC Nivel General Nacional, INDEC, base dic-2016, mensual. */
export const IPC_SERIE_ID = '148.3_INIVELNAL_DICI_M_26';
/** Índice para Contratos de Locación (BCRA), base 30/6/2020 = 1, diario. */
export const ICL_VARIABLE_ID = 40;
/** Primer dato publicado del ICL. */
const ICL_DESDE = '2020-07-01';

const IPC_URL = `https://apis.datos.gob.ar/series/api/series/?ids=${IPC_SERIE_ID}&format=json&limit=1000&sort=asc`;
const BCRA_URL = `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${ICL_VARIABLE_ID}`;
const BCRA_PAGINA = 1000;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar ${url}`);
  return res.json();
}

/** Serie mensual del IPC: [["2016-12", 100], ["2017-01", 101.59], ...] */
export async function obtenerIPC(): Promise<Punto[]> {
  const json = await getJson(IPC_URL);
  const filas: [string, number | null][] = json?.data ?? [];
  const serie = filas
    .filter((f): f is [string, number] => typeof f[1] === 'number')
    .map(([fecha, valor]): Punto => [fecha.slice(0, 7), valor]);
  if (serie.length === 0) throw new Error('La API de Series de Tiempo no devolvió datos de IPC');
  return serie;
}

/** Serie diaria del ICL: [["2020-07-01", 1.0], ...]. Pagina de a 1000 registros. */
export async function obtenerICL(desde: string = ICL_DESDE): Promise<Punto[]> {
  const serie: Punto[] = [];
  for (let offset = 0; ; offset += BCRA_PAGINA) {
    const url = `${BCRA_URL}?desde=${desde}&limit=${BCRA_PAGINA}&offset=${offset}`;
    const json = await getJson(url);
    const detalle: { fecha: string; valor: number }[] = json?.results?.[0]?.detalle ?? [];
    for (const d of detalle) serie.push([d.fecha, d.valor]);
    const total: number = json?.metadata?.resultset?.count ?? 0;
    if (detalle.length === 0 || offset + BCRA_PAGINA >= total) break;
  }
  if (serie.length === 0) throw new Error('La API del BCRA no devolvió datos de ICL');
  // El BCRA responde en orden descendente; lo dejamos ascendente.
  return serie.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Descarga completa (se usa en el build). */
export async function obtenerIndices(): Promise<Indices> {
  const [ipc, icl] = await Promise.all([obtenerIPC(), obtenerICL()]);
  return { ipc, icl, actualizado: new Date().toISOString() };
}

/**
 * Actualización incremental (se usa en el navegador): trae el IPC completo (es
 * un solo pedido chico) y solo el ICL posterior al último dato que ya tenemos.
 */
export async function actualizarIndices(previos: Indices): Promise<Indices> {
  const ultimoICL = previos.icl[previos.icl.length - 1]?.[0] ?? ICL_DESDE;
  const [ipc, nuevosICL] = await Promise.all([obtenerIPC(), obtenerICL(ultimoICL)]);
  const icl = new Map(previos.icl);
  for (const [fecha, valor] of nuevosICL) icl.set(fecha, valor);
  return {
    ipc,
    icl: [...icl].sort((a, b) => a[0].localeCompare(b[0])),
    actualizado: new Date().toISOString(),
  };
}
