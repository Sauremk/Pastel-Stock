# ADR-09: Pipeline de CI en GitHub Actions con Quality Gate bloqueante (SonarCloud) y artefacto inmutable por SHA

| Campo | Valor |
|---|---|
| **Estado** | Aceptado |
| **Origen** | Guía de aprendizaje No. 9 (FPI-25) — Ingeniería de Software II, Universidad de Pamplona |
| **Autor** | Kevin Andres Rojas Marin |
| **Implementación en el repositorio** | `.github/workflows/ci.yml`, `sonar-project.properties`, `.github/dependabot.yml`. |

## Contexto

Contamos con 46 pruebas y un linter, pero todo se ejecuta a mano ("en mi máquina sí funciona"). Hay deuda heredada que no se puede pagar de una vez (DT-01 a DT-13), y una IA generó un pipeline que pasa la sintaxis pero no protege: gate informativo, Node incompatible y cobertura sin transferir. El equipo es de 4 personas y el repositorio es el único punto de integración.

## Decisión

GitHub Actions con jobs encadenados `lint → test → analysis → build`; Node 22; `permissions: contents: read`; gate de SonarCloud sobre **código nuevo** con `sonar.qualitygate.wait=true`; cobertura (c8, `lcov`) pasada entre jobs como artefacto; umbral global de 70 %; protección de `main` con los tres checks obligatorios; artefacto `pastel-stock-<SHA>.tgz` generado solo en `main` y nunca recompilado por entorno; secretos solo vía `secrets` (`SONAR_TOKEN`); Dependabot para npm y para las Actions. La imagen Docker (Guía 10) reemplazará al `.tgz` como artefacto.

## Consecuencias

**Positivas:** ningún PR con vulnerabilidades, bugs o cobertura baja nueva se fusiona; el estándar es igual para todos; builds reproducibles; la deuda heredada no bloquea el trabajo pero no crece. **Negativas:** cada PR espera ≈ minutos de pipeline y el scan de SonarCloud; dependencia de dos servicios externos (GitHub, SonarCloud) y de un token que debe rotarse; las Actions de terceros deberían fijarse por SHA para mayor seguridad de la cadena de suministro; el gate de código nuevo no mide la deuda existente (se gestiona con el roadmap, Guía 15).
