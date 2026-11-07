import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatoCOP, formatoCOPCorto, formatoNumero, formatoFecha, hoyISO, estadoStock, infoEstado,
  estadoCaducidad, diasHasta, parseProblema, ApiError, mensajeDeError, nombreDeArchivo, construirConsulta,
} from '../../web/js/format.js';

const sinNbsp = (s) => s.replace(/\u00a0/g, ' ');

test('formatoCOP: pesos colombianos sin decimales', () => {
  assert.equal(sinNbsp(formatoCOP(35000)), '$ 35.000');
  assert.equal(sinNbsp(formatoCOP(0)), '$ 0');
  assert.equal(sinNbsp(formatoCOP(1234567.8)), '$ 1.234.568');
  assert.equal(sinNbsp(formatoCOP('abc')), '$ 0');
  assert.equal(sinNbsp(formatoCOP(undefined)), '$ 0');
});

test('formatoCOPCorto: ejes de gráficos', () => {
  assert.equal(formatoCOPCorto(2_500_000), '$2,5 M');
  assert.equal(formatoCOPCorto(45_000), '$45 mil');
  assert.equal(formatoCOPCorto(800), '$800');
  assert.equal(formatoCOPCorto(0), '$0');
});

test('formatoNumero: hasta 3 decimales con coma', () => {
  assert.equal(formatoNumero(25000), '25.000');
  assert.equal(formatoNumero(1500.5), '1.500,5');
  assert.equal(formatoNumero(4 / 12), '0,333');
  assert.equal(formatoNumero(null), '0');
});

test('formatoFecha: AAAA-MM-DD → DD/MM/AAAA sin zonas horarias', () => {
  assert.equal(formatoFecha('2026-10-07'), '07/10/2026');
  assert.equal(formatoFecha('2026-10-07T23:59:59Z'), '07/10/2026');
  assert.equal(formatoFecha('no-fecha'), 'no-fecha');
  assert.equal(formatoFecha(null), '');
});

test('hoyISO: usa la fecha local', () => {
  assert.equal(hoyISO(new Date(2026, 10, 6, 23, 59)), '2026-11-06');
  assert.equal(hoyISO(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

test('estadoStock: misma regla que el MVP y el servidor', () => {
  assert.equal(estadoStock(25000, 10000).clave, 'OPTIMO');
  assert.equal(estadoStock(10000, 10000).clave, 'BAJO');      // stock == mínimo → bajo
  assert.equal(estadoStock(3, 5).clave, 'BAJO');               // Huevos del MVP: 3 > 2,5
  assert.equal(estadoStock(2000, 3000).clave, 'BAJO');         // Mantequilla del MVP: 2000 > 1500
  assert.equal(estadoStock(1500, 3000).clave, 'CRITICO');      // ≤ 50 % del mínimo
  assert.equal(estadoStock(0, 5).clave, 'CRITICO');
  assert.equal(estadoStock(1500, 3000).texto, 'Crítico');
  assert.equal(estadoStock('x', 'y').clave, 'CRITICO');        // entradas no numéricas se tratan como 0
});

test('infoEstado: traduce el enum del API y tolera valores desconocidos', () => {
  assert.deepEqual([infoEstado('OPTIMO').texto, infoEstado('OPTIMO').clase], ['Óptimo', 'optimo']);
  assert.equal(infoEstado('BAJO').clase, 'bajo');
  assert.equal(infoEstado('RARO').texto, 'RARO');
  assert.equal(infoEstado(undefined).texto, '—');
});

test('estadoCaducidad: vencido, por vencer (0 a 3 días) y vigente', () => {
  const ahora = new Date(2026, 10, 6, 22, 0); // 6-nov-2026 22:00 local
  assert.equal(estadoCaducidad('2026-11-05', ahora).clave, 'vencido');
  assert.equal(estadoCaducidad('2026-11-06', ahora).clave, 'por-vencer'); // vence hoy
  assert.equal(estadoCaducidad('2026-11-09', ahora).clave, 'por-vencer'); // 3 días
  assert.equal(estadoCaducidad('2026-11-10', ahora).clave, 'vigente');
  assert.equal(estadoCaducidad('2026-11-05', ahora).texto, 'Vencido');
  assert.equal(estadoCaducidad('basura', ahora).texto, '—');
  assert.equal(diasHasta('2026-11-06', ahora), 0);
  assert.equal(diasHasta('2026-10-07', ahora), -30);
  assert.ok(Number.isNaN(diasHasta('2026-13-45x', ahora)));
});

test('parseProblema: problem+json (RFC 9457) a mensaje legible', () => {
  const p = parseProblema(409, { type: '/errores/stock', title: 'Stock insuficiente', status: 409, detail: 'No alcanza: Huevos.' });
  assert.equal(p.mensaje, 'Stock insuficiente. No alcanza: Huevos.');
  assert.equal(p.status, 409);
  assert.equal(p.type, '/errores/stock');
  assert.equal(parseProblema(401, { title: 'Token inválido' }).mensaje, 'Token inválido');
  assert.equal(parseProblema(422, { title: 'X', detail: 'X' }).mensaje, 'X');           // sin duplicar
  assert.match(parseProblema(403, null).mensaje, /rol no tiene permiso/);
  assert.match(parseProblema(0, null).mensaje, /conexión/);
  assert.match(parseProblema(503, '<html>').mensaje, /Error del servidor/);
  assert.equal(parseProblema(418, undefined).mensaje, 'Error 418.');
  const conErrores = parseProblema(422, { title: 'Datos inválidos', errors: [{ campo: 'cantidad', mensaje: 'debe ser > 0' }, 'otro'] });
  assert.equal(conErrores.mensaje, 'Datos inválidos (cantidad: debe ser > 0; otro)');
  assert.deepEqual(conErrores.errores, ['cantidad: debe ser > 0', 'otro']);
});

test('ApiError y mensajeDeError', () => {
  const e = new ApiError(parseProblema(404, { title: 'No encontrada' }));
  assert.ok(e instanceof Error);
  assert.equal(e.status, 404);
  assert.equal(mensajeDeError(e), 'No encontrada');
  assert.equal(mensajeDeError(new Error('boom')), 'boom');
  assert.equal(mensajeDeError(null), 'Ocurrió un error inesperado.');
});

test('nombreDeArchivo: Content-Disposition', () => {
  assert.equal(nombreDeArchivo('attachment; filename="reporte-materias.pdf"', 'x'), 'reporte-materias.pdf');
  assert.equal(nombreDeArchivo("attachment; filename*=UTF-8''informe%20%C3%B1.xlsx", 'x'), 'informe ñ.xlsx');
  assert.equal(nombreDeArchivo(null, 'respaldo.pdf'), 'respaldo.pdf');
});

test('construirConsulta: omite valores vacíos y codifica', () => {
  assert.equal(construirConsulta({ pagina: 2, q: '', categoria: undefined, estado: null }), '?pagina=2');
  assert.equal(construirConsulta({ q: 'harina de trigo&x=1' }), '?q=harina+de+trigo%26x%3D1');
  assert.equal(construirConsulta({}), '');
  assert.equal(construirConsulta(undefined), '');
});

import { nuevaClaveIdempotencia } from '../../web/js/format.js';
test('nuevaClaveIdempotencia: cumple el patrón del contrato y no se repite', () => {
  const claves = new Set(Array.from({ length: 200 }, () => nuevaClaveIdempotencia()));
  assert.equal(claves.size, 200);
  for (const c of claves) assert.match(c, /^[A-Za-z0-9_-]{8,64}$/);
});
