// Verificación de extremo a extremo del reintento en la interfaz (II-06). NO es parte de `npm test` (necesita app + navegador + PostgreSQL con la siembra).
// Simula que el servidor procesa «producir» pero la respuesta se pierde, y la persona reintenta. Con la clave de idempotencia debe producirse UNA vez.
// Uso:  OPER=<contraseña del operador> PGPASSWORD=<clave de la BD> node scripts/verificar-reintento-ui.cjs   (app en :3102, PostgreSQL en :54412; ver scripts/ensayo-despliegue.sh)
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const q = (s) => execSync(`psql -h 127.0.0.1 -p 54412 -U pastel -d pastel_piloto -Atc "${s}"`, { env: process.env }).toString().trim();
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const vistas = [];
  let n = 0;
  await p.route('**/api/v1/recetas/1/producir', async (route) => {
    n += 1; vistas.push(route.request().headers()['idempotency-key']);
    if (n === 1) { await route.fetch(); await route.abort('failed'); } // el servidor procesa y COMMITEA, pero la respuesta se pierde
    else await route.continue();
  });
  await p.goto('http://localhost:3102/');
  const inputs = await p.$$('input'); 
  console.log('inputs login:', inputs.length);
  await inputs[0].fill('operador'); await inputs[1].fill(process.env.OPER);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  await p.getByText('Recetas', { exact: false }).first().click();
  await p.waitForTimeout(800);
  const antes = q("select stock from productos where sku='PT001'") + '/' + q("select count(*) from movimientos where tipo='SALIDA'");
  await p.getByRole('button', { name: /Producir/ }).first().click();
  await p.getByRole('button', { name: 'Registrar producción' }).click();
  await p.waitForTimeout(1200);
  const aviso1 = await p.locator('[role=alert], .banner-error, .aviso').allInnerTexts();
  console.log('tras 1.er envío (respuesta perdida): aviso =', JSON.stringify(aviso1));
  const medio = q("select stock from productos where sku='PT001'") + '/' + q("select count(*) from movimientos where tipo='SALIDA'");
  await p.getByRole('button', { name: 'Registrar producción' }).click();
  await p.waitForTimeout(1200);
  const ok = await p.locator('[role=status]').allInnerTexts();
  const despues = q("select stock from productos where sku='PT001'") + '/' + q("select count(*) from movimientos where tipo='SALIDA'");
  console.log('claves enviadas:', JSON.stringify(vistas), 'iguales =', vistas[0] === vistas[1]);
  console.log('stock PT001 / SALIDAs  antes:', antes, ' tras 1.º (servidor sí produjo):', medio, ' tras reintento:', despues);
  console.log('mensaje final:', JSON.stringify(ok));
  await b.close();
})();
