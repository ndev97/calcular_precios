import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularAlquiler, sumarMeses, diaAnterior, ErrorCalculo } from './calculo.ts';
import type { Punto } from './indices.ts';

// IPC ficticio: sube 10 % por mes desde nov-2024 (100, 110, 121, ...).
const ipc: Punto[] = Array.from({ length: 14 }, (_, i) => [
  sumarMeses('2024-11-01', i).slice(0, 7),
  100 * 1.1 ** i,
]);
// ICL ficticio diario, con huecos: 2025-01-01 = 1, 2025-04-01 = 1.2, 2025-07-01 = 1.5.
const icl: Punto[] = [
  ['2025-01-01', 1],
  ['2025-03-30', 1.19],
  ['2025-04-01', 1.2],
  ['2025-06-29', 1.45],
  ['2025-07-01', 1.5],
];

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('sumarMeses ajusta fin de mes y cambia de año', () => {
  assert.equal(sumarMeses('2025-01-31', 1), '2025-02-28');
  assert.equal(sumarMeses('2024-01-31', 1), '2024-02-29');
  assert.equal(sumarMeses('2025-11-15', 3), '2026-02-15');
  assert.equal(sumarMeses('2025-03-01', -2), '2025-01-01');
  assert.equal(diaAnterior('2025-03-01'), '2025-02-28');
});

test('IPC trimestral usa la variación con 2 meses de rezago', () => {
  const r = calcularAlquiler(
    { monto: 100_000, inicio: '2025-01-01', indice: 'ipc', frecuencia: 3, hoy: '2025-08-15' },
    { ipc, icl },
  );
  // Abril: IPC feb-25 / IPC nov-24 = 1.1^3. Julio: IPC may-25 / IPC nov-24 = 1.1^6.
  assert.equal(r.periodos.length, 3);
  close(r.periodos[1].coeficiente, 1.1 ** 3);
  close(r.periodos[1].monto, 133_100);
  close(r.periodos[2].aumento, 1.1 ** 3 - 1);
  assert.equal(r.periodos[1].referencia, 'IPC feb-25 / IPC nov-24');
  assert.equal(r.periodos[1].hasta, '2025-06-30');
  // Octubre es futuro, pero IPC ago-25 ya está publicado: el próximo aumento ya se conoce.
  assert.equal(r.proxima?.fecha, '2025-10-01');
  assert.equal(r.proxima?.motivo, 'futura');
  close(r.proxima!.periodo!.coeficiente, 1.1 ** 9);
  assert.equal(r.proxima!.periodo!.referencia, 'IPC ago-25 / IPC nov-24');
});

test('IPC marca como pendiente el aumento cuyo índice no se publicó', () => {
  // La serie llega hasta dic-2025; el aumento de mar-2026 necesita IPC ene-26.
  const r = calcularAlquiler(
    { monto: 1000, inicio: '2025-03-01', indice: 'ipc', frecuencia: 12, hoy: '2026-03-10' },
    { ipc, icl },
  );
  assert.equal(r.periodos.length, 1);
  assert.deepEqual(r.proxima, { fecha: '2026-03-01', motivo: 'sin-dato' });
});

test('ICL usa el cociente entre el día de actualización y el de inicio', () => {
  const r = calcularAlquiler(
    { monto: 200_000, inicio: '2025-01-01', indice: 'icl', frecuencia: 3, hoy: '2025-07-01' },
    { ipc, icl },
  );
  close(r.periodos[1].coeficiente, 1.2);
  close(r.periodos[2].monto, 300_000);
  close(r.periodos[2].aumento, 1.5 / 1.2 - 1);
  close(r.aumentoTotal, 0.5);
});

test('ICL toma el último valor publicado si la fecha no tiene dato', () => {
  const r = calcularAlquiler(
    { monto: 100, inicio: '2025-01-01', indice: 'icl', frecuencia: 6, hoy: '2025-07-01' },
    { ipc, icl: icl.filter(([f]) => f !== '2025-07-01') },
  );
  // Si la fecha de actualización es posterior al último dato publicado, queda pendiente.
  assert.deepEqual(r.proxima, { fecha: '2025-07-01', motivo: 'sin-dato' });

  const r2 = calcularAlquiler(
    { monto: 100, inicio: '2025-01-01', indice: 'icl', frecuencia: 3, hoy: '2025-07-01' },
    { ipc, icl: icl.filter(([f]) => f !== '2025-04-01') },
  );
  close(r2.periodos[1].coeficiente, 1.19);
});

test('rechaza entradas inválidas o fuera de rango', () => {
  const base = { monto: 1000, inicio: '2025-01-01', indice: 'ipc', frecuencia: 3, hoy: '2025-06-01' } as const;
  assert.throws(() => calcularAlquiler({ ...base, monto: 0 }, { ipc, icl }), ErrorCalculo);
  assert.throws(() => calcularAlquiler({ ...base, inicio: '2025-07-01' }, { ipc, icl }), ErrorCalculo);
  assert.throws(() => calcularAlquiler({ ...base, inicio: '2024-01-01' }, { ipc, icl }), /No hay datos de IPC/);
  assert.throws(() => calcularAlquiler({ ...base, indice: 'icl', inicio: '2024-12-01' }, { ipc, icl }), /ICL se publica/);
});
