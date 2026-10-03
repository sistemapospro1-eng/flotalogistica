# Gestion Flota Operacion

Prototipo web estatico para control operativo de flota. La primera version prioriza responsabilidad, trazabilidad y reportes del circuito principal de uso de vehiculos.

## Alcance de esta version

- Login demo de administrador y conductor.
- Maestro demo de vehiculos y conductores.
- Relacion historica `conductor + vehiculo + inicio + finalizacion`.
- Recepcion de vehiculo con kilometraje inicial.
- Visualizacion de danos e irregularidades preexistentes.
- Checklist inicial.
- Confirmacion auditable de recepcion.
- Vehiculo en uso.
- Devolucion con kilometraje final.
- Checklist final.
- Registro de novedades, danos nuevos y faltantes.
- Calculo de kilometros recorridos.
- Panel administrador con vehiculos en uso, alertas, historial, conductores, mantenimiento y reportes.
- Exportacion CSV de asignaciones.

## GPS

El GPS no forma parte de esta primera version. La aplicacion funciona completamente sin localizacion.

La arquitectura queda preparada para incorporar mas adelante un modulo opcional de localizacion, por ejemplo con una capa `LocationProvider`, cuando la empresa defina proveedor o API.

## Datos

El archivo `data.js` incluido en el repo contiene datos demo anonimizados.

Los datos reales importados desde Excel no deben subirse a GitHub ni desplegarse publicamente. Si se trabaja localmente con datos reales, usar un archivo local ignorado por Git, por ejemplo `data.real.local.js`.

## Accesos demo

- Administrador: `admin` / `admin123`
- Conductor demo: `chofer1` / `flota123`
- Conductores demo importados: legajo / `1234`

## Uso local

Abrir `index.html` directamente en el navegador o ejecutar un servidor estatico:

```bash
python -m http.server 8787 --bind 127.0.0.1
```

Luego abrir:

```text
http://127.0.0.1:8787/index.html
```

## Deploy en Vercel

Este proyecto puede desplegarse como sitio estatico.

1. Subir el repositorio a GitHub.
2. Crear un nuevo proyecto en Vercel.
3. Importar el repositorio.
4. Framework preset: `Other`.
5. Build command: dejar vacio.
6. Output directory: dejar vacio o usar la raiz del proyecto.

## Futuro Supabase

Cuando el circuito sea aprobado, la siguiente etapa recomendada es migrar de `localStorage` a Supabase/PostgreSQL. El esquema inicial esta documentado en `supabase/schema.sql` e incluye:

- `users`
- `employees`
- `vehicles`
- `vehicle_assignments`
- `vehicle_inspections`
- `inspection_details`
- `vehicle_incidents`
- `maintenance`
- `alerts`
- `audit_logs`

Tambien se puede agregar Supabase Storage para fotos de tablero, danos y documentacion.

El alcance completo de produccion esta detallado en `docs/production-scope.md`.
