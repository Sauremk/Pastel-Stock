// Modo sin servidor (PWA): conecta la interfaz al servidor local y agrega lo propio de una app que vive en el
// dispositivo: tiendas (v1.5), aviso de usuarios de prueba, respaldo de datos, cambio de contraseña, instalación y uso
// sin conexión.
import { crearServidorLocal, CLAVE_DATOS, hashClave } from './servidor.js';
import { CLAVE_DEMO, crearDatosTienda } from './semilla.js';
import { validarNuevoUsuario } from '../src/identity/domain/equipo.js';
import { h, abrirModal, confirmar, toast, toastError, descargarArchivo, conBotonOcupado, crearAvisoFormulario, campo, idCampo, mostrarErrores, opciones } from '../js/ui.js';

// ---------------------------------------------------------------- Tiendas (v1.5, ADR-19)
// Cada tienda guarda sus datos aparte en este dispositivo. La demostración conserva la clave de siempre
// (los datos de quien ya usaba la app no se pierden).
const CLAVE_TIENDAS = 'pastel-stock.tiendas';
const DEMO = { id: 'demo', nombre: 'Dulce Hogar (demostración)', demo: true };
const claveDatos = (id) => (id === 'demo' ? CLAVE_DATOS : `${CLAVE_DATOS}.${id}`);
const ls = {
  leer(k) { try { return localStorage.getItem(k); } catch { return null; } },
  guardar(k, v) {
    try { localStorage.setItem(k, v); return true; } catch {
      toast('No hay espacio para guardar en este dispositivo. Descarga un respaldo.', 'error');
      return false;
    }
  },
  borrar(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

function leerTiendas() {
  let reg = null;
  try { reg = JSON.parse(ls.leer(CLAVE_TIENDAS)); } catch { reg = null; }
  const lista = Array.isArray(reg?.lista) ? reg.lista.filter((t) => t && typeof t.id === 'string' && t.id !== 'demo' && typeof t.nombre === 'string') : [];
  const todas = [...lista, DEMO];
  const activa = todas.some((t) => t.id === reg?.activa) ? reg.activa : (lista[0]?.id ?? 'demo');
  return { activa, lista: todas };
}
function guardarTiendas(reg) {
  ls.guardar(CLAVE_TIENDAS, JSON.stringify({ activa: reg.activa, lista: reg.lista.filter((t) => !t.demo) }));
}

let tiendas = leerTiendas();
const tiendaActiva = () => tiendas.lista.find((t) => t.id === tiendas.activa) ?? DEMO;
function servidorDe(id) {
  const clave = claveDatos(id);
  return crearServidorLocal({
    almacen: { leer: () => ls.leer(clave), guardar: (texto) => ls.guardar(clave, texto) },
    inicial: id === 'demo' ? undefined : async () => { throw new Error('Los datos de esta tienda no están en este dispositivo. Restaura un respaldo.'); },
  });
}
let servidor = servidorDe(tiendas.activa);
function usarTienda(id) {
  tiendas = { ...tiendas, activa: id };
  guardarTiendas(tiendas);
  servidor = servidorDe(id);
}

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
  const t = tiendaActiva();
  aviso.replaceChildren(...(t.demo
    ? [h('strong', {}, 'Usuarios de prueba: '), 'admin, operador o contador · contraseña ', h('code', {}, CLAVE_DEMO), h('br')]
    : [h('span', {}, '¿Olvidaste tu contraseña? Pídele al administrador de la tienda que te ponga una nueva en «Equipo».'), h('br')]),
  h('span', {}, '📱 Funciona sin internet. Los datos se guardan solo en este dispositivo.'));
  const sub = document.querySelector('.login-header p');
  if (sub) sub.textContent = `Sistema de gestión de inventarios · ${t.demo ? 'Dulce Hogar' : t.nombre}`;
}

/** Selector de tienda y botón «Crear una tienda nueva» en la pantalla de inicio de sesión. */
function montarTiendasEnLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  const id = idCampo('tienda');
  const select = h('select', { id, name: 'tienda' });
  const crear = h('button', { type: 'button', class: 'btn-enlace' }, '＋ Crear una tienda nueva');
  const bloque = h('div', { class: 'selector-tienda' },
    h('label', { for: id }, 'Tienda'),
    select,
    crear);
  form.insertBefore(bloque, form.querySelector('.form-group'));
  function pintar() {
    select.replaceChildren(...opciones(tiendas.lista.map((t) => ({ valor: t.id, texto: t.nombre }))));
    select.value = tiendas.activa;
    avisoLogin();
  }
  select.addEventListener('change', () => { usarTienda(select.value); pintar(); document.getElementById('login-user').focus(); });
  crear.addEventListener('click', () => abrirCrearTienda({ alCrear: pintar }));
  pintar();
}

function abrirCrearTienda({ alCrear }) {
  const aviso = crearAvisoFormulario();
  const campos = {
    tienda: campo({ id: idCampo('t-nombre'), etiqueta: 'Nombre de la tienda', requerido: true, ayuda: 'Ejemplo: Panadería La Espiga', control: h('input', { type: 'text', autocomplete: 'organization', maxlength: '60' }) }),
    nombre: campo({ id: idCampo('t-admin'), etiqueta: 'Tu nombre', requerido: true, control: h('input', { type: 'text', autocomplete: 'name', maxlength: '80' }) }),
    usuario: campo({ id: idCampo('t-usuario'), etiqueta: 'Tu usuario para entrar', requerido: true, ayuda: 'Sin espacios ni tildes. Ejemplo: rosa', control: h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '40' }) }),
    contrasena: campo({ id: idCampo('t-clave'), etiqueta: 'Tu contraseña', requerido: true, ayuda: 'Mínimo 8 caracteres.', control: h('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' }) }),
    repetir: campo({ id: idCampo('t-clave2'), etiqueta: 'Repite la contraseña', requerido: true, control: h('input', { type: 'password', autocomplete: 'new-password', maxlength: '72' }) }),
  };
  campos.usuario.control.addEventListener('input', () => { campos.usuario.control.value = campos.usuario.control.value.toLowerCase().replace(/\s/g, ''); });
  const guardar = h('button', { type: 'submit', class: 'btn' }, 'Crear tienda');
  const cancelar = h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar');
  const form = h('form', { novalidate: true },
    h('p', { class: 'ayuda', style: { margin: '0 0 14px' } }, 'La tienda empieza vacía y tú serás su administrador. Después podrás agregar a tu equipo en «Equipo».'),
    aviso.el, ...Object.values(campos).map((c) => c.grupo), h('div', { class: 'form-acciones' }, cancelar, guardar));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); aviso.ocultar();
    const v = Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.control.value]));
    const errores = {};
    const nombreTienda = v.tienda.trim();
    if (nombreTienda.length < 2) errores.tienda = 'Escribe el nombre de la tienda.';
    else if (tiendas.lista.some((t) => t.nombre.toLowerCase() === nombreTienda.toLowerCase())) errores.tienda = 'Ya hay una tienda con ese nombre en este dispositivo.';
    if (v.nombre.trim().length < 2) errores.nombre = 'Escribe tu nombre.';
    let admin = null;
    try { admin = validarNuevoUsuario({ usuario: v.usuario, nombre: v.nombre.trim() || 'xx', rol: 'admin', contrasena: v.contrasena }); } catch (e) {
      if (/Usuario/.test(e.title)) errores.usuario = 'De 3 a 40 letras minúsculas o números, sin espacios ni tildes.';
      else if (/Contraseña/.test(e.title)) errores.contrasena = 'Usa entre 8 y 72 caracteres.';
    }
    if (!errores.contrasena && v.repetir !== v.contrasena) errores.repetir = 'Las contraseñas no coinciden.';
    mostrarErrores(campos, errores);
    if (Object.keys(errores).length) return;
    try {
      await conBotonOcupado(guardar, async () => {
        const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const datos = await crearDatosTienda({ nombreTienda, admin: { ...admin, contrasena: v.contrasena }, hashClave });
        if (!ls.guardar(claveDatos(id), JSON.stringify(datos))) throw new Error('No hay espacio en este dispositivo para otra tienda.');
        tiendas = { activa: id, lista: [{ id, nombre: nombreTienda, creadaEn: datos.tienda.creadaEn }, ...tiendas.lista] };
        usarTienda(id);
      }, 'Creando…');
      modal.cerrar();
      alCrear?.();
      toast(`Tienda «${nombreTienda}» creada`);
      // Entra de una vez con la cuenta recién creada
      document.getElementById('login-user').value = admin.usuario;
      document.getElementById('login-pass').value = v.contrasena;
      document.getElementById('login-form').requestSubmit();
    } catch (e) { aviso.mostrar(e.message ?? 'No se pudo crear la tienda.'); }
  });
  const modal = abrirModal({ titulo: 'Crear una tienda nueva', contenido: form, ancho: 520 });
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
    const t = tiendaActiva();
    let peligro = reiniciar;
    if (!t.demo) {
      peligro = h('button', { type: 'button', class: 'btn btn-danger btn-sm' }, `Eliminar la tienda «${t.nombre}» de este dispositivo`);
      peligro.addEventListener('click', async () => {
        if (!(await confirmar({ titulo: 'Eliminar tienda', mensaje: `Se borrarán TODOS los datos de «${t.nombre}» en este dispositivo: ingredientes, productos, ventas y equipo. Descarga un respaldo antes si lo necesitas. ¿Continuar?`, textoAceptar: 'Eliminar tienda' }))) return;
        ls.borrar(claveDatos(t.id));
        tiendas = { activa: 'demo', lista: tiendas.lista.filter((x) => x.id !== t.id) };
        usarTienda('demo');
        modal.cerrar();
        cerrarSesion();
        location.reload();
      });
    }
    secciones.push(h('h3', {}, 'Zona de riesgo'), h('div', { class: 'acciones', style: { margin: '10px 0 18px' } }, peligro));
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
  fetch: (...args) => servidor.fetch(...args),
  storage: (() => { try { return globalThis.localStorage; } catch { return undefined; } })(),
  montar(ctx) {
    registrarServiceWorker();
    montarTiendasEnLogin();
    const pie = document.querySelector('.sidebar-footer');
    if (!pie) return;
    botonInstalar(pie);
    const datos = h('button', { type: 'button', class: 'btn-logout' }, '💾 Datos y cuenta');
    datos.addEventListener('click', () => abrirDatos(ctx));
    pie.insertBefore(datos, document.getElementById('btn-logout'));
  },
};
