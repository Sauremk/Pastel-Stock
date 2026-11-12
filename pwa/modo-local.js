// Modo sin servidor (PWA): conecta la interfaz al servidor local y agrega lo propio de una app que vive en el
// dispositivo: aviso de usuarios de prueba, respaldo de datos, cambio de contraseña, instalación y uso sin conexión.
import { crearServidorLocal, CLAVE_DATOS } from './servidor.js';
import { CLAVE_DEMO } from './semilla.js';
import { h, abrirModal, confirmar, toast, toastError, descargarArchivo, conBotonOcupado, crearAvisoFormulario, campo, idCampo, mostrarErrores } from '../js/ui.js';

const almacen = {
  leer() { try { return localStorage.getItem(CLAVE_DATOS); } catch { return null; } },
  guardar(texto) {
    try { localStorage.setItem(CLAVE_DATOS, texto); } catch {
      toast('No hay espacio para guardar en este dispositivo. Descarga un respaldo.', 'error');
    }
  },
};
const servidor = crearServidorLocal({ almacen });

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) toast('Hay una versión nueva de Pastel Stock. Cierra y vuelve a abrir la app para usarla.');
      });
    });
  }).catch(() => { /* sin service worker la app funciona igual, solo que no sin conexión */ });
}

function avisoLogin() {
  const aviso = document.querySelector('.login-aviso');
  if (!aviso) return;
  aviso.replaceChildren(
    h('strong', {}, 'Usuarios de prueba: '), 'admin, operador o contador · contraseña ', h('code', {}, CLAVE_DEMO),
    h('br'), h('span', {}, '📱 Funciona sin internet. Tus datos se guardan solo en este dispositivo.'));
}

function botonInstalar(pie) {
  let evento = null;
  const boton = h('button', { type: 'button', class: 'btn-logout', hidden: true }, '📲 Instalar la app');
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); evento = e; boton.hidden = false; });
  window.addEventListener('appinstalled', () => { boton.hidden = true; toast('Pastel Stock quedó instalada'); });
  boton.addEventListener('click', async () => { if (!evento) return; evento.prompt(); await evento.userChoice; evento = null; boton.hidden = true; });
  pie.insertBefore(boton, document.getElementById('btn-logout'));
}

function abrirDatos({ api, auth, cerrarSesion }) {
  const esAdmin = auth.usuario()?.rol === 'admin';
  const aviso = crearAvisoFormulario();
  const entrada = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const secciones = [];

  if (esAdmin) {
    const descargar = h('button', { type: 'button', class: 'btn' }, '💾 Descargar respaldo');
    descargar.addEventListener('click', async () => {
      try {
        await conBotonOcupado(descargar, async () => {
          const { blob, nombre } = await api.descargar('/local/respaldo');
          descargarArchivo(blob, nombre ?? 'pastel-stock-respaldo.json');
        }, 'Preparando…');
        toast('Respaldo descargado. Guárdalo en un lugar seguro.');
      } catch (e) { toastError(e); }
    });
    const restaurar = h('button', { type: 'button', class: 'btn btn-secondary' }, '📂 Restaurar desde archivo');
    restaurar.addEventListener('click', () => entrada.click());
    entrada.addEventListener('change', async () => {
      const archivo = entrada.files?.[0];
      entrada.value = '';
      if (!archivo) return;
      if (!(await confirmar({ titulo: 'Restaurar respaldo', mensaje: 'Se reemplazarán TODOS los datos de este dispositivo por los del archivo. ¿Continuar?', textoAceptar: 'Restaurar' }))) return;
      try {
        const contenido = JSON.parse(await archivo.text());
        await api.post('/local/respaldo', contenido);
        modal.cerrar();
        toast('Datos restaurados. Inicia sesión de nuevo.');
        cerrarSesion();
      } catch (e) { aviso.mostrar(e instanceof SyntaxError ? 'El archivo no es un respaldo válido.' : (e.message ?? 'No se pudo restaurar.')); }
    });
    const reiniciar = h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, 'Borrar todo y volver a los datos de demostración');
    reiniciar.addEventListener('click', async () => {
      if (!(await confirmar({ titulo: 'Reiniciar datos', mensaje: 'Se borrarán todas las ventas, movimientos y cambios de este dispositivo. Descarga un respaldo antes si lo necesitas. ¿Continuar?', textoAceptar: 'Borrar todo' }))) return;
      try { await api.post('/local/reiniciar'); modal.cerrar(); toast('Datos de demostración restablecidos'); cerrarSesion(); } catch (e) { toastError(e); }
    });
    secciones.push(
      h('h3', {}, 'Respaldo'),
      h('p', { class: 'ayuda' }, 'Los datos viven solo en este dispositivo. Si borras los datos del navegador o cambias de celular, se pierden: descarga un respaldo cada semana.'),
      h('div', { class: 'acciones', style: { margin: '10px 0 18px' } }, descargar, restaurar, entrada),
    );
    secciones.push(h('h3', {}, 'Zona de riesgo'), h('div', { class: 'acciones', style: { margin: '10px 0 18px' } }, reiniciar));
  }

  const campos = {
    actual: campo({ id: idCampo('pw-actual'), etiqueta: 'Contraseña actual', requerido: true, control: h('input', { type: 'password', autocomplete: 'current-password' }) }),
    nueva: campo({ id: idCampo('pw-nueva'), etiqueta: 'Contraseña nueva', requerido: true, ayuda: 'Mínimo 8 caracteres.', control: h('input', { type: 'password', autocomplete: 'new-password', minlength: '8' }) }),
  };
  const cambiar = h('button', { type: 'submit', class: 'btn' }, 'Cambiar contraseña');
  const form = h('form', { novalidate: true }, h('h3', {}, 'Mi contraseña'), h('div', { class: 'form-row' }, campos.actual.grupo, campos.nueva.grupo), h('div', { class: 'acciones' }, cambiar));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); aviso.ocultar();
    const errores = {};
    if (!campos.actual.control.value) errores.actual = 'Escribe tu contraseña actual.';
    if (campos.nueva.control.value.length < 8) errores.nueva = 'Usa al menos 8 caracteres.';
    mostrarErrores(campos, errores);
    if (Object.keys(errores).length) return;
    try {
      await conBotonOcupado(cambiar, () => api.post('/local/contrasena', { actual: campos.actual.control.value, nueva: campos.nueva.control.value }), 'Guardando…');
      campos.actual.control.value = ''; campos.nueva.control.value = '';
      toast('Contraseña cambiada');
    } catch (e) { aviso.mostrar(e.message); }
  });

  const modal = abrirModal({ titulo: 'Datos y cuenta', contenido: h('div', {}, aviso.el, ...secciones, form), ancho: 620 });
}

export const modoLocal = {
  fetch: servidor.fetch,
  storage: (() => { try { return globalThis.localStorage; } catch { return undefined; } })(),
  montar(ctx) {
    registrarServiceWorker();
    avisoLogin();
    const pie = document.querySelector('.sidebar-footer');
    if (!pie) return;
    botonInstalar(pie);
    const datos = h('button', { type: 'button', class: 'btn-logout' }, '💾 Datos y cuenta');
    datos.addEventListener('click', () => abrirDatos(ctx));
    pie.insertBefore(datos, document.getElementById('btn-logout'));
  },
};
