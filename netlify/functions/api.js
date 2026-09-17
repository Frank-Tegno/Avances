/*
NETLIFY FUNCTION - API Plantas Medicinales Chocoanas
=====================================================
Reemplaza el backend Python (app.py) por funciones serverless.
Usa Supabase (PostgreSQL) como base de datos y almacenamiento.

Variables de entorno requeridas en Netlify:
  SUPABASE_URL           https://xxxxxxxx.supabase.co
  SUPABASE_SERVICE_KEY   clave service_role (Dashboard > Settings > API)

El esquema de la base de datos esta en supabase/schema.sql
*/

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const MAX_UPLOAD = 5 * 1024 * 1024; // 5 MB

let _sb = null;
function supabase() {
  if (!_sb) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error(
        "Faltan variables de entorno SUPABASE_URL / SUPABASE_SERVICE_KEY. Configuralas en Site settings > Environment variables."
      );
    }
    _sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _sb;
}

// ============================================================
// UTILIDADES
// ============================================================
function json(status, data) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Token",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(data),
  };
}

const sha256 = (s) =>
  crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");

function publico(u) {
  if (!u) return null;
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    usuario: u.usuario,
    rol: u.rol,
    telefono: u.telefono,
    foto: u.foto,
    fecha_registro: u.fecha_registro,
  };
}

function tokenDe(event) {
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const apikey = h["x-token"] || q.token || null;
  return apikey;
}

function leerBodyJSON(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ============================================================
// SESION / USUARIOS
// ============================================================
async function usuarioPorToken(token) {
  if (!token) return null;
  const { data, error } = await supabase()
    .from("sesiones")
    .select("usuarios!inner(id, nombre, correo, usuario, rol, telefono, foto, fecha_registro)")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  return data.usuarios;
}

async function crearTokenEnSesion(userId) {
  let token = crypto.randomUUID();
  let { error } = await supabase().from("sesiones").insert({ token, user_id: userId });
  if (error) {
    token = crypto.randomBytes(32).toString("hex");
    ({ error } = await supabase().from("sesiones").insert({ token, user_id: userId }));
    if (error) throw new Error(error.message);
  }
  return token;
}

// ============================================================
// PRODUCTOS
// ============================================================
async function listarProductos() {
  const { data, error } = await supabase()
    .from("productos")
    .select(
      "id, nombre, descripcion, precio, precio_anterior, stock, imagen, categoria, activo, vendedor_id, vendedor:usuarios!productos_vendedor_id_fkey(nombre)"
    )
    .order("activo", { ascending: false })
    .order("id", { ascending: true });

  if (error) throw new Error(error.message);

  const productos = (data || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    precio: Number(p.precio),
    precio_anterior: p.precio_anterior == null ? null : Number(p.precio_anterior),
    stock: p.stock,
    imagen: p.imagen,
    categoria: p.categoria,
    activo: p.activo,
    vendedor_id: p.vendedor_id,
    vendedor_nombre: p.vendedor ? p.vendedor.nombre : null,
  }));

  return { success: true, productos, total: productos.length };
}

// ============================================================
// VENTAS
// ============================================================
async function listarVentas(requester) {
  if (!requester) return { status: 401, body: { success: false, message: "No autenticado" } };

  const { data: u } = await supabase().from("usuarios").select("rol").eq("id", requester).maybeSingle();
  if (!u) return { status: 404, body: { success: false, message: "Usuario no encontrado" } };

  let query = supabase()
    .from("ventas")
    .select("id, usuario_id, total, estado, fecha, cliente:usuarios!ventas_usuario_id_fkey(nombre)")
    .order("id", { ascending: false });

  if (u.rol === "comprador") query = query.eq("usuario_id", requester);

  const { data: ventas, error } = await query;
  if (error) throw new Error(error.message);

  for (const v of ventas || []) {
    const { data: det } = await supabase()
      .from("venta_detalle")
      .select("producto_id, nombre, precio, cantidad")
      .eq("venta_id", v.id);
    v.detalles = (det || []).map((d) => ({ ...d, precio: Number(d.precio) }));
  }

  const resultado = (ventas || []).map((v) => ({
    id: v.id,
    usuario_id: v.usuario_id,
    total: Number(v.total),
    estado: v.estado,
    fecha: v.fecha,
    cliente: v.cliente ? v.cliente.nombre : null,
    detalles: v.detalles,
  }));

  return { status: 200, body: { success: true, ventas: resultado, total: resultado.length } };
}

// ============================================================
// MANEJO MULTIPART (subida de foto)
// ============================================================
function parseMultipart(raw, boundary) {
  const delim = Buffer.from("--" + boundary);
  const parts = {};
  let start = raw.indexOf(delim);
  while (start !== -1) {
    const next = raw.indexOf(delim, start + delim.length);
    if (next === -1) break;
    const chunkOriginal = raw.slice(start + delim.length, next);
    start = next; // avanzar siempre (evita bucle infinito)
    let chunk = chunkOriginal;
    if (chunk.length >= 2 && chunk[0] === 13 && chunk[1] === 10) chunk = chunk.slice(2);
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 13 && chunk[chunk.length - 1] === 10)
      chunk = chunk.slice(0, chunk.length - 2);
    const sep = chunk.indexOf("\r\n\r\n");
    if (sep === -1) continue;
    const headerText = chunk.slice(0, sep).toString("utf8");
    const content = chunk.slice(sep + 4);
    let name = null;
    let filename = null;
    for (const line of headerText.split("\r\n")) {
      if (line.toLowerCase().startsWith("content-disposition")) {
        const m = line.match(/name="([^"]*)"/);
        if (m) name = m[1];
        const mf = line.match(/filename="([^"]*)"/);
        if (mf) filename = mf[1];
      }
    }
    if (name) parts[name] = { content, filename };
  }
  return parts;
}

async function asegurarBucket() {
  const { data: buckets } = await supabase().storage.listBuckets();
  if (!buckets || !buckets.find((b) => b.name === "fotos")) {
    await supabase().storage.createBucket("fotos", { public: true });
  }
}

async function subirFoto(bytes, filename) {
  const ext = (filename ? require("path").extname(filename) : ".jpg").toLowerCase();
  const extOk = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
  const extFinal = extOk.indexOf(ext) === -1 ? ".jpg" : ext;
  const contentType =
    extFinal === ".jpg" || extFinal === ".jpeg"
      ? "image/jpeg"
      : "image/" + extFinal.replace(".", "");

  const nombre = "foto_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex") + extFinal;
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  try {
    await asegurarBucket();
  } catch (e) {
    // el bucket se puede crear manualmente en el dashboard; seguimos intentando
  }

  const { error } = await supabase()
    .storage.from("fotos")
    .upload(nombre, arrayBuffer, { contentType, upsert: false });
  if (error) {
    try {
      const { error: crea } = await supabase()
        .storage.from("fotos")
        .upload(nombre, arrayBuffer, { contentType, upsert: false });
      if (crea) throw new Error(crea.message);
    } catch (e2) {
      throw new Error("No se pudo subir la foto al bucket 'fotos': " + e2.message);
    }
  }

  const { data: pub } = supabase().storage.from("fotos").getPublicUrl(nombre);
  return pub.publicUrl;
}

// ============================================================
// RUTAS
// ============================================================
async function rutear(event) {
  const method = event.httpMethod;
  const path = event.path || "";

  // ---------- OPTIONS ----------
  if (method === "OPTIONS") return json(200, {});

  // ---------- GET ----------
  if (method === "GET") {
    if (path === "/api/productos") {
      return json(200, await listarProductos());
    }

    if (path === "/api/perfil") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user) return json(401, { success: false, message: "No autenticado" });
      return json(200, { success: true, usuario: publico(user) });
    }

    if (path === "/api/usuarios") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user || !["admin", "vendedor"].includes(user.rol))
        return json(403, { success: false, message: "Sin permisos" });
      const { data, error } = await supabase()
        .from("usuarios")
        .select("id, nombre, correo, usuario, rol, telefono, foto, fecha_registro")
        .order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return json(200, { success: true, usuarios: data || [], total: (data || []).length });
    }

    if (path === "/api/ventas") {
      const user = await usuarioPorToken(tokenDe(event));
      const res = await listarVentas(user ? user.id : null);
      return json(res.status, res.body);
    }

    return json(404, { success: false, message: "Ruta no encontrada" });
  }

  // ---------- POST ----------
  if (method === "POST") {
    if (path === "/api/registro") {
      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const nombre = (data.nombre || "").trim();
      const correo = (data.email || "").trim().toLowerCase();
      const usuario = (data.usuario || "").trim().toLowerCase();
      const password = data.password || "";
      const rol = (data.rol || "").trim().toLowerCase();
      const telefono = (data.telefono || "").trim();

      if (!["vendedor", "comprador"].includes(rol))
        return json(400, { success: false, message: "Debes especificar si tu cuenta es de tipo vendedor o comprador" });
      if (!nombre || !correo || !usuario || !password)
        return json(400, { success: false, message: "Todos los campos son obligatorios" });
      if (password.length < 6)
        return json(400, { success: false, message: "La contrasena debe tener al menos 6 caracteres" });
      if (correo.indexOf("@") === -1)
        return json(400, { success: false, message: "Correo electronico invalido" });
      if (usuario.length < 3)
        return json(400, { success: false, message: "El usuario debe tener al menos 3 caracteres" });

      const { data: dupeCorreo } = await supabase().from("usuarios").select("id").eq("correo", correo).maybeSingle();
      if (dupeCorreo) return json(409, { success: false, message: "Este correo ya esta registrado" });
      const { data: dupeUsuario } = await supabase().from("usuarios").select("id").eq("usuario", usuario).maybeSingle();
      if (dupeUsuario) return json(409, { success: false, message: "Este usuario ya existe" });

      const { error } = await supabase().from("usuarios").insert({
        nombre,
        correo,
        usuario,
        password: sha256(password),
        rol,
        telefono: telefono || null,
      });
      if (error) throw new Error(error.message);

      return json(201, {
        success: true,
        message: "Usuario registrado exitosamente",
        usuario: { nombre, correo, usuario, rol },
      });
    }

    if (path === "/api/login") {
      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const input = (data.usuario || "").trim().toLowerCase();
      const password = data.password || "";
      if (!input || !password)
        return json(400, { success: false, message: "Usuario y contrasena son obligatorios" });

      let { data: u } = await supabase().from("usuarios").select("*").eq("correo", input).maybeSingle();
      if (!u) {
        const r = await supabase().from("usuarios").select("*").eq("usuario", input).maybeSingle();
        u = r.data;
      }

      if (u && u.password === sha256(password)) {
        const token = await crearTokenEnSesion(u.id);
        return json(200, {
          success: true,
          message: "Bienvenido, " + u.nombre,
          usuario: publico(u),
          token,
        });
      }
      return json(401, { success: false, message: "Correo/usuario o contrasena incorrectos" });
    }

    if (path === "/api/recuperar") {
      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const correo = (data.email || "").trim().toLowerCase();
      const nueva = data.password || "";
      if (!correo || nueva.length < 6)
        return json(400, { success: false, message: "Correo y nueva contrasena (min 6 caracteres) son obligatorios" });

      const { data: u } = await supabase().from("usuarios").select("id").eq("correo", correo).maybeSingle();
      if (!u) return json(404, { success: false, message: "No existe una cuenta con ese correo" });

      const { error } = await supabase()
        .from("usuarios")
        .update({ password: sha256(nueva) })
        .eq("id", u.id);
      if (error) throw new Error(error.message);

      return json(200, { success: true, message: "Contrasena actualizada. Ya puedes iniciar sesion." });
    }

    if (path === "/api/logout") {
      const token = tokenDe(event);
      if (token) await supabase().from("sesiones").delete().eq("token", token);
      return json(200, { success: true, message: "Sesion cerrada" });
    }

    if (path === "/api/perfil/foto") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user) return json(401, { success: false, message: "No autenticado" });

      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64")
        : Buffer.from(event.body || "", "utf8");
      const ctype = (event.headers && event.headers["content-type"]) || "";
      const m = ctype.match(/boundary=(.+)$/);
      if (!m) return json(400, { success: false, message: "Formato invalido" });

      const boundary = m[1].trim().replace(/^"|"$/g, "");
      const partes = parseMultipart(raw, boundary);
      const archivo = partes["foto"];

      if (!archivo || !archivo.content)
        return json(400, { success: false, message: "No se envio ninguna foto" });
      if (archivo.content.length > MAX_UPLOAD)
        return json(413, { success: false, message: "La imagen supera los 5 MB" });

      const url = await subirFoto(archivo.content, archivo.filename);
      const { error } = await supabase().from("usuarios").update({ foto: url }).eq("id", user.id);
      if (error) throw new Error(error.message);

      const { data: actualizado } = await supabase()
        .from("usuarios")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      return json(200, {
        success: true,
        message: "Foto de perfil actualizada",
        usuario: publico(actualizado),
      });
    }

    if (path === "/api/perfil") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user) return json(401, { success: false, message: "No autenticado" });
      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const campos = {};
      if (data.nombre) campos.nombre = String(data.nombre).trim();
      if (data.telefono !== undefined && data.telefono !== null) campos.telefono = String(data.telefono);
      if (data.password) campos.password = sha256(data.password);

      if (!Object.keys(campos).length)
        return json(400, { success: false, message: "No hay datos para actualizar" });

      const { error } = await supabase().from("usuarios").update(campos).eq("id", user.id);
      if (error) throw new Error(error.message);

      const { data: actualizado } = await supabase()
        .from("usuarios")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();

      return json(200, {
        success: true,
        message: "Perfil actualizado",
        usuario: publico(actualizado),
      });
    }

    if (path === "/api/productos") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user || !["admin", "vendedor"].includes(user.rol))
        return json(403, { success: false, message: "Sin permisos (se requiere cuenta admin o vendedor)" });

      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const nombre = (data.nombre || "").trim();
      if (!nombre) return json(400, { success: false, message: "El nombre es obligatorio" });

      const precio = Number(data.precio || 0);
      const anterior = data.precio_anterior && String(data.precio_anterior) !== "0"
        ? Number(data.precio_anterior)
        : null;
      const stock = Math.max(0, parseInt(data.stock || 0, 10) || 0);
      if (isNaN(precio)) return json(400, { success: false, message: "Precio/stock invalido" });

      const vendedorId = user.rol === "vendedor" ? user.id : null;

      const { data: creado, error } = await supabase()
        .from("productos")
        .insert({
          nombre,
          descripcion: data.descripcion || "",
          precio,
          precio_anterior: anterior,
          stock,
          imagen: data.imagen || "",
          categoria: data.categoria || "",
          activo: 1,
          vendedor_id: vendedorId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      return json(201, { success: true, message: "Producto creado", id: creado.id });
    }

    if (path === "/api/venta") {
      const user = await usuarioPorToken(tokenDe(event));
      if (!user) return json(401, { success: false, message: "Inicia sesion para comprar" });

      const data = leerBodyJSON(event);
      if (data === null) return json(400, { success: false, message: "JSON invalido" });

      const items = data.items || [];
      const { data: res, error } = await supabase().rpc("crear_venta", {
        p_user_id: user.id,
        p_items: items,
      });
      if (error) throw new Error(error.message);

      if (res && res.success) return json(201, res);
      return json(400, res || { success: false, message: "No se pudo procesar la venta" });
    }

    return json(404, { success: false, message: "Ruta no encontrada" });
  }

  // ---------- PUT ----------
  if (method === "PUT") {
    const user = await usuarioPorToken(tokenDe(event));
    if (!user) return json(401, { success: false, message: "No autenticado" });

    let m = /^\/api\/productos\/(\d+)$/.exec(path);
    if (!m) m = /^\/api\/stock\/(\d+)$/.exec(path);

    if (!m) return json(404, { success: false, message: "Ruta no encontrada" });

    const pid = Number(m[1]);
    const data = leerBodyJSON(event);
    if (data === null) return json(400, { success: false, message: "JSON invalido" });

    if (!["admin", "vendedor"].includes(user.rol))
      return json(403, { success: false, message: "Sin permisos" });

    const { data: existente } = await supabase()
      .from("productos")
      .select("*")
      .eq("id", pid)
      .maybeSingle();
    if (!existente) return json(404, { success: false, message: "Producto no encontrado" });

    const esAdmin = user.rol === "admin";

    if (!esAdmin) {
      if (existente.vendedor_id !== user.id)
        return json(403, { success: false, message: "Solo puedes modificar el stock de los productos que publicaste" });

      const prohibidos = Object.keys(data).filter((k) => k !== "stock");
      if (prohibidos.length)
        return json(403, { success: false, message: "Como vendedor solo puedes modificar el stock de tu producto" });

      const stock = parseInt(data.stock, 10);
      if (isNaN(stock) || stock < 0)
        return json(400, { success: false, message: "Stock invalido" });

      const { error } = await supabase().from("productos").update({ stock }).eq("id", pid);
      if (error) throw new Error(error.message);
      return json(200, { success: true, message: "Producto actualizado" });
    }

    const campos = {};
    if ("nombre" in data) campos.nombre = String(data.nombre).trim();
    if ("descripcion" in data) campos.descripcion = String(data.descripcion);
    if ("precio" in data) campos.precio = Number(data.precio);
    if ("precio_anterior" in data)
      campos.precio_anterior = data.precio_anterior ? Number(data.precio_anterior) : null;
    if ("stock" in data) campos.stock = Math.max(0, parseInt(data.stock, 10) || 0);
    if ("imagen" in data) campos.imagen = String(data.imagen);
    if ("categoria" in data) campos.categoria = String(data.categoria);
    if ("activo" in data) campos.activo = data.activo ? 1 : 0;

    if (!Object.keys(campos).length)
      return json(400, { success: false, message: "No hay campos para actualizar" });

    const { error } = await supabase().from("productos").update(campos).eq("id", pid);
    if (error) throw new Error(error.message);
    return json(200, { success: true, message: "Producto actualizado" });
  }

  // ---------- DELETE ----------
  if (method === "DELETE") {
    const m = /^\/api\/productos\/(\d+)$/.exec(path);
    if (!m) return json(404, { success: false, message: "Ruta no encontrada" });

    const user = await usuarioPorToken(tokenDe(event));
    if (!user || user.rol !== "admin")
      return json(403, { success: false, message: "Solo el admin puede eliminar productos" });

    const { error } = await supabase().from("productos").delete().eq("id", Number(m[1]));
    if (error) throw new Error(error.message);
    return json(200, { success: true, message: "Producto eliminado" });
  }

  return json(404, { success: false, message: "Ruta no encontrada" });
}

exports.handler = async (event) => {
  try {
    return await rutear(event);
  } catch (e) {
    return json(500, { success: false, message: "Error del servidor: " + e.message });
  }
};

// exportados para pruebas unitarias
exports._internals = {
  json,
  sha256,
  publico,
  parseMultipart,
  tokenDe,
};