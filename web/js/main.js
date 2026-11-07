// Punto de entrada: tema, sesión, navegación por hash y montaje de vistas.
import { crearAuth } from './auth.js';
import { crearApi } from './api.js';
import { h, reemplazarHijos, toast } from './ui.js';
import { ETIQUETAS_ROL } from './catalogos.js';
import { validarCredenciales } from './validacion.js';
import { mensajeDeError } from './format.js';
import { crearVista as vistaDashboard } from './views/dashboard.js';
import { crearVista as vistaMaterias } from './views/materias.js';
import { crearVista as vistaRecetas } from './views/recetas.js';
import { crearVista as vistaProductos } from './views/productos.js';
import { crearVista as vistaMovimientos } from './views/movimientos.js';

const VISTAS = {
  dashboard: vistaDashboard,
  materias: vistaMaterias,
  recetas: vistaRecetas,
  productos: vistaProductos,
  movimientos: vistaMovimientos,
};
const VISTA_INICIAL = 'dashboard';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- Tema
function leerTema() { try { return localStorage.getItem('theme') || 'light'; } catch { return 'light'; } }
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  $('theme-switch').checked = tema === 'dark';
  $('theme-icon').textContent = tema === 'dark' ? '🌙' : '☀️';
  $('theme-text').textContent = tema === 'dark' ? 'Modo oscuro' : 'Modo claro';
}

// ---------------------------------------------------------------- Estado de aplicación
const auth = crearAuth();
const api = crearApi({ auth, alSesionExpirada: () => mostrarLogin('Tu sesión venció. Inicia sesión de nuevo.') });
const ctx = { api, auth };
let vistaActual = null;
let nombreVistaActual = null;
let marcaNavegacion = 0;

function mostrarLogin(mensaje) {
  vistaActual?.destruir?.();
  vistaActual = null;
  nombreVistaActual = null;
  $('arranque').hidden = true;
  $('app-container').classList.remove('active');
  $('login-screen').hidden = false;
  const error = $('login-error');
  error.hidden = !mensaje;
  error.textContent = mensaje ?? '';
  $('login-pass').value = '';
  $('login-user').focus();
}

function mostrarApp() {
  const u = auth.usuario();
  $('arranque').hidden = true;
  $('login-screen').hidden = true;
  $('app-container').classList.add('active');
  $('user-name').textContent = u.nombre;
  $('user-role').textContent = ETIQUETAS_ROL[u.rol] ?? u.rol;
  $('user-avatar').textContent = (u.nombre || '?').trim().charAt(0).toUpperCase();
  navegar();
}

// ---------------------------------------------------------------- Navegación (hash: #/materias)
function vistaDeHash() {
  const nombre = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(VISTAS, nombre) ? nombre : VISTA_INICIAL;
}

async function navegar() {
  if (!auth.estaAutenticado()) return;
  const nombre = vistaDeHash();
  if (nombre === nombreVistaActual) return;
  const marca = ++marcaNavegacion;
  vistaActual?.destruir?.();

  const vista = VISTAS[nombre](ctx);
  vistaActual = vista;
  nombreVistaActual = nombre;
  document.querySelectorAll('.nav-item').forEach((b) => {
    if (b.dataset.vista === nombre) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  reemplazarHijos($('contenido'), vista.el);
  document.title = `${vista.titulo} · Pastel Stock`;
  $('contenido').scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  await vista.cargar();
  if (marca === marcaNavegacion) vista.el.querySelector('h1')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- Eventos de la interfaz
function configurarEventos() {
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
    const destino = `#/${b.dataset.vista}`;
    if (location.hash === destino) { nombreVistaActual = null; navegar(); } else location.hash = destino;
  }));
  window.addEventListener('hashchange', navegar);

  $('theme-switch').addEventListener('change', () => {
    const tema = $('theme-switch').checked ? 'dark' : 'light';
    aplicarTema(tema);
    try { localStorage.setItem('theme', tema); } catch { /* sin almacenamiento: el tema dura la pestaña */ }
    vistaActual?.temaCambiado?.();
  });

  $('btn-logout').addEventListener('click', () => {
    auth.cerrarSesion();
    location.hash = '';
    mostrarLogin();
    toast('Sesión cerrada');
  });

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = $('login-submit');
    const { errores, datos, valido } = validarCredenciales({ usuario: $('login-user').value, contrasena: $('login-pass').value });
    const error = $('login-error');
    if (!valido) {
      error.textContent = errores.usuario ?? errores.contrasena;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Ingresando…';
    try {
      const u = await auth.iniciarSesion(datos.usuario, datos.contrasena);
      $('login-pass').value = '';
      mostrarApp();
      toast(`Bienvenido, ${u.nombre}`);
    } catch (e) {
      error.textContent = mensajeDeError(e);
      error.hidden = false;
      $('login-pass').select();
    } finally {
      boton.disabled = false;
      boton.textContent = 'Iniciar sesión';
    }
  });
}

// ---------------------------------------------------------------- Arranque
async function iniciar() {
  aplicarTema(leerTema());
  configurarEventos();
  if (await auth.restaurar()) mostrarApp(); else mostrarLogin();
}

iniciar().catch((e) => {
  console.error(e);
  reemplazarHijos($('arranque'), h('div', { class: 'banner-error', role: 'alert' }, 'No se pudo iniciar la aplicación. Recarga la página.'));
});

