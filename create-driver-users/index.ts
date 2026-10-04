import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Employee = {
  id: string;
  employee_number: string | null;
  full_name: string | null;
  is_active: boolean | null;
};

type ResultItem = {
  employeeId: string;
  employeeNumber: string;
  email: string;
  profileId?: string;
  reason?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Metodo no permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Faltan variables de entorno de Supabase." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return json({ error: "Sesion no valida." }, 401);
  }

  const { data: callerProfile, error: profileError } = await serviceClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", authData.user.id)
    .single();

  if (profileError || !callerProfile?.is_active || !["admin", "super_admin"].includes(callerProfile.role)) {
    return json({ error: "No tenes permiso para crear usuarios." }, 403);
  }

  let body: { defaultPassword?: string; employeeIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud invalida." }, 400);
  }

  const defaultPassword = String(body.defaultPassword || "");
  if (defaultPassword.length < 8) {
    return json({ error: "La contraseña inicial debe tener al menos 8 caracteres." }, 400);
  }

  let employeesQuery = serviceClient
    .from("employees")
    .select("id, employee_number, full_name, is_active")
    .eq("is_active", true)
    .order("employee_number", { ascending: true });

  if (Array.isArray(body.employeeIds) && body.employeeIds.length) {
    employeesQuery = employeesQuery.in("id", body.employeeIds);
  }

  const { data: employees, error: employeesError } = await employeesQuery;
  if (employeesError) return json({ error: employeesError.message }, 500);

  const { data: profiles, error: profilesError } = await serviceClient
    .from("profiles")
    .select("id, employee_id, username");

  if (profilesError) return json({ error: profilesError.message }, 500);

  const linkedEmployeeIds = new Set((profiles || []).map((profile) => profile.employee_id).filter(Boolean));
  const created: ResultItem[] = [];
  const linked: ResultItem[] = [];
  const existing: ResultItem[] = [];
  const skipped: ResultItem[] = [];
  const errors: ResultItem[] = [];

  for (const employee of (employees || []) as Employee[]) {
    const employeeNumber = String(employee.employee_number || "").trim();
    if (!employeeNumber) {
      skipped.push({ employeeId: employee.id, employeeNumber: "", email: "", reason: "Sin legajo." });
      continue;
    }

    if (linkedEmployeeIds.has(employee.id)) {
      skipped.push({
        employeeId: employee.id,
        employeeNumber,
        email: driverEmail(employeeNumber),
        reason: "Ya tiene usuario vinculado.",
      });
      continue;
    }

    const email = driverEmail(employeeNumber);
    let authUserId = "";
    let wasCreated = false;

    const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: {
        employee_number: employeeNumber,
        full_name: employee.full_name || "",
      },
    });

    if (createData?.user?.id) {
      authUserId = createData.user.id;
      wasCreated = true;
    } else if (isAlreadyRegistered(createError?.message)) {
      const found = await findUserByEmail(serviceClient, email);
      if (found?.id) authUserId = found.id;
    } else {
      errors.push({
        employeeId: employee.id,
        employeeNumber,
        email,
        reason: createError?.message || "No se pudo crear el usuario.",
      });
      continue;
    }

    if (!authUserId) {
      errors.push({ employeeId: employee.id, employeeNumber, email, reason: "No se encontro el usuario Auth." });
      continue;
    }

    const { error: upsertError } = await serviceClient
      .from("profiles")
      .upsert({
        id: authUserId,
        employee_id: employee.id,
        username: employeeNumber,
        role: "driver",
        display_name: employee.full_name || `Chofer ${employeeNumber}`,
        is_active: true,
      }, { onConflict: "id" });

    if (upsertError) {
      errors.push({ employeeId: employee.id, employeeNumber, email, profileId: authUserId, reason: upsertError.message });
      continue;
    }

    const item = { employeeId: employee.id, employeeNumber, email, profileId: authUserId };
    if (wasCreated) created.push(item);
    else {
      existing.push(item);
      linked.push(item);
    }
  }

  return json({ created, linked, existing, skipped, errors });
});

function driverEmail(employeeNumber: string) {
  return `${employeeNumber.trim().toLowerCase()}@flotalogistica.local`;
}

function isAlreadyRegistered(message = "") {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("registered") || normalized.includes("exists");
}

async function findUserByEmail(serviceClient: ReturnType<typeof createClient>, email: string) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
