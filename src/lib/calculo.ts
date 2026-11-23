/**
 * Cálculo de actualizaciones de alquiler por IPC o ICL.
 * Funciones puras: sin DOM ni red, para poder testearlas y usarlas en el cliente.
 */
import type { Punto } from './indices.ts';

export type Indice = 'ipc' | 'icl';
export type Frecuencia = 3 | 4 | 6 | 12;
export const FRECUENCIAS: readonly Frecuencia[] = [3, 4, 6, 12];

/**
 * Meses de rezago del IPC: al día 1 de un mes, el último IPC publicado por el
 * INDEC es el de dos meses antes (cada dato sale a mediados del mes siguiente).
 */
export const REZAGO_IPC = 2;

export interface Entrada {
  monto: number;
  /** Fecha de inicio del contrato, "AAAA-MM-DD". */
  inicio: string;
  indice: Indice;
  frecuencia: Frecuencia;
  /** Fecha de referencia ("hoy"), "AAAA-MM-DD". Se calculan los aumentos hasta esta fecha. */
  hoy: string;
}

export interface Periodo {
  /** 0 = valor inicial del contrato. */
  numero: number;
  desde: string;
  hasta: string;
  /** Coeficiente acumulado respecto del inicio. */
  coeficiente: number;
  /** Aumento de este período respecto del anterior (0.25 = 25 %). */
  aumento: number;
  monto: number;
  /** Explicación de qué valores del índice se usaron. */
  referencia: string;
}

export interface Resultado {
  periodos: Periodo[];
  /**
   * Próxima actualización (futura o con índice aún no publicado). Si es futura pero
   * su índice ya se conoce (el ICL se publica por adelantado), incluye el período calculado.
   */
  proxima: { fecha: string; motivo: 'futura' | 'sin-dato'; periodo?: Periodo } | null;
  aumentoTotal: number;
}

export class ErrorCalculo extends Error {}

// ---------- utilidades de fechas (sin zonas horarias: todo en strings ISO) ----------

const pad = (n: number) => String(n).padStart(2, '0');

function partes(fecha: string): [number, number, number] {
  const [a, m, d] = fecha.split('-').map(Number);
  return [a, m, d ?? 1];
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** Suma meses a "AAAA-MM-DD", ajustando el día si el mes es más corto (31/01 + 1 → 28/02). */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = partes(fecha);
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  return `${anio}-${pad(mes)}-${pad(Math.min(d, diasDelMes(anio, mes)))}`;
}

/** Día anterior a "AAAA-MM-DD". */
export function diaAnterior(fecha: string): string {
  const [a, m, d] = partes(fecha);
  const dt = new Date(Date.UTC(a, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** "AAAA-MM" del mes que está `meses` antes de la fecha dada. */
function mesAnterior(fecha: string, meses: number): string {
  return sumarMeses(fecha.slice(0, 7) + '-01', -meses).slice(0, 7);
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatearMes(aaaamm: string): string {
  const [a, m] = partes(aaaamm);
  return `${MESES_CORTOS[m - 1]}-${String(a).slice(2)}`;
}

export function formatearFecha(fecha: string): string {
  const [a, m, d] = partes(fecha);
  return `${pad(d)}/${pad(m)}/${a}`;
}

// ---------- búsqueda en series ----------

/** Valor exacto para la fecha, o null. La serie debe estar ordenada. */
function valorExacto(serie: Punto[], fecha: string): number | null {
  let lo = 0;
  let hi = serie.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = serie[mid][0].localeCompare(fecha);
    if (cmp === 0) return serie[mid][1];
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Último valor publicado en la fecha dada o antes (para días sin dato). */
function valorAlDia(serie: Punto[], fecha: string): Punto | null {
  let lo = 0;
  let hi = serie.length - 1;
  let res: Punto | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (serie[mid][0] <= fecha) {
      res = serie[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return res;
}

// ---------- coeficientes por índice ----------

interface Coeficiente {
  valor: number;
  referencia: string;
}

/** Devuelve el coeficiente acumulado entre el inicio y `fecha`, o null si el índice aún no se publicó. */
type Calculador = (fecha: string) => Coeficiente | null;

function calculadorIPC(ipc: Punto[], inicio: string): Calculador {
  const mesBase = mesAnterior(inicio, REZAGO_IPC);
  const base = valorExacto(ipc, mesBase);
  if (base === null) {
    const primero = ipc[0]?.[0] ?? '';
    throw new ErrorCalculo(
      `No hay datos de IPC para ${formatearMes(mesBase)}. Con IPC se pueden calcular contratos ` +
        `iniciados desde ${formatearFecha(sumarMeses(primero + '-01', REZAGO_IPC))}.`,
    );
  }
  return (fecha) => {
    const mes = mesAnterior(fecha, REZAGO_IPC);
    const valor = valorExacto(ipc, mes);
    if (valor === null) return null;
    return {
      valor: valor / base,
      referencia: `IPC ${formatearMes(mes)} / IPC ${formatearMes(mesBase)}`,
    };
  };
}

function calculadorICL(icl: Punto[], inicio: string): Calculador {
  const primero = icl[0]?.[0];
  const ultimo = icl[icl.length - 1]?.[0];
  if (!primero || inicio < primero) {
    throw new ErrorCalculo(
      `El ICL se publica desde el ${formatearFecha(primero ?? '2020-07-01')}. ` +
        'Para contratos anteriores usá IPC.',
    );
  }
  if (inicio > ultimo) {
    throw new ErrorCalculo('Todavía no hay valor de ICL publicado para la fecha de inicio.');
  }
  const base = valorAlDia(icl, inicio)!;
  return (fecha) => {
    if (fecha > ultimo) return null;
    const punto = valorAlDia(icl, fecha)!;
    return {
      valor: punto[1] / base[1],
      referencia: `ICL ${formatearFecha(punto[0])} / ICL ${formatearFecha(base[0])}`,
    };
  };
}

// ---------- cálculo principal ----------

export function validarEntrada(e: Partial<Entrada>): string | null {
  if (!e.monto || !Number.isFinite(e.monto) || e.monto <= 0) return 'Ingresá un monto de alquiler mayor a cero.';
  if (!e.inicio || !/^\d{4}-\d{2}-\d{2}$/.test(e.inicio)) return 'Ingresá la fecha de inicio del contrato.';
  if (e.indice !== 'ipc' && e.indice !== 'icl') return 'Elegí un índice (IPC o ICL).';
  if (!FRECUENCIAS.includes(e.frecuencia as Frecuencia)) return 'Elegí cada cuántos meses se actualiza.';
  if (e.inicio > (e.hoy ?? '')) return 'La fecha de inicio no puede ser posterior a hoy.';
  return null;
}

/** Tope de actualizaciones (por si se ingresa una fecha muy antigua). */
const MAX_PERIODOS = 200;

export function calcularAlquiler(entrada: Entrada, series: { ipc: Punto[]; icl: Punto[] }): Resultado {
  const error = validarEntrada(entrada);
  if (error) throw new ErrorCalculo(error);

  const { monto, inicio, indice, frecuencia, hoy } = entrada;
  const coef = indice === 'ipc' ? calculadorIPC(series.ipc, inicio) : calculadorICL(series.icl, inicio);

  const periodos: Periodo[] = [
    {
      numero: 0,
      desde: inicio,
      hasta: diaAnterior(sumarMeses(inicio, frecuencia)),
      coeficiente: 1,
      aumento: 0,
      monto,
      referencia: 'Valor inicial del contrato',
    },
  ];
  let proxima: Resultado['proxima'] = null;

  for (let n = 1; n <= MAX_PERIODOS; n++) {
    const fecha = sumarMeses(inicio, n * frecuencia);
    const c = coef(fecha);
    const anterior = periodos[periodos.length - 1];
    const periodo: Periodo | undefined = c ? {
      numero: n,
      desde: fecha,
      hasta: diaAnterior(sumarMeses(inicio, (n + 1) * frecuencia)),
      coeficiente: c.valor,
      aumento: c.valor / anterior.coeficiente - 1,
      monto: monto * c.valor,
      referencia: c.referencia,
    } : undefined;
    if (fecha > hoy) {
      proxima = { fecha, motivo: 'futura', periodo };
      break;
    }
    if (!periodo) {
      proxima = { fecha, motivo: 'sin-dato' };
      break;
    }
    periodos.push(periodo);
  }

  const ultimo = periodos[periodos.length - 1];
  return { periodos, proxima, aumentoTotal: ultimo.coeficiente - 1 };
}
