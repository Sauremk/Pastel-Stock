// Guía II-04 (defecto D-02): el marcador de posición debe tener contraste >= 4,5:1 en ambos temas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../web/css/styles.css', import.meta.url), 'utf8');
const bloque = (selector) => css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))[1];
const variable = (texto, nombre) => texto.match(new RegExp(`${nombre}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
const luminancia = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('el marcador de posición usa el color secundario del tema (regla presente)', () => {
  assert.match(css, /::placeholder\s*\{\s*color:\s*var\(--color-texto-secundario\)/);
});

test('contraste texto secundario / fondo de campo >= 4,5:1 en tema claro y oscuro', () => {
  const claro = bloque(':root'); const oscuro = bloque('\\[data-theme="dark"\\]');
  const rc = contraste(variable(claro, '--color-texto-secundario'), variable(claro, '--color-card'));
  const ro = contraste(variable(oscuro, '--color-texto-secundario'), variable(oscuro, '--color-card'));
  assert.ok(rc >= 4.5, `claro ${rc.toFixed(2)}`); assert.ok(ro >= 4.5, `oscuro ${ro.toFixed(2)}`);
});
