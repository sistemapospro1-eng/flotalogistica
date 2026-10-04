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
      vth: "",
      documents: [],
      equipment: [],
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
      enteredAt: row.entered_at,
      retiredAt: row.retired_at,
      notes: row.notes || "",
    };
  }

  function mapDocument(row) {
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      type: row.document_type,
      number: row.document_number || "",
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      status: row.status || "",
      notes: row.notes || "",
      storagePath: row.storage_path || "",
    };
  }

  function mapEquipment(row) {
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      name: row.equipment_name,
      expected: row.expected,
      present: row.present,
      expiresAt: row.expires_at,
      notes: row.notes || "",
    };
  }

  function mapProfile(row) {
    return {
      id: row.id,
      displayName: row.display_name,
      username: row.username || "",
      role: row.role,
      isActive: row.is_active,
      employeeId: row.employee_id,
      employeeNumber: row.employees?.employee_number || "",
      employeeName: row.employees?.full_name || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapAuditLog(row) {
    return {
      id: row.id,
      actorId: row.actor_id,
      actorName: row.actor_profile?.display_name || "Sistema",
      action: row.action,
      entityName: row.entity_name,
      entityId: row.entity_id,
      oldData: row.old_data,
      newData: row.new_data,
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
    const [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult, documentsResult, equipmentResult, profilesResult, auditResult] = await Promise.all([
      client.from("vehicles").select("*").eq("is_active", true).order("domain"),
      client.from("employees").select("*").eq("is_active", true).order("full_name"),
      client.from("vehicle_assignments").select("*, vehicles(domain), employees(employee_number, full_name)").order("started_at", { ascending: false }).limit(500),
      client.from("vehicle_incidents").select("*, vehicles(domain), reported_by_profile:profiles!vehicle_incidents_reported_by_fkey(display_name)").order("created_at", { ascending: false }).limit(500),
      client.from("maintenance_records").select("*, vehicles(domain)").order("created_at", { ascending: false }).limit(2500),
      client.from("vehicle_documents").select("*").order("expires_at", { ascending: true }),
      client.from("vehicle_equipment").select("*").order("equipment_name", { ascending: true }),
      client.from("profiles").select("*, employees(employee_number, full_name)").order("display_name", { ascending: true }),
      client.from("audit_logs").select("*, actor_profile:profiles!audit_logs_actor_id_fkey(display_name)").order("created_at", { ascending: false }).limit(500),
    ]);

    const firstError = [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult, documentsResult, equipmentResult].find((result) => result.error);
    if (firstError) throw firstError.error;

    const assignments = assignmentsResult.data.map(mapAssignment);
    const documents = documentsResult.data.map(mapDocument);
    const equipment = equipmentResult.data.map(mapEquipment);
    const documentsByVehicle = groupBy(documents, "vehicleId");
    const equipmentByVehicle = groupBy(equipment, "vehicleId");
    const activeByVehicle = new Map(assignments.filter((item) => item.status === "active").map((item) => [item.vehicleId, item]));
    const vehicles = vehiclesResult.data.map(mapVehicle).map((vehicle) => {
      const active = activeByVehicle.get(vehicle.id);
      const vehicleDocuments = documentsByVehicle[vehicle.id] || [];
      const vtv = vehicleDocuments.find((item) => normalize(item.type) === "vtv");
      const vth = vehicleDocuments.find((item) => normalize(item.type) === "vth");
      const enriched = {
        ...vehicle,
        documents: vehicleDocuments,
        equipment: equipmentByVehicle[vehicle.id] || [],
        vtv: vtv?.expiresAt || "",
        vth: vth?.expiresAt || "",
      };
      return active ? { ...enriched, status: "active", driver: active.driver, activeAssignmentId: active.id } : enriched;
    });

    return {
      vehicles,
      people: employeesResult.data.map(mapEmployee),
      assignments,
      incidents: incidentsResult.data.map(mapIncident),
      maintenance: maintenanceResult.data.map(mapMaintenance),
      documents,
      equipment,
      profiles: profilesResult.error ? [] : profilesResult.data.map(mapProfile),
      auditLogs: auditResult.error ? [] : auditResult.data.map(mapAuditLog),
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

  async function saveVehicle(vehicle) {
    if (!enabled) return vehicle;
    const payload = {
      domain: vehicle.domain,
      internal_code: vehicle.internal || null,
      model: vehicle.model || null,
      vehicle_type: vehicle.type || null,
      company: vehicle.company || null,
      area: vehicle.area || null,
      sector: vehicle.sector || null,
      odometer: vehicle.odometer || 0,
      status: reverseStatusMap[vehicle.status] || "available",
      is_active: true,
      source: "app",
    };

    const query = vehicle.id
      ? client.from("vehicles").update(payload).eq("id", vehicle.id).select("*").single()
      : client.from("vehicles").insert(payload).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapVehicle(data);
  }

  async function deactivateVehicle(vehicleId) {
    if (!enabled) return;
    const { error } = await client.from("vehicles").update({ is_active: false, status: "inactive" }).eq("id", vehicleId);
    if (error) throw error;
  }

  async function saveEmployee(person) {
    if (!enabled) return person;
    const payload = {
      employee_number: person.employeeId,
      full_name: person.name,
      area: person.area || null,
      role_title: person.role || null,
      is_active: true,
      source: "app",
    };

    const query = person.employeeUuid || person.id
      ? client.from("employees").update(payload).eq("id", person.employeeUuid || person.id).select("*").single()
      : client.from("employees").insert(payload).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapEmployee(data);
  }

  async function updateProfileRole(profileId, role) {
    if (!enabled) return;
    const { data, error } = await client
      .from("profiles")
      .update({ role })
      .eq("id", profileId)
      .select("*, employees(employee_number, full_name)")
      .single();
    if (error) throw error;
    return mapProfile(data);
  }

  function groupBy(items, key) {
    return items.reduce((acc, item) => {
      const value = item[key];
      if (!acc[value]) acc[value] = [];
      acc[value].push(item);
      return acc;
    }, {});
  }

  function normalize(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
    saveVehicle,
    deactivateVehicle,
    saveEmployee,
    updateProfileRole,
  };
})();
