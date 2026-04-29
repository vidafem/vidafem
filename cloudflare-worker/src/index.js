const SESSION_TTL_DEFAULT_SECONDS = 21600;
const WORKER_STORAGE_ROUTE_PREFIX = "/files/";
const WORKER_STORAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const LOCAL_ACTIONS = new Set([
  "login",
  "logout",
  "me",
  "first_login_keep",
  "first_login_update_password",
  "self_update_password",
  "get_data",
  "create_record",
  "update_record",
  "delete_record",
  "get_doctor_patients",
  "get_patient_profile",
  "get_history",
  "save_history",
  "get_patient_appointments",
  "get_dashboard_stats",
  "get_agenda",
  "get_agenda_month_summary",
  "get_week_appointments",
  "get_service_config",
  "save_service_full",
  "delete_service_full",
  "add_service",
  "update_service",
  "delete_service",
  "save_diagnosis_advanced",
  "get_diagnosis_history",
  "get_diagnosis_report",
  "delete_diagnosis_asset",
  "delete_diagnosis",
  "delete_bulk_diagnosis",
  "get_patient_evolution",
  "save_patient_evolution",
  "delete_patient_evolution",
  "delete_bulk_patient_evolution",
  "get_services",
  "get_taken_slots",
  "schedule_appointment",
  "reschedule_appointment",
  "update_appt_status",
  "delete_cita",
  "delete_bulk_citas",
  "self_update_patient_profile",
  "self_update_admin_profile",
  "get_my_doctor_info",
  "set_my_vacation",
  "get_my_vacation",
  "get_my_doctor_vacation",
  "get_file_base64",
  "save_promotion",
  "get_active_promotion",
  "get_promo_list",
  "delete_promotion",
  "save_infographic_post",
  "get_infographic_posts_admin",
  "delete_infographic_post",
  "get_patient_infographics",
  "superadmin_get_data",
  "superadmin_update_doctor",
  "superadmin_create_doctor",
  "superadmin_delete_doctor",
  "superadmin_assign_patient_doctor",
  "superadmin_update_patient_password",
  "superadmin_update_patient_management",
  "superadmin_delete_patient",
  "health",
  "ping",
  "get_p12_status",
  "upload_p12",
  "delete_p12",
  "sign_existing_diagnosis_asset"
]);

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") {
        return buildPreflightResponse(request, env);
      }

      if (request.method === "GET") {
        return handleGet(request, env, url);
      }

      if (request.method === "POST") {
        return handlePost(request, env, url);
      }

      return jsonResponse(
        request,
        env,
        { success: false, message: "Metodo no permitido." },
        405
      );
    } catch (error) {
      return jsonResponse(
        request,
        env,
        {
          success: false,
          message: "Error inesperado en el Worker.",
          detail: toErrorMessage(error)
        },
        500
      );
    }
  }
};

async function handleGet(request, env, url) {
  const pathname = normalizePath_(url.pathname);
  if (pathname.indexOf(WORKER_STORAGE_ROUTE_PREFIX) === 0) {
    return handleGetStoredAsset_(request, env, pathname);
  }

  const action = normalizeText_(url.searchParams.get("action"));
  if (pathname === "/health" || action === "health" || action === "ping" || !pathname || pathname === "/") {
    const target = String(env.APPS_SCRIPT_API_URL || "").trim();
    return jsonResponse(request, env, {
      success: true,
      method: "GET",
      service: "VIDAFEM Cloudflare Worker API",
      backend: "worker",
      generated_at: new Date().toISOString(),
      supabase_ready: !!String(env.SUPABASE_URL || "").trim() && !!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
      r2_ready: hasWorkerStorageBinding_(env),
      proxy_ready: !!target,
      proxy_target: target ? maskUrlForHealth_(target) : ""
    });
  }

  return jsonResponse(request, env, { success: false, message: "Ruta no encontrada." }, 404);
}

async function handleGetStoredAsset_(request, env, pathname) {
  const bucket = getWorkerStorageBucket_(env);
  if (!bucket) {
    return jsonResponse(request, env, { success: false, message: "Cloudflare R2 no esta configurado en el Worker." }, 500);
  }

  const objectKey = decodeStorageObjectPath_(String(pathname || "").substring(WORKER_STORAGE_ROUTE_PREFIX.length));
  if (!objectKey) {
    return jsonResponse(request, env, { success: false, message: "Archivo no encontrado." }, 404);
  }

  let object = null;
  try {
    object = await bucket.get(objectKey);
  } catch (error) {
    return jsonResponse(request, env, { success: false, message: "No se pudo leer el archivo almacenado." }, 500);
  }

  if (!object) {
    return jsonResponse(request, env, { success: false, message: "Archivo no encontrado." }, 404);
  }

  const headers = buildCorsHeaders_(request, env);
  if (typeof object.writeHttpMetadata === "function") {
    object.writeHttpMetadata(headers);
  }
  if (!headers.get("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  if (!headers.get("cache-control")) {
    headers.set("cache-control", WORKER_STORAGE_CACHE_CONTROL);
  }
  if ((headers.get("content-type") || "").indexOf("application/pdf") === 0 && !headers.get("content-disposition")) {
    headers.set("content-disposition", "inline");
  }
  if (object.httpEtag) headers.set("etag", object.httpEtag);

  return new Response(object.body, {
    status: 200,
    headers
  });
}

async function handlePost(request, env, url) {
  const body = await readJsonBody_(request);
  if (!body || typeof body !== "object") {
    return jsonResponse(request, env, { success: false, message: "JSON invalido." }, 400);
  }

  const action = normalizeText_(body.action).toLowerCase();
  if (!action) {
    return jsonResponse(request, env, { success: false, message: "Falta action." }, 400);
  }

  if (LOCAL_ACTIONS.has(action)) {
    const response = await handleLocalAction_(action, body, env, url);
    return jsonResponse(request, env, response.payload, response.status);
  }

  const proxied = await proxyToAppsScript_(body, env);
  return jsonResponse(request, env, proxied.payload, proxied.status);
}

async function handleLocalAction_(action, body, env, url) {
  switch (action) {
    case "login":
      return handleLogin_(body, env);
    case "logout":
      return handleLogout_(body, env);
    case "me":
      return handleMe_(body, env);
    case "first_login_keep":
      return handleFirstLoginKeep_(body, env);
    case "first_login_update_password":
      return handleFirstLoginUpdatePassword_(body, env);
    case "self_update_password":
      return handleSelfUpdatePassword_(body, env);
    case "get_data":
      return handleGetData_(body, env);
    case "create_record":
      return handleCreateRecord_(body, env);
    case "update_record":
      return handleUpdateRecord_(body, env);
    case "delete_record":
      return handleDeleteRecord_(body, env);
    case "get_doctor_patients":
      return handleGetDoctorPatients_(body, env);
    case "get_patient_profile":
      return handleGetPatientProfile_(body, env);
    case "get_history":
      return handleGetHistory_(body, env);
    case "save_history":
      return handleSaveHistory_(body, env);
    case "get_patient_appointments":
      return handleGetPatientAppointments_(body, env);
    case "get_dashboard_stats":
      return handleGetDashboardStats_(body, env);
    case "get_agenda":
      return handleGetAgenda_(body, env);
    case "get_agenda_month_summary":
      return handleGetAgendaMonthSummary_(body, env);
    case "get_week_appointments":
      return handleGetWeekAppointments_(body, env);
    case "get_service_config":
      return handleGetServiceConfig_(body, env);
    case "save_service_full":
      return handleSaveServiceFull_(body, env);
    case "delete_service_full":
      return handleDeleteServiceFull_(body, env);
    case "add_service":
      return handleAddService_(body, env);
    case "update_service":
      return handleUpdateService_(body, env);
    case "delete_service":
      return handleDeleteServiceById_(body, env);
    case "save_diagnosis_advanced":
      return handleSaveDiagnosisAdvanced_(body, env, url);
    case "get_diagnosis_history":
      return handleGetDiagnosisHistory_(body, env);
    case "get_diagnosis_report":
      return handleGetDiagnosisReport_(body, env);
    case "delete_diagnosis_asset":
      return handleDeleteDiagnosisAsset_(body, env);
    case "delete_diagnosis":
      return handleDeleteDiagnosis_(body, env);
    case "delete_bulk_diagnosis":
      return handleDeleteBulkDiagnosis_(body, env);
    case "get_patient_evolution":
      return handleGetPatientEvolution_(body, env);
    case "save_patient_evolution":
      return handleSavePatientEvolution_(body, env);
    case "delete_patient_evolution":
      return handleDeletePatientEvolution_(body, env);
    case "delete_bulk_patient_evolution":
      return handleDeleteBulkPatientEvolution_(body, env);
    case "get_services":
      return handleGetServices_(body, env);
    case "get_taken_slots":
      return handleGetTakenSlots_(body, env);
    case "schedule_appointment":
      return handleScheduleAppointment_(body, env);
    case "reschedule_appointment":
      return handleRescheduleAppointment_(body, env);
    case "update_appt_status":
      return handleUpdateApptStatus_(body, env);
    case "delete_cita":
      return handleDeleteCita_(body, env);
    case "delete_bulk_citas":
      return handleDeleteBulkCitas_(body, env);
    case "self_update_patient_profile":
      return handleSelfUpdatePatientProfile_(body, env);
    case "self_update_admin_profile":
      return handleSelfUpdateAdminProfile_(body, env);
    case "get_my_doctor_info":
      return handleGetMyDoctorInfo_(body, env);
    case "set_my_vacation":
      return handleSetMyVacation_(body, env);
    case "get_my_vacation":
      return handleGetMyVacation_(body, env);
    case "get_my_doctor_vacation":
      return handleGetMyDoctorVacation_(body, env);
    case "get_file_base64":
      return handleGetFileBase64_(body, env);
    case "save_promotion":
      return handleSavePromotion_(body, env);
    case "get_active_promotion":
      return handleGetActivePromotion_(body, env);
    case "get_promo_list":
      return handleGetPromoList_(body, env);
    case "delete_promotion":
      return handleDeletePromotion_(body, env);
    case "save_infographic_post":
      return handleSaveInfographicPost_(body, env, url);
    case "get_infographic_posts_admin":
      return handleGetInfographicPostsAdmin_(body, env);
    case "delete_infographic_post":
      return handleDeleteInfographicPost_(body, env);
    case "get_patient_infographics":
      return handleGetPatientInfographics_(body, env);
    case "superadmin_get_data":
      return handleSuperadminGetData_(body, env);
    case "superadmin_update_doctor":
      return handleSuperadminUpdateDoctor_(body, env);
    case "superadmin_create_doctor":
      return handleSuperadminCreateDoctor_(body, env);
    case "superadmin_delete_doctor":
      return handleSuperadminDeleteDoctor_(body, env);
    case "superadmin_assign_patient_doctor":
      return handleSuperadminAssignPatientDoctor_(body, env);
    case "superadmin_update_patient_password":
      return handleSuperadminUpdatePatientPassword_(body, env);
    case "superadmin_update_patient_management":
      return handleSuperadminUpdatePatientManagement_(body, env);
    case "superadmin_delete_patient":
      return handleSuperadminDeletePatient_(body, env);
    case "health":
    case "ping":
      return {
        status: 200,
        payload: {
          success: true,
          backend: "worker",
          generated_at: new Date().toISOString()
        }
      };
    case "get_p12_status":
      return handleGetP12Status_(body, env);
    case "upload_p12":
      return handleUploadP12_(body, env);
    case "delete_p12":
      return handleDeleteP12_(body, env);
    case "sign_existing_diagnosis_asset":
      return handleSignExistingDiagnosisAsset_(body, env, url);
    default:
      return {
        status: 501,
        payload: { success: false, message: "Accion no implementada en el Worker." }
      };
  }
}

async function handleLogin_(body, env) {
  try {
    assertSupabaseEnv_(env);
  } catch (error) {
    return errorResult_(500, toErrorMessage(error));
  }

  const username = normalizeText_(body.usuario);
  const usernameLower = normalizeLower_(username);
  const usernameDigits = normalizeDigits_(username);
  const looksNumeric = !!username && /^\d+$/.test(username);
  const canBeCedula = usernameDigits.length >= 8;

  const patientCandidate = canBeCedula
    ? await findPatientByCedula_(env, usernameDigits)
    : null;

  if (looksNumeric && patientCandidate && await verifyPassword_(body.password, patientCandidate.password)) {
    await maybeUpgradePasswordHash_(env, "paciente", patientCandidate, body.password);
    return buildLoginResult_("paciente", patientCandidate, env);
  }

  const superadmin = await findSuperadminByUser_(env, usernameLower);
  if (superadmin && await verifyPassword_(body.password, superadmin.password)) {
    await maybeUpgradePasswordHash_(env, "superadmin", superadmin, body.password);
    return buildLoginResult_("superadmin", superadmin, env);
  }

  const admin = await findAdminByUser_(env, usernameLower);
  if (admin && await verifyPassword_(body.password, admin.password)) {
    await maybeUpgradePasswordHash_(env, "admin", admin, body.password);
    return buildLoginResult_("admin", admin, env);
  }

  if (patientCandidate && await verifyPassword_(body.password, patientCandidate.password)) {
    await maybeUpgradePasswordHash_(env, "paciente", patientCandidate, body.password);
    return buildLoginResult_("paciente", patientCandidate, env);
  }

  return {
    status: 401,
    payload: { success: false, message: "Usuario o contrasena incorrectos." }
  };
}

async function buildLoginResult_(role, row, env) {
  const userId = getUserIdForRole_(role, row);
  if (!userId) {
    return errorResult_(500, "No se pudo identificar al usuario autenticado.");
  }

  const session = await createSession_(env, role, userId);
  if (!session.success) {
    return errorResult_(500, session.message || "No se pudo crear la sesion.");
  }

  const payload = {
    success: true,
    role: role,
    data: sanitizeUserData_(row),
    session_token: session.token,
    session_expires_at: session.expires_at
  };

  if (role === "admin" || role === "paciente") {
    const mustChange = normalizeUpper_(row.first_login || "") === "SI";
    payload.must_change_password = mustChange;
    payload.first_login_role = role;
    payload.first_login_id = userId;
  }

  return { status: 200, payload };
}

async function handleLogout_(body, env) {
  try {
    assertSupabaseEnv_(env);
  } catch (error) {
    return errorResult_(500, toErrorMessage(error));
  }

  const token = normalizeText_(body.session_token);
  if (!token) {
    return { status: 200, payload: { success: true, message: "Sesion cerrada." } };
  }

  const deleted = await deleteSessionByToken_(env, token);
  if (!deleted.success) {
    return errorResult_(500, deleted.message || "No se pudo cerrar la sesion.");
  }

  return { status: 200, payload: { success: true, message: "Sesion cerrada." } };
}

async function handleMe_(body, env) {
  try {
    assertSupabaseEnv_(env);
  } catch (error) {
    return errorResult_(500, toErrorMessage(error));
  }

  const session = await requireValidSession_(env, body.session_token);
  if (!session.ok) {
    return { status: 401, payload: { success: false, message: "Sesion invalida o expirada." } };
  }

  const user = await loadUserByRoleAndId_(env, session.role, session.user_id);
  if (!user) {
    await deleteSessionByHash_(env, session.token_hash);
    return { status: 401, payload: { success: false, message: "Sesion invalida o expirada." } };
  }

  const payload = {
    success: true,
    role: session.role,
    data: sanitizeUserData_(user),
    session_token: normalizeText_(body.session_token),
    session_expires_at: session.expires_at
  };

  if (session.role === "admin" || session.role === "paciente") {
    payload.must_change_password = normalizeUpper_(user.first_login || "") === "SI";
    payload.first_login_role = session.role;
    payload.first_login_id = session.user_id;
  }

  await touchSession_(env, session.token_hash);
  return { status: 200, payload };
}

async function handleFirstLoginKeep_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "paciente"] });
  if (!validation.ok) {
    return validation.result;
  }

  const update = await updateFirstLoginFlag_(env, validation.session.role, validation.session.user_id, "NO");
  if (!update.success) {
    return errorResult_(500, update.message || "No se pudo completar el primer ingreso.");
  }

  return {
    status: 200,
    payload: { success: true, message: "Primer ingreso completado." }
  };
}

async function handleFirstLoginUpdatePassword_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "paciente"] });
  if (!validation.ok) {
    return validation.result;
  }

  const newPassword = normalizeText_(body.new_password);
  if (!newPassword) {
    return { status: 400, payload: { success: false, message: "Falta new_password." } };
  }

  const update = await updateUserPassword_(env, validation.session.role, validation.session.user_id, newPassword, {
    clearFirstLogin: true
  });
  if (!update.success) {
    return errorResult_(500, update.message || "No se pudo actualizar la contrasena.");
  }

  return {
    status: 200,
    payload: { success: true, message: "Contrasena actualizada correctamente." }
  };
}

async function handleSelfUpdatePassword_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const newPassword = normalizeText_(body.new_password);
  if (!newPassword) {
    return { status: 400, payload: { success: false, message: "Falta new_password." } };
  }

  const update = await updateUserPassword_(env, validation.session.role, validation.session.user_id, newPassword, {
    clearFirstLogin: validation.session.role === "admin" || validation.session.role === "paciente"
  });
  if (!update.success) {
    return errorResult_(500, update.message || "No se pudo actualizar la contrasena.");
  }

  return {
    status: 200,
    payload: { success: true, message: "Contrasena actualizada." }
  };
}

async function handleGetData_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const sheetName = normalizeLower_(body.sheet);
  if (!sheetName) {
    return { status: 400, payload: { success: false, message: "Falta sheet." } };
  }
  if (sheetName === "usuarios_superadmin" || sheetName === "usuarios_admin") {
    return { status: 403, payload: { success: false, message: "Acceso denegado" } };
  }

  if (sheetName === "pacientes") {
    if (validation.session.role === "admin" || validation.session.role === "superadmin") {
      return handleGetDoctorPatients_(body, env);
    }

    const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
    if (!patient) {
      return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
    }

    const item = Object.assign({}, patient || {});
    if (!Object.prototype.hasOwnProperty.call(item, "antecedentes")) {
      item.antecedentes = normalizeText_(item.antecedentes_medicos);
    }
    return { status: 200, payload: { success: true, data: [item] } };
  }

  if (sheetName === "diagnosticos_archivos") {
    let rows = [];
    if (validation.session.role === "superadmin") {
      const res = await supabaseRest_(env, "get", "diagnosticos_archivos", {
        select: "id_reporte,id_paciente,tipo_examen,fecha,datos_json,pdf_url,creado_por",
        orderBy: "fecha",
        ascending: false
      });
      if (!res.success) {
        return errorResult_(500, res.message || "No se pudo cargar la lista de diagnosticos.");
      }
      rows = Array.isArray(res.data) ? res.data : [];
    } else if (validation.session.role === "paciente") {
      const res = await supabaseRest_(env, "get", "diagnosticos_archivos", {
        select: "id_reporte,id_paciente,tipo_examen,fecha,datos_json,pdf_url,creado_por",
        filters: { id_paciente: eq_(validation.session.user_id) },
        orderBy: "fecha",
        ascending: false
      });
      if (!res.success) {
        return errorResult_(500, res.message || "No se pudo cargar la lista de diagnosticos.");
      }
      rows = Array.isArray(res.data) ? res.data : [];
    } else {
      const patientsRes = await supabaseRest_(env, "get", "pacientes", {
        select: "id_paciente",
        filters: { creado_por: eq_(validation.session.user_id) }
      });
      if (!patientsRes.success) {
        return errorResult_(500, patientsRes.message || "No se pudieron cargar los pacientes del medico.");
      }

      const patientIds = normalizeIdList_((Array.isArray(patientsRes.data) ? patientsRes.data : []).map(function(row) {
        return row && row.id_paciente;
      }));
      if (!patientIds.length) {
        return { status: 200, payload: { success: true, data: [] } };
      }

      const diagnosesRes = await supabaseRest_(env, "get", "diagnosticos_archivos", {
        select: "id_reporte,id_paciente,tipo_examen,fecha,datos_json,pdf_url,creado_por",
        filters: { id_paciente: inList_(patientIds) },
        orderBy: "fecha",
        ascending: false
      });
      if (!diagnosesRes.success) {
        return errorResult_(500, diagnosesRes.message || "No se pudo cargar la lista de diagnosticos.");
      }
      rows = Array.isArray(diagnosesRes.data) ? diagnosesRes.data : [];
    }

    return {
      status: 200,
      payload: {
        success: true,
        data: rows.slice().sort(compareDiagnosisDesc_)
      }
    };
  }

  return {
    status: 400,
    payload: { success: false, message: "Hoja no soportada en el Worker: " + sheetName }
  };
}

async function handleCreateRecord_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const sheetName = normalizeLower_(body.sheet);
  if (sheetName !== "pacientes") {
    return {
      status: 400,
      payload: { success: false, message: "Solo la hoja pacientes esta soportada en create_record." }
    };
  }

  const input = body.data && typeof body.data === "object" ? body.data : {};
  const row = await normalizePatientWritePayloadWorker_(input);
  row.id_paciente = normalizeText_(row.id_paciente || ("P-" + Date.now()));
  row.fecha_registro = normalizeIsoDateValue_(row.fecha_registro || new Date());
  row.first_login = normalizeUpper_(row.first_login || "SI") || "SI";
  if (validation.session.role === "admin") {
    row.creado_por = validation.session.user_id;
  } else if (!row.creado_por) {
    row.creado_por = normalizeLower_(input.creado_por);
  }

  const res = await supabaseRest_(env, "post", "pacientes", {
    prefer: "return=representation",
    body: row
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo crear el paciente.");
  }

  const created = res.data[0] || row;
  return {
    status: 200,
    payload: {
      success: true,
      message: "Paciente registrado correctamente.",
      data: Object.assign({}, created, {
        antecedentes: normalizeText_(created.antecedentes || created.antecedentes_medicos)
      })
    }
  };
}

async function handleUpdateRecord_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const sheetName = normalizeLower_(body.sheet);
  if (sheetName !== "pacientes") {
    return {
      status: 400,
      payload: { success: false, message: "Solo la hoja pacientes esta soportada en update_record." }
    };
  }

  const targetId = normalizeText_(body.id || (body.data && body.data.id_paciente));
  if (!targetId) {
    return { status: 400, payload: { success: false, message: "Falta id del registro." } };
  }

  const access = await resolveAccessiblePatientForSession_(env, validation.session, targetId);
  if (!access.ok) {
    return access.result;
  }

  const patch = await normalizePatientWritePayloadWorker_(body.data && typeof body.data === "object" ? body.data : {});
  delete patch.id_paciente;
  if (validation.session.role === "admin") {
    patch.creado_por = validation.session.user_id;
  }

  const res = await supabaseRest_(env, "patch", "pacientes", {
    filters: { id_paciente: eq_(access.patient.id_paciente) },
    prefer: "return=representation",
    body: patch
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo actualizar el paciente.");
  }

  const updated = res.data[0] || {};
  return {
    status: 200,
    payload: {
      success: true,
      message: "Datos actualizados.",
      data: Object.assign({}, updated, {
        antecedentes: normalizeText_(updated.antecedentes || updated.antecedentes_medicos)
      })
    }
  };
}

async function handleDeleteRecord_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const sheetName = normalizeLower_(body.sheet);
  if (sheetName !== "pacientes") {
    return {
      status: 400,
      payload: { success: false, message: "Solo la hoja pacientes esta soportada en delete_record." }
    };
  }

  const targetId = normalizeText_(body.id || body.patient_id || body.id_paciente);
  if (!targetId) {
    return { status: 400, payload: { success: false, message: "Falta id del registro." } };
  }

  const access = await resolveAccessiblePatientForSession_(env, validation.session, targetId);
  if (!access.ok) {
    return access.result;
  }

  return deletePatientCascadeWorker_(env, access.patient.id_paciente, body);
}

async function handleGetDoctorPatients_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const filters = validation.session.role === "admin"
    ? { creado_por: eq_(validation.session.user_id) }
    : null;

  const res = await supabaseRest_(env, "get", "pacientes", {
    select: "id_paciente,cedula,nombre_completo,fecha_nacimiento,telefono,correo,direccion,ocupacion,antecedentes_medicos,fecha_registro,password,creado_por,first_login",
    filters: filters,
    orderBy: "fecha_registro",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar la lista de pacientes.");
  }

  const data = Array.isArray(res.data) ? res.data.map(function(row) {
    const item = Object.assign({}, row || {});
    if (!Object.prototype.hasOwnProperty.call(item, "antecedentes")) {
      item.antecedentes = normalizeText_(item.antecedentes_medicos);
    }
    return item;
  }) : [];

  return { status: 200, payload: { success: true, data } };
}

async function handleGetPatientProfile_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const data = Object.assign({}, sanitizeUserData_(access.patient));
  if (!Object.prototype.hasOwnProperty.call(data, "antecedentes")) {
    data.antecedentes = normalizeText_(access.patient.antecedentes || access.patient.antecedentes_medicos);
  }

  return { status: 200, payload: { success: true, data } };
}

async function handleGetHistory_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const res = await supabaseRest_(env, "get", "historia_clinica", {
    select: "*",
    filters: { id_paciente: eq_(access.patient.id_paciente) },
    limit: 1
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar la historia clinica.");
  }

  const data = (Array.isArray(res.data) && res.data.length) ? (res.data[0] || {}) : {};
  return { status: 200, payload: { success: true, data } };
}

async function handleSaveHistory_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const payload = buildClinicalHistoryWriteRow_(body.data || {}, access.patient.id_paciente);
  const res = await supabaseRest_(env, "post", "historia_clinica", {
    onConflict: "id_paciente",
    prefer: "resolution=merge-duplicates,return=representation",
    body: payload
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo guardar la historia clinica.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: "Historia clinica guardada.",
      data: Array.isArray(res.data) && res.data.length ? res.data[0] : payload
    }
  };
}

async function handleGetPatientAppointments_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const res = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,id_paciente,fecha,hora,motivo,estado,fecha_registro,nota_paciente,recomendaciones_serv,creado_por,duracion_minutos",
    filters: { id_paciente: eq_(access.patient.id_paciente) },
    orderBy: "fecha",
    ascending: true
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar el historial de citas.");
  }

  const data = (Array.isArray(res.data) ? res.data : []).map(function(row) {
    const duration = normalizeDurationMinutesWorker_(row && row.duracion_minutos);
    return {
      id_cita: normalizeText_(row && row.id_cita),
      id_paciente: normalizeText_(row && row.id_paciente),
      fecha: normalizeIsoDateValue_(row && row.fecha),
      hora: normalizeTimeText_(row && row.hora),
      motivo: normalizeText_(row && row.motivo),
      estado: normalizeUpper_(row && row.estado),
      fecha_registro: normalizeText_(row && row.fecha_registro),
      nota: normalizeText_(row && row.nota_paciente),
      nota_paciente: normalizeText_(row && row.nota_paciente),
      recomendaciones: normalizeText_(row && row.recomendaciones_serv),
      recomendaciones_serv: normalizeText_(row && row.recomendaciones_serv),
      creado_por: normalizeLower_(row && row.creado_por),
      duracion_minutos: duration
    };
  }).sort(compareAppointmentsAsc_);

  return { status: 200, payload: { success: true, data } };
}

async function handleGetDashboardStats_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const patientsRes = await supabaseRest_(env, "get", "pacientes", {
    select: "id_paciente,creado_por",
    filters: validation.session.role === "admin"
      ? { creado_por: eq_(validation.session.user_id) }
      : undefined
  });
  if (!patientsRes.success) {
    return errorResult_(500, patientsRes.message || "No se pudieron cargar los pacientes.");
  }

  const patients = Array.isArray(patientsRes.data) ? patientsRes.data : [];
  const patientIds = normalizeIdList_(patients.map(function(row) { return row && row.id_paciente; }));
  const today = normalizeIsoDateValue_(new Date());
  const weekRange = getWeekDateRange_(today);

  let citasHoy = 0;
  let citasSemana = 0;
  if (patientIds.length) {
    const appointmentsRes = await supabaseRest_(env, "get", "citas", {
      select: "id_paciente,fecha",
      filters: [
        ["id_paciente", inList_(patientIds)],
        ["fecha", gte_(weekRange.start)],
        ["fecha", lte_(weekRange.end)]
      ]
    });
    if (!appointmentsRes.success) {
      return errorResult_(500, appointmentsRes.message || "No se pudieron cargar las citas.");
    }

    const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
    appointments.forEach(function(row) {
      const dateKey = normalizeIsoDateValue_(row && row.fecha);
      if (!dateKey) return;
      citasSemana++;
      if (dateKey === today) citasHoy++;
    });
  }

  return {
    status: 200,
    payload: {
      success: true,
      data: {
        total_pacientes: patientIds.length,
        citas_hoy: citasHoy,
        citas_semana: citasSemana
      }
    }
  };
}

async function handleGetAgenda_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const dateString = normalizeIsoDateValue_(body.fecha);
  if (!dateString) {
    return { status: 400, payload: { success: false, message: "Falta fecha." } };
  }

  const appointmentsRes = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,id_paciente,fecha,hora,motivo,estado,fecha_registro,nota_paciente,recomendaciones_serv,creado_por,duracion_minutos",
    filters: { fecha: eq_(dateString) },
    orderBy: "hora",
    ascending: true
  });
  if (!appointmentsRes.success) {
    return errorResult_(500, appointmentsRes.message || "No se pudo cargar la agenda.");
  }

  const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
  const patientMap = await loadPatientMapByIds_(env, collectAppointmentPatientIds_(appointments));
  const data = appointments
    .map(function(row) {
      const patientId = normalizeText_(row && row.id_paciente);
      const patient = patientMap[patientId] || null;
      if (validation.session.role === "admin" && normalizeLower_(patient && patient.creado_por) !== validation.session.user_id) {
        return null;
      }
      return buildAgendaAppointmentOutput_(row, patient);
    })
    .filter(Boolean)
    .sort(compareAgendaAppointmentsAsc_);

  return { status: 200, payload: { success: true, data } };
}

async function handleGetAgendaMonthSummary_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const monthKey = normalizeMonthKey_(body.month || body.month_ref || body.fecha || new Date());
  if (!monthKey) {
    return { status: 400, payload: { success: false, message: "Falta month." } };
  }

  const monthRange = getMonthDateRange_(monthKey);
  const appointmentsRes = await supabaseRest_(env, "get", "citas", {
    select: "id_paciente,fecha",
    filters: [
      ["fecha", gte_(monthRange.start)],
      ["fecha", lte_(monthRange.end)]
    ]
  });
  if (!appointmentsRes.success) {
    return errorResult_(500, appointmentsRes.message || "No se pudo cargar el calendario.");
  }

  const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
  const patientMap = validation.session.role === "admin"
    ? await loadPatientMapByIds_(env, collectAppointmentPatientIds_(appointments))
    : {};
  const counts = {};

  appointments.forEach(function(row) {
    const dateKey = normalizeIsoDateValue_(row && row.fecha);
    if (!dateKey || dateKey.slice(0, 7) !== monthKey) return;
    if (validation.session.role === "admin") {
      const patient = patientMap[normalizeText_(row && row.id_paciente)] || null;
      if (normalizeLower_(patient && patient.creado_por) !== validation.session.user_id) return;
    }
    counts[dateKey] = (counts[dateKey] || 0) + 1;
  });

  return {
    status: 200,
    payload: {
      success: true,
      data: {
        month: monthKey,
        counts: counts,
        marked_dates: Object.keys(counts).sort()
      }
    }
  };
}

async function handleGetWeekAppointments_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const referenceDate = normalizeIsoDateValue_(body.fecha_ref || new Date());
  const weekRange = getWeekDateRange_(referenceDate);
  const appointmentsRes = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,id_paciente,fecha,hora,motivo,estado,fecha_registro,nota_paciente,recomendaciones_serv,creado_por,duracion_minutos",
    filters: [
      ["fecha", gte_(weekRange.start)],
      ["fecha", lte_(weekRange.end)]
    ],
    orderBy: "fecha",
    ascending: true
  });
  if (!appointmentsRes.success) {
    return errorResult_(500, appointmentsRes.message || "No se pudo cargar la semana.");
  }

  const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
  const patientMap = await loadPatientMapByIds_(env, collectAppointmentPatientIds_(appointments));
  const items = appointments
    .map(function(row) {
      const patient = patientMap[normalizeText_(row && row.id_paciente)] || null;
      if (validation.session.role === "admin" && normalizeLower_(patient && patient.creado_por) !== validation.session.user_id) {
        return null;
      }
      return buildAgendaAppointmentOutput_(row, patient);
    })
    .filter(Boolean)
    .sort(compareAgendaAppointmentsAsc_);

  return {
    status: 200,
    payload: {
      success: true,
      data: {
        week_start: weekRange.start,
        week_end: weekRange.end,
        items: items
      }
    }
  };
}

async function handleGetServiceConfig_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const servicesRes = await supabaseRest_(env, "get", "servicios", {
    select: "id,nombre_servicio,recomendaciones,titulo_reporte,scope_visibility,owner_usuario,duracion_minutos",
    orderBy: "nombre_servicio",
    ascending: true
  });
  if (!servicesRes.success) {
    return errorResult_(500, servicesRes.message || "No se pudo cargar la configuracion de servicios.");
  }

  let patientDoctorOwner = "";
  if (validation.session.role === "paciente") {
    const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
    patientDoctorOwner = normalizeLower_(patient && patient.creado_por);
  }

  const visibleServices = (Array.isArray(servicesRes.data) ? servicesRes.data : [])
    .map(normalizeServiceOutputRow_)
    .filter(function(service) {
      if (!service.nombre_servicio) return false;
      if (validation.session.role === "superadmin") return true;
      if (validation.session.role === "admin") {
        return service.scope_visibility === "ALL" || service.owner_usuario === validation.session.user_id;
      }
      return service.scope_visibility === "ALL" || (!!patientDoctorOwner && service.owner_usuario === patientDoctorOwner);
    });

  const allowedServices = {};
  visibleServices.forEach(function(service) {
    allowedServices[service.nombre_servicio] = true;
  });

  const configRes = await supabaseRest_(env, "get", "config_campos", {
    select: "servicio,campo_nombre,campo_etiqueta,campo_tipo,opciones"
  });
  if (!configRes.success) {
    return errorResult_(500, configRes.message || "No se pudo cargar la configuracion de campos.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      data: buildServiceConfigMapWorker_(Array.isArray(configRes.data) ? configRes.data : [], allowedServices)
    }
  };
}

async function handleSaveServiceFull_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const payload = body.data && typeof body.data === "object" ? body.data : {};
  const targetName = normalizeText_(payload.nombre_servicio);
  if (!targetName) {
    return { status: 400, payload: { success: false, message: "Falta nombre del servicio" } };
  }

  const servicesRes = await supabaseRest_(env, "get", "servicios", {
    select: "id,nombre_servicio,recomendaciones,titulo_reporte,scope_visibility,owner_usuario,duracion_minutos",
    orderBy: "nombre_servicio",
    ascending: true
  });
  if (!servicesRes.success) {
    return errorResult_(500, servicesRes.message || "No se pudieron cargar los servicios.");
  }

  const allServices = Array.isArray(servicesRes.data) ? servicesRes.data : [];
  const originalName = normalizeText_(payload.originalName || targetName);
  const targetNameLower = normalizeLower_(targetName);
  const searchNameLower = normalizeLower_(originalName);
  const existing = allServices.find(function(service) {
    return normalizeLower_(service && service.nombre_servicio) === searchNameLower;
  }) || null;

  const duplicate = allServices.find(function(service) {
    if (normalizeLower_(service && service.nombre_servicio) !== targetNameLower) return false;
    if (existing && normalizeText_(service && service.id) === normalizeText_(existing.id)) return false;
    return true;
  });
  if (duplicate) {
    return { status: 400, payload: { success: false, message: "Ya existe un servicio con ese nombre." } };
  }

  const isSuper = validation.session.role === "superadmin";
  const isCreate = !existing;
  let finalScope = "ALL";
  let finalOwner = "";
  let finalDuration = 30;
  let serviceId = existing ? normalizeText_(existing.id) : ("SERV-" + Date.now());

  if (existing) {
    finalScope = normalizeServiceScopeWorker_(existing.scope_visibility || "ALL");
    finalOwner = normalizeLower_(existing.owner_usuario);
    finalDuration = normalizeDurationMinutesWorker_(existing.duracion_minutos);

    if (!finalOwner && !isSuper) {
      return {
        status: 403,
        payload: { success: false, message: "Servicio sin propietario. Solicita asignacion por superadmin." }
      };
    }
    if (!finalOwner && isSuper) {
      finalOwner = normalizeLower_(payload.owner_usuario || validation.session.user_id);
    }
    if (finalOwner && !isSuper && finalOwner !== validation.session.user_id) {
      return {
        status: 403,
        payload: { success: false, message: "Solo el medico creador puede modificar este servicio." }
      };
    }
  }

  if (isCreate) {
    finalScope = normalizeServiceScopeWorker_(payload.scope_visibility || "ALL");
    finalOwner = normalizeLower_(validation.session.user_id);
    finalDuration = normalizeDurationMinutesWorker_(payload.duracion_minutos);
  } else {
    const requestedScope = normalizeServiceScopeWorker_(payload.scope_visibility);
    if (requestedScope) finalScope = requestedScope;
    if (!finalOwner) finalOwner = normalizeLower_(validation.session.user_id);
    if (Object.prototype.hasOwnProperty.call(payload, "duracion_minutos")) {
      finalDuration = normalizeDurationMinutesWorker_(payload.duracion_minutos);
    }
  }

  const row = {
    id: serviceId,
    nombre_servicio: targetName,
    recomendaciones: normalizeText_(payload.recomendaciones),
    titulo_reporte: normalizeText_(payload.titulo_reporte),
    scope_visibility: finalScope,
    owner_usuario: finalOwner,
    duracion_minutos: finalDuration
  };

  const serviceWriteRes = existing
    ? await supabaseRest_(env, "patch", "servicios", {
        filters: { id: eq_(serviceId) },
        prefer: "return=representation",
        body: row
      })
    : await supabaseRest_(env, "post", "servicios", {
        prefer: "return=representation",
        body: row
      });
  if (!serviceWriteRes.success) {
    return errorResult_(500, serviceWriteRes.message || "No se pudo guardar el servicio.");
  }

  const cleanupNames = normalizeIdList_([
    existing && existing.nombre_servicio,
    targetName
  ]);
  for (const serviceName of cleanupNames) {
    const deleteConfigRes = await supabaseRest_(env, "delete", "config_campos", {
      filters: { servicio: eq_(serviceName) }
    });
    if (!deleteConfigRes.success) {
      return errorResult_(500, deleteConfigRes.message || "No se pudo limpiar la configuracion del servicio.");
    }
  }

  const campos = normalizeServiceFieldRowsWorker_(payload.campos, targetName);
  if (campos.length) {
    const insertFieldsRes = await supabaseRest_(env, "post", "config_campos", {
      prefer: "return=minimal",
      body: campos
    });
    if (!insertFieldsRes.success) {
      return errorResult_(500, insertFieldsRes.message || "No se pudieron guardar los campos del servicio.");
    }
  }

  const savedService = normalizeServiceOutputRow_(row);
  return {
    status: 200,
    payload: {
      success: true,
      message: "Servicio guardado y configurado correctamente.",
      data: savedService
    }
  };
}

async function handleDeleteServiceFull_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const serviceName = normalizeText_(body.nombre);
  if (!serviceName) {
    return { status: 400, payload: { success: false, message: "Nombre de servicio invalido." } };
  }

  const service = await findServiceByNameInsensitive_(env, serviceName);
  if (!service) {
    return { status: 404, payload: { success: false, message: "Servicio no encontrado." } };
  }

  const owner = normalizeLower_(service.owner_usuario);
  const isSuper = validation.session.role === "superadmin";
  if (!owner && !isSuper) {
    return {
      status: 403,
      payload: { success: false, message: "Servicio sin propietario. Solo superadmin puede eliminarlo." }
    };
  }
  if (owner && !isSuper && owner !== validation.session.user_id) {
    return {
      status: 403,
      payload: { success: false, message: "Solo el medico creador puede eliminar este servicio." }
    };
  }

  const deleteConfigRes = await supabaseRest_(env, "delete", "config_campos", {
    filters: { servicio: eq_(normalizeText_(service.nombre_servicio)) }
  });
  if (!deleteConfigRes.success) {
    return errorResult_(500, deleteConfigRes.message || "No se pudo eliminar la configuracion del servicio.");
  }

  const deleteServiceRes = await supabaseRest_(env, "delete", "servicios", {
    filters: { id: eq_(normalizeText_(service.id)) }
  });
  if (!deleteServiceRes.success) {
    return errorResult_(500, deleteServiceRes.message || "No se pudo eliminar el servicio.");
  }

  return {
    status: 200,
    payload: { success: true, message: "Servicio eliminado completamente." }
  };
}

async function handleAddService_(body, env) {
  const data = body.data && typeof body.data === "object" ? body.data : {};
  return handleSaveServiceFull_(Object.assign({}, body, {
    data: {
      originalName: "",
      nombre_servicio: data.nombre,
      recomendaciones: data.recomendaciones || "",
      titulo_reporte: "",
      duracion_minutos: 30,
      campos: [],
      scope_visibility: "ALL"
    }
  }), env);
}

async function handleUpdateService_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const serviceId = normalizeText_(data.id);
  if (!serviceId) {
    return { status: 400, payload: { success: false, message: "Servicio no encontrado." } };
  }

  const existing = await findSingleByField_(env, "servicios", "id", serviceId);
  if (!existing) {
    return { status: 404, payload: { success: false, message: "Servicio no encontrado." } };
  }

  return handleSaveServiceFull_(Object.assign({}, body, {
    requester: body.requester || validation.session.user_id,
    session_token: body.session_token,
    data: {
      originalName: existing.nombre_servicio,
      nombre_servicio: normalizeText_(data.nombre || existing.nombre_servicio),
      recomendaciones: normalizeText_(data.recomendaciones || existing.recomendaciones),
      titulo_reporte: normalizeText_(existing.titulo_reporte),
      duracion_minutos: normalizeDurationMinutesWorker_(existing.duracion_minutos),
      scope_visibility: normalizeServiceScopeWorker_(existing.scope_visibility),
      campos: await loadServiceConfigRowsForService_(env, normalizeText_(existing.nombre_servicio))
    }
  }), env);
}

async function handleDeleteServiceById_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const serviceId = normalizeText_(body.id);
  if (!serviceId) {
    return { status: 400, payload: { success: false, message: "Servicio no encontrado." } };
  }

  const service = await findSingleByField_(env, "servicios", "id", serviceId);
  if (!service) {
    return { status: 404, payload: { success: false, message: "Servicio no encontrado." } };
  }

  return handleDeleteServiceFull_(Object.assign({}, body, {
    nombre: normalizeText_(service.nombre_servicio),
    requester: body.requester || validation.session.user_id,
    session_token: body.session_token
  }), env);
}

async function handleSaveDiagnosisAdvanced_(body, env, url) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const reportId = normalizeText_(data.id_reporte);
  let existing = null;
  let patientId = normalizeText_(data.id_paciente);

  if (reportId) {
    existing = await findSingleByField_(env, "diagnosticos_archivos", "id_reporte", reportId);
    if (!existing) {
      return { status: 404, payload: { success: false, message: "Reporte no encontrado." } };
    }
    patientId = normalizeText_(existing.id_paciente) || patientId;
  }

  if (!patientId) {
    return { status: 400, payload: { success: false, message: "Falta id_paciente." } };
  }

  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, patientId);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const existingPayload = parseStoredDiagnosisJson_(existing && existing.datos_json);
  const normalizedData = normalizeDiagnosisSavePayloadForMode_(data, existingPayload);

  const idReporte = reportId || ("REP-" + Date.now());
  const requestedReportDate = normalizeIsoDateValue_(
    data.fecha_reporte
    || data.fecha
    || normalizedData.fecha_reporte
    || normalizedData.fecha
    || existingPayload.fecha_reporte
    || (existing && existing.fecha)
  );
  const hasCustomReportDate = !!requestedReportDate;
  const savedAt = hasCustomReportDate
    ? (requestedReportDate + "T12:00:00.000Z")
    : normalizeIsoDateTimeValue_((existing && existing.fecha) || new Date().toISOString());

  const signaturePassword = normalizeText_(data.firma_electronica_password);
  const doctorUser = normalizeLower_(patientAccess.patient.creado_por || validation.session.user_id);
  const prepared = await prepareDiagnosisPersistenceWorker_(env, normalizedData, {
    patientId: patientAccess.patient.id_paciente,
    reportId: idReporte,
    requestUrl: url,
    firmaPassword: signaturePassword,
    doctorId: doctorUser
  });
  if (!prepared.success) {
    return errorResult_(prepared.status || 500, prepared.message || "No se pudo preparar el diagnostico.");
  }

  const preparedData = prepared.data || normalizedData;
  if (prepared.recipePdfUrl) {
    preparedData.pdf_receta_link = normalizeText_(prepared.recipePdfUrl);
  }
  if (prepared.certificatePdfUrl) {
    preparedData.pdf_certificado_link = normalizeText_(prepared.certificatePdfUrl);
  }
  const storedPayload = buildDiagnosisStoragePayload_(preparedData, {
    id_reporte: idReporte,
    id_paciente: patientAccess.patient.id_paciente,
    nombre_paciente: normalizeText_(preparedData.nombre_paciente || patientAccess.patient.nombre_completo),
    doctor_usuario: doctorUser,
    oldPayload: existingPayload
  });
  if (hasCustomReportDate) {
    storedPayload.fecha_reporte = requestedReportDate;
  } else if (normalizeIsoDateValue_(existingPayload.fecha_reporte)) {
    storedPayload.fecha_reporte = normalizeIsoDateValue_(existingPayload.fecha_reporte);
  }
  if (Object.prototype.hasOwnProperty.call(preparedData, "imagenes")) {
    storedPayload.imagenes = normalizeDiagnosisImagesForStorage_(preparedData.imagenes);
  }
  if (Object.prototype.hasOwnProperty.call(preparedData, "pdf_externos")) {
    storedPayload.pdf_externos = normalizeDiagnosisExternalPdfsForStorage_(preparedData.pdf_externos);
    storedPayload.pdf_externo_link = storedPayload.pdf_externos.length
      ? normalizeText_(storedPayload.pdf_externos[0].url)
      : "";
  }
  if (prepared.recipePdfUrl) {
    storedPayload.pdf_receta_link = normalizeText_(prepared.recipePdfUrl);
  } else if (normalizeText_(existingPayload.pdf_receta_link)) {
    storedPayload.pdf_receta_link = normalizeText_(existingPayload.pdf_receta_link);
  }
  if (prepared.certificatePdfUrl) {
    storedPayload.pdf_certificado_link = normalizeText_(prepared.certificatePdfUrl);
  } else if (normalizeText_(existingPayload.pdf_certificado_link)) {
    storedPayload.pdf_certificado_link = normalizeText_(existingPayload.pdf_certificado_link);
  }

  const rowPdfUrl = normalizeText_(
    prepared.reportPdfUrl
    || prepared.certificatePdfUrl
    || (existing && existing.pdf_url)
    || ""
  );

  const row = {
    id_reporte: idReporte,
    id_paciente: patientAccess.patient.id_paciente,
    tipo_examen: normalizeText_(storedPayload.tipo_examen || preparedData.tipo_examen),
    fecha: savedAt,
    datos_json: JSON.stringify(storedPayload),
    pdf_url: rowPdfUrl,
    creado_por: normalizeLower_((existing && existing.creado_por) || validation.session.user_id || doctorUser || "doctor")
  };

  const res = await supabaseRest_(env, "post", "diagnosticos_archivos", {
    onConflict: "id_reporte",
    prefer: "resolution=merge-duplicates,return=representation",
    body: row
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo guardar el diagnostico.");
  }

  const oldUrls = existing ? collectDiagnosisAssetUrlsFromReportWorker_(existing) : [];
  const newUrls = collectDiagnosisAssetUrlsWorker_(rowPdfUrl, storedPayload);
  const staleUrls = oldUrls.filter(function(currentUrl) {
    return newUrls.indexOf(currentUrl) === -1;
  });
  const cleanupResult = await deleteWorkerManagedAssetUrls_(env, staleUrls);
  const cleanupWarning = cleanupResult.success ? "" : cleanupResult.warning;
  let finalWarning = cleanupWarning;
  if (prepared.signatureWarnings) {
    finalWarning = finalWarning ? (finalWarning + " | " + prepared.signatureWarnings) : prepared.signatureWarnings;
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: "Guardado exitoso",
      id_reporte: idReporte,
      pdf_url: rowPdfUrl,
      pdf_receta_url: normalizeText_(storedPayload.pdf_receta_link),
      pdf_certificado_url: normalizeText_(storedPayload.pdf_certificado_link),
      pdf_externo_url: normalizeText_(storedPayload.pdf_externo_link),
      pdf_externos: Array.isArray(storedPayload.pdf_externos) ? storedPayload.pdf_externos : [],
      storage_info: {
        backend: hasWorkerStorageBinding_(env) ? "r2" : "none",
        report_key: normalizeText_(prepared.reportPdfKey),
        recipe_key: normalizeText_(prepared.recipePdfKey),
        certificate_key: normalizeText_(prepared.certificatePdfKey)
      },
      warning: finalWarning
    }
  };
}

async function handleGetDiagnosisHistory_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const res = await supabaseRest_(env, "get", "diagnosticos_archivos", {
    select: "id_reporte,id_paciente,tipo_examen,fecha,datos_json,pdf_url,creado_por",
    filters: { id_paciente: eq_(access.patient.id_paciente) },
    orderBy: "fecha",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar el historial diagnostico.");
  }

  const data = Array.isArray(res.data)
    ? res.data.slice().sort(compareDiagnosisDesc_).map(normalizeDiagnosisReportResponseRow_)
    : [];
  return { status: 200, payload: { success: true, data } };
}

async function handleGetDiagnosisReport_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const reportId = normalizeText_(body.id_reporte || body.report_id);
  if (!reportId) {
    return { status: 400, payload: { success: false, message: "Falta id_reporte." } };
  }

  const report = await findSingleByField_(env, "diagnosticos_archivos", "id_reporte", reportId);
  if (!report) {
    return { status: 404, payload: { success: false, message: "Reporte no encontrado." } };
  }

  const access = await resolveAccessiblePatientForSession_(env, validation.session, report.id_paciente);
  if (!access.ok) {
    return access.result;
  }

  return {
    status: 200,
    payload: {
      success: true,
      data: [normalizeDiagnosisReportResponseRow_(report)]
    }
  };
}

function normalizeDiagnosisReportResponseRow_(row) {
  const src = row && typeof row === "object" ? row : {};
  const payload = parseStoredDiagnosisJson_(src.datos_json);
  const externalItems = getDiagnosisExternalPdfItemsForWorker_(payload);
  const externalUrl = externalItems.length
    ? normalizeText_(externalItems[0] && externalItems[0].url)
    : normalizeText_(payload.pdf_externo_link);
  const reportDate = normalizeIsoDateValue_(payload.fecha_reporte) || normalizeIsoDateValue_(src.fecha);
  const rowPdfUrl = normalizeText_(src.pdf_url);
  const reportType = normalizeUpper_(payload.tipo_examen || src.tipo_examen);
  const certificateUrl = normalizeText_(payload.pdf_certificado_link)
    || ((reportType === "CERTIFICADO MEDICO" || reportType === "CERTIFICADOMEDICO") ? rowPdfUrl : "");

  return Object.assign({}, src, {
    id_reporte: normalizeText_(src.id_reporte),
    id_paciente: normalizeText_(src.id_paciente),
    tipo_examen: normalizeText_(payload.tipo_examen || src.tipo_examen),
    fecha: normalizeText_(src.fecha),
    fecha_reporte: reportDate,
    datos_json: payload,
    pdf_url: rowPdfUrl,
    pdf_receta_url: normalizeText_(payload.pdf_receta_link),
    pdf_receta_link: normalizeText_(payload.pdf_receta_link),
    pdfRecetaUrl: normalizeText_(payload.pdf_receta_link),
    pdf_certificado_url: certificateUrl,
    pdf_certificado_link: certificateUrl,
    pdfCertificadoUrl: certificateUrl,
    pdf_externo_url: externalUrl,
    pdf_externo_link: externalUrl,
    pdfExternoUrl: externalUrl,
    pdf_externos: externalItems,
    fechaReporte: reportDate,
    creado_por: normalizeLower_(src.creado_por)
  });
}

async function handleDeleteDiagnosisAsset_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const reportId = normalizeText_(body.id_reporte || body.report_id);
  const assetType = normalizeLower_(body.asset_type || body.asset || body.asset_kind);
  const allowed = {
    report_pdf: true,
    recipe_pdf: true,
    certificate_pdf: true,
    external_pdf: true
  };
  if (!reportId) {
    return { status: 400, payload: { success: false, message: "Falta id_reporte." } };
  }
  if (!allowed[assetType]) {
    return { status: 400, payload: { success: false, message: "Tipo de documento no valido." } };
  }

  const report = await findSingleByField_(env, "diagnosticos_archivos", "id_reporte", reportId);
  if (!report) {
    return { status: 404, payload: { success: false, message: "Reporte no encontrado." } };
  }

  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, report.id_paciente);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const payload = parseStoredDiagnosisJson_(report.datos_json);
  let updatedPdfUrl = normalizeText_(report.pdf_url || report.pdf_link);
  let requiresProxy = false;
  let localErrorMessage = "";
  let removedAssetUrl = "";

  if (assetType === "report_pdf") {
    if (!updatedPdfUrl) {
      localErrorMessage = "Ese documento ya no existe o no fue generado.";
    } else {
      removedAssetUrl = updatedPdfUrl;
      requiresProxy = isDriveManagedUrlWorker_(updatedPdfUrl);
      updatedPdfUrl = "";
    }
  } else if (assetType === "recipe_pdf") {
    const recipeUrl = normalizeText_(payload.pdf_receta_link);
    if (!recipeUrl) {
      localErrorMessage = "Ese documento ya no existe o no fue generado.";
    } else {
      removedAssetUrl = recipeUrl;
      requiresProxy = isDriveManagedUrlWorker_(recipeUrl);
      delete payload.pdf_receta_link;
    }
  } else if (assetType === "certificate_pdf") {
    const certUrl = normalizeText_(payload.pdf_certificado_link);
    if (!certUrl) {
      localErrorMessage = "Ese documento ya no existe o no fue generado.";
    } else {
      removedAssetUrl = certUrl;
      requiresProxy = isDriveManagedUrlWorker_(certUrl);
      delete payload.pdf_certificado_link;
    }
  } else if (assetType === "external_pdf") {
    const assetId = normalizeText_(body.asset_id || body.id_asset || body.file_id || body.url);
    let externalItems = getDiagnosisExternalPdfItemsForWorker_(payload);
    if (!externalItems.length) {
      localErrorMessage = "Ese documento ya no existe o no fue generado.";
    } else {
      let targetIndex = 0;
      if (assetId) {
        targetIndex = externalItems.findIndex(function(item) {
          const current = item || {};
          return normalizeText_(current.id) === assetId
            || normalizeText_(current.file_id || current.fileId) === assetId
            || normalizeText_(current.url) === assetId;
        });
        if (targetIndex === -1) {
          localErrorMessage = "Ese documento ya no existe o no fue generado.";
        }
      }
        if (!localErrorMessage) {
          const removed = externalItems.splice(targetIndex, 1)[0] || {};
          if (!normalizeText_(removed.url)) {
            localErrorMessage = "Ese documento ya no existe o no fue generado.";
          } else {
            removedAssetUrl = normalizeText_(removed.url);
            requiresProxy = diagnosisExternalItemNeedsAppsScriptCleanup_(removed);
            payload.pdf_externos = externalItems;
            if (externalItems.length) {
              payload.pdf_externo_link = normalizeText_(externalItems[0].url);
            } else {
            delete payload.pdf_externo_link;
          }
        }
      }
    }
  }

  if (localErrorMessage) {
    return { status: 400, payload: { success: false, message: localErrorMessage } };
  }

  const updateRes = await supabaseRest_(env, "patch", "diagnosticos_archivos", {
    filters: { id_reporte: eq_(reportId) },
    prefer: "return=minimal",
    body: {
      datos_json: JSON.stringify(payload),
      pdf_url: updatedPdfUrl
    }
  });
  if (!updateRes.success) {
    return errorResult_(500, updateRes.message || "No se pudo actualizar el diagnostico.");
  }

  const warnings = [];
  if (requiresProxy) {
    warnings.push("El archivo heredado de Drive ya no se mostrara en el sistema, pero no se pudo eliminar fisicamente fuera de Supabase.");
  } else if (isWorkerManagedUrlWorker_(removedAssetUrl)) {
    const cleanupRes = await deleteWorkerManagedAssetByUrl_(env, removedAssetUrl);
    if (!cleanupRes.success && !cleanupRes.skipped) {
      warnings.push("El documento fue desvinculado del diagnostico, pero no se pudo borrar fisicamente de Cloudflare R2.");
    }
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: warnings.length
        ? "Documento eliminado con advertencia."
        : "Documento eliminado correctamente.",
      warning: warnings.join(" | "),
      remaining_docs: buildDiagnosisRemainingDocsWorker_(updatedPdfUrl, payload)
    }
  };
}

async function handleDeleteDiagnosis_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const reportId = normalizeText_(body.id_reporte || body.report_id);
  if (!reportId) {
    return { status: 400, payload: { success: false, message: "Falta id_reporte." } };
  }

  const report = await findSingleByField_(env, "diagnosticos_archivos", "id_reporte", reportId);
  if (!report) {
    return { status: 404, payload: { success: false, message: "Reporte no encontrado." } };
  }

  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, report.id_paciente);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const legacyWarning = diagnosisRecordRequiresAppsScriptCleanup_(report)
    ? "El diagnostico referenciaba archivos heredados de Drive. El registro se elimino de Supabase, pero esos archivos externos no se borraron fisicamente."
    : "";
  const storedUrls = collectDiagnosisAssetUrlsFromReportWorker_(report);

  const deleteRes = await supabaseRest_(env, "delete", "diagnosticos_archivos", {
    filters: { id_reporte: eq_(reportId) }
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudo eliminar el diagnostico.");
  }

  const storageCleanup = await deleteWorkerManagedAssetUrls_(env, storedUrls);
  const warnings = [];
  if (legacyWarning) warnings.push(legacyWarning);
  if (!storageCleanup.success) warnings.push(storageCleanup.warning || "No se pudieron borrar algunos archivos de Cloudflare R2.");

  return {
    status: 200,
    payload: {
      success: true,
      message: warnings.length
        ? "Diagnostico eliminado con advertencia."
        : "Diagnostico eliminado correctamente.",
      warning: warnings.join(" | ")
    }
  };
}

async function handleDeleteBulkDiagnosis_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const ids = normalizeIdList_(body.ids);
  if (!ids.length) {
    return {
      status: 400,
      payload: { success: false, deleted_count: 0, failed_ids: [], message: "No se recibieron diagnosticos para eliminar." }
    };
  }

  const lookupRes = await supabaseRest_(env, "get", "diagnosticos_archivos", {
    select: "id_reporte,id_paciente,datos_json,pdf_url",
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_reporte", inList_(ids)]
    ]
  });
  if (!lookupRes.success) {
    return errorResult_(500, lookupRes.message || "No se pudieron validar los diagnosticos a eliminar.");
  }

  const matches = Array.isArray(lookupRes.data) ? lookupRes.data : [];
  if (!matches.length) {
    return {
      status: 404,
      payload: {
        success: false,
        deleted_count: 0,
        failed_ids: ids,
        message: "No se encontraron diagnosticos para eliminar."
      }
    };
  }

  const matchedIds = matches.map(function(row) { return normalizeText_(row && row.id_reporte); }).filter(Boolean);
  if (matchedIds.length !== ids.length) {
    return {
      status: 400,
      payload: {
        success: false,
        deleted_count: 0,
        failed_ids: ids.filter(function(id) { return matchedIds.indexOf(id) === -1; }),
        message: "Uno o mas diagnosticos no pertenecen a este paciente."
      }
    };
  }

  const hasLegacyDriveAssets = matches.some(diagnosisRecordRequiresAppsScriptCleanup_);
  const storedUrls = [];
  for (let i = 0; i < matches.length; i++) {
    const urls = collectDiagnosisAssetUrlsFromReportWorker_(matches[i]);
    for (let j = 0; j < urls.length; j++) storedUrls.push(urls[j]);
  }

  const deleteRes = await supabaseRest_(env, "delete", "diagnosticos_archivos", {
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_reporte", inList_(matchedIds)]
    ]
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudieron eliminar los diagnosticos seleccionados.");
  }

  const storageCleanup = await deleteWorkerManagedAssetUrls_(env, storedUrls);
  const warnings = [];
  if (hasLegacyDriveAssets) {
    warnings.push("Uno o mas diagnosticos referenciaban archivos heredados de Drive. Los registros se eliminaron de Supabase, pero esos archivos externos no se borraron fisicamente.");
  }
  if (!storageCleanup.success) {
    warnings.push(storageCleanup.warning || "No se pudieron borrar algunos archivos de Cloudflare R2.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      deleted_count: matchedIds.length,
      failed_ids: [],
      warning: warnings.join(" | "),
      message: matchedIds.length === 1
        ? (warnings.length ? "Se elimino 1 diagnostico con advertencia." : "Se elimino 1 diagnostico.")
        : (warnings.length
          ? ("Se eliminaron " + matchedIds.length + " diagnostico(s) con advertencia.")
          : ("Se eliminaron " + matchedIds.length + " diagnostico(s)."))
    }
  };
}

async function handleGetPatientEvolution_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const res = await supabaseRest_(env, "get", "evolucion_paciente", {
    select: "id_evolucion,id_paciente,fecha_consulta,motivo_consulta,evolucion,diagnostico,tratamiento,sugerencias,creado_por,fecha_actualizacion",
    filters: { id_paciente: eq_(access.patient.id_paciente) },
    orderBy: "fecha_consulta",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar la evolucion del paciente.");
  }

  const data = Array.isArray(res.data) ? res.data.slice().sort(compareEvolutionDesc_) : [];
  return { status: 200, payload: { success: true, data } };
}

async function handleSavePatientEvolution_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const data = body.data && typeof body.data === "object" ? body.data : {};
  let targetPatientId = normalizeText_(data.id_paciente);
  const targetId = normalizeText_(data.id_evolucion);
  let existing = null;

  if (targetId) {
    existing = await findSingleByField_(env, "evolucion_paciente", "id_evolucion", targetId);
    if (!existing) {
      return { status: 404, payload: { success: false, message: "La evolucion que intentas editar no existe." } };
    }
    targetPatientId = normalizeText_(existing.id_paciente) || targetPatientId;
  }

  if (!targetPatientId) {
    return { status: 400, payload: { success: false, message: "Falta id_paciente." } };
  }

  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, targetPatientId);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const row = buildPatientEvolutionWriteRow_(data, {
    id_evolucion: targetId || ("EVOL-" + Date.now()),
    id_paciente: patientAccess.patient.id_paciente,
    creado_por: normalizeLower_((existing && existing.creado_por) || validation.session.user_id),
    fecha_actualizacion: new Date().toISOString()
  });

  const res = await supabaseRest_(env, "post", "evolucion_paciente", {
    onConflict: "id_evolucion",
    prefer: "resolution=merge-duplicates,return=representation",
    body: row
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo guardar la evolucion.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: "Evolucion guardada correctamente.",
      data: Array.isArray(res.data) && res.data.length ? res.data[0] : row
    }
  };
}

async function handleDeletePatientEvolution_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const idEvolution = normalizeText_(body.id_evolucion || body.evolution_id);
  if (!idEvolution) {
    return { status: 400, payload: { success: false, message: "Falta id_evolucion." } };
  }

  const evolution = await findSingleByField_(env, "evolucion_paciente", "id_evolucion", idEvolution);
  if (!evolution) {
    return { status: 404, payload: { success: false, message: "Evolucion no encontrada." } };
  }

  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, evolution.id_paciente);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const res = await supabaseRest_(env, "delete", "evolucion_paciente", {
    filters: { id_evolucion: eq_(idEvolution) }
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo eliminar la evolucion.");
  }

  return { status: 200, payload: { success: true, message: "Evolucion eliminada correctamente." } };
}

async function handleDeleteBulkPatientEvolution_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const ids = normalizeIdList_(body.ids);
  if (!ids.length) {
    return {
      status: 400,
      payload: { success: false, deleted_count: 0, missing_ids: [], message: "No se recibieron evoluciones para eliminar." }
    };
  }

  const lookupRes = await supabaseRest_(env, "get", "evolucion_paciente", {
    select: "id_evolucion,id_paciente",
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_evolucion", inList_(ids)]
    ]
  });
  if (!lookupRes.success) {
    return errorResult_(500, lookupRes.message || "No se pudieron validar las evoluciones a eliminar.");
  }

  const matches = Array.isArray(lookupRes.data) ? lookupRes.data : [];
  if (!matches.length) {
    return {
      status: 404,
      payload: {
        success: false,
        deleted_count: 0,
        missing_ids: ids,
        message: "No se encontraron evoluciones para eliminar."
      }
    };
  }

  const matchedIds = matches.map(function(row) { return normalizeText_(row && row.id_evolucion); }).filter(Boolean);
  if (matchedIds.length !== ids.length) {
    return {
      status: 400,
      payload: {
        success: false,
        deleted_count: 0,
        missing_ids: ids.filter(function(id) { return matchedIds.indexOf(id) === -1; }),
        message: "Una o mas evoluciones no pertenecen a este paciente."
      }
    };
  }

  const deleteRes = await supabaseRest_(env, "delete", "evolucion_paciente", {
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_evolucion", inList_(matchedIds)]
    ]
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudieron eliminar las evoluciones seleccionadas.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      deleted_count: matchedIds.length,
      missing_ids: [],
      message: matchedIds.length === 1
        ? "Se elimino 1 evolucion."
        : ("Se eliminaron " + matchedIds.length + " evolucion(es).")
    }
  };
}

async function handleGetServices_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const servicesRes = await supabaseRest_(env, "get", "servicios", {
    select: "id,nombre_servicio,recomendaciones,titulo_reporte,scope_visibility,owner_usuario,duracion_minutos",
    orderBy: "nombre_servicio",
    ascending: true
  });
  if (!servicesRes.success) {
    return errorResult_(500, servicesRes.message || "No se pudieron cargar los servicios.");
  }

  let patientDoctorOwner = "";
  if (validation.session.role === "paciente") {
    const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
    patientDoctorOwner = normalizeLower_(patient && patient.creado_por);
  }

  const data = (Array.isArray(servicesRes.data) ? servicesRes.data : [])
    .map(normalizeServiceOutputRow_)
    .filter(function(service) {
      if (!service.nombre_servicio) return false;
      if (validation.session.role === "superadmin") return true;
      if (validation.session.role === "admin") {
        return service.scope_visibility === "ALL" || service.owner_usuario === validation.session.user_id;
      }
      return service.scope_visibility === "ALL" || (!!patientDoctorOwner && service.owner_usuario === patientDoctorOwner);
    });

  return { status: 200, payload: { success: true, data } };
}

async function handleGetTakenSlots_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const dateString = normalizeIsoDateValue_(body.fecha);
  if (!dateString) {
    return { status: 400, payload: { success: false, message: "Falta fecha." } };
  }

  const mode = normalizeLower_(body.mode);
  const excludeId = normalizeText_(body.exclude_cita_id || body.appointment_id);
  const appointmentsRes = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,fecha,hora,motivo,duracion_minutos",
    filters: { fecha: eq_(dateString) }
  });
  if (!appointmentsRes.success) {
    return errorResult_(500, appointmentsRes.message || "No se pudo consultar la disponibilidad.");
  }

  const appointments = Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [];
  let requestedDuration = parseAllowedDurationMinutesWorker_(body.duration_minutes);
  if (!requestedDuration && excludeId) {
    const currentAppointment = appointments.find(function(item) {
      return normalizeText_(item && item.id_cita) === excludeId;
    });
    requestedDuration = await resolveAppointmentDurationMinutesWorker_(env, currentAppointment || {});
  }
  requestedDuration = normalizeDurationMinutesWorker_(requestedDuration);

  const occupied = await getOccupiedSlotsForDateWorker_(env, appointments, { excludeId });
  if (mode === "available") {
    return {
      status: 200,
      payload: { success: true, data: getAvailableStartSlotsForDateWorker_(occupied, requestedDuration) }
    };
  }

  return { status: 200, payload: { success: true, data: occupied.slice() } };
}

async function handleScheduleAppointment_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, data.id_paciente);
  if (!patientAccess.ok) {
    return patientAccess.result;
  }

  const fecha = normalizeIsoDateValue_(data.fecha);
  const hora = normalizeTimeText_(data.hora);
  const motivo = normalizeText_(data.motivo);
  if (!fecha || !hora || !motivo) {
    return { status: 400, payload: { success: false, message: "Completa fecha, hora y motivo." } };
  }

  if (validation.session.role === "paciente") {
    const vacationRecord = await findDoctorVacationRecord_(env, patientAccess.patient.creado_por);
    const vacationState = buildVacationResponse_(patientAccess.patient.creado_por, vacationRecord);
    if (vacationState && vacationState.active) {
      return {
        status: 400,
        payload: {
          success: false,
          message: vacationState.block_message || "Tu medico se encuentra de vacaciones y no acepta citas por el momento."
        }
      };
    }
  }

  const durationMinutes = await resolveRequestedAppointmentDurationWorker_(env, data);
  const isAvailable = await isAppointmentRangeAvailableWorker_(env, fecha, hora, durationMinutes, {});
  if (!isAvailable) {
    return {
      status: 409,
      payload: {
        success: false,
        message: "Ese horario ya no esta disponible para la duracion del servicio seleccionado."
      }
    };
  }

  const doctor = await loadUserByRoleAndId_(env, "admin", patientAccess.patient.creado_por);
  const createdBy = normalizeText_(data.creado_por || (validation.session.role === "paciente" ? "PACIENTE_WEB" : "DOCTOR")) || "DOCTOR";
  const record = {
    id_cita: "C-" + Date.now(),
    id_paciente: normalizeText_(patientAccess.patient.id_paciente),
    fecha: fecha,
    hora: hora,
    motivo: motivo,
    estado: "PENDIENTE",
    fecha_registro: new Date().toISOString(),
    nota_paciente: normalizeText_(data.nota || data.nota_paciente),
    recomendaciones_serv: normalizeText_(data.recomendaciones || data.recomendaciones_serv),
    creado_por: createdBy,
    duracion_minutos: durationMinutes
  };

  const insertRes = await supabaseRest_(env, "post", "citas", {
    prefer: "return=representation",
    body: record
  });
  if (!insertRes.success) {
    return errorResult_(500, insertRes.message || "No se pudo guardar la cita.");
  }

  const notifyRes = await sendAppointmentNotificationsByBridge_(env, {
    event: "schedule",
    id_cita: record.id_cita,
    id_paciente: record.id_paciente,
    creado_por: createdBy,
    fecha: fecha,
    hora: hora,
    motivo: motivo,
    recomendaciones: normalizeText_(record.recomendaciones_serv),
    patient_email: normalizeLower_(patientAccess.patient.correo),
    patient_nombre: normalizeText_(patientAccess.patient.nombre_completo),
    patient_telefono: normalizeText_(patientAccess.patient.telefono),
    doctor_email: normalizeLower_(doctor && (doctor.correo_notificaciones || doctor.correo)),
    doctor_nombre: normalizeText_(doctor && (doctor.nombre_doctor || doctor.nombre || patientAccess.patient.creado_por)),
    doctor_telefono: normalizeText_(doctor && doctor.telefono)
  });
  const notifyWarning = !notifyRes.success
    ? (notifyRes.message || "La cita se guardo, pero no se pudo enviar el correo de notificacion.")
    : "";
  const responseMessage = notifyWarning
    ? "Cita procesada correctamente. Advertencia: " + notifyWarning
    : "Cita procesada correctamente.";

  return {
    status: 200,
    payload: {
      success: true,
      message: responseMessage,
      id_cita: record.id_cita,
      telefono: normalizeText_(patientAccess.patient.telefono),
      nombre: normalizeText_(patientAccess.patient.nombre_completo),
      doctor_phone: normalizeText_(doctor && doctor.telefono),
      duracion_minutos: durationMinutes,
      warning: notifyWarning
    }
  };
}

async function handleRescheduleAppointment_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const appointmentId = normalizeText_(data.id_cita);
  const nuevaFecha = normalizeIsoDateValue_(data.nueva_fecha);
  const nuevaHora = normalizeTimeText_(data.nueva_hora);
  if (!appointmentId || !nuevaFecha || !nuevaHora) {
    return { status: 400, payload: { success: false, message: "Completa id_cita, nueva_fecha y nueva_hora." } };
  }

  const access = await resolveAccessibleAppointmentForSession_(env, validation.session, appointmentId);
  if (!access.ok) {
    return access.result;
  }

  if (validation.session.role === "paciente") {
    const vacationRecord = await findDoctorVacationRecord_(env, access.patient.creado_por);
    const vacationState = buildVacationResponse_(access.patient.creado_por, vacationRecord);
    if (vacationState && vacationState.active) {
      return {
        status: 400,
        payload: {
          success: false,
          message: vacationState.block_message || "Tu medico se encuentra de vacaciones y no acepta citas por el momento."
        }
      };
    }
  }

  const durationMinutes = await resolveAppointmentDurationMinutesWorker_(env, access.appointment || {});
  const isAvailable = await isAppointmentRangeAvailableWorker_(env, nuevaFecha, nuevaHora, durationMinutes, {
    excludeId: appointmentId
  });
  if (!isAvailable) {
    return {
      status: 409,
      payload: {
        success: false,
        message: "Ese horario ya no esta disponible para la duracion de esta cita."
      }
    };
  }

  const patchRes = await supabaseRest_(env, "patch", "citas", {
    filters: { id_cita: eq_(appointmentId) },
    prefer: "return=representation",
    body: {
      fecha: nuevaFecha,
      hora: nuevaHora,
      estado: "REAGENDADO"
    }
  });
  if (!patchRes.success) {
    return errorResult_(500, patchRes.message || "No se pudo reagendar la cita.");
  }

  const doctor = await loadUserByRoleAndId_(env, "admin", access.patient.creado_por);
  const notifyRes = await sendAppointmentNotificationsByBridge_(env, {
    event: "reschedule",
    id_cita: appointmentId,
    id_paciente: normalizeText_(access.patient.id_paciente),
    fecha: nuevaFecha,
    hora: nuevaHora,
    motivo: normalizeText_(access.appointment && access.appointment.motivo) || "REAGENDADO",
    patient_email: normalizeLower_(access.patient.correo),
    patient_nombre: normalizeText_(access.patient.nombre_completo),
    patient_telefono: normalizeText_(access.patient.telefono),
    doctor_email: normalizeLower_(doctor && (doctor.correo_notificaciones || doctor.correo)),
    doctor_nombre: normalizeText_(doctor && (doctor.nombre_doctor || doctor.nombre || access.patient.creado_por)),
    doctor_telefono: normalizeText_(doctor && doctor.telefono)
  });
  const notifyWarning = !notifyRes.success
    ? (notifyRes.message || "La cita se reagendo, pero no se pudo enviar el correo de notificacion.")
    : "";
  const responseMessage = notifyWarning
    ? "Cita reagendada correctamente. Advertencia: " + notifyWarning
    : "Cita reagendada correctamente.";
  return {
    status: 200,
    payload: {
      success: true,
      message: responseMessage,
      doctor_phone: normalizeText_(doctor && doctor.telefono),
      warning: notifyWarning
    }
  };
}

async function handleUpdateApptStatus_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const appointmentId = normalizeText_(body.id_cita || body.appointment_id);
  if (!appointmentId) {
    return { status: 400, payload: { success: false, message: "Falta id_cita." } };
  }

  const nextStatus = normalizeAppointmentStatus_(body.estado);
  if (!nextStatus) {
    return { status: 400, payload: { success: false, message: "Estado de cita invalido." } };
  }

  const access = await resolveAccessibleAppointmentForSession_(env, validation.session, appointmentId);
  if (!access.ok) {
    return access.result;
  }

  const patchRes = await supabaseRest_(env, "patch", "citas", {
    filters: { id_cita: eq_(appointmentId) },
    prefer: "return=representation",
    body: { estado: nextStatus }
  });
  if (!patchRes.success) {
    return errorResult_(500, patchRes.message || "No se pudo actualizar el estado de la cita.");
  }

  return { status: 200, payload: { success: true, message: "Estado actualizado" } };
}

async function handleDeleteCita_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const appointmentId = normalizeText_(body.id_cita || body.appointment_id);
  if (!appointmentId) {
    return { status: 400, payload: { success: false, message: "Falta id_cita." } };
  }

  const access = await resolveAccessibleAppointmentForSession_(env, validation.session, appointmentId);
  if (!access.ok) {
    return access.result;
  }
  if (!canPatientDeleteOwnAppointmentForSession_(validation.session, access.appointment)) {
    return {
      status: 403,
      payload: {
        success: false,
        message: "Solo puedes eliminar citas que agendaste tu mismo y que sigan pendientes."
      }
    };
  }

  const deleteRes = await supabaseRest_(env, "delete", "citas", {
    filters: { id_cita: eq_(appointmentId) }
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudo eliminar la cita.");
  }

  let notifyWarning = "";
  if (validationSessionIsPaciente_(validation.session)) {
    const doctor = await loadUserByRoleAndId_(env, "admin", access.patient.creado_por);
    const notifyRes = await sendAppointmentNotificationsByBridge_(env, {
      event: "cancel",
      id_cita: appointmentId,
      id_paciente: normalizeText_(access.patient.id_paciente),
      fecha: normalizeIsoDateValue_(access.appointment && access.appointment.fecha),
      hora: normalizeTimeText_(access.appointment && access.appointment.hora),
      motivo: normalizeText_(access.appointment && access.appointment.motivo),
      recomendaciones: normalizeText_(access.appointment && access.appointment.recomendaciones_serv),
      patient_email: normalizeLower_(access.patient.correo),
      patient_nombre: normalizeText_(access.patient.nombre_completo),
      patient_telefono: normalizeText_(access.patient.telefono),
      doctor_email: normalizeLower_(doctor && (doctor.correo_notificaciones || doctor.correo)),
      doctor_nombre: normalizeText_(doctor && (doctor.nombre_doctor || doctor.nombre || access.patient.creado_por)),
      doctor_telefono: normalizeText_(doctor && doctor.telefono)
    });
    if (!notifyRes.success) {
      notifyWarning = notifyRes.message || "La cita se elimino, pero no se pudo enviar el correo de notificacion.";
    }
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: notifyWarning
        ? ("Cita eliminada correctamente. Advertencia: " + notifyWarning)
        : "Cita eliminada correctamente",
      warning: notifyWarning
    }
  };
}

async function handleDeleteBulkCitas_(body, env) {
  const access = await requireAccessiblePatientForAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!access.ok) {
    return access.result;
  }

  const ids = normalizeIdList_(body.ids);
  if (!ids.length) {
    return {
      status: 400,
      payload: { success: false, deleted_count: 0, missing_ids: [], message: "No se recibieron citas para eliminar." }
    };
  }

  const lookupRes = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,id_paciente,creado_por,estado,fecha,hora,motivo,recomendaciones_serv",
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_cita", inList_(ids)]
    ]
  });
  if (!lookupRes.success) {
    return errorResult_(500, lookupRes.message || "No se pudieron validar las citas a eliminar.");
  }

  const matches = Array.isArray(lookupRes.data) ? lookupRes.data : [];
  if (!matches.length) {
    return {
      status: 404,
      payload: {
        success: false,
        deleted_count: 0,
        missing_ids: ids,
        message: "No se encontraron citas para eliminar."
      }
    };
  }

  const matchedIds = matches.map(function(row) { return normalizeText_(row && row.id_cita); }).filter(Boolean);
  if (matchedIds.length !== ids.length) {
    return {
      status: 400,
      payload: {
        success: false,
        deleted_count: 0,
        missing_ids: ids.filter(function(id) { return matchedIds.indexOf(id) === -1; }),
        message: "Una o mas citas no pertenecen a este paciente."
      }
    };
  }
  if (validationSessionIsPaciente_(access.session)) {
    const denied = matches.find(function(row) {
      return !canPatientDeleteOwnAppointmentForSession_(access.session, row);
    });
    if (denied) {
      return {
        status: 403,
        payload: {
          success: false,
          deleted_count: 0,
          missing_ids: [],
          message: "Solo puedes eliminar citas que agendaste tu mismo y que sigan pendientes."
        }
      };
    }
  }

  const deleteRes = await supabaseRest_(env, "delete", "citas", {
    filters: [
      ["id_paciente", eq_(access.patient.id_paciente)],
      ["id_cita", inList_(matchedIds)]
    ]
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudieron eliminar las citas seleccionadas.");
  }

  let notifyWarning = "";
  if (validationSessionIsPaciente_(access.session)) {
    const doctor = await loadUserByRoleAndId_(env, "admin", access.patient.creado_por);
    const notifyErrors = [];
    for (const row of matches) {
      const notifyRes = await sendAppointmentNotificationsByBridge_(env, {
        event: "cancel",
        id_cita: normalizeText_(row && row.id_cita),
        id_paciente: normalizeText_(access.patient.id_paciente),
        fecha: normalizeIsoDateValue_(row && row.fecha),
        hora: normalizeTimeText_(row && row.hora),
        motivo: normalizeText_(row && row.motivo),
        recomendaciones: normalizeText_(row && row.recomendaciones_serv),
        patient_email: normalizeLower_(access.patient.correo),
        patient_nombre: normalizeText_(access.patient.nombre_completo),
        patient_telefono: normalizeText_(access.patient.telefono),
        doctor_email: normalizeLower_(doctor && (doctor.correo_notificaciones || doctor.correo)),
        doctor_nombre: normalizeText_(doctor && (doctor.nombre_doctor || doctor.nombre || access.patient.creado_por)),
        doctor_telefono: normalizeText_(doctor && doctor.telefono)
      });
      if (!notifyRes.success) {
        notifyErrors.push(notifyRes.message || "No se pudo enviar el correo de notificacion.");
      }
    }
    if (notifyErrors.length) {
      notifyWarning = notifyErrors[0];
    }
  }

  return {
    status: 200,
    payload: {
      success: true,
      deleted_count: matchedIds.length,
      missing_ids: [],
      message: notifyWarning
        ? ((matchedIds.length === 1
            ? "Se elimino 1 cita."
            : ("Se eliminaron " + matchedIds.length + " cita(s).")) + " Advertencia: " + notifyWarning)
        : (matchedIds.length === 1
            ? "Se elimino 1 cita."
            : ("Se eliminaron " + matchedIds.length + " cita(s).")),
      warning: notifyWarning
    }
  };
}

async function handleSelfUpdatePatientProfile_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["paciente"] });
  if (!validation.ok) {
    return validation.result;
  }

  const safePayload = body.data && typeof body.data === "object" ? body.data : {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(safePayload, "nombre_completo")) patch.nombre_completo = normalizeUpper_(safePayload.nombre_completo);
  if (Object.prototype.hasOwnProperty.call(safePayload, "correo")) patch.correo = normalizeLower_(safePayload.correo);
  if (Object.prototype.hasOwnProperty.call(safePayload, "telefono")) patch.telefono = normalizeDigits_(safePayload.telefono);
  if (Object.prototype.hasOwnProperty.call(safePayload, "direccion")) patch.direccion = normalizeUpper_(safePayload.direccion);
  if (Object.prototype.hasOwnProperty.call(safePayload, "ocupacion")) patch.ocupacion = normalizeUpper_(safePayload.ocupacion);
  if (Object.prototype.hasOwnProperty.call(safePayload, "fecha_nacimiento")) patch.fecha_nacimiento = normalizeIsoDateValue_(safePayload.fecha_nacimiento);

  const res = await supabaseRest_(env, "patch", "pacientes", {
    filters: { id_paciente: eq_(validation.session.user_id) },
    prefer: "return=representation",
    body: patch
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo actualizar el perfil del paciente.");
  }

  const updated = res.data[0] || {};
  return {
    status: 200,
    payload: {
      success: true,
      message: "Perfil actualizado.",
      data: {
        id_paciente: String(updated.id_paciente || validation.session.user_id),
        nombre_completo: String(updated.nombre_completo || ""),
        cedula: String(updated.cedula || ""),
        correo: String(updated.correo || ""),
        telefono: String(updated.telefono || ""),
        direccion: String(updated.direccion || ""),
        ocupacion: String(updated.ocupacion || ""),
        fecha_nacimiento: String(updated.fecha_nacimiento || "")
      }
    }
  };
}

async function handleSelfUpdateAdminProfile_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const safePayload = body.data && typeof body.data === "object" ? body.data : {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(safePayload, "nombre_doctor")) patch.nombre_doctor = normalizeUpper_(safePayload.nombre_doctor);
  if (Object.prototype.hasOwnProperty.call(safePayload, "rol")) {
    const role = normalizeUpper_(safePayload.rol);
    patch.rol = role;
    patch.ocupacion = role;
  }
  if (Object.prototype.hasOwnProperty.call(safePayload, "correo_notificaciones")) {
    const email = normalizeLower_(safePayload.correo_notificaciones);
    patch.correo_notificaciones = email;
    patch.correo = email;
  }
  if (Object.prototype.hasOwnProperty.call(safePayload, "telefono")) patch.telefono = normalizeDigits_(safePayload.telefono);
  if (Object.prototype.hasOwnProperty.call(safePayload, "registro_sanitario")) patch.registro_sanitario = normalizeUpper_(safePayload.registro_sanitario);
  if (Object.prototype.hasOwnProperty.call(safePayload, "usar_firma_virtual")) patch.usar_firma_virtual = boolToSheetFlag_(safePayload.usar_firma_virtual);

  const res = await supabaseRest_(env, "patch", "usuarios_admin", {
    filters: { usuario: eq_(validation.session.user_id) },
    prefer: "return=representation",
    body: patch
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo actualizar el perfil del usuario admin.");
  }

  const updated = res.data[0] || {};
  return {
    status: 200,
    payload: {
      success: true,
      message: "Perfil actualizado.",
      data: {
        usuario: String(updated.usuario || validation.session.user_id),
        nombre_doctor: String(updated.nombre_doctor || ""),
        rol: String(updated.rol || updated.ocupacion || ""),
        correo_notificaciones: String(updated.correo_notificaciones || updated.correo || ""),
        telefono: String(updated.telefono || ""),
        registro_sanitario: String(updated.registro_sanitario || ""),
        usar_firma_virtual: sheetFlagToBool_(updated.usar_firma_virtual)
      }
    }
  };
}

async function handleGetMyDoctorInfo_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["paciente"] });
  if (!validation.ok) {
    return validation.result;
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const doctorUser = normalizeLower_(patient.creado_por);
  if (!doctorUser) {
    return {
      status: 200,
      payload: { success: true, data: { nombre_doctor: "", telefono: "", correo: "" } }
    };
  }

  const doctor = await loadUserByRoleAndId_(env, "admin", doctorUser);
  if (!doctor) {
    return {
      status: 200,
      payload: { success: true, data: { nombre_doctor: "", telefono: "", correo: "" } }
    };
  }

  return {
    status: 200,
    payload: {
      success: true,
      data: {
        nombre_doctor: normalizeUpper_(doctor.nombre_doctor || doctor.nombre || ""),
        telefono: normalizeText_(doctor.telefono),
        correo: normalizeLower_(doctor.correo_notificaciones || doctor.correo || "")
      }
    }
  };
}

async function handleGetFileBase64_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, {
    allowRoles: ["admin", "paciente", "superadmin"]
  });
  if (!validation.ok) {
    return validation.result;
  }

  const fileId = normalizeText_(body.file_id || body.id);
  if (!fileId) {
    return { status: 400, payload: { success: false, message: "Falta file_id." } };
  }

  const canAccess = await canSessionAccessLegacyDriveFile_(env, validation.session, fileId);
  if (!canAccess) {
    return { status: 403, payload: { success: false, message: "Acceso denegado." } };
  }

  const candidates = [
    "https://lh3.googleusercontent.com/d/" + encodeURIComponent(fileId),
    "https://drive.google.com/uc?export=view&id=" + encodeURIComponent(fileId)
  ];

  let lastError = "";
  for (const url of candidates) {
    const fetched = await fetchRemoteFileAsDataUrl_(url);
    if (fetched.success) {
      return { status: 200, payload: { success: true, data: fetched.data } };
    }
    lastError = fetched.message || lastError;
  }

  return {
    status: 502,
    payload: {
      success: false,
      message: lastError || "No se pudo cargar la imagen solicitada."
    }
  };
}

async function handleSetMyVacation_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const doctorUser = validation.session.user_id;
  const safePayload = body.data && typeof body.data === "object" ? body.data : {};
  const active = safePayload.activo === undefined ? true : !!safePayload.activo;
  const fechaHasta = normalizeIsoDateValue_(safePayload.fecha_hasta || safePayload.hasta || "");
  const titulo = normalizeUpper_(safePayload.titulo);
  const mensaje = normalizeText_(safePayload.mensaje);

  if (active && !fechaHasta) {
    return {
      status: 400,
      payload: { success: false, message: "Debes indicar la fecha hasta la que estaras fuera." }
    };
  }

  const nowIso = new Date().toISOString();
  const existing = await findDoctorVacationRecord_(env, doctorUser);

  let res;
  if (existing) {
    res = await supabaseRest_(env, "patch", "config_vacaciones", {
      filters: { doctor_usuario: eq_(doctorUser) },
      prefer: "return=representation",
      body: {
        activo: boolToSheetFlag_(active),
        fecha_hasta: fechaHasta,
        titulo: titulo,
        mensaje: mensaje,
        fecha_actualizacion: nowIso
      }
    });
  } else {
    res = await supabaseRest_(env, "post", "config_vacaciones", {
      prefer: "return=representation",
      body: {
        doctor_usuario: doctorUser,
        activo: boolToSheetFlag_(active),
        fecha_hasta: fechaHasta,
        titulo: titulo,
        mensaje: mensaje,
        fecha_actualizacion: nowIso
      }
    });
  }

  if (!res.success || (!existing && (!Array.isArray(res.data) || !res.data.length))) {
    return errorResult_(500, res.message || "No se pudo actualizar el aviso de vacaciones.");
  }

  const refreshed = await findDoctorVacationRecord_(env, doctorUser);
  const payload = buildVacationResponse_(doctorUser, refreshed || {
    doctor_usuario: doctorUser,
    activo: boolToSheetFlag_(active),
    fecha_hasta: fechaHasta,
    titulo: titulo,
    mensaje: mensaje,
    fecha_actualizacion: nowIso
  });
  payload.message = "Aviso de vacaciones actualizado.";
  return { status: 200, payload };
}

async function handleGetMyVacation_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const doctorUser = validation.session.user_id;
  const record = await findDoctorVacationRecord_(env, doctorUser);
  if (!record) {
    return {
      status: 200,
      payload: {
        success: true,
        doctor_usuario: doctorUser,
        active: false,
        fecha_hasta: "",
        titulo: "",
        mensaje: "",
        fecha_actualizacion: "",
        block_message: ""
      }
    };
  }

  return { status: 200, payload: buildVacationResponse_(doctorUser, record) };
}

async function handleGetMyDoctorVacation_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["paciente"] });
  if (!validation.ok) {
    return validation.result;
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const doctorUser = normalizeLower_(patient.creado_por);
  if (!doctorUser) {
    return {
      status: 200,
      payload: {
        success: true,
        doctor_usuario: "",
        active: false,
        fecha_hasta: "",
        titulo: "",
        mensaje: "",
        fecha_actualizacion: "",
        block_message: ""
      }
    };
  }

  const record = await findDoctorVacationRecord_(env, doctorUser);
  if (!record) {
    return {
      status: 200,
      payload: {
        success: true,
        doctor_usuario: doctorUser,
        active: false,
        fecha_hasta: "",
        titulo: "",
        mensaje: "",
        fecha_actualizacion: "",
        block_message: ""
      }
    };
  }

  return { status: 200, payload: buildVacationResponse_(doctorUser, record) };
}

async function handleSavePromotion_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const mensaje = normalizeText_(data.mensaje);
  const fechaInicio = normalizeIsoDateValue_(data.fecha_inicio);
  const fechaFin = normalizeIsoDateValue_(data.fecha_fin);
  const scope = normalizePromotionScope_(data.scope_visibility);
  if (!mensaje || !fechaInicio || !fechaFin) {
    return { status: 400, payload: { success: false, message: "Completa mensaje, fecha_inicio y fecha_fin." } };
  }

  const idPromo = "PROMO-" + Date.now();
  const row = {
    id_promo: idPromo,
    mensaje: mensaje,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    scope_visibility: scope,
    owner_usuario: validation.session.user_id,
    fecha_creacion: new Date().toISOString()
  };

  const res = await supabaseRest_(env, "post", "config_promociones", {
    prefer: "return=representation",
    body: row
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo guardar la promocion.");
  }

  return { status: 200, payload: { success: true, message: "Promocion guardada." } };
}

async function handleGetPromoList_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const isSuper = validation.session.role === "superadmin";
  const res = await supabaseRest_(env, "get", "config_promociones", {
    select: "id_promo,mensaje,fecha_inicio,fecha_fin,scope_visibility,owner_usuario,fecha_creacion",
    orderBy: "fecha_creacion",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar la lista de promociones.");
  }

  const list = (Array.isArray(res.data) ? res.data : [])
    .map(normalizePromotionRow_)
    .filter((item) => {
      if (!item.id) return false;
      if (isSuper) return true;
      return normalizeLower_(item.owner_usuario) === validation.session.user_id;
    });

  return { status: 200, payload: { success: true, list } };
}

async function handleDeletePromotion_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const idPromo = normalizeText_(body.id || (body.data && body.data.id));
  if (!idPromo) {
    return { status: 400, payload: { success: false, message: "Datos incompletos." } };
  }

  const existing = await findPromotionById_(env, idPromo);
  if (!existing) {
    return { status: 404, payload: { success: false, message: "Promocion no encontrada." } };
  }

  if (validation.session.role !== "superadmin" && normalizeLower_(existing.owner_usuario) !== validation.session.user_id) {
    return { status: 403, payload: { success: false, message: "Solo el medico creador puede eliminar esta promocion." } };
  }

  const res = await supabaseRest_(env, "delete", "config_promociones", {
    filters: { id_promo: eq_(idPromo) }
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo eliminar la promocion.");
  }

  return { status: 200, payload: { success: true, message: "Promocion eliminada." } };
}

async function handleGetActivePromotion_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["paciente"] });
  if (!validation.ok) return validation.result;

  const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const owner = normalizeLower_(patient.creado_por);
  const today = new Date().toISOString().split("T")[0];
  const res = await supabaseRest_(env, "get", "config_promociones", {
    select: "id_promo,mensaje,fecha_inicio,fecha_fin,scope_visibility,owner_usuario,fecha_creacion",
    orderBy: "fecha_creacion",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo cargar promociones.");
  }

  const rows = (Array.isArray(res.data) ? res.data : []).map(normalizePromotionRow_);
  for (const item of rows) {
    if (!item.id || !item.inicio || !item.fin) continue;
    if (!(today >= item.inicio && today <= item.fin)) continue;
    if (item.scope_visibility === "ALL" || (owner && normalizeLower_(item.owner_usuario) === owner)) {
      return {
        status: 200,
        payload: {
          success: true,
          active: true,
          id: item.id,
          mensaje: item.mensaje,
          fin: item.fin,
          scope_visibility: item.scope_visibility
        }
      };
    }
  }

  return { status: 200, payload: { success: true, active: false } };
}

async function handleSaveInfographicPost_(body, env, url) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const data = body.data && typeof body.data === "object" ? body.data : {};
  const inputId = normalizeText_(data.id_post || data.id);
  const existing = inputId ? await findInfographicPostById_(env, inputId) : null;
  if (inputId && !existing) {
    return { status: 404, payload: { success: false, message: "Publicacion no encontrada." } };
  }
  if (existing && validation.session.role !== "superadmin" && normalizeLower_(existing.doctor_usuario) !== validation.session.user_id) {
    return { status: 403, payload: { success: false, message: "Solo el medico creador puede modificar esta publicacion." } };
  }

  const postId = existing ? existing.id_post : ("INFO-" + Date.now());
  const imageDataUrl = normalizeText_(data.imagen_data_url);
  const imageUrlRaw = normalizeText_(data.imagen_url);
  const existingImageUrl = normalizeText_(existing && existing.imagen_url);
  let imageUrl = "";

  if (imageDataUrl || isDataImageUrl_(imageUrlRaw) || (existing && !imageDataUrl && !imageUrlRaw && isDataImageUrl_(existingImageUrl))) {
    const upload = await uploadDataUrlToWorkerStorage_(
      env,
      url,
      joinStorageObjectKey_([
        "infografias",
        validation.session.user_id,
        postId,
        "imagen_" + Date.now() + "_" + randomHex_(4)
      ]),
      imageDataUrl || imageUrlRaw || existingImageUrl
    );
    if (!upload.success) {
      return errorResult_(500, upload.message || "No se pudo guardar la imagen de la publicacion.");
    }
    imageUrl = normalizeText_(upload.url);
  } else {
    imageUrl = normalizeExternalUrl_(imageUrlRaw || existingImageUrl || "");
  }

  if (!imageUrl) {
    return { status: 400, payload: { success: false, message: "Debes subir una imagen o ingresar una URL valida." } };
  }

  const finalPost = {
    id_post: postId,
    doctor_usuario: existing ? normalizeLower_(existing.doctor_usuario) : validation.session.user_id,
    scope_visibility: Object.prototype.hasOwnProperty.call(data, "scope_visibility")
      ? normalizePromotionScope_(data.scope_visibility)
      : normalizePromotionScope_(existing && existing.scope_visibility),
    activo: Object.prototype.hasOwnProperty.call(data, "activo")
      ? boolToSheetFlag_(!!data.activo)
      : boolToSheetFlag_(existing ? sheetFlagToBool_(existing.activo) : true),
    titulo: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "titulo") ? data.titulo : (existing && existing.titulo), 120),
    mensaje: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "mensaje") ? data.mensaje : (existing && existing.mensaje), 1600),
    imagen_url: imageUrl,
    imagen_file_id: "",
    show_btn_agenda: boolToSheetFlag_(Object.prototype.hasOwnProperty.call(data, "show_btn_agenda") ? !!data.show_btn_agenda : existing ? sheetFlagToBool_(existing.show_btn_agenda) : true),
    btn_agenda_text: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "btn_agenda_text") ? data.btn_agenda_text : (existing && existing.btn_agenda_text) || "Agenda tu cita", 40) || "Agenda tu cita",
    show_btn_info: boolToSheetFlag_(Object.prototype.hasOwnProperty.call(data, "show_btn_info") ? !!data.show_btn_info : existing ? sheetFlagToBool_(existing.show_btn_info) : true),
    btn_info_text: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "btn_info_text") ? data.btn_info_text : (existing && existing.btn_info_text) || "Mas informacion", 40) || "Mas informacion",
    btn_info_url: "",
    show_btn_source: boolToSheetFlag_(Object.prototype.hasOwnProperty.call(data, "show_btn_source") ? !!data.show_btn_source : existing ? sheetFlagToBool_(existing.show_btn_source) : false),
    btn_source_text: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "btn_source_text") ? data.btn_source_text : (existing && existing.btn_source_text) || "Ir a fuente", 40) || "Ir a fuente",
    btn_source_url: normalizeExternalUrl_(Object.prototype.hasOwnProperty.call(data, "btn_source_url") ? data.btn_source_url : (existing && existing.btn_source_url)),
    show_btn_contacto: boolToSheetFlag_(Object.prototype.hasOwnProperty.call(data, "show_btn_contacto") ? !!data.show_btn_contacto : existing ? sheetFlagToBool_(existing.show_btn_contacto) : true),
    btn_contacto_text: sanitizeInfographicText_(Object.prototype.hasOwnProperty.call(data, "btn_contacto_text") ? data.btn_contacto_text : (existing && existing.btn_contacto_text) || "Contactanos", 40) || "Contactanos",
    fecha_creacion: existing ? String(existing.fecha_creacion || "") : new Date().toISOString(),
    fecha_actualizacion: new Date().toISOString()
  };

  if (!finalPost.titulo && !finalPost.mensaje) {
    return { status: 400, payload: { success: false, message: "Debes ingresar al menos un titulo o mensaje." } };
  }
  if (sheetFlagToBool_(finalPost.show_btn_source) && !finalPost.btn_source_url) {
    return { status: 400, payload: { success: false, message: "Si habilitas 'Ir a fuente' debes ingresar su enlace." } };
  }

  let res;
  if (existing) {
    res = await supabaseRest_(env, "patch", "config_infografias", {
      filters: { id_post: eq_(existing.id_post) },
      prefer: "return=representation",
      body: finalPost
    });
  } else {
    res = await supabaseRest_(env, "post", "config_infografias", {
      prefer: "return=representation",
      body: finalPost
    });
  }
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo guardar la publicacion.");
  }

  const cleanupUrls = [];
  if (existingImageUrl && existingImageUrl !== imageUrl && isWorkerManagedUrlWorker_(existingImageUrl)) {
    cleanupUrls.push(existingImageUrl);
  }
  const cleanupRes = await deleteWorkerManagedAssetUrls_(env, cleanupUrls);

  return {
    status: 200,
    payload: {
      success: true,
      message: existing ? "Publicacion actualizada." : "Publicacion guardada.",
      warning: cleanupRes.success ? "" : (cleanupRes.warning || "No se pudo eliminar la imagen anterior de Cloudflare R2."),
      data: normalizeInfographicRow_(Array.isArray(res.data) && res.data.length ? res.data[0] : finalPost)
    }
  };
}

async function handleGetInfographicPostsAdmin_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const res = await supabaseRest_(env, "get", "config_infografias", {
    select: "id_post,doctor_usuario,scope_visibility,activo,titulo,mensaje,imagen_url,imagen_file_id,show_btn_agenda,btn_agenda_text,show_btn_info,btn_info_text,btn_info_url,show_btn_source,btn_source_text,btn_source_url,show_btn_contacto,btn_contacto_text,fecha_creacion,fecha_actualizacion",
    orderBy: "fecha_actualizacion",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudieron cargar publicaciones.");
  }

  const isSuper = validation.session.role === "superadmin";
  const list = (Array.isArray(res.data) ? res.data : [])
    .map(normalizeInfographicRow_)
    .filter((item) => item.id_post && (isSuper || normalizeLower_(item.doctor_usuario) === validation.session.user_id));

  return { status: 200, payload: { success: true, list } };
}

async function handleDeleteInfographicPost_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;

  const idPost = normalizeText_(body.id || (body.data && body.data.id_post));
  if (!idPost) {
    return { status: 400, payload: { success: false, message: "Acceso denegado." } };
  }

  const existing = await findInfographicPostById_(env, idPost);
  if (!existing) {
    return { status: 404, payload: { success: false, message: "Publicacion no encontrada." } };
  }
  if (validation.session.role !== "superadmin" && normalizeLower_(existing.doctor_usuario) !== validation.session.user_id) {
    return { status: 403, payload: { success: false, message: "Solo el medico creador puede eliminar esta publicacion." } };
  }

  const res = await supabaseRest_(env, "delete", "config_infografias", {
    filters: { id_post: eq_(idPost) }
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo eliminar la publicacion.");
  }

  const cleanupRes = await deleteWorkerManagedAssetByUrl_(env, existing.imagen_url);
  return {
    status: 200,
    payload: {
      success: true,
      message: cleanupRes.success || cleanupRes.skipped
        ? "Publicacion eliminada."
        : "Publicacion eliminada con advertencia.",
      warning: cleanupRes.success || cleanupRes.skipped
        ? ""
        : "La publicacion se elimino, pero no se pudo borrar su imagen de Cloudflare R2."
    }
  };
}

async function handleGetPatientInfographics_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["paciente"] });
  if (!validation.ok) return validation.result;

  const patient = await loadUserByRoleAndId_(env, "paciente", validation.session.user_id);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const doctorOwner = normalizeLower_(patient.creado_por);
  const res = await supabaseRest_(env, "get", "config_infografias", {
    select: "id_post,doctor_usuario,scope_visibility,activo,titulo,mensaje,imagen_url,imagen_file_id,show_btn_agenda,btn_agenda_text,show_btn_info,btn_info_text,btn_info_url,show_btn_source,btn_source_text,btn_source_url,show_btn_contacto,btn_contacto_text,fecha_creacion,fecha_actualizacion",
    orderBy: "fecha_actualizacion",
    ascending: false
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudieron cargar las publicaciones.");
  }

  const visible = (Array.isArray(res.data) ? res.data : [])
    .map(normalizeInfographicRow_)
    .filter((post) => {
      if (!post.id_post) return false;
      if (!post.activo) return false;
      if (post.scope_visibility === "ALL") return true;
      return !!doctorOwner && normalizeLower_(post.doctor_usuario) === doctorOwner;
    });

  const doctorCache = {};
  const list = [];
  for (const post of visible) {
    const doctorUser = normalizeLower_(post.doctor_usuario);
    if (!doctorCache[doctorUser]) {
      doctorCache[doctorUser] = doctorUser ? (await loadUserByRoleAndId_(env, "admin", doctorUser)) : null;
    }
    const doctor = doctorCache[doctorUser] || {};
    list.push({
      id_post: post.id_post,
      doctor_usuario: post.doctor_usuario,
      doctor_nombre: normalizeText_(doctor.nombre_doctor || doctor.nombre || ""),
      scope_visibility: post.scope_visibility,
      titulo: post.titulo,
      mensaje: post.mensaje,
      imagen_url: post.imagen_url,
      show_btn_agenda: post.show_btn_agenda !== false,
      btn_agenda_text: post.btn_agenda_text || "Agenda tu cita",
      show_btn_info: post.show_btn_info !== false,
      btn_info_text: post.btn_info_text || "Mas informacion",
      show_btn_source: post.show_btn_source === true,
      btn_source_text: post.btn_source_text || "Ir a fuente",
      btn_source_url: post.btn_source_url || "",
      show_btn_contacto: post.show_btn_contacto !== false,
      btn_contacto_text: post.btn_contacto_text || "Contactanos",
      doctor_wa_number: normalizePhoneForWa_(doctor.telefono || ""),
      fecha_actualizacion: post.fecha_actualizacion
    });
  }

  return { status: 200, payload: { success: true, list } };
}

async function handleSuperadminGetData_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const doctorsRes = await supabaseRest_(env, "get", "usuarios_admin", {
    select: "nombre_doctor,usuario,password,rol,ocupacion,correo_notificaciones,correo,telefono",
    orderBy: "nombre_doctor",
    ascending: true
  });
  if (!doctorsRes.success) {
    return errorResult_(500, doctorsRes.message || "No se pudo cargar la lista de medicos.");
  }

  const patientsRes = await supabaseRest_(env, "get", "pacientes", {
    select: "id_paciente,cedula,nombre_completo,creado_por",
    orderBy: "nombre_completo",
    ascending: true
  });
  if (!patientsRes.success) {
    return errorResult_(500, patientsRes.message || "No se pudo cargar la lista de pacientes.");
  }

  const doctors = (Array.isArray(doctorsRes.data) ? doctorsRes.data : []).map(function(row) {
    return {
      nombre_doctor: normalizeUpper_(row && row.nombre_doctor),
      usuario: normalizeText_(row && row.usuario),
      password: String((row && row.password) || ""),
      rol: normalizeText_((row && row.rol) || (row && row.ocupacion)),
      correo_notificaciones: normalizeText_((row && row.correo_notificaciones) || (row && row.correo)),
      telefono: normalizeText_(row && row.telefono)
    };
  });

  const patients = (Array.isArray(patientsRes.data) ? patientsRes.data : []).map(function(row) {
    return {
      id_paciente: normalizeText_(row && row.id_paciente),
      cedula: normalizeText_(row && row.cedula),
      nombre_completo: normalizeText_(row && row.nombre_completo),
      creado_por: normalizeText_(row && row.creado_por)
    };
  });

  return { status: 200, payload: { success: true, data: { doctors, patients } } };
}

async function handleSuperadminCreateDoctor_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const payload = normalizeDoctorWritePayloadWorker_(body.data && typeof body.data === "object" ? body.data : {});
  if (!payload.nombre_doctor || !payload.usuario || !payload.password) {
    return { status: 400, payload: { success: false, message: "Completa nombre, usuario y contrasena." } };
  }

  const existing = await findAdminByUser_(env, payload.usuario);
  if (existing) {
    return { status: 400, payload: { success: false, message: "El usuario ya existe." } };
  }

  const row = {
    nombre_doctor: payload.nombre_doctor,
    usuario: payload.usuario,
    password: await toStoredPasswordWorker_(payload.password),
    rol: payload.rol || "DOCTOR",
    ocupacion: payload.rol || "DOCTOR",
    correo_notificaciones: payload.correo_notificaciones,
    correo: payload.correo_notificaciones,
    telefono: payload.telefono,
    first_login: "SI"
  };

  const res = await supabaseRest_(env, "post", "usuarios_admin", {
    prefer: "return=representation",
    body: row
  });
  if (!res.success) {
    return errorResult_(500, res.message || "No se pudo crear el medico.");
  }

  return {
    status: 200,
    payload: { success: true, message: "Medico creado correctamente." }
  };
}

async function handleSuperadminUpdateDoctor_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const payload = normalizeDoctorWritePayloadWorker_(body.data && typeof body.data === "object" ? body.data : {});
  const oldUsuario = normalizeLower_(payload.old_usuario);
  const newUsuario = normalizeLower_(payload.usuario);
  if (!oldUsuario || !newUsuario || !payload.nombre_doctor) {
    return { status: 400, payload: { success: false, message: "Faltan datos del medico." } };
  }

  const existing = await findAdminByUser_(env, oldUsuario);
  if (!existing) {
    return { status: 404, payload: { success: false, message: "Medico no encontrado." } };
  }
  if (oldUsuario !== newUsuario) {
    const collision = await findAdminByUser_(env, newUsuario);
    if (collision) {
      return { status: 400, payload: { success: false, message: "El usuario ya existe." } };
    }
  }

  const patch = {
    nombre_doctor: payload.nombre_doctor,
    usuario: newUsuario,
    rol: payload.rol || "DOCTOR",
    ocupacion: payload.rol || "DOCTOR",
    correo_notificaciones: payload.correo_notificaciones,
    correo: payload.correo_notificaciones,
    telefono: payload.telefono
  };
  if (payload.password) {
    patch.password = await toStoredPasswordWorker_(payload.password);
    patch.first_login = "SI";
  }

  const updateRes = await supabaseRest_(env, "patch", "usuarios_admin", {
    filters: { usuario: eq_(oldUsuario) },
    prefer: "return=representation",
    body: patch
  });
  if (!updateRes.success || !Array.isArray(updateRes.data) || !updateRes.data.length) {
    return errorResult_(500, updateRes.message || "No se pudo actualizar el medico.");
  }

  let reassignedCount = 0;
  if (oldUsuario !== newUsuario) {
    const patientsRes = await supabaseRest_(env, "get", "pacientes", {
      select: "id_paciente",
      filters: { creado_por: eq_(oldUsuario) }
    });
    if (!patientsRes.success) {
      return errorResult_(500, patientsRes.message || "No se pudieron cargar los pacientes a reasignar.");
    }

    reassignedCount = Array.isArray(patientsRes.data) ? patientsRes.data.length : 0;
    if (reassignedCount) {
      const patientPatch = await supabaseRest_(env, "patch", "pacientes", {
        filters: { creado_por: eq_(oldUsuario) },
        prefer: "return=minimal",
        body: { creado_por: newUsuario }
      });
      if (!patientPatch.success) {
        return errorResult_(500, patientPatch.message || "No se pudieron reasignar los pacientes del medico.");
      }
    }

    await supabaseRest_(env, "delete", "worker_sessions", {
      filters: [
        ["role", eq_("admin")],
        ["user_id", eq_(oldUsuario)]
      ]
    });
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: "Medico actualizado.",
      reassigned_patients: reassignedCount
    }
  };
}

async function handleSuperadminDeleteDoctor_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const doctorUsuario = normalizeLower_(body.data && body.data.usuario);
  if (!doctorUsuario) {
    return { status: 400, payload: { success: false, message: "Falta usuario del medico." } };
  }

  const doctor = await findAdminByUser_(env, doctorUsuario);
  if (!doctor) {
    return { status: 404, payload: { success: false, message: "Medico no encontrado." } };
  }

  const patientsRes = await supabaseRest_(env, "get", "pacientes", {
    select: "id_paciente",
    filters: { creado_por: eq_(doctorUsuario) }
  });
  if (!patientsRes.success) {
    return errorResult_(500, patientsRes.message || "No se pudieron cargar los pacientes del medico.");
  }

  const unassigned = Array.isArray(patientsRes.data) ? patientsRes.data.length : 0;
  if (unassigned) {
    const patientPatch = await supabaseRest_(env, "patch", "pacientes", {
      filters: { creado_por: eq_(doctorUsuario) },
      prefer: "return=minimal",
      body: { creado_por: "" }
    });
    if (!patientPatch.success) {
      return errorResult_(500, patientPatch.message || "No se pudieron desasignar los pacientes del medico.");
    }
  }

  const deleteRes = await supabaseRest_(env, "delete", "usuarios_admin", {
    filters: { usuario: eq_(doctorUsuario) }
  });
  if (!deleteRes.success) {
    return errorResult_(500, deleteRes.message || "No se pudo eliminar el medico.");
  }

  await supabaseRest_(env, "delete", "worker_sessions", {
    filters: [
      ["role", eq_("admin")],
      ["user_id", eq_(doctorUsuario)]
    ]
  });

  return {
    status: 200,
    payload: {
      success: true,
      message: "Medico eliminado.",
      unassigned_patients: unassigned
    }
  };
}

async function handleSuperadminAssignPatientDoctor_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const patientId = normalizeText_(body.patient_id);
  const doctorUsuario = normalizeLower_(body.doctor_usuario);
  if (!patientId || !doctorUsuario) {
    return { status: 400, payload: { success: false, message: "Faltan datos para asignar." } };
  }

  const doctor = await findAdminByUser_(env, doctorUsuario);
  if (!doctor) {
    return { status: 404, payload: { success: false, message: "Doctor no encontrado." } };
  }
  const patient = await loadUserByRoleAndId_(env, "paciente", patientId);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const res = await supabaseRest_(env, "patch", "pacientes", {
    filters: { id_paciente: eq_(patientId) },
    prefer: "return=representation",
    body: { creado_por: doctorUsuario }
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo reasignar el paciente.");
  }

  return { status: 200, payload: { success: true, message: "Paciente reasignado." } };
}

async function handleSuperadminUpdatePatientPassword_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const patientId = normalizeText_(body.patient_id);
  const newPassword = normalizeText_(body.new_password);
  if (!patientId || !newPassword) {
    return { status: 400, payload: { success: false, message: "Faltan datos para actualizar clave." } };
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", patientId);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const res = await supabaseRest_(env, "patch", "pacientes", {
    filters: { id_paciente: eq_(patientId) },
    prefer: "return=representation",
    body: { password: await toStoredPasswordWorker_(newPassword) }
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo actualizar la contrasena del paciente.");
  }

  return { status: 200, payload: { success: true, message: "Contrasena de paciente actualizada." } };
}

async function handleSuperadminUpdatePatientManagement_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const payload = body.data && typeof body.data === "object" ? body.data : {};
  const patientId = normalizeText_(payload.patient_id);
  const doctorUsuario = normalizeLower_(payload.doctor_usuario);
  const newPassword = normalizeText_(payload.new_password);
  if (!patientId || !doctorUsuario) {
    return { status: 400, payload: { success: false, message: "Faltan datos para actualizar paciente." } };
  }

  const doctor = await findAdminByUser_(env, doctorUsuario);
  if (!doctor) {
    return { status: 404, payload: { success: false, message: "Doctor no encontrado." } };
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", patientId);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  const patch = { creado_por: doctorUsuario };
  if (newPassword) {
    patch.password = await toStoredPasswordWorker_(newPassword);
  }

  const res = await supabaseRest_(env, "patch", "pacientes", {
    filters: { id_paciente: eq_(patientId) },
    prefer: "return=representation",
    body: patch
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) {
    return errorResult_(500, res.message || "No se pudo actualizar el paciente.");
  }

  return { status: 200, payload: { success: true, message: "Paciente actualizado correctamente." } };
}

async function handleSuperadminDeletePatient_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["superadmin"] });
  if (!validation.ok) {
    return validation.result;
  }

  const patientId = normalizeText_(body.patient_id);
  if (!patientId) {
    return { status: 400, payload: { success: false, message: "Falta patient_id." } };
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", patientId);
  if (!patient) {
    return { status: 404, payload: { success: false, message: "Paciente no encontrado." } };
  }

  return deletePatientCascadeWorker_(env, patientId, {
    action: "superadmin_delete_patient",
    patient_id: patientId,
    requester: validation.session.user_id
  });
}

async function handleGetP12Status_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;
  const bucket = getWorkerStorageBucket_(env);
  if (!bucket) return errorResult_(500, "R2 no esta configurado en el Worker.");
  const key = "firmas/" + validation.session.user_id + "/firma.p12";
  const obj = await bucket.head(key);
  let certName = "Profesional Médico";
  if (obj) {
    const metaObj = await bucket.get(key + ".meta");
    if (metaObj) {
      try { const metaJson = await metaObj.json(); certName = metaJson.cert_name || certName; } catch(e){}
    }
  }
  return { status: 200, payload: { success: true, has_p12: !!obj, uploaded_at: obj ? obj.uploaded : null, cert_name: certName } };
}

async function handleUploadP12_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;
  const bucket = getWorkerStorageBucket_(env);
  if (!bucket) return errorResult_(500, "R2 no esta configurado en el Worker.");
  
  const dataUrl = normalizeText_(body.p12_data_url);
  if (!dataUrl) return { status: 400, payload: { success: false, message: "Falta el archivo p12." } };

  const parsed = parseDataUrlWorker_(dataUrl);
  if (!parsed || !parsed.base64) return { status: 400, payload: { success: false, message: "Archivo p12 invalido." } };

  let bytes;
  try {
    const binary = atob(parsed.base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch (e) {
    return { status: 400, payload: { success: false, message: "No se pudo decodificar el archivo p12." } };
  }

  const certName = normalizeText_(body.cert_name) || "Profesional Médico";
  const key = "firmas/" + validation.session.user_id + "/firma.p12";
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/x-pkcs12", cacheControl: "private, no-cache" }
    });
    await bucket.put(key + ".meta", JSON.stringify({ cert_name: certName }), { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    return errorResult_(500, "No se pudo guardar la firma en R2: " + toErrorMessage(e));
  }
  return { status: 200, payload: { success: true, message: "Firma guardada en la boveda." } };
}

async function handleDeleteP12_(body, env) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;
  const bucket = getWorkerStorageBucket_(env);
  if (!bucket) return errorResult_(500, "R2 no esta configurado en el Worker.");
  const key = "firmas/" + validation.session.user_id + "/firma.p12";
  await bucket.delete(key);
  await bucket.delete(key + ".meta");
  return { status: 200, payload: { success: true, message: "Firma eliminada de la boveda." } };
}

async function requireAccessiblePatientForAction_(env, body, options) {
  const validation = await validateOwnSessionAction_(env, body, options || {});
  if (!validation.ok) {
    return { ok: false, result: validation.result };
  }

  const access = await resolveAccessiblePatientForSession_(
    env,
    validation.session,
    body.id_paciente || body.patient_id || body.user_id
  );
  if (!access.ok) {
    return { ok: false, result: access.result };
  }

  return { ok: true, session: validation.session, patient: access.patient };
}

async function resolveAccessibleAppointmentForSession_(env, session, appointmentId) {
  const targetId = normalizeText_(appointmentId);
  if (!targetId) {
    return { ok: false, result: { status: 400, payload: { success: false, message: "Falta id_cita." } } };
  }

  const appointment = await findSingleByField_(env, "citas", "id_cita", targetId);
  if (!appointment) {
    return { ok: false, result: { status: 404, payload: { success: false, message: "Cita no encontrada." } } };
  }

  const access = await resolveAccessiblePatientForSession_(env, session, appointment.id_paciente);
  if (!access.ok) {
    return access;
  }

  return { ok: true, appointment: appointment, patient: access.patient };
}

async function resolveAccessiblePatientForSession_(env, session, patientId) {
  const targetId = normalizeText_(patientId || (session && session.role === "paciente" ? session.user_id : ""));
  if (!targetId) {
    return { ok: false, result: { status: 400, payload: { success: false, message: "Falta id_paciente." } } };
  }

  const patient = await loadUserByRoleAndId_(env, "paciente", targetId);
  if (!patient) {
    return { ok: false, result: { status: 404, payload: { success: false, message: "Paciente no encontrado." } } };
  }

  const role = normalizeLower_(session && session.role);
  if (role === "superadmin") {
    return { ok: true, patient };
  }
  if (role === "paciente") {
    if (normalizeText_(patient.id_paciente) !== normalizeText_(session.user_id)) {
      return { ok: false, result: { status: 403, payload: { success: false, message: "Acceso denegado." } } };
    }
    return { ok: true, patient };
  }
  if (role === "admin" && normalizeLower_(patient.creado_por) === normalizeLower_(session.user_id)) {
    return { ok: true, patient };
  }

  return { ok: false, result: { status: 403, payload: { success: false, message: "Acceso denegado." } } };
}

async function validateOwnSessionAction_(env, body, options) {
  try {
    assertSupabaseEnv_(env);
  } catch (error) {
    return { ok: false, result: errorResult_(500, toErrorMessage(error)) };
  }

  const session = await requireValidSession_(env, body.session_token);
  if (!session.ok) {
    return {
      ok: false,
      result: { status: 401, payload: { success: false, message: "Sesion invalida o expirada." } }
    };
  }

  const allowRoles = Array.isArray(options && options.allowRoles) ? options.allowRoles : [];
  if (allowRoles.length && allowRoles.indexOf(session.role) === -1) {
    return {
      ok: false,
      result: { status: 403, payload: { success: false, message: "Acceso denegado." } }
    };
  }

  if (body.requester && !requesterMatchesSession_(body.requester, session)) {
    return {
      ok: false,
      result: { status: 403, payload: { success: false, message: "Acceso denegado." } }
    };
  }

  const roleFromBody = normalizeLower_(body.role);
  if (roleFromBody && roleFromBody !== session.role) {
    return {
      ok: false,
      result: { status: 403, payload: { success: false, message: "Acceso denegado." } }
    };
  }

  const userIdFromBody = normalizeSessionUserId_(session.role, body.user_id);
  if (userIdFromBody && userIdFromBody !== session.user_id) {
    return {
      ok: false,
      result: { status: 403, payload: { success: false, message: "Acceso denegado." } }
    };
  }

  await touchSession_(env, session.token_hash);
  return { ok: true, session };
}

async function proxyToAppsScript_(body, env) {
  const targetUrl = normalizeText_(env.APPS_SCRIPT_API_URL);
  if (!targetUrl) {
    return {
      status: 501,
      payload: {
        success: false,
        message: "Accion no implementada en el Worker y APPS_SCRIPT_API_URL no esta configurado."
      }
    };
  }

  const proxiedBody = cloneWithoutSessionToken_(body);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proxiedBody)
    });

    const text = await response.text();
    const parsed = safeJsonParse_(text);
    if (parsed !== null) {
      return {
        status: response.ok ? 200 : 502,
        payload: parsed
      };
    }

    return {
      status: 502,
      payload: {
        success: false,
        message: "El proxy recibio una respuesta no JSON desde Apps Script.",
        upstream_status: response.status
      }
    };
  } catch (error) {
    return {
      status: 502,
      payload: {
        success: false,
        message: "No se pudo contactar Apps Script desde el Worker.",
        detail: toErrorMessage(error)
      }
    };
  }
}

async function sendAppointmentNotificationsByBridge_(env, payload) {
  const targetUrl = normalizeText_(env && env.APPS_SCRIPT_API_URL);
  const bridgeTokens = resolveBridgeTokenCandidates_(env);
  if (!targetUrl || !bridgeTokens.length) {
    return {
      success: false,
      skipped: true,
      message: "Puente de correo no configurado."
    };
  }

  const safePayload = payload && typeof payload === "object" ? payload : {};
  let lastError = "";
  let authRejected = false;

  for (const bridgeToken of bridgeTokens) {
    const body = {
      action: "worker_send_cita_notifications",
      bridge_token: bridgeToken,
      data: safePayload
    };

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      const parsed = safeJsonParse_(text);
      if (!parsed || typeof parsed !== "object") {
        lastError = "El puente de correo respondio en formato no JSON.";
        continue;
      }
      if (parsed.success) {
        return { success: true };
      }

      const msg = normalizeText_(parsed.message) || "No se pudieron enviar las notificaciones de correo.";
      if (msg.toLowerCase().indexOf("acción api no reconocida: worker_send_cita_notifications") === 0
        || msg.toLowerCase().indexOf("accion api no reconocida: worker_send_cita_notifications") === 0) {
        return {
          success: false,
          message: "La cita se guardo, pero el modulo de correos del Apps Script publicado esta desactualizado."
        };
      }
      lastError = msg;
      const msgLower = msg.toLowerCase();
      if (msgLower.indexOf("acceso denegado") === 0 || msgLower.indexOf("bridge token") > -1) {
        authRejected = true;
        continue;
      }
      // Error funcional (no de token): no tiene sentido intentar con otro token.
      return { success: false, message: msg };
    } catch (error) {
      lastError = "No se pudo contactar el puente de correo: " + toErrorMessage(error);
      continue;
    }
  }

  if (authRejected) {
    return {
      success: false,
      message: "Bridge token rechazado por Apps Script. Configura el mismo token en ambos lados: Worker (.dev.vars: WORKER_BRIDGE_TOKEN o WORKER_BRIDGE_TOKENS) y Apps Script Script Properties (VIDAFEM_WORKER_BRIDGE_TOKEN o WORKER_BRIDGE_TOKEN)."
    };
  }

  return {
    success: false,
    message: lastError || "No se pudieron enviar las notificaciones de correo."
  };
}

function resolveBridgeTokenCandidates_(env) {
  const rawList = [
    normalizeText_(env && env.WORKER_BRIDGE_TOKENS),
    normalizeText_(env && env.WORKER_BRIDGE_TOKEN)
  ];
  const out = [];
  const seen = {};
  rawList.forEach(function(raw) {
    if (!raw) return;
    raw.split(/[\s,;]+/).forEach(function(token) {
      const clean = normalizeBridgeTokenValueWorker_(token);
      if (!clean || seen[clean]) return;
      seen[clean] = true;
      out.push(clean);
    });
  });
  return out;
}

function normalizeBridgeTokenValueWorker_(value) {
  let token = normalizeText_(value);
  if (!token) return "";
  if ((token.charAt(0) === '"' && token.charAt(token.length - 1) === '"') ||
      (token.charAt(0) === "'" && token.charAt(token.length - 1) === "'")) {
    token = normalizeText_(token.substring(1, token.length - 1));
  }
  return token;
}

async function requireValidSession_(env, token) {
  const rawToken = normalizeText_(token);
  if (!rawToken) return { ok: false };

  const tokenHash = await sha256Base64Url_(rawToken);
  const session = await findSessionByHash_(env, tokenHash);
  if (!session) return { ok: false };

  const expiresAtMs = Date.parse(String(session.expires_at || ""));
  if (!expiresAtMs || expiresAtMs <= Date.now()) {
    await deleteSessionByHash_(env, tokenHash);
    return { ok: false };
  }

  return {
    ok: true,
    token_hash: tokenHash,
    role: normalizeLower_(session.role),
    user_id: normalizeSessionUserId_(session.role, session.user_id),
    expires_at: String(session.expires_at || "")
  };
}

async function createSession_(env, role, userId) {
  const token = randomBase64Url_(32);
  const tokenHash = await sha256Base64Url_(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (getSessionTtlSeconds_(env) * 1000)).toISOString();

  const insert = await supabaseRest_(env, "post", "worker_sessions", {
    prefer: "return=representation",
    body: {
      token_hash: tokenHash,
      role: normalizeLower_(role),
      user_id: normalizeSessionUserId_(role, userId),
      expires_at: expiresAt,
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      metadata: { version: 1 }
    }
  });

  if (!insert.success) {
    return { success: false, message: insert.message || "No se pudo crear la sesion." };
  }

  return { success: true, token, expires_at: expiresAt };
}

async function findSessionByHash_(env, tokenHash) {
  const res = await supabaseRest_(env, "get", "worker_sessions", {
    select: "*",
    filters: { token_hash: eq_(tokenHash) },
    limit: 1
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) return null;
  return res.data[0];
}

async function deleteSessionByToken_(env, token) {
  const tokenHash = await sha256Base64Url_(normalizeText_(token));
  return deleteSessionByHash_(env, tokenHash);
}

async function deleteSessionByHash_(env, tokenHash) {
  const res = await supabaseRest_(env, "delete", "worker_sessions", {
    filters: { token_hash: eq_(tokenHash) }
  });
  return { success: !!res.success, message: res.message || "" };
}

async function touchSession_(env, tokenHash) {
  await supabaseRest_(env, "patch", "worker_sessions", {
    filters: { token_hash: eq_(tokenHash) },
    prefer: "return=minimal",
    body: { last_seen_at: new Date().toISOString() }
  });
}

async function findAdminByUser_(env, usuario) {
  return findSingleByField_(env, "usuarios_admin", "usuario", normalizeLower_(usuario));
}

async function findSuperadminByUser_(env, usuario) {
  return findSingleByField_(env, "usuarios_superadmin", "usuario", normalizeLower_(usuario));
}

async function findPatientByCedula_(env, cedula) {
  return findSingleByField_(env, "pacientes", "cedula", normalizeDigits_(cedula));
}

async function loadUserByRoleAndId_(env, role, userId) {
  const r = normalizeLower_(role);
  if (r === "admin") return findSingleByField_(env, "usuarios_admin", "usuario", normalizeLower_(userId));
  if (r === "superadmin") return findSingleByField_(env, "usuarios_superadmin", "usuario", normalizeLower_(userId));
  if (r === "paciente") return findSingleByField_(env, "pacientes", "id_paciente", normalizeText_(userId));
  return null;
}

async function findSingleByField_(env, tableName, fieldName, value) {
  const clean = normalizeText_(value);
  if (!clean) return null;
  const res = await supabaseRest_(env, "get", tableName, {
    select: "*",
    filters: { [fieldName]: eq_(clean) },
    limit: 1
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) return null;
  return res.data[0];
}

async function loadPatientMapByIds_(env, patientIds) {
  const ids = normalizeIdList_(patientIds);
  if (!ids.length) return {};

  const res = await supabaseRest_(env, "get", "pacientes", {
    select: "id_paciente,nombre_completo,telefono,creado_por",
    filters: { id_paciente: inList_(ids) }
  });
  if (!res.success || !Array.isArray(res.data)) return {};

  const map = {};
  res.data.forEach(function(row) {
    const patientId = normalizeText_(row && row.id_paciente);
    if (!patientId) return;
    map[patientId] = row || {};
  });
  return map;
}

async function maybeUpgradePasswordHash_(env, role, row, plainPassword) {
  const stored = String((row && row.password) || "");
  const input = normalizeText_(plainPassword);
  if (!stored || !input || isPasswordHash_(stored) || stored !== input) return;
  await updateUserPassword_(env, role, getUserIdForRole_(role, row), input, { clearFirstLogin: false });
}

async function findDoctorVacationRecord_(env, doctorUser) {
  const doctor = normalizeLower_(doctorUser);
  if (!doctor) return null;
  const res = await supabaseRest_(env, "get", "config_vacaciones", {
    select: "doctor_usuario,activo,fecha_hasta,titulo,mensaje,fecha_actualizacion",
    filters: { doctor_usuario: eq_(doctor) },
    orderBy: "fecha_actualizacion",
    ascending: false,
    limit: 1
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) return null;
  return res.data[0];
}

async function findPromotionById_(env, idPromo) {
  const res = await supabaseRest_(env, "get", "config_promociones", {
    select: "id_promo,mensaje,fecha_inicio,fecha_fin,scope_visibility,owner_usuario,fecha_creacion",
    filters: { id_promo: eq_(idPromo) },
    limit: 1
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) return null;
  return res.data[0];
}

async function findInfographicPostById_(env, idPost) {
  const res = await supabaseRest_(env, "get", "config_infografias", {
    select: "id_post,doctor_usuario,scope_visibility,activo,titulo,mensaje,imagen_url,imagen_file_id,show_btn_agenda,btn_agenda_text,show_btn_info,btn_info_text,btn_info_url,show_btn_source,btn_source_text,btn_source_url,show_btn_contacto,btn_contacto_text,fecha_creacion,fecha_actualizacion",
    filters: { id_post: eq_(idPost) },
    limit: 1
  });
  if (!res.success || !Array.isArray(res.data) || !res.data.length) return null;
  return res.data[0];
}

async function updateUserPassword_(env, role, userId, newPassword, options) {
  const tableMeta = getTableMetaForRole_(role);
  if (!tableMeta.table || !tableMeta.keyField || !tableMeta.keyValue(userId)) {
    return { success: false, message: "No se pudo identificar la tabla del usuario." };
  }

  const patch = {
    password: await hashPassword_(newPassword)
  };
  if (options && options.clearFirstLogin && tableMeta.hasFirstLogin) {
    patch.first_login = "NO";
  }

  const res = await supabaseRest_(env, "patch", tableMeta.table, {
    filters: { [tableMeta.keyField]: eq_(tableMeta.keyValue(userId)) },
    prefer: "return=representation",
    body: patch
  });
  return { success: !!res.success, message: res.message || "" };
}

async function updateFirstLoginFlag_(env, role, userId, value) {
  const tableMeta = getTableMetaForRole_(role);
  if (!tableMeta.table || !tableMeta.keyField || !tableMeta.hasFirstLogin) {
    return { success: false, message: "Este rol no maneja primer ingreso." };
  }

  const res = await supabaseRest_(env, "patch", tableMeta.table, {
    filters: { [tableMeta.keyField]: eq_(tableMeta.keyValue(userId)) },
    prefer: "return=representation",
    body: { first_login: normalizeUpper_(value) || "NO" }
  });
  return { success: !!res.success, message: res.message || "" };
}

async function toStoredPasswordWorker_(value) {
  const pass = normalizeText_(value);
  if (!pass) return "";
  if (isPasswordHash_(pass)) return pass;
  return hashPassword_(pass);
}

function normalizeDoctorWritePayloadWorker_(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  return {
    old_usuario: normalizeLower_(src.old_usuario),
    usuario: normalizeLower_(src.usuario),
    nombre_doctor: normalizeUpper_(src.nombre_doctor),
    password: normalizeText_(src.password),
    rol: normalizeUpper_(src.rol || "DOCTOR") || "DOCTOR",
    correo_notificaciones: normalizeLower_(src.correo_notificaciones),
    telefono: normalizeDigits_(src.telefono)
  };
}

async function normalizePatientWritePayloadWorker_(payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const out = {};

  if (Object.prototype.hasOwnProperty.call(src, "id_paciente")) out.id_paciente = normalizeText_(src.id_paciente);
  if (Object.prototype.hasOwnProperty.call(src, "nombre_completo")) out.nombre_completo = normalizeUpper_(src.nombre_completo);
  if (Object.prototype.hasOwnProperty.call(src, "cedula")) out.cedula = normalizeDigits_(src.cedula);
  if (Object.prototype.hasOwnProperty.call(src, "telefono")) out.telefono = normalizeDigits_(src.telefono);
  if (Object.prototype.hasOwnProperty.call(src, "correo")) out.correo = normalizeLower_(src.correo);
  if (Object.prototype.hasOwnProperty.call(src, "direccion")) out.direccion = normalizeUpper_(src.direccion);
  if (Object.prototype.hasOwnProperty.call(src, "ocupacion")) out.ocupacion = normalizeUpper_(src.ocupacion);
  if (Object.prototype.hasOwnProperty.call(src, "fecha_nacimiento")) out.fecha_nacimiento = normalizeIsoDateValue_(src.fecha_nacimiento);
  if (Object.prototype.hasOwnProperty.call(src, "fecha_registro")) out.fecha_registro = normalizeIsoDateValue_(src.fecha_registro);
  if (Object.prototype.hasOwnProperty.call(src, "creado_por")) out.creado_por = normalizeLower_(src.creado_por);
  if (Object.prototype.hasOwnProperty.call(src, "first_login")) out.first_login = normalizeUpper_(src.first_login);

  const antecedentes = Object.prototype.hasOwnProperty.call(src, "antecedentes_medicos")
    ? src.antecedentes_medicos
    : src.antecedentes;
  if (antecedentes !== undefined) {
    out.antecedentes_medicos = normalizeUpper_(antecedentes);
  }

  if (Object.prototype.hasOwnProperty.call(src, "password")) {
    out.password = await toStoredPasswordWorker_(src.password);
  }

  return out;
}

async function deletePatientCascadeWorker_(env, patientId, proxyBody) {
  const targetId = normalizeText_(patientId);
  if (!targetId) {
    return { status: 400, payload: { success: false, message: "Falta patient_id." } };
  }

  const patientStoragePrefix = getPatientStoragePrefix_(targetId);

  const diagnosesRes = await supabaseRest_(env, "get", "diagnosticos_archivos", {
    select: "id_reporte,id_paciente,datos_json,pdf_url",
    filters: { id_paciente: eq_(targetId) }
  });
  if (!diagnosesRes.success) {
    return errorResult_(500, diagnosesRes.message || "No se pudieron validar los diagnosticos del paciente.");
  }

  const diagnoses = Array.isArray(diagnosesRes.data) ? diagnosesRes.data : [];
  const hasLegacyDriveAssets = diagnoses.some(diagnosisRecordRequiresAppsScriptCleanup_);

  const cleanupSteps = [
    {
      table: "historia_clinica",
      filters: { id_paciente: eq_(targetId) },
      message: "No se pudo eliminar la historia clinica del paciente."
    },
    {
      table: "citas",
      filters: { id_paciente: eq_(targetId) },
      message: "No se pudieron eliminar las citas del paciente."
    },
    {
      table: "diagnosticos_archivos",
      filters: { id_paciente: eq_(targetId) },
      message: "No se pudieron eliminar los diagnosticos del paciente."
    },
    {
      table: "evolucion_paciente",
      filters: { id_paciente: eq_(targetId) },
      message: "No se pudo eliminar la evolucion del paciente."
    },
    {
      table: "worker_sessions",
      filters: [
        ["role", eq_("paciente")],
        ["user_id", eq_(targetId)]
      ],
      message: "No se pudieron limpiar las sesiones activas del paciente."
    }
  ];

  for (const step of cleanupSteps) {
    const res = await supabaseRest_(env, "delete", step.table, {
      filters: step.filters
    });
    if (!res.success) {
      return errorResult_(500, step.message || res.message || "No se pudo limpiar informacion relacionada del paciente.");
    }
  }

  const deletePatientRes = await supabaseRest_(env, "delete", "pacientes", {
    filters: { id_paciente: eq_(targetId) }
  });
  if (!deletePatientRes.success) {
    return errorResult_(500, deletePatientRes.message || "No se pudo eliminar el paciente.");
  }

  const storageCleanup = patientStoragePrefix
    ? await deleteWorkerStoragePrefix_(env, patientStoragePrefix)
    : { success: true, warning: "" };

  const warnings = [];
  if (hasLegacyDriveAssets) {
    warnings.push("El paciente tenia diagnosticos con archivos heredados de Drive. Los registros se eliminaron de Supabase, pero esos archivos externos no se borraron fisicamente.");
  }
  if (!storageCleanup.success) {
    warnings.push(storageCleanup.warning || "No se pudieron borrar todos los archivos del paciente en Cloudflare R2.");
  }

  return {
    status: 200,
    payload: {
      success: true,
      message: warnings.length
        ? "Paciente y sus datos eliminados con advertencia."
        : "Paciente y todos sus datos eliminados correctamente.",
      warning: warnings.join(" | ")
    }
  };
}

function getTableMetaForRole_(role) {
  const normalized = normalizeLower_(role);
  if (normalized === "admin") {
    return {
      table: "usuarios_admin",
      keyField: "usuario",
      keyValue: (value) => normalizeLower_(value),
      hasFirstLogin: true
    };
  }
  if (normalized === "superadmin") {
    return {
      table: "usuarios_superadmin",
      keyField: "usuario",
      keyValue: (value) => normalizeLower_(value),
      hasFirstLogin: false
    };
  }
  if (normalized === "paciente") {
    return {
      table: "pacientes",
      keyField: "id_paciente",
      keyValue: (value) => normalizeText_(value),
      hasFirstLogin: true
    };
  }
  return { table: "", keyField: "", keyValue: () => "", hasFirstLogin: false };
}

function getUserIdForRole_(role, row) {
  const r = normalizeLower_(role);
  if (!row || typeof row !== "object") return "";
  if (r === "admin" || r === "superadmin") return normalizeLower_(row.usuario);
  if (r === "paciente") return normalizeText_(row.id_paciente);
  return "";
}

function requesterMatchesSession_(requester, session) {
  const normalizedRequester = normalizeSessionUserId_(session.role, requester);
  return !!normalizedRequester && normalizedRequester === session.user_id;
}

function normalizeSessionUserId_(role, userId) {
  const r = normalizeLower_(role);
  const raw = normalizeText_(userId);
  if (!raw) return "";
  if (r === "admin" || r === "superadmin") return normalizeLower_(raw);
  return raw;
}

function sanitizeUserData_(row) {
  const out = {};
  const src = row && typeof row === "object" ? row : {};
  for (const key of Object.keys(src)) {
    if (key === "password") continue;
    out[key] = src[key];
  }
  return out;
}

function isPasswordHash_(value) {
  const raw = String(value || "");
  return raw.startsWith("sha256$") && raw.split("$").length === 3;
}

async function hashPassword_(plainPassword) {
  const plain = normalizeText_(plainPassword);
  if (!plain) return "";
  const salt = randomHex_(8);
  const digest = await sha256Base64Url_(salt + "|" + plain);
  return "sha256$" + salt + "$" + digest;
}

async function verifyPassword_(inputPassword, storedPassword) {
  const input = normalizeText_(inputPassword);
  const stored = String(storedPassword || "");
  if (!stored || !input) return false;

  if (!isPasswordHash_(stored)) {
    return stored === input;
  }

  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const expected = parts[2];
  const actual = await sha256Base64Url_(salt + "|" + input);
  return actual === expected;
}

async function supabaseRest_(env, method, tableName, options) {
  const baseUrl = normalizeText_(env.SUPABASE_URL).replace(/\/+$/g, "");
  const serviceRole = normalizeText_(env.SUPABASE_SERVICE_ROLE_KEY);
  const table = normalizeText_(tableName);
  if (!baseUrl || !serviceRole || !table) {
    return { success: false, message: "Faltan variables de Supabase en el Worker." };
  }

  const opts = options || {};
  const query = [];
  if (opts.select) query.push("select=" + encodeURIComponent(String(opts.select)));
  if (opts.limit) query.push("limit=" + encodeURIComponent(String(opts.limit)));
  if (opts.onConflict) query.push("on_conflict=" + encodeURIComponent(String(opts.onConflict)));
  if (opts.orderBy) {
    query.push(
      "order=" + encodeURIComponent(String(opts.orderBy)) + "." + encodeURIComponent(opts.ascending === true ? "asc" : "desc")
    );
  }
  if (Array.isArray(opts.filters)) {
    for (const entry of opts.filters) {
      const key = Array.isArray(entry) ? entry[0] : "";
      const value = Array.isArray(entry) ? entry[1] : "";
      const cleanKey = normalizeText_(key);
      const cleanValue = String(value === undefined || value === null ? "" : value).trim();
      if (!cleanKey || !cleanValue) continue;
      query.push(encodeURIComponent(cleanKey) + "=" + encodeURIComponent(cleanValue));
    }
  } else if (opts.filters && typeof opts.filters === "object") {
    for (const [key, value] of Object.entries(opts.filters)) {
      const cleanKey = normalizeText_(key);
      const cleanValue = String(value === undefined || value === null ? "" : value).trim();
      if (!cleanKey || !cleanValue) continue;
      query.push(encodeURIComponent(cleanKey) + "=" + encodeURIComponent(cleanValue));
    }
  }

  const url = baseUrl + "/rest/v1/" + encodeURIComponent(table) + (query.length ? "?" + query.join("&") : "");
  const headers = {
    apikey: serviceRole,
    Authorization: "Bearer " + serviceRole,
    Accept: "application/json"
  };
  if (opts.prefer) headers.Prefer = String(opts.prefer);

  const requestInit = {
    method: String(method || "get").toUpperCase(),
    headers
  };

  if (Object.prototype.hasOwnProperty.call(opts, "body")) {
    headers["Content-Type"] = "application/json";
    requestInit.body = JSON.stringify(opts.body);
  }

  try {
    const response = await fetch(url, requestInit);
    const text = await response.text();
    const data = safeJsonParse_(text);
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: extractSupabaseErrorMessage_(text, data) || ("Supabase HTTP " + response.status),
        data
      };
    }
    return { success: true, status: response.status, data };
  } catch (error) {
    return { success: false, message: toErrorMessage(error) };
  }
}

async function handleSignExistingDiagnosisAsset_(body, env, requestUrl) {
  const validation = await validateOwnSessionAction_(env, body, { allowRoles: ["admin", "superadmin"] });
  if (!validation.ok) return validation.result;
  const reportId = normalizeText_(body.id_reporte);
  const assetType = normalizeText_(body.asset_type);
  const assetId = normalizeText_(body.asset_id);
  const pdfDataUrl = normalizeText_(body.pdf_data_url);
  const password = normalizeText_(body.firma_password);
  if (!reportId || !assetType || !pdfDataUrl || !password) {
    return { status: 400, payload: { success: false, message: "Faltan datos para firmar el documento." } };
  }
  const signed = await signPdfWithCloudflareWorker_(env, validation.session.user_id, password, pdfDataUrl);
  if (!signed.success || !signed.dataUrl || signed.warning) {
    return { status: 500, payload: { success: false, message: signed.message || signed.warning || "Error criptografico al firmar el PDF." } };
  }
  const report = await findSingleByField_(env, "diagnosticos_archivos", "id_reporte", reportId);
  if (!report) return { status: 404, payload: { success: false, message: "Reporte no encontrado." } };
  const patientAccess = await resolveAccessiblePatientForSession_(env, validation.session, report.id_paciente);
  if (!patientAccess.ok) return patientAccess.result;
  const newKey = joinStorageObjectKey_([report.id_paciente, reportId, "firmados", assetType + "_" + Date.now() + "_" + randomHex_(4)]);
  const upload = await uploadDataUrlToWorkerStorage_(env, requestUrl, newKey, signed.dataUrl);
  if (!upload.success) return { status: 500, payload: { success: false, message: "No se pudo guardar el PDF firmado." } };
  const newUrl = upload.url;
  const payload = parseStoredDiagnosisJson_(report.datos_json);
  let updatedPdfUrl = normalizeText_(report.pdf_url);
  let oldUrl = "";
  if (assetType === "report_pdf") {
    oldUrl = updatedPdfUrl;
    updatedPdfUrl = newUrl;
  } else if (assetType === "recipe_pdf") {
    oldUrl = payload.pdf_receta_link;
    payload.pdf_receta_link = newUrl;
  } else if (assetType === "certificate_pdf") {
    oldUrl = payload.pdf_certificado_link;
    payload.pdf_certificado_link = newUrl;
  } else if (assetType === "external_pdf") {
    let externalItems = getDiagnosisExternalPdfItemsForWorker_(payload);
    const idx = externalItems.findIndex(i => String(i.id) === assetId || String(i.url) === assetId);
    if (idx > -1) {
      oldUrl = externalItems[idx].url;
      externalItems[idx].url = newUrl;
      payload.pdf_externos = externalItems;
      if (idx === 0) payload.pdf_externo_link = newUrl;
    }
  }
  const updateRes = await supabaseRest_(env, "patch", "diagnosticos_archivos", { filters: { id_reporte: eq_(reportId) }, prefer: "return=minimal", body: { datos_json: JSON.stringify(payload), pdf_url: updatedPdfUrl } });
  if (!updateRes.success) return { status: 500, payload: { success: false, message: "No se pudo actualizar BD." } };
  if (oldUrl && isWorkerManagedUrlWorker_(oldUrl)) await deleteWorkerManagedAssetByUrl_(env, oldUrl);
  return { status: 200, payload: { success: true, message: "Documento firmado exitosamente.", new_url: newUrl } };
}

function extractSupabaseErrorMessage_(rawText, parsed) {
  if (parsed && typeof parsed === "object") {
    if (parsed.message) return String(parsed.message);
    if (parsed.error && typeof parsed.error === "string") return parsed.error;
  }
  return normalizeText_(rawText);
}

function assertSupabaseEnv_(env) {
  if (!normalizeText_(env.SUPABASE_URL) || !normalizeText_(env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias.");
  }
}

function getSessionTtlSeconds_(env) {
  const raw = Number(String(env.SESSION_TTL_SECONDS || "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return SESSION_TTL_DEFAULT_SECONDS;
  return Math.max(300, Math.floor(raw));
}

function cloneWithoutSessionToken_(body) {
  const out = {};
  for (const key of Object.keys(body || {})) {
    if (key === "session_token") continue;
    out[key] = body[key];
  }
  return out;
}

function readJsonBody_(request) {
  return request.json().catch(() => null);
}

function safeJsonParse_(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (error) {
    return null;
  }
}

function eq_(value) {
  return "eq." + String(value === undefined || value === null ? "" : value).trim();
}

function inList_(values) {
  const list = normalizeIdList_(values);
  return list.length ? ("in.(" + list.map(encodePostgrestInValue_).join(",") + ")") : "";
}

function gte_(value) {
  return "gte." + normalizeText_(value);
}

function lte_(value) {
  return "lte." + normalizeText_(value);
}

function encodePostgrestInValue_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function jsonResponse(request, env, payload, status) {
  const headers = buildCorsHeaders_(request, env);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    status: status || 200,
    headers
  });
}

function buildPreflightResponse(request, env) {
  const headers = buildCorsHeaders_(request, env);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-max-age", "86400");
  return new Response(null, { status: 204, headers });
}

function buildCorsHeaders_(request, env) {
  const headers = new Headers();
  headers.set("access-control-allow-origin", resolveAllowedOrigin_(request, env));
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  return headers;
}

function resolveAllowedOrigin_(request, env) {
  const origin = normalizeText_(request.headers.get("Origin"));
  const configured = String(env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => normalizeText_(item))
    .filter(Boolean);

  if (!configured.length || configured.indexOf("*") !== -1) {
    return origin || "*";
  }
  if (origin && configured.indexOf(origin) !== -1) {
    return origin;
  }
  return configured[0];
}

function normalizeText_(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function normalizeLower_(value) {
  return normalizeText_(value).toLowerCase();
}

function normalizeUpper_(value) {
  return normalizeText_(value).toUpperCase();
}

function normalizeDigits_(value) {
  return String(value === undefined || value === null ? "" : value).replace(/[^\d]/g, "");
}

function normalizeIdList_(values) {
  const list = Array.isArray(values) ? values : [values];
  const seen = {};
  const out = [];
  list.forEach(function(value) {
    const clean = normalizeText_(value);
    if (!clean || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  });
  return out;
}

function collectAppointmentPatientIds_(appointments) {
  const ids = [];
  (Array.isArray(appointments) ? appointments : []).forEach(function(row) {
    ids.push(row && row.id_paciente);
  });
  return normalizeIdList_(ids);
}

function buildAgendaAppointmentOutput_(appointmentRow, patientRow) {
  const row = appointmentRow || {};
  const patient = patientRow || {};
  const duration = normalizeDurationMinutesWorker_(row && row.duracion_minutos);
  return {
    id_cita: normalizeText_(row.id_cita),
    id_paciente: normalizeText_(row.id_paciente),
    nombre_paciente: normalizeText_(patient.nombre_completo) || "Desconocido",
    telefono: normalizeText_(patient.telefono),
    fecha: normalizeIsoDateValue_(row.fecha),
    hora: normalizeTimeText_(row.hora),
    motivo: normalizeText_(row.motivo),
    estado: normalizeAppointmentStatus_(row.estado) || "PENDIENTE",
    fecha_registro: normalizeText_(row.fecha_registro),
    nota: normalizeText_(row.nota_paciente),
    nota_paciente: normalizeText_(row.nota_paciente),
    recomendaciones: normalizeText_(row.recomendaciones_serv),
    recomendaciones_serv: normalizeText_(row.recomendaciones_serv),
    creado_por: normalizeLower_(row.creado_por),
    duracion_minutos: duration
  };
}

function compareAgendaAppointmentsAsc_(a, b) {
  const dateCmp = normalizeIsoDateValue_(a && a.fecha).localeCompare(normalizeIsoDateValue_(b && b.fecha));
  if (dateCmp !== 0) return dateCmp;
  return normalizeTimeText_(a && a.hora).localeCompare(normalizeTimeText_(b && b.hora));
}

function validationSessionIsPaciente_(session) {
  return normalizeLower_(session && session.role) === "paciente";
}

function canPatientDeleteOwnAppointmentForSession_(session, appointmentRow) {
  if (!validationSessionIsPaciente_(session)) return true;
  const createdBy = normalizeLower_(appointmentRow && appointmentRow.creado_por);
  const status = normalizeAppointmentStatus_(appointmentRow && appointmentRow.estado);
  const ownCreated = createdBy === "paciente_web" || createdBy === normalizeLower_(session && session.user_id);
  return ownCreated && (status === "PENDIENTE" || status === "REAGENDADO");
}

function normalizeAppointmentStatus_(value) {
  const status = normalizeUpper_(value);
  return {
    PENDIENTE: true,
    ASISTIO: true,
    NO_ASISTIO: true,
    REAGENDADO: true,
    CANCELADO: true
  }[status] ? status : "";
}

function normalizeMonthKey_(value) {
  const raw = normalizeText_(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const dateKey = normalizeIsoDateValue_(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey.slice(0, 7) : "";
}

function parseDateAtMidday_(value) {
  const raw = normalizeIsoDateValue_(value);
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getWeekDateRange_(value) {
  const base = parseDateAtMidday_(value) || parseDateAtMidday_(new Date()) || new Date();
  const weekRef = new Date(base);
  const day = weekRef.getDay();
  const diff = weekRef.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(weekRef.setDate(diff));
  monday.setHours(12, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  saturday.setHours(12, 0, 0, 0);
  return {
    start: normalizeIsoDateValue_(monday),
    end: normalizeIsoDateValue_(saturday)
  };
}

function getMonthDateRange_(monthKey) {
  const normalized = normalizeMonthKey_(monthKey);
  const parts = normalized.split("-");
  if (parts.length !== 2) return { start: "", end: "" };
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month) return { start: "", end: "" };
  const first = new Date(year, month - 1, 1, 12, 0, 0, 0);
  const last = new Date(year, month, 0, 12, 0, 0, 0);
  return {
    start: normalizeIsoDateValue_(first),
    end: normalizeIsoDateValue_(last)
  };
}

function buildClinicalHistoryWriteRow_(payload, patientId) {
  const data = payload && typeof payload === "object" ? payload : {};
  return {
    id_paciente: normalizeText_(patientId || data.id_paciente),
    app: normalizeText_(data.app),
    apf: normalizeText_(data.apf),
    alergias: normalizeText_(data.alergias),
    aqx: normalizeText_(data.aqx),
    menarquia: normalizeText_(data.menarquia),
    prs: normalizeText_(data.prs),
    num_parejas: normalizeText_(data.num_parejas),
    ago_g: normalizeText_(data.ago_g),
    ago_p: normalizeText_(data.ago_p),
    ago_c: normalizeText_(data.ago_c),
    ago_a: normalizeText_(data.ago_a),
    fecha_aborto: normalizeIsoDateValue_(data.fecha_aborto || data.fecha_ultimo_evento),
    pap: normalizeText_(data.pap),
    fum: normalizeIsoDateValue_(data.fum),
    anticonceptivos: normalizeText_(data.anticonceptivos),
    tipo_anti: normalizeText_(data.tipo_anti),
    tiempo_uso: normalizeText_(data.tiempo_uso),
    tipo_ultimo: normalizeText_(data.tipo_ultimo),
    fecha_actualizacion: normalizeIsoDateTimeValue_(new Date())
  };
}

function buildPatientEvolutionWriteRow_(payload, base) {
  const data = payload && typeof payload === "object" ? payload : {};
  const defaults = base && typeof base === "object" ? base : {};
  return {
    id_evolucion: normalizeText_(defaults.id_evolucion || data.id_evolucion),
    id_paciente: normalizeText_(defaults.id_paciente || data.id_paciente),
    fecha_consulta: normalizeIsoDateTimeValue_(data.fecha_consulta || defaults.fecha_consulta || new Date()),
    motivo_consulta: normalizeText_(data.motivo_consulta),
    evolucion: normalizeText_(data.evolucion),
    diagnostico: normalizeText_(data.diagnostico),
    tratamiento: normalizeText_(data.tratamiento),
    sugerencias: normalizeText_(data.sugerencias),
    creado_por: normalizeLower_(defaults.creado_por || data.creado_por),
    fecha_actualizacion: normalizeIsoDateTimeValue_(defaults.fecha_actualizacion || data.fecha_actualizacion || new Date())
  };
}

function buildServiceConfigMapWorker_(rows, allowedServices) {
  const map = {};
  const allowed = allowedServices && typeof allowedServices === "object" ? allowedServices : null;
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const serviceName = normalizeText_(row && row.servicio);
    if (!serviceName) return;
    if (allowed && !allowed[serviceName]) return;
    if (!map[serviceName]) map[serviceName] = [];
    
    let opcionesStr = normalizeText_(row && row.opciones);
    let orden = 9999;
    const match = opcionesStr.match(/\|\|ORDEN:(\d+)$/);
    if (match) {
      orden = parseInt(match[1], 10);
      opcionesStr = opcionesStr.replace(/\|\|ORDEN:\d+$/, "");
    }
    
    map[serviceName].push({
      nombre: normalizeText_(row && row.campo_nombre),
      etiqueta: normalizeText_(row && row.campo_etiqueta),
      tipo: normalizeLower_(row && row.campo_tipo),
      opciones: opcionesStr,
      _orden: orden
    });
  });
  
  for (const srv in map) {
    map[srv].sort(function(a, b) { return a._orden - b._orden; });
    map[srv].forEach(function(item) { delete item._orden; });
  }
  
  return map;
}

async function loadServiceConfigRowsForService_(env, serviceName) {
  const target = normalizeText_(serviceName);
  if (!target) return [];

  const res = await supabaseRest_(env, "get", "config_campos", {
    select: "servicio,campo_nombre,campo_etiqueta,campo_tipo,opciones",
    filters: { servicio: eq_(target) }
  });
  if (!res.success || !Array.isArray(res.data)) return [];

  const items = res.data.map(function(row) {
    let opcionesStr = normalizeText_(row && row.opciones);
    let orden = 9999;
    const match = opcionesStr.match(/\|\|ORDEN:(\d+)$/);
    if (match) {
      orden = parseInt(match[1], 10);
      opcionesStr = opcionesStr.replace(/\|\|ORDEN:\d+$/, "");
    }
    
    return {
      nombre: normalizeText_(row && row.campo_nombre),
      etiqueta: normalizeText_(row && row.campo_etiqueta),
      tipo: normalizeLower_(row && row.campo_tipo),
      opciones: opcionesStr,
      _orden: orden
    };
  }).filter(function(row) {
    return !!(row.nombre || row.etiqueta || row.tipo);
  });
  
  items.sort(function(a, b) { return a._orden - b._orden; });
  items.forEach(function(item) { delete item._orden; });
  return items;
}

async function findServiceByNameInsensitive_(env, serviceName) {
  const target = normalizeLower_(serviceName);
  if (!target) return null;
  const res = await supabaseRest_(env, "get", "servicios", {
    select: "id,nombre_servicio,recomendaciones,titulo_reporte,scope_visibility,owner_usuario,duracion_minutos",
    orderBy: "nombre_servicio",
    ascending: true
  });
  if (!res.success || !Array.isArray(res.data)) return null;
  for (const row of res.data) {
    if (normalizeLower_(row && row.nombre_servicio) === target) {
      return row;
    }
  }
  return null;
}

function normalizeServiceScopeWorker_(value) {
  const scope = normalizeUpper_(value);
  if (scope === "OWNER" || scope === "ALL") return scope;
  return "";
}

function normalizeServiceFieldRowsWorker_(campos, serviceName) {
  const targetService = normalizeText_(serviceName);
  return (Array.isArray(campos) ? campos : []).map(function(campo, index) {
    const item = campo && typeof campo === "object" ? campo : {};
    let opcionesStr = normalizeText_(item.opciones);
    opcionesStr = opcionesStr ? (opcionesStr + "||ORDEN:" + index) : ("||ORDEN:" + index);
    
    return {
      servicio: targetService,
      campo_nombre: normalizeText_(item.nombre),
      campo_etiqueta: normalizeText_(item.etiqueta),
      campo_tipo: normalizeLower_(item.tipo),
      opciones: opcionesStr
    };
  }).filter(function(item) {
    return !!targetService && !!item.campo_etiqueta;
  });
}

function normalizeStorageObjectName_(value, fallback) {
  const raw = normalizeText_(value);
  const safe = raw.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || String(fallback || "archivo");
}

function joinStorageObjectKey_(parts) {
  const source = Array.isArray(parts) ? parts : [parts];
  const out = [];
  for (let i = 0; i < source.length; i++) {
    const clean = normalizeStorageObjectName_(source[i], "");
    if (clean) out.push(clean);
  }
  return out.join("/");
}

function encodeStorageObjectPath_(path) {
  return String(path || "")
    .split("/")
    .map(function(part) { return encodeURIComponent(String(part || "").trim()); })
    .join("/");
}

function decodeStorageObjectPath_(path) {
  return String(path || "")
    .split("/")
    .map(function(part) {
      try {
        return decodeURIComponent(String(part || "").trim());
      } catch (error) {
        return String(part || "").trim();
      }
    })
    .filter(Boolean)
    .join("/");
}

function parseDataUrlWorker_(value) {
  const raw = normalizeText_(value);
  // Acepta data URLs con parametros opcionales antes de ";base64"
  // Ejemplo comun de jsPDF: data:application/pdf;filename=generated.pdf;base64,....
  const match = raw.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return {
    mime: normalizeText_(match[1]),
    base64: normalizeText_(match[2])
  };
}

function arrayBufferToBase64Worker_(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchRemoteFileAsDataUrl_(url) {
  const target = normalizeText_(url);
  if (!target) return { success: false, message: "URL invalida." };
  try {
    const response = await fetch(target);
    if (!response.ok) {
      return { success: false, message: "HTTP " + response.status + " al cargar el archivo." };
    }
    const mime = normalizeText_(response.headers.get("content-type")) || "application/octet-stream";
    const buffer = await response.arrayBuffer();
    return {
      success: true,
      data: "data:" + mime + ";base64," + arrayBufferToBase64Worker_(buffer)
    };
  } catch (error) {
    return { success: false, message: toErrorMessage(error) };
  }
}

function getWorkerStorageBucket_(env) {
  if (!env || typeof env !== "object") return null;
  return env.ASSETS_BUCKET || env.DIAGNOSIS_BUCKET || null;
}

function hasWorkerStorageBinding_(env) {
  const bucket = getWorkerStorageBucket_(env);
  return !!(bucket && typeof bucket.get === "function" && typeof bucket.put === "function" && typeof bucket.delete === "function");
}

function buildWorkerStoragePublicUrl_(requestUrl, objectKey) {
  const path = encodeStorageObjectPath_(objectKey);
  if (!path) return "";

  try {
    const parsed = requestUrl instanceof URL ? requestUrl : new URL(String(requestUrl || ""));
    return parsed.origin + WORKER_STORAGE_ROUTE_PREFIX + path;
  } catch (error) {
    return "";
  }
}

function isWorkerManagedUrlWorker_(url) {
  const raw = normalizeText_(url);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return normalizePath_(parsed.pathname).indexOf(WORKER_STORAGE_ROUTE_PREFIX) === 0;
  } catch (error) {
    return false;
  }
}

function extractWorkerStorageObjectKeyFromUrl_(url) {
  const raw = normalizeText_(url);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const pathname = normalizePath_(parsed.pathname);
    if (pathname.indexOf(WORKER_STORAGE_ROUTE_PREFIX) !== 0) return "";
    return decodeStorageObjectPath_(pathname.substring(WORKER_STORAGE_ROUTE_PREFIX.length));
  } catch (error) {
    return "";
  }
}

async function uploadDataUrlToWorkerStorage_(env, requestUrl, objectPath, dataUrl) {
  const bucket = getWorkerStorageBucket_(env);
  const parsed = parseDataUrlWorker_(dataUrl);
  const objectKey = decodeStorageObjectPath_(objectPath);
  if (!bucket || !parsed || !parsed.mime || !parsed.base64 || !objectKey) {
    return { success: false, message: "Archivo adjunto invalido." };
  }

  let bytes;
  try {
    const binary = atob(parsed.base64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch (error) {
    return { success: false, message: "No se pudo decodificar el archivo adjunto." };
  }

  try {
    await bucket.put(objectKey, bytes, {
      httpMetadata: {
        contentType: parsed.mime,
        cacheControl: WORKER_STORAGE_CACHE_CONTROL,
        contentDisposition: parsed.mime === "application/pdf" ? "inline" : undefined
      }
    });
  } catch (error) {
    return { success: false, message: "No se pudo guardar el archivo en Cloudflare R2: " + toErrorMessage(error) };
  }

  return {
    success: true,
    mime: parsed.mime,
    key: objectKey,
    url: buildWorkerStoragePublicUrl_(requestUrl, objectKey)
  };
}

async function uploadBinaryToWorkerStorage_(env, requestUrl, objectPath, binary, options) {
  const bucket = getWorkerStorageBucket_(env);
  const objectKey = decodeStorageObjectPath_(objectPath);
  if (!bucket || !objectKey || !binary) {
    return { success: false, message: "Archivo binario invalido." };
  }

  const opts = options && typeof options === "object" ? options : {};
  const contentType = normalizeText_(opts.contentType) || "application/octet-stream";
  const contentDisposition = normalizeText_(opts.contentDisposition);
  const payload = binary instanceof Uint8Array ? binary : new Uint8Array(binary);

  try {
    await bucket.put(objectKey, payload, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: WORKER_STORAGE_CACHE_CONTROL,
        contentDisposition: contentDisposition || (contentType === "application/pdf" ? "inline" : undefined)
      }
    });
  } catch (error) {
    return { success: false, message: "No se pudo guardar el archivo en Cloudflare R2: " + toErrorMessage(error) };
  }

  return {
    success: true,
    key: objectKey,
    url: buildWorkerStoragePublicUrl_(requestUrl, objectKey)
  };
}

async function deleteWorkerStorageObjectByKey_(env, objectKey) {
  const bucket = getWorkerStorageBucket_(env);
  const key = decodeStorageObjectPath_(objectKey);
  if (!bucket || !key) return { success: false, message: "Archivo no encontrado en Cloudflare R2." };
  try {
    await bucket.delete(key);
    return { success: true, key: key };
  } catch (error) {
    return { success: false, message: toErrorMessage(error), key: key };
  }
}

async function deleteWorkerManagedAssetByUrl_(env, url) {
  const key = extractWorkerStorageObjectKeyFromUrl_(url);
  if (!key) return { success: true, skipped: true };
  return deleteWorkerStorageObjectByKey_(env, key);
}

async function deleteWorkerManagedAssetUrls_(env, urls) {
  const seen = {};
  const list = Array.isArray(urls) ? urls : [urls];
  const errors = [];

  for (let i = 0; i < list.length; i++) {
    const url = normalizeText_(list[i]);
    if (!url || !isWorkerManagedUrlWorker_(url) || seen[url]) continue;
    seen[url] = true;
    const removed = await deleteWorkerManagedAssetByUrl_(env, url);
    if (!removed.success && !removed.skipped) {
      errors.push(removed.message || ("No se pudo eliminar " + url));
    }
  }

  return {
    success: errors.length === 0,
    warning: errors.length ? errors.join(" | ") : ""
  };
}

function getPatientStoragePrefix_(patientId) {
  const clean = normalizeStorageObjectName_(patientId, "");
  return clean ? (clean + "/") : "";
}

async function deleteWorkerStoragePrefix_(env, prefix) {
  const bucket = getWorkerStorageBucket_(env);
  const targetPrefix = decodeStorageObjectPath_(prefix);
  if (!bucket || !targetPrefix) return { success: false, message: "Prefijo invalido para borrar archivos del paciente." };

  const errors = [];
  let cursor = undefined;

  do {
    let listed = null;
    try {
      listed = await bucket.list({
        prefix: targetPrefix,
        cursor: cursor
      });
    } catch (error) {
      return { success: false, message: "No se pudo listar archivos del paciente en Cloudflare R2: " + toErrorMessage(error) };
    }

    const objects = listed && Array.isArray(listed.objects) ? listed.objects : [];
    for (let i = 0; i < objects.length; i++) {
      const key = normalizeText_(objects[i] && objects[i].key);
      if (!key) continue;
      try {
        await bucket.delete(key);
      } catch (error) {
        errors.push("No se pudo borrar " + key + " en Cloudflare R2.");
      }
    }

    cursor = listed && listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return {
    success: errors.length === 0,
    warning: errors.length ? errors.join(" | ") : ""
  };
}

async function prepareDiagnosisPersistenceWorker_(env, payload, options) {
  const src = payload && typeof payload === "object" ? Object.assign({}, payload) : {};
  const opts = options && typeof options === "object" ? options : {};
  const patientId = normalizeText_(opts.patientId);
  const reportId = normalizeText_(opts.reportId);
  const requestUrl = opts.requestUrl;
  const out = Object.assign({}, src);
  let reportPdfUrl = "";
  let recipePdfUrl = "";
  let certificatePdfUrl = "";
  let reportPdfKey = "";
  let recipePdfKey = "";
  let certificatePdfKey = "";
  let signatureWarnings = [];

  if (Object.prototype.hasOwnProperty.call(src, "imagenes")) {
    const images = [];
    const list = Array.isArray(src.imagenes) ? src.imagenes : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i] && typeof list[i] === "object" ? list[i] : {};
      const index = Number(item.index);
      const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : (i + 1);
      const title = normalizeText_(item.title);
      const size = normalizeLower_(item.size);
      const uploadedData = normalizeText_(item.data);
      if (uploadedData) {
        const upload = await uploadDataUrlToWorkerStorage_(
          env,
          requestUrl,
          joinStorageObjectKey_([
            patientId,
            reportId,
            "imagenes",
            "img_" + safeIndex + "_" + randomHex_(6)
          ]),
          uploadedData
        );
        if (!upload.success) {
          return { success: false, status: 500, message: upload.message || "No se pudo guardar una imagen del diagnostico." };
        }
        images.push({
          index: safeIndex,
          title: title,
          url: upload.url,
          fileId: "",
          size: size
        });
        continue;
      }

      const imageUrl = normalizeText_(item.url || item.src);
      const fileId = normalizeText_(item.fileId);
      if (!imageUrl && !fileId) continue;
      images.push({
        index: safeIndex,
        title: title,
        url: imageUrl,
        fileId: fileId,
        size: size
      });
    }
    out.imagenes = images;
  }

  if (Object.prototype.hasOwnProperty.call(src, "pdf_externos")) {
    const pdfs = [];
    const list = Array.isArray(src.pdf_externos) ? src.pdf_externos : [];
    for (let i = 0; i < list.length; i++) {
      const item = list[i] && typeof list[i] === "object" ? list[i] : {};
      const fileData = normalizeText_(item.data);
      const currentId = normalizeText_(item.id) || ("external_pdf_" + (i + 1));
      const label = normalizeText_(item.label || item.nombre_visible || item.display_name || item.name) || ("Adjunto PDF " + (i + 1));
      const name = normalizeText_(item.name) || (normalizeStorageObjectName_(label, "adjunto") + ".pdf");

      if (fileData) {
        const upload = await uploadDataUrlToWorkerStorage_(
          env,
          requestUrl,
          joinStorageObjectKey_([
            patientId,
            reportId,
            "externos",
            normalizeStorageObjectName_(currentId, "adjunto_" + (i + 1)) + "_" + randomHex_(6)
          ]),
          fileData
        );
        if (!upload.success) {
          return { success: false, status: 500, message: upload.message || "No se pudo guardar un PDF adjunto." };
        }
        pdfs.push({
          id: currentId,
          label: label,
          url: upload.url,
          file_id: "",
          name: name
        });
        continue;
      }

      const fileUrl = normalizeText_(item.url || item.pdf_externo_link);
      const fileId = normalizeText_(item.file_id || item.fileId);
      if (!fileUrl && !fileId) continue;
      pdfs.push({
        id: currentId,
        label: label,
        url: fileUrl,
        file_id: fileId,
        name: name
      });
    }
    out.pdf_externos = pdfs;
  }

  const reportPdfDataUrl = normalizeText_(src.report_pdf_data_url);
  if (reportPdfDataUrl) {
    let finalReportPdfDataUrl = reportPdfDataUrl;
    if (opts.firmaPassword && opts.doctorId) {
      const signed = await signPdfWithCloudflareWorker_(env, opts.doctorId, opts.firmaPassword, reportPdfDataUrl);
      if (signed.success && signed.dataUrl) {
        finalReportPdfDataUrl = signed.dataUrl;
        if (signed.warning) signatureWarnings.push("Informe: " + signed.warning);
      }
    }
    const upload = await uploadDataUrlToWorkerStorage_(
      env,
      requestUrl,
      joinStorageObjectKey_([
        patientId,
        reportId,
        "reportes",
        "informe_principal_" + Date.now() + "_" + randomHex_(4)
      ]),
      finalReportPdfDataUrl
    );
    if (!upload.success) {
      return { success: false, status: 500, message: upload.message || "No se pudo guardar el PDF principal." };
    }
    reportPdfUrl = upload.url;
    reportPdfKey = upload.key || "";
  }

  const recipePdfDataUrl = normalizeText_(src.recipe_pdf_data_url);
  if (recipePdfDataUrl) {
    let finalRecipePdfDataUrl = recipePdfDataUrl;
    if (opts.firmaPassword && opts.doctorId) {
      const signed = await signPdfWithCloudflareWorker_(env, opts.doctorId, opts.firmaPassword, recipePdfDataUrl);
      if (signed.success && signed.dataUrl) {
        finalRecipePdfDataUrl = signed.dataUrl;
        if (signed.warning) signatureWarnings.push("Receta: " + signed.warning);
      }
    }
    const upload = await uploadDataUrlToWorkerStorage_(
      env,
      requestUrl,
      joinStorageObjectKey_([
        patientId,
        reportId,
        "reportes",
        "receta_" + Date.now() + "_" + randomHex_(4)
      ]),
      finalRecipePdfDataUrl
    );
    if (!upload.success) {
      return { success: false, status: 500, message: upload.message || "No se pudo guardar el PDF de receta." };
    }
    recipePdfUrl = upload.url;
    recipePdfKey = upload.key || "";
  }

  const certificatePdfDataUrl = normalizeText_(src.certificate_pdf_data_url);
  if (certificatePdfDataUrl) {
    let finalCertificatePdfDataUrl = certificatePdfDataUrl;
    if (opts.firmaPassword && opts.doctorId) {
      const signed = await signPdfWithCloudflareWorker_(env, opts.doctorId, opts.firmaPassword, certificatePdfDataUrl);
      if (signed.success && signed.dataUrl) {
        finalCertificatePdfDataUrl = signed.dataUrl;
        if (signed.warning) signatureWarnings.push("Certificado: " + signed.warning);
      }
    }
    const upload = await uploadDataUrlToWorkerStorage_(
      env,
      requestUrl,
      joinStorageObjectKey_([
        patientId,
        reportId,
        "reportes",
        "certificado_medico_" + Date.now() + "_" + randomHex_(4)
      ]),
      finalCertificatePdfDataUrl
    );
    if (!upload.success) {
      return { success: false, status: 500, message: upload.message || "No se pudo guardar el PDF de certificado medico." };
    }
    certificatePdfUrl = upload.url;
    certificatePdfKey = upload.key || "";
  }

  delete out.report_pdf_data_url;
  delete out.recipe_pdf_data_url;
  delete out.certificate_pdf_data_url;

  return {
    success: true,
    data: out,
    reportPdfUrl: reportPdfUrl,
    recipePdfUrl: recipePdfUrl,
    certificatePdfUrl: certificatePdfUrl,
    reportPdfKey: reportPdfKey,
    recipePdfKey: recipePdfKey,
    certificatePdfKey: certificatePdfKey
  };
}

async function signPdfWithCloudflareWorker_(env, doctorId, password, pdfDataUrl) {
  try {
    const bucket = getWorkerStorageBucket_(env);
    if (!bucket) return { success: false, message: "R2 no configurado." };

    const p12Obj = await bucket.get("firmas/" + doctorId + "/firma.p12");
    if (!p12Obj) return { success: false, message: "No se encontro archivo .p12 en la boveda." };

    const p12Buffer = await p12Obj.arrayBuffer();
    const parsedPdf = parseDataUrlWorker_(pdfDataUrl);
    if (!parsedPdf) return { success: false, message: "PDF invalido." };

    try {
      let BufferClass;
      if (typeof globalThis.Buffer !== "undefined") {
        BufferClass = globalThis.Buffer;
      } else {
        try {
          const bufMod = await import("node:buffer"); BufferClass = bufMod.Buffer;
        } catch(e) {
          const bufMod = await import("buffer"); BufferClass = bufMod.Buffer;
        }
      }
      const signpdfModule = await import("node-signpdf");
      const signpdf = signpdfModule.default || signpdfModule;
      
      let plainAddPlaceholder = signpdfModule.plainAddPlaceholder;
      if (!plainAddPlaceholder) {
        try { const helpers = await import("node-signpdf/dist/helpers.js"); plainAddPlaceholder = helpers.plainAddPlaceholder; } catch(e) {}
      }
      if (!plainAddPlaceholder) {
        try { const helpersIndex = await import("node-signpdf/dist/helpers/index.js"); plainAddPlaceholder = helpersIndex.plainAddPlaceholder; } catch(e) {}
      }
      if (!plainAddPlaceholder) {
         throw new Error("Libreria placeholder-plain no detectada en Cloudflare.");
      }
      
      const pdfBinary = atob(parsedPdf.base64);
      const pdfBytes = new Uint8Array(pdfBinary.length);
      for (let i = 0; i < pdfBinary.length; i++) pdfBytes[i] = pdfBinary.charCodeAt(i);
      
      let pdfBuffer = BufferClass.from(pdfBytes);
      
      const metaObj = await bucket.get("firmas/" + doctorId + "/firma.p12.meta");
      let signerName = "Profesional Medico";
      if (metaObj) {
        try { const metaJson = await metaObj.json(); signerName = metaJson.cert_name || signerName; } catch(e){}
      }
      
      pdfBuffer = plainAddPlaceholder({
        pdfBuffer: pdfBuffer,
          reason: 'Firma Electronica Medica',
        signatureLength: 33280,
        name: signerName,
        location: 'Ecuador'
      });

      const signedBytes = signpdf.sign(pdfBuffer, BufferClass.from(p12Buffer), { passphrase: password });
      const signedBase64 = arrayBufferToBase64Worker_(signedBytes);
      
      return { success: true, dataUrl: "data:application/pdf;base64," + signedBase64 };
    } catch (e) {
      console.warn("Worker: PAdES Error:", e.message);
      return { success: true, dataUrl: pdfDataUrl, warning: "Error Criptografico: " + e.message };
    }
  } catch (error) {
    return { success: false, message: toErrorMessage(error) };
  }
}

function normalizeDiagnosisSavePayloadForMode_(payload, oldPayload) {
  const data = payload && typeof payload === "object" ? Object.assign({}, payload) : {};
  const oldData = oldPayload && typeof oldPayload === "object" ? oldPayload : {};
  const tipo = normalizeUpper_(data.tipo_examen);
  if (tipo !== "TODO") return data;

  const hasRecipe = diagnosisHasMeaningfulRecipePayload_(data)
    || (!Object.prototype.hasOwnProperty.call(data, "medicamentos") && diagnosisHasMeaningfulRecipePayload_(oldData));
  const hasExternalPdf = diagnosisHasMeaningfulExternalPdfPayload_(data, oldData);
  const hasReportContent = diagnosisHasMeaningfulClinicalPayload_(data)
    || (!Object.prototype.hasOwnProperty.call(data, "datos_json") && diagnosisHasMeaningfulClinicalPayload_(oldData));

  if (!hasReportContent) {
    if (hasRecipe) {
      data.tipo_examen = "RECETA";
    } else if (hasExternalPdf) {
      data.tipo_examen = "EXAMENPDF";
    }
  }

  return data;
}

function parseStoredDiagnosisJson_(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.assign({}, value);
  }
  const parsed = safeJsonParse_(normalizeText_(value));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function isDriveManagedUrlWorker_(url) {
  const raw = normalizeText_(url).toLowerCase();
  if (!raw) return false;
  return raw.indexOf("drive.google.com/") !== -1
    || raw.indexOf("docs.google.com/") !== -1
    || raw.indexOf("googleusercontent.com/") !== -1;
}

function getDiagnosisExternalPdfItemsForWorker_(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const modern = normalizeDiagnosisExternalPdfsForStorage_(data.pdf_externos);
  return modern.length ? modern : getLegacyDiagnosisExternalPdfsForStorage_(data);
}

function diagnosisExternalItemNeedsAppsScriptCleanup_(item) {
  const current = item || {};
  const url = normalizeText_(current.url || current.pdf_externo_link);
  const fileId = normalizeText_(current.file_id || current.fileId);
  if (isDriveManagedUrlWorker_(url)) return true;
  return !url && !!fileId;
}

function diagnosisRecordRequiresAppsScriptCleanup_(report) {
  const row = report || {};
  const payload = parseStoredDiagnosisJson_(row.datos_json);
  if (isDriveManagedUrlWorker_(row.pdf_url || row.pdf_link)) return true;
  if (isDriveManagedUrlWorker_(payload.pdf_receta_link)) return true;
  if (isDriveManagedUrlWorker_(payload.pdf_certificado_link)) return true;
  if (normalizeText_(payload.report_folder_id)) return true;
  if (Array.isArray(payload.drive_file_ids) && payload.drive_file_ids.some(function(item) { return !!normalizeText_(item); })) {
    return true;
  }
  if (Array.isArray(payload.imagenes) && payload.imagenes.some(function(img) { return !!normalizeText_(img && img.fileId); })) {
    return true;
  }
  if (getDiagnosisExternalPdfItemsForWorker_(payload).some(diagnosisExternalItemNeedsAppsScriptCleanup_)) {
    return true;
  }
  return false;
}

function collectDiagnosisAssetUrlsWorker_(pdfUrl, payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const seen = {};
  const out = [];

  function add(url) {
    const clean = normalizeText_(url);
    if (!clean || seen[clean]) return;
    seen[clean] = true;
    out.push(clean);
  }

  add(pdfUrl);
  add(data.pdf_receta_link);
  add(data.pdf_certificado_link);

  const images = Array.isArray(data.imagenes) ? data.imagenes : [];
  for (let i = 0; i < images.length; i++) {
    add(images[i] && (images[i].url || images[i].src));
  }

  const externalItems = getDiagnosisExternalPdfItemsForWorker_(data);
  for (let i = 0; i < externalItems.length; i++) {
    add(externalItems[i] && (externalItems[i].url || externalItems[i].pdf_externo_link));
  }

  return out;
}

function collectDiagnosisAssetUrlsFromReportWorker_(report) {
  const row = report || {};
  return collectDiagnosisAssetUrlsWorker_(row.pdf_url || row.pdf_link, parseStoredDiagnosisJson_(row.datos_json));
}

function buildDiagnosisRemainingDocsWorker_(pdfUrl, payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const externalItems = getDiagnosisExternalPdfItemsForWorker_(data);
  const externalLink = externalItems.length
    ? normalizeText_(externalItems[0].url)
    : normalizeText_(data.pdf_externo_link);
  return {
    pdf_url: normalizeText_(pdfUrl),
    pdf_receta_link: normalizeText_(data.pdf_receta_link),
    pdf_certificado_link: normalizeText_(data.pdf_certificado_link),
    pdf_externo_link: externalLink,
    pdf_externos: externalItems
  };
}

function buildDiagnosisStoragePayload_(payload, options) {
  const data = payload && typeof payload === "object" ? payload : {};
  const opts = options && typeof options === "object" ? options : {};
  const oldPayload = opts.oldPayload && typeof opts.oldPayload === "object" ? opts.oldPayload : {};
  const out = Object.assign({}, oldPayload);

  out.id_reporte = normalizeText_(opts.id_reporte || data.id_reporte || oldPayload.id_reporte);
  out.id_paciente = normalizeText_(opts.id_paciente || data.id_paciente || oldPayload.id_paciente);
  out.nombre_paciente = normalizeText_(data.nombre_paciente || oldPayload.nombre_paciente || opts.nombre_paciente);
  out.tipo_examen = normalizeText_(data.tipo_examen || oldPayload.tipo_examen);
  out.doctor_usuario = normalizeLower_(opts.doctor_usuario || oldPayload.doctor_usuario);
  out.incluir_firma_virtual = Object.prototype.hasOwnProperty.call(data, "incluir_firma_virtual")
    ? !!data.incluir_firma_virtual
    : !!oldPayload.incluir_firma_virtual;

  if (Object.prototype.hasOwnProperty.call(data, "datos_json")) {
    out.datos_json = normalizeDiagnosisDynamicPayload_(data.datos_json);
  } else if (oldPayload.datos_json && typeof oldPayload.datos_json === "object") {
    out.datos_json = normalizeDiagnosisDynamicPayload_(oldPayload.datos_json);
  }

  if (Object.prototype.hasOwnProperty.call(data, "certificado_medico")) {
    const cert = normalizeDiagnosisMedicalCertificateForStorage_(data.certificado_medico);
    if (cert) out.certificado_medico = cert;
    else delete out.certificado_medico;
  } else if (oldPayload.certificado_medico && typeof oldPayload.certificado_medico === "object") {
    const oldCert = normalizeDiagnosisMedicalCertificateForStorage_(oldPayload.certificado_medico);
    if (oldCert) out.certificado_medico = oldCert;
  }

  [
    "motivo",
    "evaluacion",
    "vagina",
    "vulva",
    "ano",
    "hallazgos",
    "diagnostico",
    "biopsia",
    "recomendaciones",
    "observaciones_receta"
  ].forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      out[key] = normalizeText_(data[key]);
    } else if (Object.prototype.hasOwnProperty.call(oldPayload, key)) {
      out[key] = normalizeText_(oldPayload[key]);
    }
  });

  if (Object.prototype.hasOwnProperty.call(data, "pdf_receta_link")) {
    out.pdf_receta_link = normalizeText_(data.pdf_receta_link);
  } else if (normalizeText_(oldPayload.pdf_receta_link)) {
    out.pdf_receta_link = normalizeText_(oldPayload.pdf_receta_link);
  }

  if (Object.prototype.hasOwnProperty.call(data, "pdf_certificado_link")) {
    out.pdf_certificado_link = normalizeText_(data.pdf_certificado_link);
  } else if (normalizeText_(oldPayload.pdf_certificado_link)) {
    out.pdf_certificado_link = normalizeText_(oldPayload.pdf_certificado_link);
  }

  out.medicamentos = normalizeDiagnosisMedicamentosForStorage_(
    Object.prototype.hasOwnProperty.call(data, "medicamentos") ? data.medicamentos : oldPayload.medicamentos
  );
  out.imagenes = normalizeDiagnosisImagesForStorage_(
    Object.prototype.hasOwnProperty.call(data, "imagenes") ? data.imagenes : oldPayload.imagenes
  );
  out.pdf_externos = Object.prototype.hasOwnProperty.call(data, "pdf_externos")
    ? normalizeDiagnosisExternalPdfsForStorage_(data.pdf_externos)
    : normalizeDiagnosisExternalPdfsForStorage_(oldPayload.pdf_externos);
  if (!out.pdf_externos.length) {
    out.pdf_externos = getLegacyDiagnosisExternalPdfsForStorage_(data).length
      ? getLegacyDiagnosisExternalPdfsForStorage_(data)
      : getLegacyDiagnosisExternalPdfsForStorage_(oldPayload);
  }
  out.pdf_externo_link = out.pdf_externos.length
    ? normalizeText_(out.pdf_externos[0].url)
    : "";

  if (Array.isArray(oldPayload.drive_file_ids)) out.drive_file_ids = oldPayload.drive_file_ids.slice();
  if (normalizeText_(oldPayload.report_folder_id)) out.report_folder_id = normalizeText_(oldPayload.report_folder_id);

  return out;
}

function diagnosisHasMeaningfulRecipePayload_(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const meds = Array.isArray(data.medicamentos) ? data.medicamentos : [];
  const hasMeds = meds.some(function(item) {
    return !!normalizeText_(item && item.nombre);
  });
  const hasObs = !!normalizeText_(data.observaciones_receta);
  return hasMeds || hasObs;
}

function diagnosisHasMeaningfulClinicalPayload_(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const fixedKeys = [
    "motivo",
    "evaluacion",
    "vagina",
    "vulva",
    "ano",
    "hallazgos",
    "diagnostico",
    "biopsia",
    "recomendaciones"
  ];
  for (let i = 0; i < fixedKeys.length; i++) {
    if (normalizeText_(data[fixedKeys[i]])) return true;
  }

  const dyn = data.datos_json && typeof data.datos_json === "object" ? data.datos_json : null;
  if (dyn) {
    for (const key of Object.keys(dyn)) {
      if (normalizeText_(dyn[key])) return true;
    }
  }

  return !!(Array.isArray(data.imagenes) && data.imagenes.length);
}

function diagnosisHasMeaningfulExternalPdfPayload_(payload, oldPayload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const oldData = oldPayload && typeof oldPayload === "object" ? oldPayload : {};
  const currentItems = Object.prototype.hasOwnProperty.call(data, "pdf_externos")
    ? normalizeDiagnosisExternalPdfsForStorage_(data.pdf_externos)
    : [];
  if (currentItems.length) return true;
  const current = data.pdf_externo && typeof data.pdf_externo === "object" ? data.pdf_externo : null;
  if (current) {
    if (current.delete === true) return false;
    if (normalizeText_(current.data) || normalizeText_(current.name) || normalizeText_(current.mime)) return true;
  }
  return !!(
    normalizeDiagnosisExternalPdfsForStorage_(oldData.pdf_externos).length
    || getLegacyDiagnosisExternalPdfsForStorage_(oldData).length
  );
}

function normalizeDiagnosisDynamicPayload_(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  Object.keys(value).forEach(function(key) {
    const cleanKey = normalizeText_(key);
    if (!cleanKey) return;
    const rawValue = value[key];
    if (rawValue === undefined) return;
    out[cleanKey] = rawValue === null ? "" : rawValue;
  });
  return out;
}

function normalizeDiagnosisMedicalCertificateForStorage_(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const src = value;
  const out = {
    ciudad: normalizeText_(src.ciudad),
    nombre_paciente: normalizeText_(src.nombre_paciente),
    cedula: normalizeText_(src.cedula),
    cuadro_clinico: normalizeText_(src.cuadro_clinico),
    diagnostico: normalizeText_(src.diagnostico),
    lugar_trabajo: normalizeText_(src.lugar_trabajo),
    ocupacion: normalizeText_(src.ocupacion),
    lugar_atencion: normalizeText_(src.lugar_atencion),
    establecimiento: normalizeText_(src.establecimiento),
    reposo_sugerido: normalizeUpper_(src.reposo_sugerido) === "SI" ? "SI" : "NO",
    reposo_inicio: normalizeIsoDateValue_(src.reposo_inicio),
    reposo_fin: normalizeIsoDateValue_(src.reposo_fin)
  };
  const hasContent = !!(
    out.nombre_paciente
    || out.cedula
    || out.cuadro_clinico
    || out.diagnostico
    || out.lugar_trabajo
    || out.ocupacion
    || out.lugar_atencion
    || out.establecimiento
    || out.reposo_inicio
    || out.reposo_fin
  );
  return hasContent ? out : null;
}

function normalizeDiagnosisMedicamentosForStorage_(items) {
  return (Array.isArray(items) ? items : []).map(function(item) {
    return {
      nombre: normalizeText_(item && item.nombre),
      cantidad: normalizeText_(item && item.cantidad),
      frecuencia: normalizeText_(item && item.frecuencia)
    };
  }).filter(function(item) {
    return !!(item.nombre || item.cantidad || item.frecuencia);
  });
}

function normalizeDiagnosisImagesForStorage_(items) {
  const allowedSizes = { small: true, medium: true, large: true };
  return (Array.isArray(items) ? items : []).map(function(item, index) {
    const size = normalizeLower_(item && item.size);
    const rawIndex = Number(item && item.index);
    return {
      index: Number.isFinite(rawIndex) && rawIndex > 0 ? rawIndex : (index + 1),
      title: normalizeText_(item && item.title),
      url: normalizeText_(item && (item.url || item.src)),
      fileId: normalizeText_(item && item.fileId),
      isNew: false,
      size: allowedSizes[size] ? size : "small"
    };
  }).filter(function(item) {
    return !!(item.url || item.fileId || item.title || item.index);
  });
}

function extractDriveFileIdFromUrlWorker_(url) {
  const raw = normalizeText_(url);
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    return /^[a-zA-Z0-9_-]{20,}$/.test(raw) ? raw : "";
  }
  if (!isDriveManagedUrlWorker_(raw)) return "";
  let match = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  match = raw.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  return "";
}

function inferDiagnosisAssetExtensionByMime_(mime, fallback) {
  const type = normalizeLower_(mime);
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "application/pdf") return "pdf";
  return String(fallback || "bin");
}

function reportContainsFileIdWorker_(report, fileId) {
  const target = normalizeText_(fileId);
  const row = report || {};
  if (!target) return false;
  if (extractDriveFileIdFromUrlWorker_(row.pdf_url || row.pdf_link) === target) return true;

  const payload = parseStoredDiagnosisJson_(row.datos_json);
  if (extractDriveFileIdFromUrlWorker_(payload.pdf_receta_link) === target) return true;
  if (extractDriveFileIdFromUrlWorker_(payload.pdf_certificado_link) === target) return true;
  if (extractDriveFileIdFromUrlWorker_(payload.pdf_externo_link) === target) return true;

  const list = Array.isArray(payload.drive_file_ids) ? payload.drive_file_ids : [];
  for (let i = 0; i < list.length; i++) {
    if (normalizeText_(list[i]) === target) return true;
  }

  const images = Array.isArray(payload.imagenes) ? payload.imagenes : [];
  for (let i = 0; i < images.length; i++) {
    if (normalizeText_(images[i] && images[i].fileId) === target) return true;
  }

  const externalItems = getDiagnosisExternalPdfItemsForWorker_(payload);
  for (let i = 0; i < externalItems.length; i++) {
    const current = externalItems[i] || {};
    if (normalizeText_(current.file_id || current.fileId) === target) return true;
    if (extractDriveFileIdFromUrlWorker_(current.url || current.pdf_externo_link) === target) return true;
  }

  return false;
}

async function canSessionAccessLegacyDriveFile_(env, session, fileId) {
  if (!session || !session.ok) return false;
  if (session.role === "superadmin") return true;

  const lookup = await supabaseRest_(env, "get", "diagnosticos_archivos", {
    select: "id_paciente,datos_json,pdf_url"
  });
  if (!lookup.success) return false;

  const rows = Array.isArray(lookup.data) ? lookup.data : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    const rawJson = normalizeText_(row.datos_json);
    const rawPdf = normalizeText_(row.pdf_url);
    if (rawJson.indexOf(fileId) === -1 && rawPdf.indexOf(fileId) === -1) continue;
    if (!reportContainsFileIdWorker_(row, fileId)) continue;
    const access = await resolveAccessiblePatientForSession_(env, session, row.id_paciente);
    if (access.ok) return true;
  }

  return false;
}

function normalizeDiagnosisExternalPdfsForStorage_(items) {
  return (Array.isArray(items) ? items : []).map(function(item, index) {
    const url = normalizeText_(item && (item.url || item.pdf_externo_link));
    const fileId = normalizeText_(item && (item.file_id || item.fileId))
      || (isDriveManagedUrlWorker_(url) ? extractDriveFileIdFromUrlWorker_(url) : "");
    const name = normalizeText_(item && item.name);
    const label = normalizeText_(item && (item.label || item.display_name || item.nombre_visible || name)) || ("Adjunto PDF " + (index + 1));
    const id = normalizeText_(item && item.id) || fileId || ("external_pdf_" + (index + 1));
    return {
      id: id,
      label: label,
      url: url,
      file_id: fileId,
      name: name
    };
  }).filter(function(item) {
    return !!item.url;
  });
}

function getLegacyDiagnosisExternalPdfsForStorage_(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const legacyUrl = normalizeText_(data.pdf_externo_link);
  if (!legacyUrl) return [];
  const fileId = extractDriveFileIdFromUrlWorker_(legacyUrl);
  return [{
    id: fileId || "external_pdf_1",
    label: normalizeText_(data.pdf_externo_nombre || data.titulo_adjunto || "Adjunto PDF"),
    url: legacyUrl,
    file_id: fileId,
    name: ""
  }];
}

function parseAllowedDurationMinutesWorker_(value) {
  const num = Number(String(value === undefined || value === null ? "" : value).trim());
  const allowed = { 30: true, 60: true, 120: true, 180: true, 240: true, 300: true };
  return allowed[num] ? num : 0;
}

function normalizeDurationMinutesWorker_(value) {
  return parseAllowedDurationMinutesWorker_(value) || 30;
}

function durationLabelWorker_(value) {
  const mins = normalizeDurationMinutesWorker_(value);
  if (mins === 30) return "30 minutos";
  const hours = mins / 60;
  return hours + " hora" + (hours === 1 ? "" : "s");
}

function normalizeServiceOutputRow_(row) {
  const service = row || {};
  let scope = normalizeUpper_(service.scope_visibility);
  if (scope !== "ALL" && scope !== "OWNER") scope = "ALL";
  const duration = normalizeDurationMinutesWorker_(service.duracion_minutos);
  return {
    id: normalizeText_(service.id),
    nombre_servicio: normalizeText_(service.nombre_servicio),
    recomendaciones: normalizeText_(service.recomendaciones),
    titulo_reporte: normalizeText_(service.titulo_reporte),
    scope_visibility: scope,
    owner_usuario: normalizeLower_(service.owner_usuario),
    duracion_minutos: duration,
    duracion_label: durationLabelWorker_(duration)
  };
}

function normalizeTimeText_(value) {
  const raw = normalizeText_(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) return String(match[1]).padStart(2, "0") + ":" + match[2];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return String(parsed.getHours()).padStart(2, "0") + ":" + String(parsed.getMinutes()).padStart(2, "0");
}

function compareAppointmentsAsc_(a, b) {
  const dateCmp = normalizeIsoDateValue_(a && a.fecha).localeCompare(normalizeIsoDateValue_(b && b.fecha));
  if (dateCmp !== 0) return dateCmp;
  return normalizeTimeText_(a && a.hora).localeCompare(normalizeTimeText_(b && b.hora));
}

function compareDiagnosisDesc_(a, b) {
  const aTime = Date.parse(normalizeText_(a && a.fecha)) || 0;
  const bTime = Date.parse(normalizeText_(b && b.fecha)) || 0;
  return bTime - aTime;
}

function compareEvolutionDesc_(a, b) {
  const aTime = Date.parse(normalizeText_((a && (a.fecha_consulta || a.fecha_actualizacion)) || "")) || 0;
  const bTime = Date.parse(normalizeText_((b && (b.fecha_consulta || b.fecha_actualizacion)) || "")) || 0;
  return bTime - aTime;
}

function extractServiceNameFromAppointmentMotiveWorker_(motivo) {
  const raw = normalizeText_(motivo);
  if (!raw) return "";
  const marker = raw.indexOf(" | Nota:");
  if (marker > -1) return raw.substring(0, marker).trim();
  return raw;
}

function timeTextToMinutesWorker_(value) {
  const raw = normalizeTimeText_(value);
  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function minutesToTimeTextWorker_(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total)) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function getAppointmentHalfHourSlotCountWorker_(durationMinutes) {
  return Math.max(1, Math.round(normalizeDurationMinutesWorker_(durationMinutes) / 30));
}

function buildHalfHourSlotsFromTimeWorker_(startTime, durationMinutes) {
  const startMinutes = timeTextToMinutesWorker_(startTime);
  if (!Number.isFinite(startMinutes)) return [];
  const count = getAppointmentHalfHourSlotCountWorker_(durationMinutes);
  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(minutesToTimeTextWorker_(startMinutes + (i * 30)));
  }
  return slots;
}

function getAvailableStartSlotsForDateWorker_(occupiedSlots, durationMinutes) {
  const occupiedMap = {};
  (occupiedSlots || []).forEach(function(slot) {
    occupiedMap[slot] = true;
  });

  const dayStart = timeTextToMinutesWorker_("09:00");
  const dayEnd = timeTextToMinutesWorker_("17:30");
  const lastStart = dayEnd - 30;
  const blockMinutes = getAppointmentHalfHourSlotCountWorker_(durationMinutes) * 30;
  const available = [];

  for (let start = dayStart; start <= lastStart; start += 30) {
    const end = start + blockMinutes;
    if (end > dayEnd) continue;

    let free = true;
    for (let cursor = start; cursor < end; cursor += 30) {
      if (occupiedMap[minutesToTimeTextWorker_(cursor)]) {
        free = false;
        break;
      }
    }
    if (free) available.push(minutesToTimeTextWorker_(start));
  }

  return available;
}

async function resolveAppointmentDurationMinutesWorker_(env, appointmentRow) {
  const explicit = parseAllowedDurationMinutesWorker_(appointmentRow && appointmentRow.duracion_minutos);
  if (explicit) return explicit;

  const serviceName = extractServiceNameFromAppointmentMotiveWorker_(appointmentRow && appointmentRow.motivo);
  if (!serviceName) return 30;

  const service = await findSingleByField_(env, "servicios", "nombre_servicio", serviceName);
  return normalizeDurationMinutesWorker_(service && service.duracion_minutos);
}

async function resolveRequestedAppointmentDurationWorker_(env, appointmentInput) {
  const input = appointmentInput || {};
  const explicit = parseAllowedDurationMinutesWorker_(input.duracion_minutos);
  if (explicit) return explicit;

  const serviceName = normalizeText_(input.servicio_nombre) || extractServiceNameFromAppointmentMotiveWorker_(input.motivo);
  if (!serviceName) return 30;

  const service = await findSingleByField_(env, "servicios", "nombre_servicio", serviceName);
  return normalizeDurationMinutesWorker_(service && service.duracion_minutos);
}

async function getOccupiedSlotsForDateWorker_(env, appointments, options) {
  const excludeId = normalizeText_(options && options.excludeId);
  const occupied = {};

  for (const row of Array.isArray(appointments) ? appointments : []) {
    const rowId = normalizeText_(row && row.id_cita);
    if (excludeId && rowId === excludeId) continue;
    const duration = await resolveAppointmentDurationMinutesWorker_(env, row || {});
    const slots = buildHalfHourSlotsFromTimeWorker_(row && row.hora, duration);
    slots.forEach(function(slot) {
      occupied[slot] = true;
    });
  }

  return Object.keys(occupied).sort();
}

async function isAppointmentRangeAvailableWorker_(env, dateString, startTime, durationMinutes, options) {
  const startMinutes = timeTextToMinutesWorker_(startTime);
  if (!Number.isFinite(startMinutes)) return false;

  const dayStart = timeTextToMinutesWorker_("09:00");
  const dayEnd = timeTextToMinutesWorker_("17:30");
  const blockMinutes = getAppointmentHalfHourSlotCountWorker_(durationMinutes) * 30;
  if (startMinutes < dayStart || (startMinutes + blockMinutes) > dayEnd) return false;

  const appointmentsRes = await supabaseRest_(env, "get", "citas", {
    select: "id_cita,fecha,hora,motivo,duracion_minutos",
    filters: { fecha: eq_(normalizeIsoDateValue_(dateString)) }
  });
  if (!appointmentsRes.success) return false;

  const occupiedList = await getOccupiedSlotsForDateWorker_(env, Array.isArray(appointmentsRes.data) ? appointmentsRes.data : [], options || {});
  const occupiedMap = {};
  occupiedList.forEach(function(slot) {
    occupiedMap[slot] = true;
  });

  const neededSlots = buildHalfHourSlotsFromTimeWorker_(startTime, durationMinutes);
  for (let i = 0; i < neededSlots.length; i++) {
    if (occupiedMap[neededSlots[i]]) return false;
  }
  return true;
}

function normalizeIsoDateValue_(value) {
  if (!value) return "";
  const raw = normalizeText_(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.split("T")[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().split("T")[0];
}

function normalizeIsoDateTimeValue_(value) {
  if (!value) return "";
  const raw = normalizeText_(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    return raw;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return raw;
}

function normalizePromotionScope_(value) {
  return normalizeUpper_(value) === "ALL" ? "ALL" : "OWNER";
}

function normalizePromotionRow_(row) {
  const item = row || {};
  return {
    id: normalizeText_(item.id || item.id_promo),
    mensaje: normalizeText_(item.mensaje),
    inicio: normalizeIsoDateValue_(item.inicio || item.fecha_inicio),
    fin: normalizeIsoDateValue_(item.fin || item.fecha_fin),
    scope_visibility: normalizePromotionScope_(item.scope_visibility),
    owner_usuario: normalizeLower_(item.owner_usuario),
    fecha_creacion: normalizeIsoDateValue_(item.fecha_creacion)
  };
}

function sanitizeInfographicText_(value, maxLen) {
  const raw = normalizeText_(value);
  const limit = Number(maxLen || 0);
  if (!limit || raw.length <= limit) return raw;
  return raw.substring(0, limit);
}

function normalizeExternalUrl_(value) {
  const raw = normalizeText_(value);
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function isDataImageUrl_(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(normalizeText_(value));
}

function normalizeImageUrl_(value) {
  const raw = normalizeText_(value);
  if (!raw) return "";
  if (isDataImageUrl_(raw)) return raw;
  return normalizeExternalUrl_(raw);
}

function normalizeInfographicRow_(row) {
  const item = row || {};
  return {
    id_post: normalizeText_(item.id_post),
    doctor_usuario: normalizeLower_(item.doctor_usuario),
    scope_visibility: normalizePromotionScope_(item.scope_visibility),
    activo: sheetFlagToBool_(item.activo),
    titulo: sanitizeInfographicText_(item.titulo, 120),
    mensaje: sanitizeInfographicText_(item.mensaje, 1600),
    imagen_url: normalizeImageUrl_(item.imagen_url),
    imagen_file_id: normalizeText_(item.imagen_file_id),
    show_btn_agenda: Object.prototype.hasOwnProperty.call(item, "show_btn_agenda") ? sheetFlagToBool_(item.show_btn_agenda) : true,
    btn_agenda_text: sanitizeInfographicText_(item.btn_agenda_text, 40),
    show_btn_info: Object.prototype.hasOwnProperty.call(item, "show_btn_info") ? sheetFlagToBool_(item.show_btn_info) : true,
    btn_info_text: sanitizeInfographicText_(item.btn_info_text, 40),
    btn_info_url: normalizeExternalUrl_(item.btn_info_url),
    show_btn_source: Object.prototype.hasOwnProperty.call(item, "show_btn_source") ? sheetFlagToBool_(item.show_btn_source) : false,
    btn_source_text: sanitizeInfographicText_(item.btn_source_text, 40),
    btn_source_url: normalizeExternalUrl_(item.btn_source_url),
    show_btn_contacto: Object.prototype.hasOwnProperty.call(item, "show_btn_contacto") ? sheetFlagToBool_(item.show_btn_contacto) : true,
    btn_contacto_text: sanitizeInfographicText_(item.btn_contacto_text, 40),
    fecha_creacion: normalizeIsoDateValue_(item.fecha_creacion),
    fecha_actualizacion: normalizeIsoDateValue_(item.fecha_actualizacion)
  };
}

function normalizePhoneForWa_(phone) {
  let digits = normalizeDigits_(phone);
  if (!digits) return "";
  if (digits.length === 10 && digits.charAt(0) === "0") {
    digits = "593" + digits.substring(1);
  } else if (digits.length === 9) {
    digits = "593" + digits;
  }
  return digits;
}

function boolToSheetFlag_(value) {
  if (value === true || value === 1) return "SI";
  const raw = normalizeLower_(value);
  if (raw === "si" || raw === "true" || raw === "1" || raw === "yes" || raw === "on") return "SI";
  return "NO";
}

function sheetFlagToBool_(value) {
  const raw = normalizeLower_(value);
  return raw === "si" || raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function isVacationCurrentlyActive_(record) {
  if (!record || !sheetFlagToBool_(record.activo)) return false;
  const until = normalizeIsoDateValue_(record.fecha_hasta);
  if (!until) return false;
  const today = new Date().toISOString().split("T")[0];
  return today <= until;
}

function buildVacationResponse_(doctorUser, record) {
  const until = normalizeIsoDateValue_(record && record.fecha_hasta);
  const title = normalizeText_((record && record.titulo) || "") || "Aviso importante";
  const message = normalizeText_((record && record.mensaje) || "") || "Tu medico se encuentra temporalmente fuera del consultorio.";
  return {
    success: true,
    doctor_usuario: normalizeLower_(doctorUser || (record && record.doctor_usuario) || ""),
    active: isVacationCurrentlyActive_(record),
    fecha_hasta: until,
    titulo: title,
    mensaje: message,
    fecha_actualizacion: normalizeIsoDateValue_(record && record.fecha_actualizacion),
    block_message: "No se pueden agendar citas hasta " + (until || "nuevo aviso") + "."
  };
}

function normalizePath_(value) {
  const raw = normalizeText_(value);
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : "/" + raw;
}

function randomBase64Url_(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url_(bytes);
}

function randomHex_(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, byteLength * 2);
}

async function sha256Base64Url_(value) {
  const data = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url_(new Uint8Array(digest));
}

function bytesToBase64Url_(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function maskUrlForHealth_(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch (error) {
    return "";
  }
}

function errorResult_(status, message) {
  return {
    status: status || 500,
    payload: {
      success: false,
      message: message || "Error del Worker."
    }
  };
}

function toErrorMessage(error) {
  if (!error) return "Error desconocido.";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch (jsonError) {
    return String(error);
  }
}
