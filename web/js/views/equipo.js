// Equipo (v1.5, solo administrador): quién entra a la tienda y qué puede hacer cada persona.
// Las reglas las aplica el servidor (src/identity/domain/equipo.js); aquí solo se ayuda a no equivocarse.
import { h, reemplazarHijos, cargando, vacio, bannerError, tabla, insignia, encabezadoVista, abrirModal, confirmar, toast, toastError,
  campo, idCampo, selectControl, mostrarErrores, crearAvisoFormulario, conBotonOcupado } from '../ui.js';
import { ETIQUETAS_ROL, ROLES_EQUIPO } from '../catalogos.js';
import { mensajeDeError } from '../format.js';

const RE_USUARIO = /^[a-z0-9][a-z0-9._-]{2,39}$/;

/** Sugerencia de usuario a partir del nombre: "María Pérez" → "maria.perez". */
export function sugerirUsuario(nombre) {
  const partes = String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  return partes.slice(0, 2).join('.').slice(0, 40);
}

export function validarPersona({ nombre, usuario, contrasena }, { crear = true } = {}) {
  const errores = {};
  if (String(nombre ?? '').trim().length < 2) errores.nombre = 'Escribe el nombre (mínimo 2 letras).';
  if (crear && !RE_USUARIO.test(String(usuario ?? ''))) errores.usuario = 'De 3 a 40 letras minúsculas o números, sin espacios ni tildes. Puedes usar punto o guion.';
  if (crear && String(contrasena ?? '').length < 8) errores.contrasena = 'Usa al menos 8 caracteres.';
  return errores;
}

export function crearVista(ctx) {
  const { api, auth } = ctx;
  let marcaCarga = 0;
  const cuerpo = h('div', {});
  const agregar = h('button', { type: 'button', class: 'btn' }, '＋ Agregar persona');
  const el = h('section', { class: 'vista activa', 'aria-labelledby': 'titulo-equipo' },
    encabezadoVista('Equipo', 'Las personas que pueden entrar a la tienda y lo que puede hacer cada una.', h('div', { class: 'panel-actions' }, agregar)),
    cuerpo);
  el.querySelector('h1').id = 'titulo-equipo';
  agregar.addEventListener('click', () => formularioPersona());

  const soyYo = (u) => u.usuario === auth.usuario()?.usuario;

  function pintar({ datos }) {
    if (datos.length === 0) { reemplazarHijos(cuerpo, vacio('Aún no hay personas.', '👥')); return; }
    const activos = datos.filter((u) => u.activo).length;
    reemplazarHijos(cuerpo,
      h('div', { class: 'panel' },
        h('div', { class: 'panel-header' }, h('h2', {}, `${activos} ${activos === 1 ? 'persona activa' : 'personas activas'}`)),
        tabla({
          descripcion: 'Personas del equipo, su rol y su estado',
          columnas: [{ titulo: 'Persona' }, { titulo: 'Qué hace' }, { titulo: 'Estado' }, { titulo: 'Acciones' }],
          filas: datos.map((u) => ({
            clase: u.activo ? null : 'fila-inactiva',
            celdas: [
              h('span', {}, u.nombre, soyYo(u) ? h('span', { class: 'estado vigente', style: { marginLeft: '6px' } }, 'Tú') : null,
                h('span', { class: 'sub' }, `Usuario: ${u.usuario}`)),
              ETIQUETAS_ROL[u.rol] ?? u.rol,
              u.activo ? insignia('Puede entrar', 'vigente') : insignia('Desactivada', 'vencido'),
              h('div', { class: 'acciones' },
                h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => formularioPersona(u) }, 'Editar'),
                h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onClick: () => formularioClave(u) }, 'Contraseña'),
                soyYo(u) ? null : h('button', { type: 'button', class: ['btn', 'btn-sm', u.activo ? 'btn-danger' : 'btn-secondary'], onClick: () => alternarActivo(u) },
                  u.activo ? 'Desactivar' : 'Activar')),
            ],
          })),
        }),
        h('p', { class: 'ayuda' }, 'Desactivar no borra a la persona: sus ventas y movimientos quedan con su nombre. Puedes volver a activarla cuando quieras.')));
  }

  async function cargar() {
    const marca = ++marcaCarga;
    reemplazarHijos(cuerpo, cargando('Cargando el equipo…'));
    try {
      const r = await api.get('/usuarios');
      if (marca === marcaCarga) pintar(r);
    } catch (e) { if (marca === marcaCarga) reemplazarHijos(cuerpo, bannerError(e, cargar)); }
  }

  function formularioPersona(existente = null) {
    const crear = !existente;
    const yo = existente && soyYo(existente);
    const aviso = crearAvisoFormulario();
    const campos = {
      nombre: campo({ id: idCampo('p-nombre'), etiqueta: '¿Cómo se llama?', requerido: true, control: h('input', { type: 'text', autocomplete: 'off', maxlength: '80', value: existente?.nombre ?? '' }) }),
    };
    if (crear) {
      campos.usuario = campo({ id: idCampo('p-usuario'), etiqueta: 'Usuario para entrar', requerido: true, ayuda: 'Sin espacios ni tildes. Ejemplo: maria.perez',
        control: h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '40' }) });
      let tocado = false;
      campos.usuario.control.addEventListener('input', () => { tocado = true; campos.usuario.control.value = campos.usuario.control.value.toLowerCase().replace(/\s/g, ''); });
      campos.nombre.control.addEventListener('input', () => { if (!tocado) campos.usuario.control.value = sugerirUsuario(campos.nombre.control.value); });
    }
    campos.rol = campo({ id: idCampo('p-rol'), etiqueta: '¿Qué va a hacer?', requerido: true,
      ayuda: yo ? 'No puedes cambiar tu propio rol: así la tienda nunca se queda sin administrador.' : null,
      control: selectControl(ROLES_EQUIPO, { valor: existente?.rol ?? 'operador', disabled: yo }) });
    if (crear) {
      campos.contrasena = campo({ id: idCampo('p-clave'), etiqueta: 'Contraseña inicial', requerido: true, ayuda: 'Mínimo 8 caracteres. Dísela a la persona para que pueda entrar.',
        control: h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '72' }) });
    }
    const guardar = h('button', { type: 'submit', class: 'btn' }, crear ? 'Agregar' : 'Guardar cambios');
    const cancelar = h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar');
    const form = h('form', { novalidate: true }, aviso.el, ...Object.values(campos).map((c) => c.grupo), h('div', { class: 'form-acciones' }, cancelar, guardar));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); aviso.ocultar();
      const valores = Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, c.control.value]));
      const errores = validarPersona(valores, { crear });
      mostrarErrores(campos, errores);
      if (Object.keys(errores).length) return;
      try {
        await conBotonOcupado(guardar, async () => {
          if (crear) {
            await api.post('/usuarios', { nombre: valores.nombre.trim(), usuario: valores.usuario, rol: valores.rol, contrasena: valores.contrasena });
          } else {
            const cambios = {};
            if (valores.nombre.trim() !== existente.nombre) cambios.nombre = valores.nombre.trim();
            if (!yo && valores.rol !== existente.rol) cambios.rol = valores.rol;
            if (Object.keys(cambios).length) await api.patch(`/usuarios/${existente.id}`, cambios);
          }
        });
        modal.cerrar();
        toast(crear ? `${valores.nombre.trim()} ya puede entrar con el usuario «${valores.usuario}»` : 'Cambios guardados');
        cargar();
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
    const modal = abrirModal({ titulo: crear ? 'Agregar persona' : `Editar a ${existente.nombre}`, contenido: form, ancho: 520 });
  }

  function formularioClave(u) {
    const aviso = crearAvisoFormulario();
    const c = campo({ id: idCampo('p-clave-nueva'), etiqueta: 'Contraseña nueva', requerido: true, ayuda: 'Mínimo 8 caracteres. Se cerrará su sesión y deberá entrar con esta.',
      control: h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '72' }) });
    const guardar = h('button', { type: 'submit', class: 'btn' }, 'Cambiar contraseña');
    const cancelar = h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => modal.cerrar() }, 'Cancelar');
    const form = h('form', { novalidate: true }, aviso.el, c.grupo, h('div', { class: 'form-acciones' }, cancelar, guardar));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); aviso.ocultar();
      if (c.control.value.length < 8) { c.error('Usa al menos 8 caracteres.'); c.control.focus(); return; }
      try {
        await conBotonOcupado(guardar, () => api.post(`/usuarios/${u.id}/contrasena`, { contrasena: c.control.value }));
        modal.cerrar();
        toast(soyYo(u) ? 'Contraseña cambiada. Vuelve a entrar con la nueva cuando se cierre tu sesión.' : `Contraseña de ${u.nombre} cambiada`);
      } catch (e) { aviso.mostrar(mensajeDeError(e)); }
    });
    const modal = abrirModal({ titulo: `Contraseña de ${u.nombre}`, contenido: form, ancho: 460 });
  }

  async function alternarActivo(u) {
    if (u.activo && !(await confirmar({ titulo: `Desactivar a ${u.nombre}`, mensaje: 'No podrá volver a entrar hasta que la actives. Sus ventas y movimientos se conservan.', textoAceptar: 'Desactivar' }))) return;
    try {
      await api.patch(`/usuarios/${u.id}`, { activo: !u.activo });
      toast(u.activo ? `${u.nombre} ya no puede entrar` : `${u.nombre} puede volver a entrar`);
      cargar();
    } catch (e) { toastError(e); }
  }

  return { el, titulo: 'Equipo', cargar, destruir() { marcaCarga++; } };
}
