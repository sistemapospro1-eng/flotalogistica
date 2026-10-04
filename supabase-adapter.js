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
      status: row.status === "finished" ? "Finalizado" : row.status === "in_repair" ? "En curso" : row.status === "cancelled" ? "Cancelado" : "Pendiente",
      statusValue: row.status,
      provider: row.provider || "",
      workshop: row.workshop || "",
      detail: row.detail || "",
      cost: row.cost,
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

  function mapPhoto(row) {
    return {
      id: row.id,
      vehicleId: row.vehicle_id,
      assignmentId: row.assignment_id,
      inspectionId: row.inspection_id,
      incidentId: row.incident_id,
      storageBucket: row.storage_bucket || "vehicle-evidence",
      storagePath: row.storage_path,
      photoType: row.photo_type,
      description: row.description || "",
      fileName: row.file_name || "",
      mimeType: row.mime_type || "",
      fileSize: row.file_size || 0,
      uploadedBy: row.uploaded_by,
      createdAt: row.created_at,
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

  function mapChecklistTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      vehicleType: row.vehicle_type || "",
      stage: row.stage,
      isActive: row.is_active,
    };
  }

  function mapChecklistItem(row) {
    return {
      id: row.id,
      templateId: row.template_id,
      stage: row.checklist_templates?.stage || row.stage || "",
      category: row.category,
      label: row.label,
      appliesToVehicleType: row.applies_to_vehicle_type || "",
      sortOrder: row.sort_order || 0,
      isActive: row.is_active,
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
    const [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult, documentsResult, equipmentResult, photosResult, profilesResult, auditResult, checklistTemplatesResult, checklistItemsResult] = await Promise.all([
      client.from("vehicles").select("*").eq("is_active", true).order("domain"),
      client.from("employees").select("*").eq("is_active", true).order("full_name"),
      client.from("vehicle_assignments").select("*, vehicles(domain), employees(employee_number, full_name)").order("started_at", { ascending: false }).limit(500),
      client.from("vehicle_incidents").select("*, vehicles(domain), reported_by_profile:profiles!vehicle_incidents_reported_by_fkey(display_name)").order("created_at", { ascending: false }).limit(500),
      client.from("maintenance_records").select("*, vehicles(domain)").order("created_at", { ascending: false }).limit(2500),
      client.from("vehicle_documents").select("*").order("expires_at", { ascending: true }),
      client.from("vehicle_equipment").select("*").order("equipment_name", { ascending: true }),
      client.from("vehicle_photos").select("*").order("created_at", { ascending: false }),
      client.from("profiles").select("*, employees(employee_number, full_name)").order("display_name", { ascending: true }),
      client.from("audit_logs").select("*, actor_profile:profiles!audit_logs_actor_id_fkey(display_name)").order("created_at", { ascending: false }).limit(500),
      client.from("checklist_templates").select("*").order("stage", { ascending: true }),
      client.from("checklist_items").select("*, checklist_templates(stage)").order("sort_order", { ascending: true }),
    ]);

    const firstError = [vehiclesResult, employeesResult, assignmentsResult, incidentsResult, maintenanceResult, documentsResult, equipmentResult, photosResult, checklistTemplatesResult, checklistItemsResult].find((result) => result.error);
    if (firstError) throw firstError.error;

    const assignments = assignmentsResult.data.map(mapAssignment);
    const documents = documentsResult.data.map(mapDocument);
    const equipment = equipmentResult.data.map(mapEquipment);
    const photos = photosResult.data.map(mapPhoto);
    const documentsByVehicle = groupBy(documents, "vehicleId");
    const equipmentByVehicle = groupBy(equipment, "vehicleId");
    const photosByVehicle = groupBy(photos, "vehicleId");
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
        photos: photosByVehicle[vehicle.id] || [],
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
      photos,
      profiles: profilesResult.error ? [] : profilesResult.data.map(mapProfile),
      auditLogs: auditResult.error ? [] : auditResult.data.map(mapAuditLog),
      checklistTemplates: checklistTemplatesResult.data.map(mapChecklistTemplate),
      checklistItems: checklistItemsResult.data.map(mapChecklistItem),
    };
  }

  async function signIn(username, password) {
    if (!enabled) return null;
    const login = String(username || "").trim();
    const email = login.includes("@") ? login : `${login}@flotalogistica.local`;
    const { error } = await client.auth.signInWithPassword({ email, password });
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

  async function saveDocument(documentItem) {
    if (!enabled) return documentItem;
    const payload = {
      vehicle_id: documentItem.vehicleId,
      document_type: documentItem.type,
      document_number: documentItem.number || null,
      expires_at: documentItem.expiresAt || null,
      status: documentItem.status || null,
      notes: documentItem.notes || null,
    };
    const query = documentItem.id
      ? client.from("vehicle_documents").update(payload).eq("id", documentItem.id).select("*").single()
      : client.from("vehicle_documents").insert(payload).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapDocument(data);
  }

  async function saveEquipment(equipmentItem) {
    if (!enabled) return equipmentItem;
    const payload = {
      vehicle_id: equipmentItem.vehicleId,
      equipment_name: equipmentItem.name,
      expected: equipmentItem.expected,
      present: equipmentItem.present,
      expires_at: equipmentItem.expiresAt || null,
      notes: equipmentItem.notes || null,
    };
    const query = equipmentItem.id
      ? client.from("vehicle_equipment").update(payload).eq("id", equipmentItem.id).select("*").single()
      : client.from("vehicle_equipment").insert(payload).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapEquipment(data);
  }

  async function saveMaintenance(record) {
    if (!enabled) return record;
    const payload = {
      vehicle_id: record.vehicleId,
      status: record.statusValue || reverseMaintenanceStatus(record.status),
      maintenance_type: record.type || null,
      provider: record.provider || null,
      workshop: record.workshop || null,
      detail: record.detail,
      cost: record.cost ?? null,
      entered_at: record.enteredAt || null,
      retired_at: record.retiredAt || null,
      notes: record.notes || null,
    };
    const query = record.id
      ? client.from("maintenance_records").update(payload).eq("id", record.id).select("*, vehicles(domain)").single()
      : client.from("maintenance_records").insert(payload).select("*, vehicles(domain)").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapMaintenance(data);
  }

  async function uploadVehicleEvidence(photo, file) {
    if (!enabled) return photo;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "archivo";
    const path = `vehicles/${photo.vehicleId}/${Date.now()}-${safeName}`;
    const upload = await client.storage
      .from("vehicle-evidence")
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (upload.error) throw upload.error;

    const { data: authData } = await client.auth.getUser();
    const { data, error } = await client
      .from("vehicle_photos")
      .insert({
        vehicle_id: photo.vehicleId,
        storage_path: path,
        photo_type: photo.photoType,
        description: photo.description || null,
        file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size || null,
        uploaded_by: authData.user?.id || null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapPhoto(data);
  }

  async function createEvidenceUrl(storagePath) {
    if (!enabled || !storagePath) return "";
    const { data, error } = await client.storage
      .from("vehicle-evidence")
      .createSignedUrl(storagePath, 60);
    if (error) throw error;
    return data.signedUrl;
  }

  async function updateProfileRole(profileId, role) {
    if (!enabled) return;
    return updateProfile({ id: profileId, role });
  }

  async function updateProfile(profile) {
    if (!enabled) return profile;
    const payload = {};
    if (profile.role) payload.role = profile.role;
    if ("employeeId" in profile) payload.employee_id = profile.employeeId || null;
    if ("isActive" in profile) payload.is_active = profile.isActive;
    const { data, error } = await client
      .from("profiles")
      .update(payload)
      .eq("id", profile.id)
      .select("*, employees(employee_number, full_name)")
      .single();
    if (error) throw error;
    return mapProfile(data);
  }

  async function createDriverUsers(payload) {
    if (!enabled) return { created: [], linked: [], existing: [], skipped: [], errors: [] };
    const { data, error } = await client.functions.invoke("create-driver-users", {
      body: payload,
    });
    if (error) throw error;
    return data;
  }

  async function saveChecklistItem(item) {
    if (!enabled) return item;
    const payload = {
      template_id: item.templateId,
      category: item.category,
      label: item.label,
      applies_to_vehicle_type: item.appliesToVehicleType || null,
      sort_order: item.sortOrder || 0,
      is_active: item.isActive,
    };
    const query = item.id
      ? client.from("checklist_items").update(payload).eq("id", item.id).select("*, checklist_templates(stage)").single()
      : client.from("checklist_items").insert(payload).select("*, checklist_templates(stage)").single();
    const { data, error } = await query;
    if (error) throw error;
    return mapChecklistItem(data);
  }

  function groupBy(items, key) {
    return items.reduce((acc, item) => {
      const value = item[key];
      if (!acc[value]) acc[value] = [];
      acc[value].push(item);
      return acc;
    }, {});
  }

  function reverseMaintenanceStatus(label) {
    const normalized = normalize(label);
    if (normalized.includes("curso") || normalized.includes("repair")) return "in_repair";
    if (normalized.includes("final")) return "finished";
    if (normalized.includes("cancel")) return "cancelled";
    return "pending";
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
    saveDocument,
    saveEquipment,
    saveMaintenance,
    uploadVehicleEvidence,
    createEvidenceUrl,
    updateProfileRole,
    updateProfile,
    createDriverUsers,
    saveChecklistItem,
  };
})();
