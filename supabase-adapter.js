(function () {
  const config = window.APP_CONFIG || {};
  const enabled = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase);
  const client = enabled ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;

  const statusMap = {
    available: "available",
    in_use: "active",
    observed: "alert",
    out_of_service: "alert",
    maintenance: "alert",
    inactive: "idle",
  };

  const reverseStatusMap = {
    available: "available",
    active: "in_use",
    alert: "observed",
    idle: "available",
  };

  const severityMap = {
    info: "correcto",
    warning: "advertencia",
    critical: "critica",
  };

  const reverseSeverityMap = {
    correcto: "info",
    advertencia: "warning",
    critica: "critical",
  };

  function mapVehicle(row) {
    return {
      id: row.id,
      domain: row.domain,
      internal: row.internal_code || "",
      model: row.model || "",
      type: row.vehicle_type || "",
      company: row.company || "",
      area: row.area || "",
      sector: row.sector || "",
      odometer: row.odometer || 0,
      status: statusMap[row.status] || "available",
      activeAssignmentId: "",
      driver: "",
      vtv: "",
      raw: row,
    };
  }

  function mapEmployee(row) {
    return {
      id: row.id,
      employeeId: row.employee_number,
      employeeUuid: row.id,
      name: row.full_name,
      area: row.area || "",
      role: row.role_title || "",
      isActive: row.is_active,
    };
  }

  function mapAssignment(row) {
    const vehicle = row.vehicles || {};
    const employee = row.employees || {};
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      domain: vehicle.domain || "",
      employeeUuid: row.employee_id,
      employeeId: employee.employee_number || row.employee_id,
      driver: employee.full_name || "Conductor",
      startAt: row.started_at,
      endAt: row.ended_at,
      odometerStart: row.odometer_start,
      odometerEnd: row.odometer_end,
      distance: row.distance_km,
      locationStart: row.start_location_text || "",
      locationEnd: row.end_location_text || "",
      startChecklist: {},
      endChecklist: {},
      startNotes: row.start_notes || "",
      endNotes: row.end_notes || "",
      acceptedAt: row.accepted_at,
      preexistingIncidentIds: [],
      status: row.status === "closed" ? "closed" : "active",
    };
  }

  function mapIncident(row) {
    const vehicle = row.vehicles || {};
    const reporter = row.reported_by_profile || {};
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      domain: vehicle.domain || "",
      assignmentId: row.assignment_id || "",
      reportedBy: reporter.display_name || "Usuario",
      reportedAt: row.created_at,
      stage: row.stage,
      title: row.title,
      description: row.description || "",
      status: row.status === "resolved" ? "closed" : "open",
      severity: severityMap[row.severity] || "advertencia",
      source: "supabase",
    };
  }

  function mapMaintenance(row) {
    const vehicle = row.vehicles || {};
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      domain: vehicle.domain || "",
      type: row.maintenance_type || "Mantenimiento",
      status: row.status === "finished" ? "Finalizado" : "Pendiente",
      detail: row.detail || "",
      createdAt: row.created_at,
    };
  }

  async function currentProfile() {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) return null;

    const { data, error } = await client
      .from("profiles")
      .select("id, role, display_name, is_active, employee_id, employees(id, employee_number, full_name)")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (error || !data || !data.is_active) return null;
    return {
      role: data.role === "driver" ? "driver" : "admin",
      appRole: data.role,
      name: data.display_name,
      username: authData.user.email,
      employeeId: data.employees?.employee_number || data.employee_id || authData.user.id,
      employeeUuid: data.employee_id,
      profileId: data.id,
    };
  }

  async function loadRuntime() {
    const [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult] = await Promise.all([
      client.from("vehicles").select("*").eq("is_active", true).order("domain"),
      client.from("employees").select("*").eq("is_active", true).order("full_name"),
      client.from("vehicle_assignments").select("*, vehicles(domain), employees(employee_number, full_name)").order("started_at", { ascending: false }).limit(500),
      client.from("vehicle_incidents").select("*, vehicles(domain), reported_by_profile:profiles!vehicle_incidents_reported_by_fkey(display_name)").order("created_at", { ascending: false }).limit(500),
      client.from("maintenance_records").select("*, vehicles(domain)").order("created_at", { ascending: false }).limit(300),
    ]);

    const firstError = [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult].find((result) => result.error);
    if (firstError) throw firstError.error;

    const assignments = assignmentsResult.data.map(mapAssignment);
    const activeByVehicle = new Map(assignments.filter((item) => item.status === "active").map((item) => [item.vehicleId, item]));
    const vehicles = vehiclesResult.data.map(mapVehicle).map((vehicle) => {
      const active = activeByVehicle.get(vehicle.id);
      return active ? { ...vehicle, status: "active", driver: active.driver, activeAssignmentId: active.id } : vehicle;
    });

    return {
      vehicles,
      people: employeesResult.data.map(mapEmployee),
      assignments,
      incidents: incidentsResult.data.map(mapIncident),
      maintenance: maintenanceResult.data.map(mapMaintenance),
      auditLogs: [],
    };
  }

  async function signIn(username, password) {
    if (!enabled) return null;
    if (!username.includes("@")) {
      throw new Error("En modo Supabase el ingreso usa email y contrasena. Luego se puede agregar login por legajo con una API segura.");
    }
    const { error } = await client.auth.signInWithPassword({ email: username, password });
    if (error) throw error;
    return currentProfile();
  }

  async function signOut() {
    if (enabled) await client.auth.signOut();
  }

  async function saveAssignmentStarted(assignment, vehicle, severity) {
    if (!enabled || !assignment.employeeUuid) return;
    const { error } = await client.from("vehicle_assignments").insert({
      id: assignment.id,
      vehicle_id: assignment.vehicleId,
      employee_id: assignment.employeeUuid,
      started_by: assignment.startedBy,
      status: "active",
      started_at: assignment.startAt,
      odometer_start: assignment.odometerStart,
      start_location_text: assignment.locationStart,
      start_notes: assignment.startNotes,
      accepted_at: assignment.acceptedAt,
      odometer_warning: assignment.odometerWarning,
    });
    if (error) throw error;

    await client.from("vehicles").update({
      status: reverseStatusMap[severity === "critica" ? "alert" : "active"],
      odometer: assignment.odometerStart,
    }).eq("id", vehicle.id);
  }

  async function saveAssignmentClosed(assignment, vehicle, hasOpenIncidents) {
    if (!enabled) return;
    const { error } = await client.from("vehicle_assignments").update({
      status: "closed",
      ended_at: assignment.endAt,
      odometer_end: assignment.odometerEnd,
      end_location_text: assignment.locationEnd,
      end_notes: assignment.endNotes,
      closed_by: assignment.closedBy,
    }).eq("id", assignment.id);
    if (error) throw error;

    await client.from("vehicles").update({
      status: hasOpenIncidents ? "observed" : "available",
      odometer: assignment.odometerEnd,
    }).eq("id", vehicle.id);
  }

  async function saveIncident(incident) {
    if (!enabled) return;
    const { error } = await client.from("vehicle_incidents").insert({
      id: incident.id,
      vehicle_id: incident.vehicleId,
      assignment_id: incident.assignmentId || null,
      reported_by: incident.reportedById || null,
      stage: incident.stage,
      title: incident.title,
      description: incident.description,
      severity: reverseSeverityMap[incident.severity] || "warning",
      status: "open",
      created_at: incident.reportedAt,
    });
    if (error) throw error;
  }

  window.fleetSupabase = {
    isEnabled: () => enabled,
    client,
    currentProfile,
    loadRuntime,
    signIn,
    signOut,
    saveAssignmentStarted,
    saveAssignmentClosed,
    saveIncident,
  };
})();
