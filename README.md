# calcular_precios
Calculadora de Precios: calculadoras basadas en inflación para Argentina (alquiler IPC/ICL, sueldo, aguinaldo, dólar).

Sitio estático hecho con [Astro](https://astro.build).

## Comandos

| Comando           | Qué hace                                             |
| ----------------- | ---------------------------------------------------- |
| `npm install`     | Instala dependencias                                 |
| `npm run dev`     | Servidor local en http://localhost:4321              |
| `npm run build`   | Genera el sitio en `dist/` (descarga los índices)    |
| `npm run preview` | Sirve el build localmente                            |
| `npm test`        | Tests de la lógica de cálculo                        |
| `npm run check`   | Chequeo de tipos                                     |

## Datos

- **IPC**: API de Series de Tiempo (datos.gob.ar), serie `148.3_INIVELNAL_DICI_M_26`.
- **ICL**: API de Estadísticas del BCRA v4.0, variable `40`.

Los índices se descargan en cada build y quedan embebidos en la página. Si tienen más de
12 h, el navegador los actualiza en segundo plano. Conviene rebuildear el sitio al menos
una vez por día (por ejemplo, con un cron del hosting).

## Estructura

- `src/lib/indices.ts`: descarga de IPC e ICL.
- `src/lib/calculo.ts`: lógica de actualización (funciones puras, con tests).
- `src/components/CalculadoraAlquiler.astro`: formulario y resultados.
- `src/pages/`: una ruta por archivo.
