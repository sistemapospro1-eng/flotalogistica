const app = document.getElementById("app");
const storageKey = "gestion-flota-operacion-v2";

const state = {
  user: null,
  view: "dashboard",
  query: "",
  area: "Todas",
  reportStatus: "Todos",
  reportFrom: "",
  reportTo: "",
  vehicleId: "",
  vehicleDetailTab: "summary",
  editVehicleId: "",
  editDriverId: "",
  editMaintenanceId: "",
  loading: false,
  dataMode: window.fleetSupabase?.isEnabled() ? "supabase" : "demo",
};

const checklistTemplate = [
  ["Luces", ["Bajas", "Altas", "Posicion", "Stop", "Giro y balizas"]],
  ["Neumaticos", ["Delantero izquierdo", "Delantero derecho", "Trasero izquierdo", "Trasero derecho", "Rueda de auxilio"]],
  ["Carroceria", ["Chapa", "Paragolpes", "Puertas", "Espejos", "Cristales"]],
  ["Interior", ["Asientos", "Cinturones", "Tablero", "Limpieza"]],
  ["Seguridad y equipamiento", ["Matafuego", "Balizas", "Cricket/gato", "Llave cruz", "Herramientas"]],
  ["Mecanica", ["Frenos", "Direccion", "Bateria", "Perdidas", "Ruidos"]],
];

const checklistStatuses = [
  ["correcto", "Correcto"],
  ["observado", "Observado"],
  ["defectuoso", "Defectuoso"],
  ["faltante", "Faltante"],
  ["no_aplica", "No aplica"],
];

const vehicleTypeOptions = [
  ["", "Todos"],
  ["Automovil", "Automovil"],
  ["Camioneta", "Camioneta"],
  ["Camion", "Camion"],
  ["Furgon", "Furgon"],
  ["Utilitario", "Utilitario"],
  ["4x4", "4x4"],
  ["4x2", "4x2"],
];

function loadRuntime() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const oldSaved = JSON.parse(localStorage.getItem("gestion-flota-localizador-v1") || "{}");
  const seedAssignments = (seedData.handovers || []).map(migrateHandover);
  const assignments = saved.assignments || (oldSaved.handovers || []).map(migrateHandover);

  return reconcileRuntime({
    vehicles: mergeVehicles(seedData.vehicles || [], saved.vehicles || oldSaved.vehicles || []),
    people: seedData.people || [],
    assignments: assignments.length ? assignments : seedAssignments,
    incidents: saved.incidents || buildSeedIncidents(seedAssignments),
    maintenance: saved.maintenance || buildSeedMaintenance(seedData.vehicles || []),
    documents: saved.documents || [],
    equipment: saved.equipment || [],
    photos: saved.photos || [],
    profiles: saved.profiles || [],
    auditLogs: saved.auditLogs || [],
    checklistTemplates: saved.checklistTemplates || [],
    checklistItems: saved.checklistItems || [],
  });
}

let runtime = loadRuntime();

function saveRuntime() {
  if (state.dataMode === "supabase") return;
  localStorage.setItem(storageKey, JSON.stringify({
    vehicles: runtime.vehicles.map(({ id, status, odometer, driver, activeAssignmentId, lastReport }) => ({
      id, status, odometer, driver, activeAssignmentId, lastReport,
    })),
    assignments: runtime.assignments,
    incidents: runtime.incidents,
    maintenance: runtime.maintenance,
    documents: runtime.documents,
    equipment: runtime.equipment,
    photos: runtime.photos,
    auditLogs: runtime.auditLogs,
    checklistTemplates: runtime.checklistTemplates,
    checklistItems: runtime.checklistItems,
  }));
}

function mergeVehicles(base, saved) {
  const byId = new Map(saved.map((item) => [item.id, item]));
  return base.map((vehicle) => ({ ...vehicle, ...byId.get(vehicle.id) }));
}

function migrateHandover(item) {
  const closed = Boolean(item.closedAt);
  const odometerStart = Number(item.odometerStart || 0);
  const odometerEnd = closed ? Number(item.odometerEnd || item.odometerStart || 0) : null;
  return {
    id: item.id || `A${Date.now()}`,
    vehicleId: item.vehicleId,
    domain: item.domain,
    employeeId: item.employeeId,
    driver: item.driver,
    startAt: item.createdAt,
    endAt: item.closedAt,
    odometerStart,
    odometerEnd,
    distance: closed ? Math.max(0, odometerEnd - odometerStart) : null,
    locationStart: item.location || "Base operativa",
    locationEnd: "",
    startChecklist: migrateChecklist(item.checks || {}),
    endChecklist: {},
    startNotes: item.notes || "",
    endNotes: "",
    acceptedAt: item.createdAt,
    preexistingIncidentIds: [],
    status: closed ? "closed" : "active",
  };
}

function migrateChecklist(checks) {
  return Object.fromEntries(Object.entries(checks).map(([key, value]) => {
    const normalized = value === "ok" ? "correcto" : value === "warn" ? "observado" : "defectuoso";
    return [key, normalized];
  }));
}

function buildSeedIncidents(assignments) {
  return assignments
    .filter((assignment) => checklistSeverity(assignment.startChecklist) !== "correcto")
    .map((assignment, index) => ({
      id: `I-SEED-${index + 1}`,
      vehicleId: assignment.vehicleId,
      domain: assignment.domain,
      assignmentId: assignment.id,
      reportedBy: assignment.driver,
      reportedAt: assignment.startAt,
      stage: "detected_at_start",
      title: "Novedad detectada en control inicial",
      description: assignment.startNotes || "Checklist inicial con observaciones.",
      status: "open",
      severity: checklistSeverity(assignment.startChecklist),
      source: "seed",
    }));
}

function buildSeedMaintenance(vehicles) {
  return vehicles.slice(0, 10).map((vehicle, index) => ({
    id: `M${index + 1}`,
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    type: index % 3 === 0 ? "Correctivo" : "Preventivo",
    status: index % 4 === 0 ? "Pendiente" : "Finalizado",
    detail: index % 3 === 0 ? "Revision por novedad operativa." : "Control periodico de unidad.",
    createdAt: `2026-09-${String(12 + index).padStart(2, "0")}T09:00:00.000Z`,
  }));
}

function reconcileRuntime(data) {
  const activeByVehicle = new Map(
    data.assignments
      .filter((assignment) => assignment.status === "active" && !assignment.endAt)
      .map((assignment) => [assignment.vehicleId, assignment])
  );
  const openIncidentsByVehicle = new Set(
    data.incidents
      .filter((incident) => incident.status === "open")
      .map((incident) => incident.vehicleId)
  );

  data.vehicles = data.vehicles.map((vehicle) => {
    const active = activeByVehicle.get(vehicle.id);
    if (active) {
      return {
        ...vehicle,
        status: "active",
        driver: active.driver,
        activeAssignmentId: active.id,
        odometer: active.odometerStart || vehicle.odometer,
        lastReport: active.startAt,
      };
    }
    if (openIncidentsByVehicle.has(vehicle.id)) {
      return { ...vehicle, status: "alert", activeAssignmentId: "", driver: "" };
    }
    return { ...vehicle, activeAssignmentId: vehicle.activeAssignmentId || "", driver: vehicle.driver || "" };
  });

  return data;
}

function init() {
  bootstrap();
}

async function bootstrap() {
  state.loading = true;
  renderShellMessage("Cargando aplicacion...");
  try {
    if (window.fleetSupabase?.isEnabled()) {
      state.dataMode = "supabase";
      const remoteUser = await window.fleetSupabase.currentProfile();
      state.user = remoteUser || null;
      sessionStorage.removeItem("gestion-flota-session");
      if (state.user) {
        runtime = reconcileRuntime(await window.fleetSupabase.loadRuntime());
      }
    } else {
      state.dataMode = "demo";
      state.user = JSON.parse(sessionStorage.getItem("gestion-flota-session") || "null");
    }
  } catch (error) {
    console.error(error);
    state.dataMode = "demo";
    state.user = JSON.parse(sessionStorage.getItem("gestion-flota-session") || "null");
    toast("No se pudo conectar Supabase. Se abrio en modo demo.");
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  if (state.loading) return renderShellMessage("Cargando aplicacion...");
  if (!state.user) return renderLogin();

  const appRole = state.user.appRole || (state.user.role === "admin" ? "admin" : "driver");
  const isAdmin = state.user.role === "admin";
  const canManageUsers = ["admin", "super_admin"].includes(appRole);
  const canViewAudit = ["admin", "super_admin", "auditor"].includes(appRole);
  if (!isAdmin) state.view = "driver";

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand-mark"><span class="bolt">F</span><span>Gestion Flota</span></div>
        <nav class="side-nav">
          ${isAdmin ? navButton("dashboard", "Panel") : ""}
          ${isAdmin ? navButton("vehicles", "Vehiculos") : ""}
          ${isAdmin ? navButton("drivers", "Conductores") : ""}
          ${isAdmin ? navButton("incidents", "Danos") : ""}
          ${isAdmin ? navButton("maintenance", "Mantenimiento") : ""}
          ${isAdmin ? navButton("reports", "Reportes") : ""}
          ${canManageUsers ? navButton("checklist", "Checklist") : ""}
          ${canManageUsers ? navButton("users", "Usuarios") : ""}
          ${canViewAudit ? navButton("audit", "Auditoria") : ""}
          ${navButton("driver", isAdmin ? "Modo conductor" : "Mi turno")}
        </nav>
        <div class="user-box">
          <div><strong>${escapeHtml(state.user.name)}</strong><br><span class="muted">${isAdmin ? roleLabel(appRole) : "Conductor"}</span></div>
          <button class="btn secondary" data-action="logout">Cerrar sesion</button>
        </div>
      </aside>
      <section class="content">${renderView()}</section>
    </div>
  `;
  bindCommon();
}

function renderLogin() {
  const supabaseEnabled = state.dataMode === "supabase";
  app.innerHTML = `
    <div class="login-shell">
      <section class="brand-panel">
        <div class="brand-mark"><span class="bolt">F</span><span>Gestion Flota</span></div>
        <div>
          <h1>Control y trazabilidad vehicular</h1>
          <p>Recepcion, uso, devolucion, kilometraje, danos, checklist y reportes operativos para flota.</p>
        </div>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <h2>Ingresar</h2>
          <p class="muted">Primera version sin GPS. El foco es responsabilidad e historial de uso.</p>
          <form class="form-grid" id="loginForm">
            <label class="field"><span>${supabaseEnabled ? "Email o legajo" : "Usuario"}</span><input name="username" autocomplete="username" value="${supabaseEnabled ? "" : "admin"}"></label>
            <label class="field"><span>Contrasena</span><input name="password" type="password" autocomplete="current-password" value="${supabaseEnabled ? "" : "admin123"}"></label>
            <div class="error" id="loginError"></div>
            <button class="btn" type="submit">Ingresar</button>
          </form>
          <div class="hint">
            ${supabaseEnabled
              ? "Modo produccion: admin con email; choferes pueden ingresar con legajo si su usuario fue creado como legajo@flotalogistica.local."
              : "Admin: <strong>admin</strong> / <strong>admin123</strong><br>Conductor demo: <strong>chofer1</strong> / <strong>flota123</strong><br>Personal importado: legajo / ultimos 4 digitos del CUIL."}
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const user = await authenticate(String(form.get("username") || "").trim(), String(form.get("password") || "").trim());
      if (!user) {
        document.getElementById("loginError").textContent = "Usuario o contrasena incorrectos.";
        return;
      }
      state.user = user;
      state.view = user.role === "admin" ? "dashboard" : "driver";
      if (state.dataMode === "demo") sessionStorage.setItem("gestion-flota-session", JSON.stringify(user));
      if (state.dataMode === "supabase") runtime = reconcileRuntime(await window.fleetSupabase.loadRuntime());
      addAudit("login", user.username, "users", user.username);
      render();
    } catch (error) {
      document.getElementById("loginError").textContent = error.message || "No se pudo iniciar sesion.";
    }
  });
}

async function authenticate(username, password) {
  if (state.dataMode === "supabase") {
    return window.fleetSupabase.signIn(username, password);
  }
  if (username === "admin" && password === "admin123") {
    return { role: "admin", name: "Administrador de flota", username, employeeId: "admin" };
  }
  if (username === "chofer1" && password === "flota123") {
    const person = runtime.people[0] || { name: "Conductor demo", employeeId: "chofer1" };
    return { role: "driver", name: person.name, username, employeeId: person.employeeId };
  }
  const person = runtime.people.find((item) => String(item.employeeId) === username);
  if (person && person.password === password) {
    return { role: "driver", name: person.name, username, employeeId: person.employeeId };
  }
  return null;
}

function renderView() {
  if (state.view === "vehicles") return renderVehicles();
  if (state.view === "drivers") return renderDrivers();
  if (state.view === "incidents") return renderIncidents();
  if (state.view === "maintenance") return renderMaintenance();
  if (state.view === "reports") return renderReports();
  if (state.view === "checklist") return renderChecklistAdmin();
  if (state.view === "users") return renderUsers();
  if (state.view === "audit") return renderAudit();
  if (state.view === "driver") return renderDriver();
  return renderDashboard();
}

function renderDashboard() {
  const stats = getStats();
  const active = getActiveAssignments();
  const alerts = getAlerts();
  return `
    ${topbar("Panel administrador", `<button class="btn" data-action="export">Exportar CSV</button>`)}
    <section class="stats">
      ${stat("Vehiculos", stats.total)}
      ${stat("En uso", stats.inUse)}
      ${stat("Disponibles", stats.available)}
      ${stat("Con alertas", stats.alerts)}
    </section>
    <section class="grid-2">
      <div class="panel">
        <h3>Vehiculos actualmente utilizados</h3>
        <div class="table-wrap">${activeTable(active)}</div>
      </div>
      <div class="panel">
        <h3>Alertas operativas</h3>
        <div class="vehicle-list">${alerts.slice(0, 12).map(alertCard).join("") || empty("No hay alertas activas.")}</div>
      </div>
    </section>
  `;
}

function renderVehicles() {
  const vehicles = getFilteredVehicles();
  const editingVehicle = state.editVehicleId ? getVehicle(state.editVehicleId) : null;
  return `
    ${topbar("Control de vehiculos", `<button class="btn" data-action="new-vehicle">Nuevo vehiculo</button>${state.dataMode === "demo" ? `<button class="btn secondary" data-action="reset">Restaurar datos base</button>` : `<span class="badge ok">Supabase conectado</span>`}`)}
    ${state.vehicleId ? renderVehicleDetail(getVehicle(state.vehicleId)) : ""}
    ${state.editVehicleId === "new" || editingVehicle ? renderVehicleForm(editingVehicle) : ""}
    <div class="panel">
      ${toolbar()}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Dominio</th><th>Datos</th><th>Asignacion actual</th><th>Km</th><th>Alertas</th><th>Accion</th></tr></thead>
          <tbody>${vehicles.map(vehicleRow).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderVehicleForm(vehicle) {
  const isNew = !vehicle;
  return `
    <form class="panel form-grid" id="vehicleForm">
      <div class="panel-title-row">
        <h3>${isNew ? "Alta de vehiculo" : `Editar ${escapeHtml(vehicle.domain)}`}</h3>
        <button class="btn ghost" type="button" data-action="cancel-vehicle-form">Cerrar</button>
      </div>
      <div class="grid-2 compact">
        <label class="field"><span>Patente</span><input name="domain" required value="${escapeAttr(vehicle?.domain || "")}"></label>
        <label class="field"><span>Interno</span><input name="internal" value="${escapeAttr(vehicle?.internal || "")}"></label>
        <label class="field"><span>Modelo</span><input name="model" value="${escapeAttr(vehicle?.model || "")}"></label>
        <label class="field"><span>Tipo</span><select name="type">${vehicleTypeSelectOptions(vehicle?.type || "", false)}</select></label>
        <label class="field"><span>Area</span><input name="area" value="${escapeAttr(vehicle?.area || "")}"></label>
        <label class="field"><span>Sector</span><input name="sector" value="${escapeAttr(vehicle?.sector || "")}"></label>
        <label class="field"><span>Kilometraje</span><input name="odometer" type="number" min="0" value="${escapeAttr(vehicle?.odometer || 0)}"></label>
        <label class="field"><span>Estado</span><select name="status">
          ${["available", "active", "alert", "idle"].map((status) => `<option value="${status}" ${vehicle?.status === status ? "selected" : ""}>${stripTags(statusBadge(status))}</option>`).join("")}
        </select></label>
      </div>
      <button class="btn" type="submit">${isNew ? "Crear vehiculo" : "Guardar cambios"}</button>
    </form>
  `;
}

function renderVehicleDetail(vehicle) {
  if (!vehicle) return "";
  const assignments = runtime.assignments.filter((item) => item.vehicleId === vehicle.id).sort(sortDesc("startAt"));
  const incidents = getOpenIncidents(vehicle.id);
  const maintenance = runtime.maintenance.filter((item) => item.vehicleId === vehicle.id).sort(sortDesc("createdAt"));
  const documents = vehicle.documents || (runtime.documents || []).filter((item) => item.vehicleId === vehicle.id);
  const equipment = vehicle.equipment || (runtime.equipment || []).filter((item) => item.vehicleId === vehicle.id);
  const photos = vehicle.photos || (runtime.photos || []).filter((item) => item.vehicleId === vehicle.id);
  const fireExtinguisher = equipment.find((item) => normalize(item.name).includes("matafuego"));
  return `
    <section class="panel detail-panel" id="vehicleDetail">
      <div class="panel-title-row">
        <h3>Ficha ${escapeHtml(vehicle.domain)}</h3>
        <button class="btn ghost" data-action="clear-detail">Cerrar</button>
      </div>
      <div class="summary-grid">
        ${summaryItem("Interno", vehicle.internal || "-")}
        ${summaryItem("Modelo", vehicle.model || "-")}
        ${summaryItem("Tipo", vehicle.type || "-")}
        ${summaryItem("Empresa", vehicle.company || "-")}
        ${summaryItem("Area", vehicle.area || "-")}
        ${summaryItem("Sector", vehicle.sector || "-")}
        ${summaryItem("Ultimo km", vehicle.odometer || "s/d")}
        ${summaryItem("VTV", `${formatDate(vehicle.vtv)} ${stripTags(vtvBadge(vehicle))}`)}
        ${summaryItem("VTH", vehicle.vth ? formatDate(vehicle.vth) : "-")}
        ${summaryItem("Matafuego", fireExtinguisher ? `${fireExtinguisher.present ? "Presente" : "Faltante"} ${fireExtinguisher.expiresAt ? `| Vto ${formatDate(fireExtinguisher.expiresAt)}` : ""}` : "-")}
      </div>
      <div class="detail-tabs">
        ${detailTab("summary", "Resumen")}
        ${detailTab("documents", `Documentacion ${documents.length}`)}
        ${detailTab("equipment", `Equipamiento ${equipment.length}`)}
        ${detailTab("photos", `Archivos ${photos.length}`)}
        ${detailTab("repairs", `Reparaciones ${maintenance.length}`)}
        ${detailTab("history", `Historial ${assignments.length}`)}
        ${detailTab("damages", `Danos ${incidents.length}`)}
      </div>
      ${renderVehicleDetailTab({ vehicle, assignments, incidents, maintenance, documents, equipment, photos })}
    </section>
  `;
}

function detailTab(tab, label) {
  return `<button class="tab-btn ${state.vehicleDetailTab === tab ? "active" : ""}" data-action="detail-tab" data-tab="${tab}">${escapeHtml(label)}</button>`;
}

function renderVehicleDetailTab({ vehicle, assignments, incidents, maintenance, documents, equipment, photos }) {
  if (state.vehicleDetailTab === "documents") {
    return `
      <div class="detail-section">
        <h4>Documentacion</h4>
        <div class="record-form-list">
          ${documents.map((item) => documentForm(item, vehicle.id)).join("") || empty("Sin documentacion importada.")}
        </div>
        ${documentForm(null, vehicle.id)}
      </div>
    `;
  }
  if (state.vehicleDetailTab === "equipment") {
    return `
      <div class="detail-section">
        <h4>Equipamiento y matafuegos</h4>
        <div class="record-form-list">
          ${equipment.map((item) => equipmentForm(item, vehicle.id)).join("") || empty("Sin equipamiento importado.")}
        </div>
        ${equipmentForm(null, vehicle.id)}
      </div>
    `;
  }
  if (state.vehicleDetailTab === "photos") {
    return `
      <div class="detail-section">
        <h4>Fotos y archivos</h4>
        <div class="record-form-list">
          ${photos.map(photoMini).join("") || empty("Sin archivos cargados.")}
        </div>
        ${photoUploadForm(vehicle.id)}
      </div>
    `;
  }
  if (state.vehicleDetailTab === "repairs") {
    const visible = maintenance.slice(0, 8);
    return `
      <div class="detail-section">
        <div class="panel-title-row">
          <h4>Reparaciones historicas</h4>
          <span class="muted">Mostrando ${visible.length} de ${maintenance.length}</span>
        </div>
        ${visible.map(maintenanceMini).join("") || empty("Sin reparaciones importadas.")}
      </div>
    `;
  }
  if (state.vehicleDetailTab === "history") {
    return `<div class="detail-section"><h4>Historial de uso</h4>${assignments.slice(0, 12).map(assignmentMini).join("") || empty("Sin usos registrados.")}</div>`;
  }
  if (state.vehicleDetailTab === "damages") {
    return `<div class="detail-section"><h4>Danos e irregularidades abiertas</h4>${incidents.map(incidentMini).join("") || empty("Sin danos abiertos.")}</div>`;
  }
  return `
    <div class="grid-3 detail-section-grid">
      <div>
        <h4>Documentacion critica</h4>
        ${documents.filter((item) => expiryState(item.expiresAt) !== "vigente").slice(0, 5).map(documentMini).join("") || empty("Sin vencimientos criticos.")}
      </div>
      <div>
        <h4>Equipamiento</h4>
        ${equipment.slice(0, 5).map(equipmentMini).join("") || empty("Sin equipamiento importado.")}
      </div>
      <div>
        <h4>Ultimas reparaciones</h4>
        ${maintenance.slice(0, 5).map(maintenanceMini).join("") || empty("Sin reparaciones importadas.")}
      </div>
    </div>
  `;
}

function renderDrivers() {
  const query = normalize(state.query);
  const rows = runtime.people
    .filter((person) => !query || normalize([person.employeeId, person.name, person.area, person.role].join(" ")).includes(query))
    .slice(0, 120);
  const editingDriver = state.editDriverId ? runtime.people.find((person) => person.employeeId === state.editDriverId || person.id === state.editDriverId) : null;
  return `
    ${topbar("Control de conductores", `<button class="btn" data-action="new-driver">Nuevo conductor</button>`)}
    <div class="panel">
      <div class="toolbar"><label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Legajo, nombre, area, cargo"></label></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Legajo</th><th>Nombre</th><th>Area</th><th>Cargo</th><th>Usos</th><th>Actual</th><th>Accion</th></tr></thead>
          <tbody>${rows.map(driverRow).join("")}</tbody>
        </table>
      </div>
    </div>
    ${state.editDriverId === "new" || editingDriver ? renderDriverForm(editingDriver) : ""}
  `;
}

function renderDriverForm(person) {
  const isNew = !person;
  return `
    <form class="panel form-grid" id="driverForm">
      <div class="panel-title-row">
        <h3>${isNew ? "Alta de conductor" : `Editar ${escapeHtml(person.name)}`}</h3>
        <button class="btn ghost" type="button" data-action="cancel-driver-form">Cerrar</button>
      </div>
      <div class="grid-2 compact">
        <label class="field"><span>Legajo</span><input name="employeeId" required value="${escapeAttr(person?.employeeId || "")}"></label>
        <label class="field"><span>Nombre</span><input name="name" required value="${escapeAttr(person?.name || "")}"></label>
        <label class="field"><span>Area</span><input name="area" value="${escapeAttr(person?.area || "")}"></label>
        <label class="field"><span>Cargo</span><input name="role" value="${escapeAttr(person?.role || "")}"></label>
      </div>
      <button class="btn" type="submit">${isNew ? "Crear conductor" : "Guardar cambios"}</button>
    </form>
  `;
}

function renderIncidents() {
  const incidents = runtime.incidents.slice().sort(sortDesc("reportedAt"));
  return `
    ${topbar("Danos e irregularidades")}
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Patente</th><th>Tipo</th><th>Detalle</th><th>Reportado por</th><th>Estado</th></tr></thead>
          <tbody>${incidents.map(incidentRow).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderMaintenance() {
  const query = normalize(state.query);
  const rows = runtime.maintenance
    .filter((item) => {
      const vehicle = getVehicle(item.vehicleId) || {};
      const haystack = normalize([item.domain, item.type, item.detail, item.status, item.provider, item.workshop, vehicle.area].join(" "));
      if (query && !haystack.includes(query)) return false;
      if (state.area !== "Todas" && vehicle.area !== state.area) return false;
      return true;
    })
    .sort(sortDesc("createdAt"));
  const editing = state.editMaintenanceId ? runtime.maintenance.find((item) => item.id === state.editMaintenanceId) : null;
  return `
    ${topbar("Mantenimiento", `<button class="btn" data-action="new-maintenance">Nueva reparacion</button>`)}
    ${state.editMaintenanceId === "new" || editing ? maintenanceForm(editing) : ""}
    <div class="panel">
      ${toolbar()}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Patente</th><th>Tipo</th><th>Proveedor/Taller</th><th>Detalle</th><th>Estado</th><th>Accion</th></tr></thead>
          <tbody>${rows.map((item) => `
            <tr>
              <td>${formatDate(item.enteredAt || item.createdAt)}</td>
              <td>${escapeHtml(item.domain)}</td>
              <td>${escapeHtml(item.type)}</td>
              <td>${escapeHtml([item.provider, item.workshop].filter(Boolean).join(" / ") || "-")}</td>
              <td>${escapeHtml(item.detail)}</td>
              <td>${statusTextBadge(item.status)}</td>
              <td><button class="link-btn" data-action="edit-maintenance" data-maintenance-id="${escapeAttr(item.id)}">Editar</button></td>
            </tr>
          `).join("") || `<tr><td colspan="7">${empty("Sin reparaciones para los filtros seleccionados.")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function maintenanceForm(item) {
  const isNew = !item;
  const selectedVehicleId = item?.vehicleId || runtime.vehicles[0]?.id || "";
  const statusOptions = [["pending", "Pendiente"], ["in_repair", "En curso"], ["finished", "Finalizado"], ["cancelled", "Cancelado"]];
  return `
    <form class="panel form-grid" id="maintenanceForm">
      <div class="panel-title-row">
        <h3>${isNew ? "Nueva reparacion / mantenimiento" : `Editar ${escapeHtml(item.domain)}`}</h3>
        <button class="btn ghost" type="button" data-action="cancel-maintenance-form">Cerrar</button>
      </div>
      <div class="grid-2 compact">
        <label class="field"><span>Vehiculo</span><select name="vehicleId" required>
          ${runtime.vehicles.map((vehicle) => `<option value="${vehicle.id}" ${vehicle.id === selectedVehicleId ? "selected" : ""}>${escapeHtml(vehicle.domain)} | ${escapeHtml(vehicle.model || "")}</option>`).join("")}
        </select></label>
        <label class="field"><span>Estado</span><select name="status">${statusOptions.map(([value, label]) => `<option value="${value}" ${maintenanceStatusValue(item?.status) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>Tipo</span><input name="type" value="${escapeAttr(item?.type || "")}" placeholder="Preventivo, correctivo, service"></label>
        <label class="field"><span>Fecha ingreso</span><input name="enteredAt" type="date" value="${escapeAttr(dateInputValue(item?.enteredAt || item?.createdAt))}"></label>
        <label class="field"><span>Fecha salida</span><input name="retiredAt" type="date" value="${escapeAttr(dateInputValue(item?.retiredAt))}"></label>
        <label class="field"><span>Costo</span><input name="cost" type="number" min="0" step="0.01" value="${escapeAttr(item?.cost || "")}"></label>
        <label class="field"><span>Proveedor</span><input name="provider" value="${escapeAttr(item?.provider || "")}"></label>
        <label class="field"><span>Taller</span><input name="workshop" value="${escapeAttr(item?.workshop || "")}"></label>
      </div>
      <label class="field"><span>Detalle</span><textarea name="detail" required>${escapeHtml(item?.detail || "")}</textarea></label>
      <label class="field"><span>Notas</span><textarea name="notes">${escapeHtml(item?.notes || "")}</textarea></label>
      <button class="btn" type="submit">${isNew ? "Crear registro" : "Guardar cambios"}</button>
    </form>
  `;
}

function renderReports() {
  const assignments = getReportAssignments();
  const vehicles = getReportVehicles();
  const documents = getReportDocuments();
  const equipment = getReportEquipment();
  const maintenance = getReportMaintenance();
  const byVehicle = groupCount(assignments, "domain");
  const byDriver = groupCount(assignments, "driver");
  const totalKm = assignments.reduce((sum, item) => sum + Number(item.distance || 0), 0);
  const openDamages = getFilteredIncidentsForReports().length;
  return `
    ${topbar("Reportes", `<div class="topbar-actions"><button class="btn secondary" data-action="export-pdf">Exportar PDF</button><button class="btn secondary" data-action="export-excel">Exportar Excel</button><button class="btn" data-action="export">Exportar CSV</button></div>`)}
    ${reportFilters()}
    <section class="grid-3">
      <div class="panel"><h3>Usos registrados</h3><strong class="big">${assignments.length}</strong><p class="muted">Asignaciones historicas.</p></div>
      <div class="panel"><h3>Kilometros cerrados</h3><strong class="big">${totalKm}</strong><p class="muted">Solo usos con devolucion.</p></div>
      <div class="panel"><h3>Danos abiertos</h3><strong class="big">${openDamages}</strong><p class="muted">Filtrados por patente/area cuando aplica.</p></div>
    </section>
    <section class="grid-3" style="margin-top:16px">
      <div class="panel"><h3>Vehiculos filtrados</h3><strong class="big">${vehicles.length}</strong><p class="muted">Unidades por busqueda y area.</p></div>
      <div class="panel"><h3>Documentacion critica</h3><strong class="big">${documents.length}</strong><p class="muted">Vencida, proxima o sin fecha.</p></div>
      <div class="panel"><h3>Equipamiento critico</h3><strong class="big">${equipment.length}</strong><p class="muted">Faltante, vencido o proximo.</p></div>
    </section>
    <section class="grid-2" style="margin-top:16px">
      <div class="panel"><h3>Uso por vehiculo</h3>${miniTable(byVehicle, ["Patente", "Usos"])}</div>
      <div class="panel"><h3>Uso por conductor</h3>${miniTable(byDriver, ["Conductor", "Usos"])}</div>
    </section>
    <section class="grid-2" style="margin-top:16px">
      <div class="panel"><h3>Vehiculos por tipo</h3>${miniTable(groupCount(vehicles, "type"), ["Tipo", "Cantidad"])}</div>
      <div class="panel"><h3>Vehiculos por empresa</h3>${miniTable(groupCount(vehicles, "company"), ["Empresa", "Cantidad"])}</div>
    </section>
    <section class="grid-2" style="margin-top:16px">
      <div class="panel"><h3>Documentacion a revisar</h3><div class="table-wrap">${documentReportTable(documents)}</div></div>
      <div class="panel"><h3>Equipamiento y matafuegos</h3><div class="table-wrap">${equipmentReportTable(equipment)}</div></div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h3>Reparaciones importadas</h3>
      <div class="table-wrap">${maintenanceReportTable(maintenance)}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h3>Historial completo</h3>
      <div class="table-wrap">${assignmentTable(assignments)}</div>
    </section>
  `;
}

function reportFilters() {
  const areas = ["Todas", ...Array.from(new Set(runtime.vehicles.map((vehicle) => vehicle.area).filter(Boolean))).sort()];
  const statuses = [["Todos", "Todos"], ["active", "En uso"], ["closed", "Cerrados"]];
  return `
    <section class="panel report-filters">
      <div class="toolbar">
        <label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Patente, conductor, legajo"></label>
        <label class="field"><span>Desde</span><input data-filter="reportFrom" type="date" value="${escapeAttr(state.reportFrom)}"></label>
        <label class="field"><span>Hasta</span><input data-filter="reportTo" type="date" value="${escapeAttr(state.reportTo)}"></label>
        <label class="field"><span>Estado</span><select data-filter="reportStatus">${statuses.map(([value, label]) => `<option value="${value}" ${state.reportStatus === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>Area</span><select data-filter="area">${areas.map((area) => `<option value="${escapeAttr(area)}" ${state.area === area ? "selected" : ""}>${escapeHtml(area)}</option>`).join("")}</select></label>
      </div>
    </section>
  `;
}

function renderChecklistAdmin() {
  return `
    ${topbar("Checklist configurable")}
    <section class="grid-2">
      ${renderChecklistManager("start", "Control inicial")}
      ${renderChecklistManager("end", "Control final")}
    </section>
  `;
}

function renderChecklistManager(stage, title) {
  const template = getChecklistTemplate(stage);
  const items = (runtime.checklistItems || [])
    .filter((item) => item.stage === stage)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return `
    <div class="panel">
      <div class="panel-title-row">
        <h3>${escapeHtml(title)}</h3>
        <span class="badge ok">${items.filter((item) => item.isActive).length} activos</span>
      </div>
      <div class="checklist-admin-list">
        ${items.map((item) => checklistItemForm(item, stage, template?.id)).join("") || empty("Sin items cargados. Agrega el primero abajo.")}
      </div>
      ${checklistItemForm(null, stage, template?.id)}
      <p class="muted role-note">Usa "Todos" para que el item aparezca en cualquier vehiculo, o elegi un tipo para limitarlo.</p>
    </div>
  `;
}

function checklistItemForm(item, stage, templateId) {
  const isNew = !item;
  const currentType = item?.appliesToVehicleType || "";
  return `
    <form class="checklist-item-form" data-checklist-item="${escapeAttr(item?.id || "new")}">
      <input type="hidden" name="id" value="${escapeAttr(item?.id || "")}">
      <input type="hidden" name="stage" value="${escapeAttr(stage)}">
      <input type="hidden" name="templateId" value="${escapeAttr(item?.templateId || templateId || "")}">
      <label class="field"><span>Categoria</span><input name="category" required value="${escapeAttr(item?.category || "")}" placeholder="Ej. Luces"></label>
      <label class="field"><span>Item</span><input name="label" required value="${escapeAttr(item?.label || "")}" placeholder="Ej. Stop"></label>
      <label class="field"><span>Tipo vehiculo</span><select name="vehicleType">${vehicleTypeSelectOptions(currentType)}</select></label>
      <label class="field"><span>Orden</span><input name="sortOrder" type="number" value="${escapeAttr(item?.sortOrder ?? 0)}"></label>
      <label class="field"><span>Estado</span><select name="isActive">
        <option value="true" ${item?.isActive !== false ? "selected" : ""}>Activo</option>
        <option value="false" ${item?.isActive === false ? "selected" : ""}>Inactivo</option>
      </select></label>
      <button class="btn ${isNew ? "" : "secondary"}" type="submit">${isNew ? "Agregar" : "Guardar"}</button>
    </form>
  `;
}

function documentForm(item, vehicleId) {
  const isNew = !item;
  const currentType = item?.type || "";
  const docTypes = ["VTV", "RTO", "Seguro", "VTH", "Cedula", "Oblea GNC", "Habilitacion", "Otro"];
  return `
    <form class="record-form document-form" data-document-form="${escapeAttr(item?.id || "new")}">
      <input type="hidden" name="id" value="${escapeAttr(item?.id || "")}">
      <input type="hidden" name="vehicleId" value="${escapeAttr(item?.vehicleId || vehicleId)}">
      <label class="field"><span>Tipo</span><select name="type">
        ${docTypes.map((type) => `<option value="${escapeAttr(type)}" ${normalize(type) === normalize(currentType) ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
        ${currentType && !docTypes.some((type) => normalize(type) === normalize(currentType)) ? `<option value="${escapeAttr(currentType)}" selected>${escapeHtml(currentType)}</option>` : ""}
      </select></label>
      <label class="field"><span>Numero</span><input name="number" value="${escapeAttr(item?.number || "")}" placeholder="Poliza, acta, referencia"></label>
      <label class="field"><span>Vence</span><input name="expiresAt" type="date" value="${escapeAttr(dateInputValue(item?.expiresAt))}"></label>
      <label class="field"><span>Estado</span><select name="status">
        ${["Vigente", "Pendiente", "Vencido", "No aplica"].map((status) => `<option value="${status}" ${normalize(item?.status || "") === normalize(status) ? "selected" : ""}>${status}</option>`).join("")}
      </select></label>
      <label class="field wide"><span>Observaciones</span><input name="notes" value="${escapeAttr(item?.notes || "")}" placeholder="Detalle adicional"></label>
      <button class="btn ${isNew ? "" : "secondary"}" type="submit">${isNew ? "Agregar" : "Guardar"}</button>
    </form>
  `;
}

function equipmentForm(item, vehicleId) {
  const isNew = !item;
  const currentName = item?.name || "";
  const names = ["Matafuego", "Balizas", "Cricket", "Llave cruz", "Herramientas", "Botiquin", "Chaleco reflectivo", "Otro"];
  return `
    <form class="record-form equipment-form" data-equipment-form="${escapeAttr(item?.id || "new")}">
      <input type="hidden" name="id" value="${escapeAttr(item?.id || "")}">
      <input type="hidden" name="vehicleId" value="${escapeAttr(item?.vehicleId || vehicleId)}">
      <label class="field"><span>Elemento</span><select name="name">
        ${names.map((name) => `<option value="${escapeAttr(name)}" ${normalize(name) === normalize(currentName) ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        ${currentName && !names.some((name) => normalize(name) === normalize(currentName)) ? `<option value="${escapeAttr(currentName)}" selected>${escapeHtml(currentName)}</option>` : ""}
      </select></label>
      <label class="field"><span>Esperado</span><select name="expected">
        <option value="true" ${item?.expected !== false ? "selected" : ""}>Si</option>
        <option value="false" ${item?.expected === false ? "selected" : ""}>No</option>
      </select></label>
      <label class="field"><span>Presente</span><select name="present">
        <option value="true" ${item?.present !== false ? "selected" : ""}>Presente</option>
        <option value="false" ${item?.present === false ? "selected" : ""}>Faltante</option>
      </select></label>
      <label class="field"><span>Vence</span><input name="expiresAt" type="date" value="${escapeAttr(dateInputValue(item?.expiresAt))}"></label>
      <label class="field wide"><span>Observaciones</span><input name="notes" value="${escapeAttr(item?.notes || "")}" placeholder="Marca, numero, detalle"></label>
      <button class="btn ${isNew ? "" : "secondary"}" type="submit">${isNew ? "Agregar" : "Guardar"}</button>
    </form>
  `;
}

function photoUploadForm(vehicleId) {
  return `
    <form class="record-form photo-form" id="photoForm">
      <input type="hidden" name="vehicleId" value="${escapeAttr(vehicleId)}">
      <label class="field"><span>Tipo</span><select name="photoType">
        <option value="Tablero">Tablero / kilometraje</option>
        <option value="Dano">Dano o irregularidad</option>
        <option value="Documento">Documento</option>
        <option value="Equipamiento">Equipamiento</option>
        <option value="Otro">Otro</option>
      </select></label>
      <label class="field wide"><span>Descripcion</span><input name="description" placeholder="Ej. VTV 2027, dano paragolpes, tablero inicial"></label>
      <label class="field wide"><span>Archivo</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label>
      <button class="btn" type="submit">Subir</button>
    </form>
  `;
}

function photoMini(item) {
  const isImage = String(item.mimeType || "").startsWith("image/");
  return `
    <article class="mini-record photo-record">
      <div>
        <strong>${escapeHtml(item.photoType)}</strong> ${isImage ? statusTextBadge("Imagen") : statusTextBadge("Archivo")}
        <br><span class="muted">${escapeHtml(item.description || item.fileName || item.storagePath)}</span>
        <br><span class="muted">${formatDateTime(item.createdAt)}${item.fileName ? ` | ${escapeHtml(item.fileName)}` : ""}</span>
      </div>
      <button class="btn secondary" data-action="open-photo" data-photo-id="${escapeAttr(item.id)}">Ver</button>
    </article>
  `;
}

function renderUsers() {
  const roles = ["driver", "admin", "supervisor", "maintenance", "auditor", "super_admin"];
  const query = normalize(state.query);
  const rows = (runtime.profiles || [])
    .filter((profile) => !query || normalize([profile.displayName, profile.username, profile.employeeNumber, profile.employeeName, profile.role].join(" ")).includes(query));
  return `
    ${topbar("Usuarios y roles")}
    <div class="panel">
      <div class="toolbar"><label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Nombre, usuario, legajo o rol"></label></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Usuario</th><th>Empleado vinculado</th><th>Rol</th><th>Estado</th><th>Accion</th></tr></thead>
          <tbody>${rows.map((profile) => `
            <tr>
              <td><strong>${escapeHtml(profile.displayName)}</strong><br><span class="muted">${escapeHtml(profile.username || profile.id)}</span></td>
              <td><select class="inline-select user-employee-select" data-user-employee="${profile.id}">
                <option value="">Sin vincular</option>
                ${runtime.people.map((person) => `<option value="${person.employeeUuid || person.id || ""}" ${profile.employeeId === (person.employeeUuid || person.id) ? "selected" : ""}>${escapeHtml(person.employeeId)} | ${escapeHtml(person.name)}</option>`).join("")}
              </select></td>
              <td><select class="inline-select" data-user-role="${profile.id}" ${profile.id === state.user.profileId ? "disabled" : ""}>${roles.map((role) => `<option value="${role}" ${profile.role === role ? "selected" : ""}>${roleLabel(role)}</option>`).join("")}</select></td>
              <td><select class="inline-select" data-user-active="${profile.id}" ${profile.id === state.user.profileId ? "disabled" : ""}>
                <option value="true" ${profile.isActive ? "selected" : ""}>Activo</option>
                <option value="false" ${!profile.isActive ? "selected" : ""}>Inactivo</option>
              </select></td>
              <td><button class="btn secondary" data-action="save-profile" data-profile-id="${escapeAttr(profile.id)}">Guardar</button></td>
            </tr>
          `).join("") || `<tr><td colspan="5">${empty("No hay usuarios creados en Supabase Auth.")}</td></tr>`}</tbody>
        </table>
      </div>
      <p class="muted role-note">Los usuarios se crean en Supabase Auth. Desde esta pantalla se vinculan a empleados, se administra el rol operativo y se activan o desactivan.</p>
    </div>
  `;
}

function renderAudit() {
  const query = normalize(state.query);
  const rows = (runtime.auditLogs || [])
    .filter((log) => !query || normalize([log.actorName, log.action, log.entityName, log.entityId].join(" ")).includes(query))
    .slice(0, 300);
  return `
    ${topbar("Auditoria")}
    <div class="panel">
      <div class="toolbar"><label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Actor, accion, tabla o ID"></label></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Actor</th><th>Accion</th><th>Entidad</th><th>Cambios</th></tr></thead>
          <tbody>${rows.map(auditRow).join("") || `<tr><td colspan="5">${empty("Sin eventos de auditoria visibles.")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDriver() {
  const active = getActiveAssignmentForUser();
  return `
    ${topbar("Circuito del conductor")}
    <div class="driver-shell">${active ? activeAssignmentView(active) : startAssignmentForm()}</div>
  `;
}

function startAssignmentForm() {
  const vehicles = runtime.vehicles.slice().sort((a, b) => a.domain.localeCompare(b.domain));
  const selected = getVehicle(state.vehicleId) || vehicles[0];
  const preexisting = selected ? getOpenIncidents(selected.id) : [];
  const unavailable = selected && selected.activeAssignmentId;
  return `
    <form class="panel form-grid" id="startForm">
      <h3>Recepcion del vehiculo</h3>
      <div class="stepper">
        <span class="active">Vehiculo</span><span>Km inicial</span><span>Checklist</span><span>Confirmacion</span>
      </div>
      <label class="field">
        <span>Seleccionar patente</span>
        <select name="vehicleId" data-filter="vehicleId">
          ${vehicles.map((vehicle) => `<option value="${vehicle.id}" ${selected?.id === vehicle.id ? "selected" : ""}>${escapeHtml(vehicle.domain)} | ${escapeHtml(vehicle.internal || "s/i")} | ${escapeHtml(vehicle.type || "sin tipo")}</option>`).join("")}
        </select>
      </label>
      ${selected ? vehicleReceiptCard(selected, preexisting) : ""}
      ${unavailable ? `<div class="notice danger">Este vehiculo figura en uso. El administrador debe revisar la asignacion antes de tomarlo nuevamente.</div>` : ""}
      <div class="grid-2 compact">
        <label class="field"><span>Kilometraje inicial</span><input name="odometerStart" type="number" min="0" required value="${selected?.odometer || ""}"></label>
        <label class="field"><span>Base o zona de retiro</span><input name="locationStart" required placeholder="Ej. Primera Junta, Quilmes"></label>
      </div>
      <div class="notice">El kilometraje inicial no puede ser menor al ultimo registrado sin generar una advertencia auditable.</div>
      ${renderChecklist("start", selected)}
      <label class="field"><span>Novedades detectadas al recibir</span><textarea name="startNotes" placeholder="Registrar danos no listados como preexistentes, faltantes o advertencias."></textarea></label>
      <label class="confirm-line"><input name="accepted" type="checkbox" required> Declaro haber verificado el estado del vehiculo y los elementos indicados en este control.</label>
      <button class="btn" type="submit" ${unavailable ? "disabled" : ""}>Confirmar recepcion</button>
    </form>
  `;
}

function activeAssignmentView(assignment) {
  const preexisting = (assignment.preexistingIncidentIds || [])
    .map((id) => runtime.incidents.find((incident) => incident.id === id))
    .filter(Boolean);
  return `
    <section class="panel">
      <h3>Vehiculo en uso</h3>
      <div class="report-card">
        <header><h4>${escapeHtml(assignment.domain)}</h4>${statusBadge("active")}</header>
        <div class="summary-grid">
          ${summaryItem("Conductor", assignment.driver)}
          ${summaryItem("Inicio", formatDateTime(assignment.startAt))}
          ${summaryItem("Km inicial", assignment.odometerStart)}
          ${summaryItem("Ubicacion retiro", assignment.locationStart)}
        </div>
      </div>
      <h3 style="margin-top:18px">Danos preexistentes vistos al recibir</h3>
      <div class="vehicle-list">${preexisting.map(incidentCard).join("") || empty("No habia danos preexistentes abiertos.")}</div>
    </section>
    <form class="panel form-grid" id="closeForm">
      <h3>Devolucion del vehiculo</h3>
      <div class="stepper">
        <span class="active">Km final</span><span>Checklist final</span><span>Novedades</span><span>Devolver</span>
      </div>
      <div class="grid-2 compact">
        <label class="field"><span>Kilometraje final</span><input name="odometerEnd" type="number" min="${assignment.odometerStart}" required placeholder="Debe ser mayor o igual a ${assignment.odometerStart}"></label>
        <label class="field"><span>Base o zona de devolucion</span><input name="locationEnd" required placeholder="Ej. 12 de Octubre"></label>
      </div>
      ${renderChecklist("end", getVehicle(assignment.vehicleId))}
      <label class="field"><span>Novedades, danos nuevos o faltantes</span><textarea name="endNotes" placeholder="Detalle cualquier dano nuevo, faltante, desperfecto o irregularidad."></textarea></label>
      <label class="confirm-line"><input name="returned" type="checkbox" required> Confirmo la devolucion del vehiculo con la informacion declarada.</label>
      <button class="btn" type="submit">Devolver vehiculo</button>
    </form>
  `;
}

function vehicleReceiptCard(vehicle, incidents) {
  const active = getActiveAssignmentByVehicle(vehicle.id);
  const documents = vehicle.documents || [];
  const equipment = vehicle.equipment || [];
  return `
    <section class="receipt-card">
      <div class="panel-title-row">
        <h4>${escapeHtml(vehicle.domain)}</h4>
        ${statusBadge(vehicle.status)}
      </div>
      <div class="summary-grid">
        ${summaryItem("Interno", vehicle.internal || "-")}
        ${summaryItem("Modelo", vehicle.model || "-")}
        ${summaryItem("Tipo", vehicle.type || "-")}
        ${summaryItem("Empresa", vehicle.company || "-")}
        ${summaryItem("Area", vehicle.area || "-")}
        ${summaryItem("Sector", vehicle.sector || "-")}
        ${summaryItem("Ultimo km", vehicle.odometer || "s/d")}
        ${summaryItem("VTV", `${formatDate(vehicle.vtv)} ${stripTags(vtvBadge(vehicle))}`)}
        ${summaryItem("Documentos", documents.length)}
        ${summaryItem("Equipamiento", equipment.length)}
      </div>
      ${active ? `<div class="notice danger">Actualmente asignado a ${escapeHtml(active.driver)} desde ${formatDateTime(active.startAt)}.</div>` : ""}
      <h4>Alertas y danos preexistentes</h4>
      <div class="vehicle-list slim">${incidents.map(incidentCard).join("") || empty("Sin danos preexistentes abiertos.")}</div>
    </section>
  `;
}

function renderChecklist(prefix, vehicle) {
  const groups = groupChecklistItems(getChecklistItems(prefix, vehicle?.type));
  return `
    <div>
      <div class="checklist-title">${prefix === "start" ? "Checklist inicial" : "Checklist final"}</div>
      <div class="checklist detailed">
        ${groups.map(([category, items]) => `
          <section class="check-group">
            <h4>${escapeHtml(category)}</h4>
            ${items.map((item) => `
              <label class="check-row">
                <span>${escapeHtml(item.label)}</span>
                <select name="${prefix}_${slug(category)}_${slug(item.label)}">
                  ${checklistStatuses.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
                </select>
              </label>
            `).join("")}
          </section>
        `).join("")}
      </div>
    </div>
  `;
}

function bindCommon() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((input) => {
    const update = () => {
      state[input.dataset.filter] = input.value;
      render();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button));
  });

  const startForm = document.getElementById("startForm");
  if (startForm) startForm.addEventListener("submit", submitStartAssignment);

  const closeForm = document.getElementById("closeForm");
  if (closeForm) closeForm.addEventListener("submit", submitCloseAssignment);

  const vehicleForm = document.getElementById("vehicleForm");
  if (vehicleForm) vehicleForm.addEventListener("submit", submitVehicleForm);

  const driverForm = document.getElementById("driverForm");
  if (driverForm) driverForm.addEventListener("submit", submitDriverForm);

  const maintenanceFormNode = document.getElementById("maintenanceForm");
  if (maintenanceFormNode) maintenanceFormNode.addEventListener("submit", submitMaintenanceForm);

  document.querySelectorAll(".document-form").forEach((form) => {
    form.addEventListener("submit", submitDocumentForm);
  });

  document.querySelectorAll(".equipment-form").forEach((form) => {
    form.addEventListener("submit", submitEquipmentForm);
  });

  const photoForm = document.getElementById("photoForm");
  if (photoForm) photoForm.addEventListener("submit", submitPhotoForm);

  document.querySelectorAll(".checklist-item-form").forEach((form) => {
    form.addEventListener("submit", submitChecklistItemForm);
  });

}

async function handleAction(action, button) {
  if (action === "logout") {
    addAudit("logout", state.user.username, "users", state.user.username);
    if (state.dataMode === "supabase") await window.fleetSupabase.signOut();
    sessionStorage.removeItem("gestion-flota-session");
    state.user = null;
    state.view = "dashboard";
    render();
  }
  if (action === "export") exportCsv();
  if (action === "export-excel") exportExcel();
  if (action === "export-pdf") exportPdf();
  if (action === "save-profile") await submitProfileForm(button.dataset.profileId);
  if (action === "reset") {
    localStorage.removeItem(storageKey);
    runtime = loadRuntime();
    toast("Datos restaurados.");
    render();
  }
  if (action === "vehicle-detail") {
    state.vehicleId = button.dataset.vehicleId;
    state.vehicleDetailTab = "summary";
    render();
    requestAnimationFrame(() => document.getElementById("vehicleDetail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  if (action === "detail-tab") {
    state.vehicleDetailTab = button.dataset.tab || "summary";
    render();
    requestAnimationFrame(() => document.getElementById("vehicleDetail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  if (action === "new-vehicle") {
    state.editVehicleId = "new";
    render();
  }
  if (action === "edit-vehicle") {
    state.editVehicleId = button.dataset.vehicleId;
    render();
  }
  if (action === "deactivate-vehicle") {
    await deactivateVehicle(button.dataset.vehicleId);
  }
  if (action === "cancel-vehicle-form") {
    state.editVehicleId = "";
    render();
  }
  if (action === "new-driver") {
    state.editDriverId = "new";
    render();
  }
  if (action === "edit-driver") {
    state.editDriverId = button.dataset.driverId;
    render();
  }
  if (action === "cancel-driver-form") {
    state.editDriverId = "";
    render();
  }
  if (action === "new-maintenance") {
    state.editMaintenanceId = "new";
    render();
  }
  if (action === "edit-maintenance") {
    state.editMaintenanceId = button.dataset.maintenanceId;
    render();
  }
  if (action === "cancel-maintenance-form") {
    state.editMaintenanceId = "";
    render();
  }
  if (action === "clear-detail") {
    state.vehicleId = "";
    state.vehicleDetailTab = "summary";
    render();
  }
  if (action === "open-photo") {
    await openPhoto(button.dataset.photoId);
  }
}

async function submitVehicleForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existing = state.editVehicleId && state.editVehicleId !== "new" ? getVehicle(state.editVehicleId) : null;
  const vehicle = {
    id: existing?.id || (state.dataMode === "supabase" ? "" : (window.crypto?.randomUUID ? window.crypto.randomUUID() : `V${Date.now()}`)),
    domain: String(form.get("domain") || "").trim().toUpperCase(),
    internal: String(form.get("internal") || "").trim(),
    model: String(form.get("model") || "").trim(),
    type: String(form.get("type") || "").trim(),
    company: existing?.company || "",
    area: String(form.get("area") || "").trim(),
    sector: String(form.get("sector") || "").trim(),
    odometer: Number(form.get("odometer") || 0),
    status: String(form.get("status") || "available"),
    activeAssignmentId: existing?.activeAssignmentId || "",
    driver: existing?.driver || "",
    isActive: true,
  };

  const savedVehicle = state.dataMode === "supabase" ? await window.fleetSupabase.saveVehicle(vehicle) : vehicle;
  const nextVehicle = { ...vehicle, ...savedVehicle };
  runtime.vehicles = existing ? runtime.vehicles.map((item) => item.id === existing.id ? { ...item, ...nextVehicle } : item) : [nextVehicle, ...runtime.vehicles];
  addAudit(existing ? "vehicle_updated" : "vehicle_created", state.user.username, "vehicles", nextVehicle.id);
  saveRuntime();
  state.editVehicleId = "";
  toast(existing ? "Vehiculo actualizado." : "Vehiculo creado.");
  render();
}

async function deactivateVehicle(vehicleId) {
  const vehicle = getVehicle(vehicleId);
  if (!vehicle || vehicle.activeAssignmentId) {
    toast("No se puede dar de baja un vehiculo en uso.");
    return;
  }
  if (state.dataMode === "supabase") await window.fleetSupabase.deactivateVehicle(vehicleId);
  runtime.vehicles = runtime.vehicles.filter((item) => item.id !== vehicleId);
  addAudit("vehicle_deactivated", state.user.username, "vehicles", vehicleId);
  saveRuntime();
  toast("Vehiculo dado de baja logica.");
  render();
}

async function submitDriverForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existing = state.editDriverId && state.editDriverId !== "new"
    ? runtime.people.find((person) => person.employeeId === state.editDriverId || person.id === state.editDriverId)
    : null;
  const person = {
    id: existing?.id,
    employeeId: String(form.get("employeeId") || "").trim(),
    employeeUuid: existing?.employeeUuid,
    name: String(form.get("name") || "").trim(),
    area: String(form.get("area") || "").trim(),
    role: String(form.get("role") || "").trim(),
    isActive: true,
  };

  const saved = state.dataMode === "supabase" ? await window.fleetSupabase.saveEmployee(person) : person;
  const nextPerson = { ...person, ...saved };
  runtime.people = existing
    ? runtime.people.map((item) => (item.employeeId === existing.employeeId || item.id === existing.id) ? { ...item, ...nextPerson } : item)
    : [nextPerson, ...runtime.people];
  addAudit(existing ? "driver_updated" : "driver_created", state.user.username, "employees", nextPerson.employeeUuid || nextPerson.employeeId);
  saveRuntime();
  state.editDriverId = "";
  toast(existing ? "Conductor actualizado." : "Conductor creado.");
  render();
}

async function submitMaintenanceForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existing = state.editMaintenanceId && state.editMaintenanceId !== "new"
    ? runtime.maintenance.find((item) => item.id === state.editMaintenanceId)
    : null;
  const vehicle = getVehicle(String(form.get("vehicleId") || ""));
  if (!vehicle) {
    toast("Selecciona un vehiculo valido.");
    return;
  }
  const record = {
    id: existing?.id || "",
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    status: maintenanceStatusLabel(String(form.get("status") || "pending")),
    statusValue: String(form.get("status") || "pending"),
    type: String(form.get("type") || "Mantenimiento").trim(),
    provider: String(form.get("provider") || "").trim(),
    workshop: String(form.get("workshop") || "").trim(),
    detail: String(form.get("detail") || "").trim(),
    cost: form.get("cost") ? Number(form.get("cost")) : null,
    enteredAt: String(form.get("enteredAt") || ""),
    retiredAt: String(form.get("retiredAt") || ""),
    notes: String(form.get("notes") || "").trim(),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  try {
    const saved = state.dataMode === "supabase" ? await window.fleetSupabase.saveMaintenance(record) : record;
    const nextRecord = { ...record, ...saved };
    runtime.maintenance = upsertById(runtime.maintenance || [], nextRecord);
    addAudit(existing ? "maintenance_updated" : "maintenance_created", state.user.username, "maintenance_records", nextRecord.id || nextRecord.domain);
    saveRuntime();
    state.editMaintenanceId = "";
    toast(existing ? "Mantenimiento actualizado." : "Mantenimiento creado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo guardar mantenimiento.");
  }
}

async function submitRoleChange(profileId, role) {
  if (state.dataMode !== "supabase") return;
  try {
    const updated = await window.fleetSupabase.updateProfileRole(profileId, role);
    runtime.profiles = (runtime.profiles || []).map((profile) => profile.id === profileId ? updated : profile);
    toast("Rol actualizado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo actualizar el rol.");
    render();
  }
}

async function submitProfileForm(profileId) {
  if (state.dataMode !== "supabase") return;
  const profile = (runtime.profiles || []).find((item) => item.id === profileId);
  if (!profile) return;
  const selectorId = selectorEscape(profileId);
  const role = document.querySelector(`[data-user-role="${selectorId}"]`)?.value || profile.role;
  const employeeId = document.querySelector(`[data-user-employee="${selectorId}"]`)?.value || "";
  const isActive = (document.querySelector(`[data-user-active="${selectorId}"]`)?.value || "true") === "true";
  try {
    const updated = await window.fleetSupabase.updateProfile({
      id: profileId,
      role,
      employeeId,
      isActive,
    });
    runtime.profiles = (runtime.profiles || []).map((item) => item.id === profileId ? updated : item);
    addAudit("profile_updated", state.user.username, "profiles", profileId);
    toast("Usuario actualizado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo actualizar el usuario.");
  }
}

async function submitDocumentForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const documentItem = {
    id: String(form.get("id") || ""),
    vehicleId: String(form.get("vehicleId") || ""),
    type: String(form.get("type") || "").trim(),
    number: String(form.get("number") || "").trim(),
    expiresAt: String(form.get("expiresAt") || ""),
    status: String(form.get("status") || "").trim(),
    notes: String(form.get("notes") || "").trim(),
  };
  try {
    const saved = state.dataMode === "supabase" ? await window.fleetSupabase.saveDocument(documentItem) : documentItem;
    const nextItem = { ...documentItem, ...saved };
    runtime.documents = upsertById(runtime.documents || [], nextItem);
    attachVehicleRecords(nextItem.vehicleId);
    addAudit(documentItem.id ? "document_updated" : "document_created", state.user.username, "vehicle_documents", nextItem.id || nextItem.type);
    saveRuntime();
    toast(documentItem.id ? "Documento actualizado." : "Documento agregado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo guardar el documento.");
  }
}

async function submitEquipmentForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const equipmentItem = {
    id: String(form.get("id") || ""),
    vehicleId: String(form.get("vehicleId") || ""),
    name: String(form.get("name") || "").trim(),
    expected: String(form.get("expected")) === "true",
    present: String(form.get("present")) === "true",
    expiresAt: String(form.get("expiresAt") || ""),
    notes: String(form.get("notes") || "").trim(),
  };
  try {
    const saved = state.dataMode === "supabase" ? await window.fleetSupabase.saveEquipment(equipmentItem) : equipmentItem;
    const nextItem = { ...equipmentItem, ...saved };
    runtime.equipment = upsertById(runtime.equipment || [], nextItem);
    attachVehicleRecords(nextItem.vehicleId);
    addAudit(equipmentItem.id ? "equipment_updated" : "equipment_created", state.user.username, "vehicle_equipment", nextItem.id || nextItem.name);
    saveRuntime();
    toast(equipmentItem.id ? "Equipamiento actualizado." : "Equipamiento agregado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo guardar el equipamiento.");
  }
}

async function submitPhotoForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) {
    toast("Selecciona un archivo para subir.");
    return;
  }
  const photo = {
    vehicleId: String(form.get("vehicleId") || ""),
    photoType: String(form.get("photoType") || "Otro"),
    description: String(form.get("description") || "").trim(),
  };
  try {
    const saved = state.dataMode === "supabase"
      ? await window.fleetSupabase.uploadVehicleEvidence(photo, file)
      : {
          ...photo,
          id: `P${Date.now()}`,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          storagePath: file.name,
          createdAt: new Date().toISOString(),
        };
    runtime.photos = [saved, ...(runtime.photos || [])];
    attachVehicleRecords(saved.vehicleId);
    addAudit("photo_uploaded", state.user.username, "vehicle_photos", saved.id || saved.fileName);
    saveRuntime();
    toast("Archivo subido.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo subir el archivo.");
  }
}

async function openPhoto(photoId) {
  const photo = (runtime.photos || []).find((item) => item.id === photoId);
  if (!photo) return;
  try {
    const url = state.dataMode === "supabase"
      ? await window.fleetSupabase.createEvidenceUrl(photo.storagePath)
      : "";
    if (!url) {
      toast("Archivo guardado localmente en modo demo.");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.click();
  } catch (error) {
    toast(error.message || "No se pudo abrir el archivo.");
  }
}

async function submitChecklistItemForm(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const item = {
    id: String(form.get("id") || ""),
    stage: String(form.get("stage") || "start"),
    templateId: String(form.get("templateId") || ""),
    category: String(form.get("category") || "").trim(),
    label: String(form.get("label") || "").trim(),
    appliesToVehicleType: String(form.get("vehicleType") || "").trim(),
    sortOrder: Number(form.get("sortOrder") || 0),
    isActive: String(form.get("isActive")) === "true",
  };
  if (!item.templateId) {
    toast("Primero debe existir una plantilla de checklist en Supabase.");
    return;
  }
  try {
    const saved = state.dataMode === "supabase" ? await window.fleetSupabase.saveChecklistItem(item) : item;
    const nextItem = { ...item, ...saved };
    runtime.checklistItems = item.id
      ? (runtime.checklistItems || []).map((current) => current.id === item.id ? nextItem : current)
      : [nextItem, ...(runtime.checklistItems || [])];
    addAudit(item.id ? "checklist_item_updated" : "checklist_item_created", state.user.username, "checklist_items", nextItem.id || nextItem.label);
    saveRuntime();
    toast(item.id ? "Item de checklist actualizado." : "Item de checklist agregado.");
    render();
  } catch (error) {
    toast(error.message || "No se pudo guardar el item.");
  }
}

async function submitStartAssignment(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const vehicle = getVehicle(form.get("vehicleId"));
  if (!vehicle || vehicle.activeAssignmentId) return;

  const odometerStart = Number(form.get("odometerStart"));
  const checklist = readChecklist(form, "start", vehicle.type);
  const severity = checklistSeverity(checklist);
  const preexisting = getOpenIncidents(vehicle.id);
  const now = new Date().toISOString();

  const assignment = {
    id: state.dataMode === "supabase" && window.crypto?.randomUUID ? window.crypto.randomUUID() : `A${Date.now()}`,
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    employeeId: state.user.employeeId,
    employeeUuid: state.user.employeeUuid,
    driver: state.user.name,
    startedBy: state.user.profileId,
    startAt: now,
    endAt: null,
    odometerStart,
    odometerEnd: null,
    distance: null,
    locationStart: String(form.get("locationStart") || ""),
    locationEnd: "",
    startChecklist: checklist,
    endChecklist: {},
    startNotes: String(form.get("startNotes") || ""),
    endNotes: "",
    acceptedAt: now,
    preexistingIncidentIds: preexisting.map((incident) => incident.id),
    status: "active",
    odometerWarning: odometerStart < Number(vehicle.odometer || 0),
  };

  runtime.assignments.push(assignment);
  let incident = null;
  if (severity !== "correcto" || assignment.startNotes.trim()) {
    incident = createIncident(vehicle, assignment, "detected_at_start", "Novedad detectada al recibir", assignment.startNotes || "Checklist inicial con observaciones.", severity);
  }
  if (state.dataMode === "supabase") await window.fleetSupabase.saveAssignmentStarted(assignment, vehicle, severity);
  if (state.dataMode === "supabase" && incident) await window.fleetSupabase.saveIncident(incident);
  updateVehicle(vehicle.id, {
    status: severity === "critica" ? "alert" : "active",
    driver: state.user.name,
    activeAssignmentId: assignment.id,
    odometer: odometerStart,
    lastReport: now,
  });
  addAudit("assignment_started", state.user.username, "vehicle_assignments", assignment.id);
  saveRuntime();
  toast(assignment.odometerWarning ? "Recepcion registrada con advertencia de kilometraje." : "Recepcion registrada.");
  render();
}

async function submitCloseAssignment(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const assignment = getActiveAssignmentForUser();
  if (!assignment) return;
  const vehicle = getVehicle(assignment.vehicleId);
  const odometerEnd = Number(form.get("odometerEnd"));
  const checklist = readChecklist(form, "end", vehicle?.type);
  const severity = checklistSeverity(checklist);
  const now = new Date().toISOString();

  assignment.endAt = now;
  assignment.odometerEnd = odometerEnd;
  assignment.distance = odometerEnd - assignment.odometerStart;
  assignment.locationEnd = String(form.get("locationEnd") || "");
  assignment.endChecklist = checklist;
  assignment.endNotes = String(form.get("endNotes") || "");
  assignment.status = "closed";
  assignment.closedBy = state.user.profileId;

  if (severity !== "correcto" || assignment.endNotes.trim()) {
    const incident = createIncident(vehicle, assignment, "new_at_return", "Dano o novedad al devolver", assignment.endNotes || "Checklist final con observaciones.", severity);
    if (state.dataMode === "supabase") await window.fleetSupabase.saveIncident(incident);
  }

  const hasOpenIncidents = getOpenIncidents(vehicle.id).length > 0;
  if (state.dataMode === "supabase") await window.fleetSupabase.saveAssignmentClosed(assignment, vehicle, hasOpenIncidents || severity !== "correcto");
  updateVehicle(vehicle.id, {
    status: hasOpenIncidents || severity !== "correcto" ? "alert" : "available",
    driver: "",
    activeAssignmentId: "",
    odometer: odometerEnd,
    lastReport: now,
  });
  addAudit("assignment_closed", state.user.username, "vehicle_assignments", assignment.id);
  saveRuntime();
  toast("Vehiculo devuelto y registro historico cerrado.");
  render();
}

function readChecklist(form, prefix, vehicleType = "") {
  const values = {};
  groupChecklistItems(getChecklistItems(prefix, vehicleType)).forEach(([category, items]) => {
    items.forEach((item) => {
      values[`${category} - ${item.label}`] = String(form.get(`${prefix}_${slug(category)}_${slug(item.label)}`) || "correcto");
    });
  });
  return values;
}

function createIncident(vehicle, assignment, stage, title, description, severity) {
  const incident = {
    id: state.dataMode === "supabase" && window.crypto?.randomUUID ? window.crypto.randomUUID() : `I${Date.now()}${runtime.incidents.length}`,
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    assignmentId: assignment.id,
    reportedBy: assignment.driver,
    reportedById: state.user?.profileId,
    reportedAt: new Date().toISOString(),
    stage,
    title,
    description,
    status: "open",
    severity,
    source: "user",
  };
  runtime.incidents.push(incident);
  return incident;
}

function getFilteredVehicles() {
  const query = normalize(state.query);
  return runtime.vehicles.filter((vehicle) => {
    const matchesArea = state.area === "Todas" || vehicle.area === state.area;
    const text = normalize([vehicle.domain, vehicle.internal, vehicle.model, vehicle.type, vehicle.company, vehicle.area, vehicle.sector, vehicle.driver].join(" "));
    return matchesArea && (!query || text.includes(query));
  });
}

function getStats() {
  const total = runtime.vehicles.length;
  const inUse = runtime.vehicles.filter((vehicle) => vehicle.activeAssignmentId).length;
  return {
    total,
    inUse,
    available: total - inUse,
    alerts: getAlerts().length,
  };
}

function getAlerts() {
  const alerts = [];
  runtime.incidents.filter((incident) => incident.status === "open").forEach((incident) => {
    alerts.push({ type: "Dano abierto", level: incident.severity, text: `${incident.domain}: ${incident.title}`, at: incident.reportedAt });
  });
  runtime.vehicles.forEach((vehicle) => {
    const state = vtvState(vehicle);
    if (state !== "vigente") alerts.push({ type: "Documentacion", level: state === "vencida" ? "critica" : "advertencia", text: `${vehicle.domain}: VTV ${state}`, at: vehicle.vtv || "" });
    (vehicle.documents || []).forEach((document) => {
      const state = expiryState(document.expiresAt);
      if (document.expiresAt && state !== "vigente") {
        alerts.push({
          type: "Documentacion",
          level: state === "vencida" ? "critica" : "advertencia",
          text: `${vehicle.domain}: ${document.type} ${state}`,
          at: document.expiresAt,
        });
      }
    });
    (vehicle.equipment || []).filter((item) => item.expiresAt).forEach((item) => {
      const state = expiryState(item.expiresAt);
      if (state !== "vigente") {
        alerts.push({
          type: "Equipamiento",
          level: state === "vencida" ? "critica" : "advertencia",
          text: `${vehicle.domain}: ${item.name} ${state}`,
          at: item.expiresAt,
        });
      }
    });
  });
  runtime.maintenance.filter((item) => item.status === "Pendiente").forEach((item) => {
    alerts.push({ type: "Mantenimiento", level: "advertencia", text: `${item.domain}: ${item.detail}`, at: item.createdAt });
  });
  return alerts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function getReportAssignments() {
  const query = normalize(state.query);
  const from = state.reportFrom ? new Date(`${state.reportFrom}T00:00:00`) : null;
  const to = state.reportTo ? new Date(`${state.reportTo}T23:59:59`) : null;
  return runtime.assignments
    .filter((item) => {
      const vehicle = getVehicle(item.vehicleId) || runtime.vehicles.find((candidate) => candidate.domain === item.domain) || {};
      const started = new Date(item.startAt || 0);
      const haystack = normalize([item.domain, item.driver, item.employeeId, vehicle.area, vehicle.type, item.status].join(" "));
      if (query && !haystack.includes(query)) return false;
      if (state.area !== "Todas" && vehicle.area !== state.area) return false;
      if (state.reportStatus !== "Todos" && item.status !== state.reportStatus) return false;
      if (from && started < from) return false;
      if (to && started > to) return false;
      return true;
    })
    .sort(sortDesc("startAt"));
}

function getFilteredIncidentsForReports() {
  const query = normalize(state.query);
  return runtime.incidents.filter((incident) => {
    const vehicle = getVehicle(incident.vehicleId) || runtime.vehicles.find((candidate) => candidate.domain === incident.domain) || {};
    const haystack = normalize([incident.domain, incident.title, incident.description, incident.reportedBy, vehicle.area].join(" "));
    if (incident.status !== "open") return false;
    if (query && !haystack.includes(query)) return false;
    if (state.area !== "Todas" && vehicle.area !== state.area) return false;
    return true;
  });
}

function getReportVehicles() {
  const query = normalize(state.query);
  return runtime.vehicles
    .filter((vehicle) => {
      const haystack = normalize([vehicle.domain, vehicle.internal, vehicle.model, vehicle.type, vehicle.company, vehicle.area, vehicle.sector].join(" "));
      if (query && !haystack.includes(query)) return false;
      if (state.area !== "Todas" && vehicle.area !== state.area) return false;
      return true;
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

function getReportDocuments() {
  const vehicleIds = new Set(getReportVehicles().map((vehicle) => vehicle.id));
  return (runtime.documents || [])
    .filter((item) => vehicleIds.has(item.vehicleId))
    .filter((item) => {
      const stateName = expiryState(item.expiresAt);
      return stateName !== "vigente" || normalize(item.status).includes("venc");
    })
    .filter((item) => dateInReportRange(item.expiresAt))
    .sort((a, b) => String(a.expiresAt || "").localeCompare(String(b.expiresAt || "")));
}

function getReportEquipment() {
  const vehicleIds = new Set(getReportVehicles().map((vehicle) => vehicle.id));
  return (runtime.equipment || [])
    .filter((item) => vehicleIds.has(item.vehicleId))
    .filter((item) => item.present === false || item.expected === false || (item.expiresAt && expiryState(item.expiresAt) !== "vigente"))
    .filter((item) => dateInReportRange(item.expiresAt))
    .sort((a, b) => String(a.expiresAt || "").localeCompare(String(b.expiresAt || "")));
}

function getReportMaintenance() {
  const vehicleIds = new Set(getReportVehicles().map((vehicle) => vehicle.id));
  return (runtime.maintenance || [])
    .filter((item) => vehicleIds.has(item.vehicleId))
    .filter((item) => dateInReportRange(item.enteredAt || item.createdAt))
    .sort(sortDesc("enteredAt"))
    .slice(0, 200);
}

function dateInReportRange(value) {
  if (!value || (!state.reportFrom && !state.reportTo)) return true;
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const from = state.reportFrom ? new Date(`${state.reportFrom}T00:00:00`) : null;
  const to = state.reportTo ? new Date(`${state.reportTo}T23:59:59`) : null;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function getActiveAssignments() {
  return runtime.assignments.filter((item) => item.status === "active" && !item.endAt).sort(sortDesc("startAt"));
}

function getActiveAssignmentForUser() {
  return runtime.assignments.find((item) => item.employeeId === state.user.employeeId && item.status === "active" && !item.endAt);
}

function getActiveAssignmentByVehicle(vehicleId) {
  return runtime.assignments.find((item) => item.vehicleId === vehicleId && item.status === "active" && !item.endAt);
}

function getOpenIncidents(vehicleId) {
  return runtime.incidents.filter((incident) => incident.vehicleId === vehicleId && incident.status === "open");
}

function getVehicle(id) {
  return runtime.vehicles.find((vehicle) => vehicle.id === id);
}

function updateVehicle(id, changes) {
  runtime.vehicles = runtime.vehicles.map((vehicle) => vehicle.id === id ? { ...vehicle, ...changes } : vehicle);
}

function checklistSeverity(checklist) {
  const values = Object.values(checklist);
  if (values.includes("defectuoso") || values.includes("faltante")) return "critica";
  if (values.includes("observado")) return "advertencia";
  return "correcto";
}

function topbar(title, actions = "") {
  const mode = state.dataMode === "supabase" ? `<span class="badge ok">Produccion Supabase</span>` : `<span class="badge warn">Demo local</span>`;
  return `<header class="topbar"><div><h2>${title}</h2><p class="muted">Primera version operativa sin GPS. La localizacion queda como modulo opcional futuro. ${mode}</p></div><div class="top-actions">${actions}</div></header>`;
}

function navButton(view, label) {
  return `<button class="nav-btn ${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function toolbar() {
  const areas = ["Todas", ...Array.from(new Set(runtime.vehicles.map((v) => v.area).filter(Boolean))).sort()];
  return `
    <div class="toolbar">
      <label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Dominio, interno, modelo, conductor"></label>
      <label class="field"><span>Area</span><select data-filter="area">${areas.map((area) => `<option ${state.area === area ? "selected" : ""}>${escapeHtml(area)}</option>`).join("")}</select></label>
    </div>
  `;
}

function activeTable(assignments) {
  return `
    <table>
      <thead><tr><th>Patente</th><th>Conductor</th><th>Inicio</th><th>Km inicial</th><th>Preexistentes</th></tr></thead>
      <tbody>${assignments.map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.driver)}</td><td>${formatDateTime(item.startAt)}</td><td>${item.odometerStart}</td><td>${(item.preexistingIncidentIds || []).length}</td></tr>`).join("") || `<tr><td colspan="5">${empty("No hay vehiculos en uso.")}</td></tr>`}</tbody>
    </table>
  `;
}

function assignmentTable(assignments) {
  return `
    <table>
      <thead><tr><th>Patente</th><th>Conductor</th><th>Inicio</th><th>Fin</th><th>Km inicial</th><th>Km final</th><th>Recorrido</th><th>Estado</th></tr></thead>
      <tbody>${assignments.map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.driver)}</td><td>${formatDateTime(item.startAt)}</td><td>${formatDateTime(item.endAt)}</td><td>${item.odometerStart}</td><td>${item.odometerEnd ?? "-"}</td><td>${item.distance ?? "-"}</td><td>${statusTextBadge(item.status)}</td></tr>`).join("") || `<tr><td colspan="8">${empty("Sin resultados para los filtros seleccionados.")}</td></tr>`}</tbody>
    </table>
  `;
}

function documentReportTable(items) {
  return `
    <table>
      <thead><tr><th>Patente</th><th>Tipo</th><th>Vence</th><th>Estado</th><th>Notas</th></tr></thead>
      <tbody>${items.slice(0, 80).map((item) => {
        const vehicle = getVehicle(item.vehicleId) || {};
        const stateName = expiryState(item.expiresAt);
        return `<tr><td>${escapeHtml(vehicle.domain || "-")}</td><td>${escapeHtml(item.type)}</td><td>${formatDate(item.expiresAt)}</td><td>${expiryBadge(stateName)}</td><td>${escapeHtml(item.notes || item.number || "")}</td></tr>`;
      }).join("") || `<tr><td colspan="5">${empty("Sin documentacion critica para los filtros seleccionados.")}</td></tr>`}</tbody>
    </table>
  `;
}

function equipmentReportTable(items) {
  return `
    <table>
      <thead><tr><th>Patente</th><th>Elemento</th><th>Vence</th><th>Estado</th><th>Notas</th></tr></thead>
      <tbody>${items.slice(0, 80).map((item) => {
        const vehicle = getVehicle(item.vehicleId) || {};
        const stateName = item.present === false ? "faltante" : expiryState(item.expiresAt);
        const badge = stateName === "faltante" ? statusTextBadge("Faltante") : expiryBadge(stateName);
        return `<tr><td>${escapeHtml(vehicle.domain || "-")}</td><td>${escapeHtml(item.name)}</td><td>${formatDate(item.expiresAt)}</td><td>${badge}</td><td>${escapeHtml(item.notes || "")}</td></tr>`;
      }).join("") || `<tr><td colspan="5">${empty("Sin equipamiento critico para los filtros seleccionados.")}</td></tr>`}</tbody>
    </table>
  `;
}

function maintenanceReportTable(items) {
  return `
    <table>
      <thead><tr><th>Fecha</th><th>Patente</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead>
      <tbody>${items.map((item) => `<tr><td>${formatDate(item.enteredAt || item.createdAt)}</td><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.detail)}</td><td>${statusTextBadge(item.status)}</td></tr>`).join("") || `<tr><td colspan="5">${empty("Sin reparaciones para los filtros seleccionados.")}</td></tr>`}</tbody>
    </table>
  `;
}

function vehicleRow(vehicle) {
  const active = getActiveAssignmentByVehicle(vehicle.id);
  const alertCount = getOpenIncidents(vehicle.id).length + (vtvState(vehicle) === "vigente" ? 0 : 1);
  return `
    <tr>
      <td><strong>${escapeHtml(vehicle.domain)}</strong><br>${statusBadge(vehicle.status)}</td>
      <td>${escapeHtml(vehicle.model || "-")}<br><span class="muted">${escapeHtml(vehicle.type || "-")} | ${escapeHtml(vehicle.company || "-")}</span></td>
      <td>${active ? `${escapeHtml(active.driver)}<br><span class="muted">${formatDateTime(active.startAt)}</span>` : "<span class=\"muted\">Sin conductor</span>"}</td>
      <td>${vehicle.odometer || "s/d"}</td>
      <td>${alertCount ? `<span class="badge danger">${alertCount}</span>` : `<span class="badge ok">0</span>`}</td>
      <td class="row-actions"><button class="btn secondary" data-action="vehicle-detail" data-vehicle-id="${vehicle.id}">Ver ficha</button><button class="btn ghost" data-action="edit-vehicle" data-vehicle-id="${vehicle.id}">Editar</button><button class="btn ghost" data-action="deactivate-vehicle" data-vehicle-id="${vehicle.id}">Baja</button></td>
    </tr>
  `;
}

function driverRow(person) {
  const assignments = runtime.assignments.filter((item) => item.employeeId === person.employeeId);
  const active = assignments.find((item) => item.status === "active" && !item.endAt);
  return `
    <tr>
      <td>${escapeHtml(person.employeeId)}</td>
      <td><strong>${escapeHtml(person.name)}</strong></td>
      <td>${escapeHtml(person.area || "-")}</td>
      <td>${escapeHtml(person.role || "-")}</td>
      <td>${assignments.length}</td>
      <td>${active ? `${escapeHtml(active.domain)} desde ${formatDateTime(active.startAt)}` : "<span class=\"muted\">Sin vehiculo</span>"}</td>
      <td><button class="btn ghost" data-action="edit-driver" data-driver-id="${escapeAttr(person.employeeId || person.id)}">Editar</button></td>
    </tr>
  `;
}

function incidentRow(incident) {
  return `
    <tr>
      <td>${formatDateTime(incident.reportedAt)}</td>
      <td>${escapeHtml(incident.domain)}</td>
      <td>${incidentStageBadge(incident.stage)}</td>
      <td><strong>${escapeHtml(incident.title)}</strong><br><span class="muted">${escapeHtml(incident.description)}</span></td>
      <td>${escapeHtml(incident.reportedBy)}</td>
      <td>${statusTextBadge(incident.status)} ${severityBadge(incident.severity)}</td>
    </tr>
  `;
}

function alertCard(alert) {
  return `<article class="vehicle-card"><header><h4>${escapeHtml(alert.type)}</h4>${severityBadge(alert.level)}</header><p>${escapeHtml(alert.text)}</p></article>`;
}

function incidentCard(incident) {
  return `<article class="vehicle-card"><header><h4>${escapeHtml(incident.title)}</h4>${severityBadge(incident.severity)}</header><p>${escapeHtml(incident.description)}</p><div class="meta"><span>${incidentStageLabel(incident.stage)}</span><span>${formatDateTime(incident.reportedAt)}</span><span>${escapeHtml(incident.reportedBy)}</span></div></article>`;
}

function incidentMini(incident) {
  return `<div class="mini-record"><strong>${escapeHtml(incident.title)}</strong><br><span class="muted">${escapeHtml(incident.description)}</span></div>`;
}

function assignmentMini(item) {
  return `<div class="mini-record"><strong>${escapeHtml(item.driver)}</strong><br><span class="muted">${formatDateTime(item.startAt)} | Km ${item.odometerStart}${item.odometerEnd ? ` a ${item.odometerEnd}` : ""}</span></div>`;
}

function maintenanceMini(item) {
  return `<div class="mini-record"><strong>${escapeHtml(item.type)}</strong> ${statusTextBadge(item.status)}<br><span class="muted">${escapeHtml(item.detail)}</span>${item.enteredAt ? `<br><span class="muted">Fecha: ${formatDate(item.enteredAt)}</span>` : ""}</div>`;
}

function auditRow(log) {
  return `
    <tr>
      <td>${formatDateTime(log.createdAt)}</td>
      <td>${escapeHtml(log.actorName)}</td>
      <td>${escapeHtml(auditActionLabel(log.action))}</td>
      <td><strong>${escapeHtml(log.entityName)}</strong><br><span class="muted">${escapeHtml(log.entityId || "-")}</span></td>
      <td>${escapeHtml(auditSummary(log))}</td>
    </tr>
  `;
}

function auditSummary(log) {
  if (log.action === "insert") return "Registro creado";
  if (log.action === "delete") return "Registro eliminado";
  if (log.action === "update") {
    const oldData = log.oldData || {};
    const newData = log.newData || {};
    const changed = Object.keys(newData).filter((key) => JSON.stringify(oldData[key]) !== JSON.stringify(newData[key]));
    return changed.slice(0, 6).join(", ") || "Registro actualizado";
  }
  return "Evento registrado";
}

function auditActionLabel(action) {
  const labels = { insert: "Alta", update: "Edicion", delete: "Eliminacion" };
  return labels[action] || action;
}

function roleLabel(role) {
  const labels = {
    driver: "Conductor",
    admin: "Admin",
    supervisor: "Supervisor",
    maintenance: "Mantenimiento",
    auditor: "Auditor",
    super_admin: "Super admin",
  };
  return labels[role] || role;
}

function documentMini(item) {
  const state = expiryState(item.expiresAt);
  return `<div class="mini-record"><strong>${escapeHtml(item.type)}</strong> ${item.expiresAt ? expiryBadge(state) : statusTextBadge(item.status || "Sin fecha")}<br><span class="muted">${item.expiresAt ? `Vence: ${formatDate(item.expiresAt)}` : "Sin vencimiento cargado"}${item.number ? ` | ${escapeHtml(item.number)}` : ""}</span>${item.notes ? `<br><span class="muted">${escapeHtml(item.notes)}</span>` : ""}</div>`;
}

function equipmentMini(item) {
  const state = expiryState(item.expiresAt);
  return `<div class="mini-record"><strong>${escapeHtml(item.name)}</strong> ${item.present ? statusTextBadge("Presente") : statusTextBadge("Faltante")} ${item.expiresAt ? expiryBadge(state) : ""}<br><span class="muted">${item.expiresAt ? `Vence: ${formatDate(item.expiresAt)}` : "Sin vencimiento"}${item.notes ? ` | ${escapeHtml(item.notes)}` : ""}</span></div>`;
}

function miniTable(rows, headers) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return `<div class="table-wrap"><table><thead><tr><th>${headers[0]}</th><th>${headers[1]}</th></tr></thead><tbody>${entries.map(([key, value]) => `<tr><td>${escapeHtml(key || "Sin dato")}</td><td>${value}</td></tr>`).join("")}</tbody></table></div>`;
}

function stat(label, value) {
  return `<div class="stat"><strong>${value}</strong><span class="muted">${label}</span></div>`;
}

function summaryItem(label, value) {
  return `<div class="summary-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function statusBadge(status) {
  const labels = {
    active: ["En uso", "ok"],
    available: ["Disponible", "info"],
    alert: ["Observado", "danger"],
    idle: ["Sin reporte", "warn"],
  };
  const [label, kind] = labels[status] || labels.idle;
  return `<span class="badge ${kind}">${label}</span>`;
}

function statusTextBadge(status) {
  const normalized = normalize(status);
  const kind = normalized.includes("faltante") || normalized.includes("open")
    ? "danger"
    : normalized.includes("pendiente") || normalized.includes("active")
      ? "warn"
      : "ok";
  const label = status === "active" ? "Activo" : status === "closed" ? "Cerrado" : status === "open" ? "Abierto" : status;
  return `<span class="badge ${kind}">${escapeHtml(label)}</span>`;
}

function severityBadge(severity) {
  const labels = {
    correcto: ["Correcto", "ok"],
    advertencia: ["Advertencia", "warn"],
    critica: ["Critica", "danger"],
  };
  const [label, kind] = labels[severity] || ["Info", "info"];
  return `<span class="badge ${kind}">${label}</span>`;
}

function incidentStageBadge(stage) {
  return `<span class="badge ${stage === "new_at_return" ? "danger" : "warn"}">${incidentStageLabel(stage)}</span>`;
}

function incidentStageLabel(stage) {
  if (stage === "new_at_return") return "Dano nuevo al devolver";
  if (stage === "detected_at_start") return "Detectado al recibir";
  return "Preexistente";
}

function vtvState(vehicle) {
  return expiryState(vehicle.vtv);
}

function vtvBadge(vehicle) {
  const state = vtvState(vehicle);
  return expiryBadge(state);
}

function expiryState(value) {
  if (!value) return "sin fecha";
  const today = new Date();
  const date = new Date(value);
  const soon = new Date();
  soon.setDate(today.getDate() + 45);
  if (date < today) return "vencida";
  if (date <= soon) return "proxima";
  return "vigente";
}

function expiryBadge(state) {
  if (state === "vencida") return `<span class="badge danger">Vencida</span>`;
  if (state === "proxima") return `<span class="badge warn">Proxima</span>`;
  if (state === "sin fecha") return `<span class="badge warn">Sin fecha</span>`;
  return `<span class="badge ok">Vigente</span>`;
}

function addAudit(action, user, entity, entityId) {
  runtime.auditLogs.push({ id: `L${Date.now()}`, action, user, entity, entityId, at: new Date().toISOString() });
  saveRuntime();
}

function exportCsv() {
  if (state.view === "reports") return exportReportsCsv();
  const assignments = runtime.assignments;
  const rows = [
    ["patente", "conductor", "legajo", "inicio", "fin", "km_inicial", "km_final", "km_recorridos", "notas_inicio", "notas_fin"],
    ...assignments.map((item) => [item.domain, item.driver, item.employeeId, item.startAt, item.endAt || "", item.odometerStart, item.odometerEnd || "", item.distance || "", item.startNotes, item.endNotes]),
  ];
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-asignaciones-flota-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportReportsCsv() {
  const sections = [
    ["USOS"],
    ["patente", "conductor", "legajo", "inicio", "fin", "km_inicial", "km_final", "km_recorridos", "notas_inicio", "notas_fin"],
    ...getReportAssignments().map((item) => [item.domain, item.driver, item.employeeId, item.startAt, item.endAt || "", item.odometerStart, item.odometerEnd || "", item.distance || "", item.startNotes, item.endNotes]),
    [],
    ["VEHICULOS"],
    ["patente", "interno", "modelo", "tipo", "empresa", "area", "sector", "km", "estado"],
    ...getReportVehicles().map((item) => [item.domain, item.internal, item.model, item.type, item.company, item.area, item.sector, item.odometer, item.status]),
    [],
    ["DOCUMENTACION_CRITICA"],
    ["patente", "tipo", "vence", "estado", "numero", "notas"],
    ...getReportDocuments().map((item) => {
      const vehicle = getVehicle(item.vehicleId) || {};
      return [vehicle.domain || "", item.type, item.expiresAt || "", expiryState(item.expiresAt), item.number || "", item.notes || ""];
    }),
    [],
    ["EQUIPAMIENTO_CRITICO"],
    ["patente", "elemento", "vence", "presente", "esperado", "notas"],
    ...getReportEquipment().map((item) => {
      const vehicle = getVehicle(item.vehicleId) || {};
      return [vehicle.domain || "", item.name, item.expiresAt || "", item.present ? "si" : "no", item.expected ? "si" : "no", item.notes || ""];
    }),
    [],
    ["REPARACIONES"],
    ["fecha", "patente", "tipo", "detalle", "estado"],
    ...getReportMaintenance().map((item) => [item.enteredAt || item.createdAt || "", item.domain, item.type, item.detail, item.status]),
  ];
  const blob = new Blob([sections.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-flota-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  if (!window.XLSX) {
    toast("No se cargo la libreria de Excel. Actualiza la pagina e intenta nuevamente.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  const sheets = reportWorkbookData();
  Object.entries(sheets).forEach(([name, rows]) => {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  });
  XLSX.writeFile(workbook, `reporte-flota-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function reportWorkbookData() {
  return {
    Usos: getReportAssignments().map((item) => ({
      Patente: item.domain,
      Conductor: item.driver,
      Legajo: item.employeeId,
      Inicio: formatDateTime(item.startAt),
      Fin: formatDateTime(item.endAt),
      "Km inicial": item.odometerStart,
      "Km final": item.odometerEnd ?? "",
      Recorrido: item.distance ?? "",
      Estado: item.status,
      "Notas inicio": item.startNotes || "",
      "Notas fin": item.endNotes || "",
    })),
    Vehiculos: getReportVehicles().map((item) => ({
      Patente: item.domain,
      Interno: item.internal,
      Modelo: item.model,
      Tipo: item.type,
      Empresa: item.company,
      Area: item.area,
      Sector: item.sector,
      Kilometraje: item.odometer,
      Estado: item.status,
    })),
    Documentacion: getReportDocuments().map((item) => {
      const vehicle = getVehicle(item.vehicleId) || {};
      return {
        Patente: vehicle.domain || "",
        Tipo: item.type,
        Numero: item.number || "",
        Vence: formatDate(item.expiresAt),
        Estado: expiryState(item.expiresAt),
        Notas: item.notes || "",
      };
    }),
    Equipamiento: getReportEquipment().map((item) => {
      const vehicle = getVehicle(item.vehicleId) || {};
      return {
        Patente: vehicle.domain || "",
        Elemento: item.name,
        Esperado: item.expected ? "Si" : "No",
        Presente: item.present ? "Si" : "No",
        Vence: formatDate(item.expiresAt),
        Estado: item.present === false ? "faltante" : expiryState(item.expiresAt),
        Notas: item.notes || "",
      };
    }),
    Reparaciones: getReportMaintenance().map((item) => ({
      Fecha: formatDate(item.enteredAt || item.createdAt),
      Patente: item.domain,
      Tipo: item.type,
      Detalle: item.detail,
      Estado: item.status,
    })),
  };
}

function exportPdf() {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    toast("No se cargo la libreria PDF. Actualiza la pagina e intenta nuevamente.");
    return;
  }
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const page = { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight(), margin: 42 };
  let y = page.margin;

  const assignments = getReportAssignments();
  const vehicles = getReportVehicles();
  const documents = getReportDocuments();
  const equipment = getReportEquipment();
  const maintenance = getReportMaintenance();
  const totalKm = assignments.reduce((sum, item) => sum + Number(item.distance || 0), 0);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Reporte de flota", page.margin, y);
  y += 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generado: ${formatDateTime(new Date().toISOString())}`, page.margin, y);
  y += 16;
  doc.text(`Filtros: ${reportFilterSummary()}`, page.margin, y, { maxWidth: page.width - page.margin * 2 });
  y += 30;

  y = pdfSectionTitle(doc, "Resumen", y, page);
  y = pdfKeyValues(doc, [
    ["Usos registrados", assignments.length],
    ["Kilometros cerrados", totalKm],
    ["Vehiculos filtrados", vehicles.length],
    ["Documentacion critica", documents.length],
    ["Equipamiento critico", equipment.length],
    ["Reparaciones", maintenance.length],
  ], y, page);

  y = pdfSectionTitle(doc, "Documentacion a revisar", y, page);
  y = pdfSimpleTable(doc, ["Patente", "Tipo", "Vence", "Estado"], documents.slice(0, 20).map((item) => {
    const vehicle = getVehicle(item.vehicleId) || {};
    return [vehicle.domain || "-", item.type, formatDate(item.expiresAt), expiryState(item.expiresAt)];
  }), y, page);

  y = pdfSectionTitle(doc, "Equipamiento y matafuegos", y, page);
  y = pdfSimpleTable(doc, ["Patente", "Elemento", "Vence", "Estado"], equipment.slice(0, 20).map((item) => {
    const vehicle = getVehicle(item.vehicleId) || {};
    return [vehicle.domain || "-", item.name, formatDate(item.expiresAt), item.present === false ? "faltante" : expiryState(item.expiresAt)];
  }), y, page);

  y = pdfSectionTitle(doc, "Reparaciones importadas", y, page);
  pdfSimpleTable(doc, ["Fecha", "Patente", "Tipo", "Estado"], maintenance.slice(0, 25).map((item) => [
    formatDate(item.enteredAt || item.createdAt),
    item.domain,
    item.type,
    item.status,
  ]), y, page);

  doc.save(`reporte-flota-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function reportFilterSummary() {
  return [
    state.query ? `busqueda "${state.query}"` : "sin busqueda",
    state.reportFrom ? `desde ${state.reportFrom}` : "sin desde",
    state.reportTo ? `hasta ${state.reportTo}` : "sin hasta",
    `estado ${state.reportStatus}`,
    `area ${state.area}`,
  ].join(" | ");
}

function pdfSectionTitle(doc, title, y, page) {
  y = pdfEnsureSpace(doc, y, 36, page);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, page.margin, y);
  return y + 18;
}

function pdfKeyValues(doc, rows, y, page) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  rows.forEach(([label, value]) => {
    y = pdfEnsureSpace(doc, y, 18, page);
    doc.setFont("helvetica", "bold");
    doc.text(`${label}:`, page.margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), page.margin + 150, y);
    y += 16;
  });
  return y + 8;
}

function pdfSimpleTable(doc, headers, rows, y, page) {
  const usableWidth = page.width - page.margin * 2;
  const colWidth = usableWidth / headers.length;
  doc.setFontSize(9);
  y = pdfEnsureSpace(doc, y, 34, page);
  doc.setFont("helvetica", "bold");
  headers.forEach((header, index) => doc.text(header, page.margin + index * colWidth, y));
  y += 12;
  doc.setFont("helvetica", "normal");
  const data = rows.length ? rows : [["Sin resultados", "", "", ""]];
  data.forEach((row) => {
    y = pdfEnsureSpace(doc, y, 18, page);
    row.slice(0, headers.length).forEach((cell, index) => {
      const text = doc.splitTextToSize(String(cell ?? ""), colWidth - 8).slice(0, 2);
      doc.text(text, page.margin + index * colWidth, y);
    });
    y += 18;
  });
  return y + 8;
}

function pdfEnsureSpace(doc, y, needed, page) {
  if (y + needed <= page.height - page.margin) return y;
  doc.addPage();
  return page.margin;
}

function groupCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Sin dato";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function upsertById(items, item) {
  return item.id && items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [item, ...items];
}

function attachVehicleRecords(vehicleId) {
  runtime.vehicles = runtime.vehicles.map((vehicle) => {
    if (vehicle.id !== vehicleId) return vehicle;
    const documents = (runtime.documents || []).filter((item) => item.vehicleId === vehicle.id);
    const equipment = (runtime.equipment || []).filter((item) => item.vehicleId === vehicle.id);
    const photos = (runtime.photos || []).filter((item) => item.vehicleId === vehicle.id);
    const vtv = documents.find((item) => normalize(item.type) === "vtv");
    const vth = documents.find((item) => normalize(item.type) === "vth");
    return {
      ...vehicle,
      documents,
      equipment,
      photos,
      vtv: vtv?.expiresAt || vehicle.vtv || "",
      vth: vth?.expiresAt || vehicle.vth || "",
    };
  });
}

function sortDesc(key) {
  return (a, b) => String(b[key] || "").localeCompare(String(a[key] || ""));
}

function getChecklistTemplate(stage) {
  return (runtime.checklistTemplates || []).find((template) => template.stage === stage && template.isActive !== false)
    || (runtime.checklistTemplates || []).find((template) => template.stage === stage);
}

function getChecklistItems(stage, vehicleType = "", includeInactive = false) {
  const items = (runtime.checklistItems || [])
    .filter((item) => item.stage === stage)
    .filter((item) => includeInactive || item.isActive !== false)
    .filter((item) => checklistAppliesToVehicle(item.appliesToVehicleType, vehicleType));
  const source = items.length ? items : fallbackChecklistItems(stage);
  return source.slice().sort((a, b) => {
    const order = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (order) return order;
    return `${a.category}${a.label}`.localeCompare(`${b.category}${b.label}`);
  });
}

function fallbackChecklistItems(stage) {
  return checklistTemplate.flatMap(([category, items], categoryIndex) => (
    items.map((label, itemIndex) => ({
      id: `fallback-${stage}-${slug(category)}-${slug(label)}`,
      stage,
      templateId: "",
      category,
      label,
      appliesToVehicleType: "",
      sortOrder: categoryIndex * 100 + itemIndex,
      isActive: true,
    }))
  ));
}

function groupChecklistItems(items) {
  const groups = new Map();
  items.forEach((item) => {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  });
  return Array.from(groups.entries());
}

function checklistAppliesToVehicle(appliesToVehicleType, vehicleType) {
  const rule = normalize(appliesToVehicleType);
  const type = normalize(vehicleType);
  if (!rule || rule === "todos") return true;
  if (!type) return true;
  const parts = rule.split(/[,;|/]+/).map((part) => part.trim()).filter(Boolean);
  return parts.some((part) => part === type || part.includes(type) || type.includes(part));
}

function vehicleTypeSelectOptions(currentType = "", includeAll = true) {
  const normalizedCurrent = normalize(currentType);
  const optionsSource = includeAll ? vehicleTypeOptions : [["", "Sin tipo"], ...vehicleTypeOptions.filter(([value]) => value)];
  const hasKnownOption = optionsSource.some(([value]) => normalize(value) === normalizedCurrent);
  const options = optionsSource
    .map(([value, label]) => `<option value="${escapeAttr(value)}" ${normalize(value) === normalizedCurrent ? "selected" : ""}>${escapeHtml(label)}</option>`)
    .join("");
  const custom = currentType && !hasKnownOption
    ? `<option value="${escapeAttr(currentType)}" selected>${escapeHtml(currentType)}</option>`
    : "";
  return options + custom;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-AR").format(date);
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function dateInputValue(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function maintenanceStatusLabel(value) {
  const labels = {
    pending: "Pendiente",
    in_progress: "En curso",
    finished: "Finalizado",
    cancelled: "Cancelado",
  };
  return labels[value] || value || "Pendiente";
}

function maintenanceStatusValue(label) {
  const normalized = normalize(label);
  if (normalized.includes("curso") || normalized.includes("repair")) return "in_repair";
  if (normalized.includes("final")) return "finished";
  if (normalized.includes("cancel")) return "cancelled";
  return "pending";
}

function slug(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function selectorEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2500);
}

function renderShellMessage(message) {
  app.innerHTML = `<div class="login-shell"><section class="login-panel"><div class="login-card"><h2>${escapeHtml(message)}</h2><p class="muted">Gestion Flota Operacion</p></div></section></div>`;
}

init();
