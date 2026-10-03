const app = document.getElementById("app");
const storageKey = "edesur-flota-operacion-v2";

const state = {
  user: null,
  view: "dashboard",
  query: "",
  area: "Todas",
  vehicleId: "",
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

function loadRuntime() {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  const oldSaved = JSON.parse(localStorage.getItem("edesur-flota-localizador-v1") || "{}");
  const seedAssignments = (seedData.handovers || []).map(migrateHandover);
  const assignments = saved.assignments || (oldSaved.handovers || []).map(migrateHandover);

  return reconcileRuntime({
    vehicles: mergeVehicles(seedData.vehicles || [], saved.vehicles || oldSaved.vehicles || []),
    people: seedData.people || [],
    assignments: assignments.length ? assignments : seedAssignments,
    incidents: saved.incidents || buildSeedIncidents(seedAssignments),
    maintenance: saved.maintenance || buildSeedMaintenance(seedData.vehicles || []),
    auditLogs: saved.auditLogs || [],
  });
}

let runtime = loadRuntime();

function saveRuntime() {
  localStorage.setItem(storageKey, JSON.stringify({
    vehicles: runtime.vehicles.map(({ id, status, odometer, driver, activeAssignmentId, lastReport }) => ({
      id, status, odometer, driver, activeAssignmentId, lastReport,
    })),
    assignments: runtime.assignments,
    incidents: runtime.incidents,
    maintenance: runtime.maintenance,
    auditLogs: runtime.auditLogs,
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
  state.user = JSON.parse(sessionStorage.getItem("edesur-session") || "null");
  render();
}

function render() {
  if (!state.user) return renderLogin();

  const isAdmin = state.user.role === "admin";
  if (!isAdmin) state.view = "driver";

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand-mark"><span class="bolt">E</span><span>EDESUR Flota</span></div>
        <nav class="side-nav">
          ${isAdmin ? navButton("dashboard", "Panel") : ""}
          ${isAdmin ? navButton("vehicles", "Vehiculos") : ""}
          ${isAdmin ? navButton("drivers", "Conductores") : ""}
          ${isAdmin ? navButton("incidents", "Danos") : ""}
          ${isAdmin ? navButton("maintenance", "Mantenimiento") : ""}
          ${isAdmin ? navButton("reports", "Reportes") : ""}
          ${navButton("driver", isAdmin ? "Modo conductor" : "Mi turno")}
        </nav>
        <div class="user-box">
          <div><strong>${escapeHtml(state.user.name)}</strong><br><span class="muted">${isAdmin ? "Administrador" : "Conductor"}</span></div>
          <button class="btn secondary" data-action="logout">Cerrar sesion</button>
        </div>
      </aside>
      <section class="content">${renderView()}</section>
    </div>
  `;
  bindCommon();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-shell">
      <section class="brand-panel">
        <div class="brand-mark"><span class="bolt">E</span><span>EDESUR Flota</span></div>
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
            <label class="field"><span>Usuario</span><input name="username" autocomplete="username" value="admin"></label>
            <label class="field"><span>Contrasena</span><input name="password" type="password" autocomplete="current-password" value="admin123"></label>
            <div class="error" id="loginError"></div>
            <button class="btn" type="submit">Ingresar</button>
          </form>
          <div class="hint">
            Admin: <strong>admin</strong> / <strong>admin123</strong><br>
            Conductor demo: <strong>chofer1</strong> / <strong>flota123</strong><br>
            Personal importado: legajo / ultimos 4 digitos del CUIL.
          </div>
        </div>
      </section>
    </div>
  `;

  document.getElementById("loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const user = authenticate(String(form.get("username") || "").trim(), String(form.get("password") || "").trim());
    if (!user) {
      document.getElementById("loginError").textContent = "Usuario o contrasena incorrectos.";
      return;
    }
    state.user = user;
    state.view = user.role === "admin" ? "dashboard" : "driver";
    sessionStorage.setItem("edesur-session", JSON.stringify(user));
    addAudit("login", user.username, "users", user.username);
    render();
  });
}

function authenticate(username, password) {
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
  return `
    ${topbar("Control de vehiculos", `<button class="btn secondary" data-action="reset">Restaurar datos base</button>`)}
    <div class="panel">
      ${toolbar()}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Dominio</th><th>Datos</th><th>Asignacion actual</th><th>Km</th><th>Alertas</th><th>Accion</th></tr></thead>
          <tbody>${vehicles.map(vehicleRow).join("")}</tbody>
        </table>
      </div>
    </div>
    ${state.vehicleId ? renderVehicleDetail(getVehicle(state.vehicleId)) : ""}
  `;
}

function renderVehicleDetail(vehicle) {
  if (!vehicle) return "";
  const assignments = runtime.assignments.filter((item) => item.vehicleId === vehicle.id).sort(sortDesc("startAt"));
  const incidents = getOpenIncidents(vehicle.id);
  const maintenance = runtime.maintenance.filter((item) => item.vehicleId === vehicle.id).sort(sortDesc("createdAt"));
  return `
    <section class="panel detail-panel">
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
      </div>
      <div class="grid-3">
        <div>
          <h4>Danos e irregularidades abiertas</h4>
          ${incidents.map(incidentMini).join("") || empty("Sin danos abiertos.")}
        </div>
        <div>
          <h4>Historial de uso</h4>
          ${assignments.slice(0, 6).map(assignmentMini).join("") || empty("Sin usos registrados.")}
        </div>
        <div>
          <h4>Mantenimiento</h4>
          ${maintenance.slice(0, 6).map(maintenanceMini).join("") || empty("Sin registros.")}
        </div>
      </div>
    </section>
  `;
}

function renderDrivers() {
  const query = normalize(state.query);
  const rows = runtime.people
    .filter((person) => !query || normalize([person.employeeId, person.name, person.area, person.role].join(" ")).includes(query))
    .slice(0, 120);
  return `
    ${topbar("Control de conductores")}
    <div class="panel">
      <div class="toolbar"><label class="field search"><span>Buscar</span><input data-filter="query" value="${escapeAttr(state.query)}" placeholder="Legajo, nombre, area, cargo"></label></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Legajo</th><th>Nombre</th><th>Area</th><th>Cargo</th><th>Usos</th><th>Actual</th></tr></thead>
          <tbody>${rows.map(driverRow).join("")}</tbody>
        </table>
      </div>
    </div>
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
  return `
    ${topbar("Mantenimiento")}
    <div class="panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Patente</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead>
          <tbody>${runtime.maintenance.sort(sortDesc("createdAt")).map((item) => `
            <tr><td>${formatDate(item.createdAt)}</td><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.detail)}</td><td>${statusTextBadge(item.status)}</td></tr>
          `).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReports() {
  const assignments = runtime.assignments.slice().sort(sortDesc("startAt"));
  const byVehicle = groupCount(assignments, "domain");
  const byDriver = groupCount(assignments, "driver");
  const totalKm = assignments.reduce((sum, item) => sum + Number(item.distance || 0), 0);
  return `
    ${topbar("Reportes", `<button class="btn" data-action="export">Exportar CSV</button>`)}
    <section class="grid-3">
      <div class="panel"><h3>Usos registrados</h3><strong class="big">${assignments.length}</strong><p class="muted">Asignaciones historicas.</p></div>
      <div class="panel"><h3>Kilometros cerrados</h3><strong class="big">${totalKm}</strong><p class="muted">Solo usos con devolucion.</p></div>
      <div class="panel"><h3>Danos abiertos</h3><strong class="big">${runtime.incidents.filter((i) => i.status === "open").length}</strong><p class="muted">Preexistentes para proximos conductores.</p></div>
    </section>
    <section class="grid-2" style="margin-top:16px">
      <div class="panel"><h3>Uso por vehiculo</h3>${miniTable(byVehicle, ["Patente", "Usos"])}</div>
      <div class="panel"><h3>Uso por conductor</h3>${miniTable(byDriver, ["Conductor", "Usos"])}</div>
    </section>
    <section class="panel" style="margin-top:16px">
      <h3>Historial completo</h3>
      <div class="table-wrap">${assignmentTable(assignments)}</div>
    </section>
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
      ${renderChecklist("start")}
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
      ${renderChecklist("end")}
      <label class="field"><span>Novedades, danos nuevos o faltantes</span><textarea name="endNotes" placeholder="Detalle cualquier dano nuevo, faltante, desperfecto o irregularidad."></textarea></label>
      <label class="confirm-line"><input name="returned" type="checkbox" required> Confirmo la devolucion del vehiculo con la informacion declarada.</label>
      <button class="btn" type="submit">Devolver vehiculo</button>
    </form>
  `;
}

function vehicleReceiptCard(vehicle, incidents) {
  const active = getActiveAssignmentByVehicle(vehicle.id);
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
      </div>
      ${active ? `<div class="notice danger">Actualmente asignado a ${escapeHtml(active.driver)} desde ${formatDateTime(active.startAt)}.</div>` : ""}
      <h4>Alertas y danos preexistentes</h4>
      <div class="vehicle-list slim">${incidents.map(incidentCard).join("") || empty("Sin danos preexistentes abiertos.")}</div>
    </section>
  `;
}

function renderChecklist(prefix) {
  return `
    <div>
      <div class="checklist-title">${prefix === "start" ? "Checklist inicial" : "Checklist final"}</div>
      <div class="checklist detailed">
        ${checklistTemplate.map(([category, items]) => `
          <section class="check-group">
            <h4>${category}</h4>
            ${items.map((item) => `
              <label class="check-row">
                <span>${item}</span>
                <select name="${prefix}_${slug(category)}_${slug(item)}">
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
    input.addEventListener("input", () => {
      state[input.dataset.filter] = input.value;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleAction(button.dataset.action, button));
  });

  const startForm = document.getElementById("startForm");
  if (startForm) startForm.addEventListener("submit", submitStartAssignment);

  const closeForm = document.getElementById("closeForm");
  if (closeForm) closeForm.addEventListener("submit", submitCloseAssignment);
}

function handleAction(action, button) {
  if (action === "logout") {
    addAudit("logout", state.user.username, "users", state.user.username);
    sessionStorage.removeItem("edesur-session");
    state.user = null;
    state.view = "dashboard";
    render();
  }
  if (action === "export") exportCsv();
  if (action === "reset") {
    localStorage.removeItem(storageKey);
    runtime = loadRuntime();
    toast("Datos restaurados.");
    render();
  }
  if (action === "vehicle-detail") {
    state.vehicleId = button.dataset.vehicleId;
    render();
  }
  if (action === "clear-detail") {
    state.vehicleId = "";
    render();
  }
}

function submitStartAssignment(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const vehicle = getVehicle(form.get("vehicleId"));
  if (!vehicle || vehicle.activeAssignmentId) return;

  const odometerStart = Number(form.get("odometerStart"));
  const checklist = readChecklist(form, "start");
  const severity = checklistSeverity(checklist);
  const preexisting = getOpenIncidents(vehicle.id);
  const now = new Date().toISOString();

  const assignment = {
    id: `A${Date.now()}`,
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    employeeId: state.user.employeeId,
    driver: state.user.name,
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
  if (severity !== "correcto" || assignment.startNotes.trim()) {
    createIncident(vehicle, assignment, "detected_at_start", "Novedad detectada al recibir", assignment.startNotes || "Checklist inicial con observaciones.", severity);
  }
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

function submitCloseAssignment(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const assignment = getActiveAssignmentForUser();
  if (!assignment) return;
  const vehicle = getVehicle(assignment.vehicleId);
  const odometerEnd = Number(form.get("odometerEnd"));
  const checklist = readChecklist(form, "end");
  const severity = checklistSeverity(checklist);
  const now = new Date().toISOString();

  assignment.endAt = now;
  assignment.odometerEnd = odometerEnd;
  assignment.distance = odometerEnd - assignment.odometerStart;
  assignment.locationEnd = String(form.get("locationEnd") || "");
  assignment.endChecklist = checklist;
  assignment.endNotes = String(form.get("endNotes") || "");
  assignment.status = "closed";

  if (severity !== "correcto" || assignment.endNotes.trim()) {
    createIncident(vehicle, assignment, "new_at_return", "Dano o novedad al devolver", assignment.endNotes || "Checklist final con observaciones.", severity);
  }

  const hasOpenIncidents = getOpenIncidents(vehicle.id).length > 0;
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

function readChecklist(form, prefix) {
  const values = {};
  checklistTemplate.forEach(([category, items]) => {
    items.forEach((item) => {
      values[`${category} - ${item}`] = String(form.get(`${prefix}_${slug(category)}_${slug(item)}`) || "correcto");
    });
  });
  return values;
}

function createIncident(vehicle, assignment, stage, title, description, severity) {
  runtime.incidents.push({
    id: `I${Date.now()}${runtime.incidents.length}`,
    vehicleId: vehicle.id,
    domain: vehicle.domain,
    assignmentId: assignment.id,
    reportedBy: assignment.driver,
    reportedAt: new Date().toISOString(),
    stage,
    title,
    description,
    status: "open",
    severity,
    source: "user",
  });
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
  });
  runtime.maintenance.filter((item) => item.status === "Pendiente").forEach((item) => {
    alerts.push({ type: "Mantenimiento", level: "advertencia", text: `${item.domain}: ${item.detail}`, at: item.createdAt });
  });
  return alerts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
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
  return `<header class="topbar"><div><h2>${title}</h2><p class="muted">Primera version operativa sin GPS. La localizacion queda como modulo opcional futuro.</p></div><div class="top-actions">${actions}</div></header>`;
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
      <tbody>${assignments.map((item) => `<tr><td>${escapeHtml(item.domain)}</td><td>${escapeHtml(item.driver)}</td><td>${formatDateTime(item.startAt)}</td><td>${formatDateTime(item.endAt)}</td><td>${item.odometerStart}</td><td>${item.odometerEnd ?? "-"}</td><td>${item.distance ?? "-"}</td><td>${statusTextBadge(item.status)}</td></tr>`).join("")}</tbody>
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
      <td><button class="btn secondary" data-action="vehicle-detail" data-vehicle-id="${vehicle.id}">Ver ficha</button></td>
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
  return `<div class="mini-record"><strong>${escapeHtml(item.type)}</strong> ${statusTextBadge(item.status)}<br><span class="muted">${escapeHtml(item.detail)}</span></div>`;
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
  const kind = normalized.includes("pendiente") || normalized.includes("active") ? "warn" : normalized.includes("open") ? "danger" : "ok";
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
  if (!vehicle.vtv) return "sin fecha";
  const today = new Date();
  const date = new Date(vehicle.vtv);
  const soon = new Date();
  soon.setDate(today.getDate() + 45);
  if (date < today) return "vencida";
  if (date <= soon) return "proxima";
  return "vigente";
}

function vtvBadge(vehicle) {
  const state = vtvState(vehicle);
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
  const rows = [
    ["patente", "conductor", "legajo", "inicio", "fin", "km_inicial", "km_final", "km_recorridos", "notas_inicio", "notas_fin"],
    ...runtime.assignments.map((item) => [item.domain, item.driver, item.employeeId, item.startAt, item.endAt || "", item.odometerStart, item.odometerEnd || "", item.distance || "", item.startNotes, item.endNotes]),
  ];
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-asignaciones-edesur-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function groupCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Sin dato";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sortDesc(key) {
  return (a, b) => String(b[key] || "").localeCompare(String(a[key] || ""));
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

init();
