# Alcance productivo requerido

Esta etapa convierte el prototipo estatico en una aplicacion productiva con backend, base de datos, autenticacion real, storage, reportes y administracion completa.

## Modulos obligatorios

1. Autenticacion y seguridad
   - Usuarios reales.
   - Contrasenas hasheadas mediante Supabase Auth.
   - Sesiones seguras.
   - Autorizacion por rol.
   - Politicas RLS en PostgreSQL.

2. Roles
   - Administrador.
   - Conductor.
   - Supervisor.
   - Mantenimiento.
   - Auditor.
   - Administrador general.

3. Vehiculos
   - Alta.
   - Edicion.
   - Baja logica.
   - Consulta.
   - Dominio, interno, modelo, tipo, empresa, area, sector, flota, equipamiento, kilometraje, estado.

4. Conductores
   - Alta.
   - Edicion.
   - Estado de usuario.
   - Legajo, nombre, area, sector, cargo, ubicacion.
   - Historial de uso.

5. Asignaciones historicas
   - Conductor + vehiculo + inicio + finalizacion.
   - Kilometraje inicial/final.
   - Kilometros recorridos.
   - Estado recibido y entregado.
   - Aceptacion auditable.

6. Checklist configurable
   - Plantillas administrables.
   - Items por tipo de vehiculo.
   - Estados: correcto, observado, defectuoso, faltante, no aplica.
   - Descripcion obligatoria segun configuracion.
   - Foto opcional u obligatoria segun configuracion.

7. Danos e irregularidades
   - Diferenciar preexistente de nuevo.
   - Estado abierto, en revision, resuelto.
   - Severidad informativa, advertencia, critica.
   - Evidencia fotografica.

8. Documentacion y vencimientos
   - VTV/RTO.
   - VTH si corresponde.
   - Seguro.
   - Matafuego.
   - Documentacion configurable por tipo de vehiculo.

9. Equipamiento
   - Equipamiento esperado por vehiculo/tipo.
   - Equipamiento presente/faltante.
   - Historial de faltantes.

10. Mantenimiento y reparaciones
   - Preventivo y correctivo.
   - Reparaciones importadas desde Excel.
   - Fecha ingreso, fecha retiro, proveedor/taller, detalle, costo, observaciones, estado.

11. Alertas
   - Matafuego vencido.
   - Equipamiento faltante.
   - Dano informado.
   - Kilometraje inconsistente.
   - Mantenimiento pendiente.
   - Vehiculo fuera de servicio.
   - Documentacion proxima a vencer.
   - Vehiculo devuelto con nueva irregularidad.

12. Reportes
   - Filtros por fecha, vehiculo, patente, conductor, legajo, area, sector, empresa, tipo, estado e incidencias.
   - Uso por vehiculo.
   - Uso por conductor.
   - Kilometros recorridos.
   - Historial de patente.
   - Danos e irregularidades.
   - Mantenimiento y reparaciones.
   - Equipamiento faltante.
   - Vencimientos.
   - Vehiculos fuera de servicio.
   - Exportacion CSV, Excel y PDF.

13. Importacion
   - No modificar archivos originales.
   - Identificar columnas.
   - Normalizar nombres.
   - Detectar duplicados.
   - Detectar incompletos.
   - Presentar informe previo.
   - Importar solo despues de aprobacion.

14. Storage
   - Fotos de tablero.
   - Fotos de danos.
   - Documentacion.
   - Evidencia de inspecciones.

15. GPS futuro
   - No implementar en primera version productiva si EDESUR no provee API.
   - Dejar modulo opcional `LocationProvider`.
   - Asociar localizacion al vehiculo/dispositivo corporativo, no al telefono personal ocultamente.

## Stack recomendado

- Frontend: Next.js, React, TypeScript.
- Backend: Next.js API Routes o Server Actions.
- Base: Supabase PostgreSQL.
- Auth: Supabase Auth.
- Storage: Supabase Storage.
- Reportes: generacion server-side CSV/XLSX/PDF.
- Deploy: Vercel.

## Etapas de implementacion

1. Crear proyecto Supabase y aplicar esquema SQL.
2. Migrar prototipo a Next.js + TypeScript.
3. Conectar autenticacion real.
4. Migrar datos demo/locales a tablas reales.
5. Implementar CRUD vehiculos y conductores.
6. Implementar checklists configurables.
7. Implementar asignaciones con inspecciones inicial/final.
8. Implementar incidentes, fotos y storage.
9. Implementar mantenimiento, reparaciones, equipamiento y documentacion.
10. Implementar alertas y auditoria visible.
11. Implementar reportes avanzados CSV/XLSX/PDF.
12. Conectar Vercel con variables de entorno.
