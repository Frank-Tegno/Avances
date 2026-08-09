const API_BASE = location.protocol.startsWith("http") ? "" : "http://localhost:5000";

const PRODUCTOS_FALLBACK = [
  { id: 1, nombre: "Infusión de Guaco", descripcion: "Bolsa x 25g — Corte fino para infusión. Ideal para vías respiratorias.", precio: 12500, precio_anterior: 15000, stock: 24, imagen: "img/guaco.jpeg", categoria: "Infusión", activo: 1 },
  { id: 2, nombre: "Té de Cidrón", descripcion: "Bolsa x 30g — Hojas deshidratadas. Digestivo y relajante.", precio: 10000, precio_anterior: null, stock: 30, imagen: "img/cidron.jpeg", categoria: "Té", activo: 1 },
  { id: 3, nombre: "Gel de Sábila Natural", descripcion: "Frasco x 120ml — 100% orgánico. Cicatrizante.", precio: 28000, precio_anterior: null, stock: 15, imagen: "img/sabila.jpeg", categoria: "Gel", activo: 1 },
  { id: 4, nombre: "Jugo de Noni", descripcion: "Botella x 500ml — Puro, sin aditivos. Inmunoestimulante.", precio: 45000, precio_anterior: 52000, stock: 8, imagen: "img/noni.jpeg", categoria: "Jugo", activo: 1 },
  { id: 5, nombre: "Kit Plantas Chocoano", descripcion: "4 productos + guía de uso ancestral.", precio: 85000, precio_anterior: null, stock: 5, imagen: "img/kit.jpeg", categoria: "Kit", activo: 1 },
  { id: 6, nombre: "Extracto de Insulina", descripcion: "Gotero x 30ml — Concentrado natural para control de azúcar.", precio: 35000, precio_anterior: null, stock: 2, imagen: "img/insulina.webp", categoria: "Extracto", activo: 1 }
];

let PRODUCTOS = [];
let USUARIOS = [];
let VENTAS = [];
let filtroTienda = "";

function getToken() { return localStorage.getItem("pmc_token"); }
function setToken(t) { if (t) localStorage.setItem("pmc_token", t); else localStorage.removeItem("pmc_token"); }
function getUser() {
  try { return JSON.parse(localStorage.getItem("pmc_user")); } catch (e) { return null; }
}
function setUser(u) {
  if (u) localStorage.setItem("pmc_user", JSON.stringify(u));
  else localStorage.removeItem("pmc_user");
}

const esAdmin = () => { const u = getUser(); return u && u.rol === "admin"; };
const esVendedor = () => { const u = getUser(); return u && u.rol === "vendedor"; };
const puedeGestionar = () => esAdmin() || esVendedor();

function formatCOP(n) {
  return "$" + Number(n || 0).toLocaleString("es-CO");
}

function toast(titulo, texto, icono) {
  Swal.mixin({
    background: "#071d12",
    color: "#eafff4",
    confirmButtonColor: "#2ee6a8",
    toast: true,
    position: "top-end",
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true,
    customClass: { popup: "swal-verde" }
  }).fire({ icon: icono || "success", title: titulo, text: texto });
}

function alerta(titulo, texto, icono, color) {
  return Swal.fire({
    icon: icono || "info",
    title: titulo,
    text: texto,
    background: "#071d12",
    color: "#eafff4",
    confirmButtonColor: color || "#2d6a4f"
  });
}

// ============================================================
// API
// ============================================================
async function apiFetch(url, options) {
  const opts = options || {};
  opts.headers = Object.assign({}, opts.headers || {});
  if (getToken()) opts.headers["X-Token"] = getToken();
  const res = await fetch(API_BASE + url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: res.ok, status: res.status, data: data || {} };
}

async function cargarProductos() {
  try {
    const r = await apiFetch("/api/productos");
    if (r.ok && r.data.success) {
      PRODUCTOS = r.data.productos || [];
    } else {
      PRODUCTOS = PRODUCTOS_FALLBACK.slice();
    }
  } catch (e) {
    PRODUCTOS = PRODUCTOS_FALLBACK.slice();
  }
  renderTienda();
  renderAdminProductos();
  renderAdmin();
}

async function cargarUsuarios() {
  try {
    const r = await apiFetch("/api/usuarios");
    if (r.ok && r.data.success) USUARIOS = r.data.usuarios || [];
  } catch (e) {
    USUARIOS = [];
  }
  renderAdminUsuarios();
  renderAdmin();
}

async function cargarVentas() {
  try {
    const r = await apiFetch("/api/ventas");
    if (r.ok && r.data.success) VENTAS = r.data.ventas || [];
  } catch (e) {
    VENTAS = [];
  }
  renderAdminVentas();
  renderAdmin();
}

// ============================================================
// SESION
// ============================================================
function aplicarSesion() {
  const u = getUser();
  const caja = document.getElementById("usuario-caja");
  if (!caja) return;
  document.body.classList.remove("rol-admin", "rol-vendedor", "rol-comprador", "rol-invitado");

  const banner = document.getElementById("rol-banner");
  const mensajes = {
    admin: '👑 <strong>Administrador</strong> — gestionas todo el inventario, usuarios y ventas.',
    vendedor: '🧑‍💼 <strong>Vendedor</strong> — publica productos y solo puedes modificar el stock de los que publicaste.',
    comprador: '🛒 <strong>Comprador</strong> — explora y compra nuestros productos naturales.'
  };

  if (u) {
    document.body.classList.add("rol-" + u.rol);
    if (banner) {
      banner.style.display = "flex";
      banner.innerHTML = mensajes[u.rol] || mensajes.comprador;
    }
    const inicial = (u.nombre || u.usuario || "U").charAt(0).toUpperCase();
    const avatarHtml = u.foto ? '<img src="' + u.foto + '" alt="Foto de perfil">' : inicial;
    const rolBadge = '<span class="rol-badge rol-' + u.rol + '">' + rolNombre(u.rol) + '</span>';
    const panelItem = puedeGestionar()
      ? '<a class="um-item" href="admin.html">📊 Panel de gestión</a>'
      : '';
    caja.innerHTML =
      '<div class="usuario-menu-trigger" id="usuario-menu-trigger" onclick="alternarMenuUsuario()">' +
      '<div class="avatar">' + avatarHtml + '</div>' +
      '<div class="usuario-info">' +
      '<div class="u-nombre">' + escapar(u.nombre) + '</div>' +
      '<div class="u-rol">' + rolBadge + '</div>' +
      '</div>' +
      '<span class="um-caret">▾</span>' +
      '</div>' +
      '<div class="usuario-menu" id="usuario-menu">' +
      '<div class="um-cabecera">' +
      '<div class="um-avatar">' + avatarHtml + '</div>' +
      '<div class="um-datos">' +
      '<div class="um-nombre">' + escapar(u.nombre) + '</div>' +
      '<div class="um-correo">' + escapar(u.correo || "") + '</div>' +
      '<div class="um-badge">' + rolBadge + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="um-sep"></div>' +
      '<button class="um-item" onclick="cerrarMenuUsuario(); abrirPerfil();">👤 Mi perfil</button>' +
      panelItem +
      '<button class="um-item" onclick="irATiendaMenu()">🛒 Ir a la tienda</button>' +
      '<div class="um-sep"></div>' +
      '<button class="um-item um-peligro" onclick="cerrarMenuUsuario(); cerrarSesion();">🚪 Cerrar sesión</button>' +
      '</div>';
  } else {
    document.body.classList.add("rol-invitado");
    if (banner) banner.style.display = "none";
    caja.innerHTML =
      '<a class="btn" href="login.html" style="padding:8px 18px;">🔐 Iniciar Sesión</a>';
  }
  const elNombre = document.getElementById("seccion-perfil-nombre");
  if (elNombre) elNombre.textContent = u ? u.nombre : "Invitado";
}

function alternarMenuUsuario() {
  const menu = document.getElementById("usuario-menu");
  if (!menu) return;
  const abierto = menu.classList.toggle("abierto");
  const trig = document.getElementById("usuario-menu-trigger");
  if (trig) trig.classList.toggle("abierto", abierto);
}
function cerrarMenuUsuario() {
  const menu = document.getElementById("usuario-menu");
  if (menu) menu.classList.remove("abierto");
  const trig = document.getElementById("usuario-menu-trigger");
  if (trig) trig.classList.remove("abierto");
}
function irATiendaMenu() {
  cerrarMenuUsuario();
  const tab = document.getElementById("tab-venta");
  if (tab) {
    tab.checked = true;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    window.location.href = "index.html";
  }
}
document.addEventListener("click", function (e) {
  const caja = document.getElementById("usuario-caja");
  if (caja && !caja.contains(e.target)) cerrarMenuUsuario();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") cerrarMenuUsuario();
});

function rolNombre(r) {
  const map = { admin: "Administrador", vendedor: "Vendedor", comprador: "Comprador" };
  return map[r] || r;
}

function escapar(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function jsStr(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;");
}

async function verificarSesion() {
  if (!getToken()) return;
  try {
    const r = await apiFetch("/api/perfil");
    if (r.ok && r.data.success) {
      setUser(r.data.usuario);
    } else if (r.status === 401) {
      setToken(null);
      setUser(null);
    }
  } catch (e) {
    /* servidor apagado: se mantiene la sesion local */
  }
  aplicarSesion();
}

function cerrarSesion() {
  apiFetch("/api/logout").catch(function () {});
  setToken(null);
  setUser(null);
  toast("Sesión cerrada", "¡Hasta pronto!", "info");
  setTimeout(function () { aplicarSesion(); }, 400);
}

// ============================================================
// CARRITO (persistente en localStorage)
// ============================================================
function cargarCarrito() {
  try { return JSON.parse(localStorage.getItem("pmc_cart") || "[]"); }
  catch (e) { return []; }
}
function guardarCarrito(c) {
  localStorage.setItem("pmc_cart", JSON.stringify(c));
  actualizarBadge();
  renderCarrito();
}
function productoPorId(id) {
  return PRODUCTOS.find(function (p) { return p.id === id; });
}

function agregarCarrito(id, nombre, precio, precioAnterior, imagen, stockMax) {
  const carrito = cargarCarrito();
  const item = carrito.find(function (i) { return i.id === id; });
  const limite = stockMax != null ? stockMax : 99;
  if (item) {
    if (item.cantidad >= limite) {
      toast("Límite de stock", "No hay más unidades de " + nombre, "warning");
      return;
    }
    item.cantidad += 1;
  } else {
    carrito.push({ id: id, nombre: nombre, precio: precio, precioAnterior: precioAnterior, imagen: imagen, cantidad: 1, stockMax: limite });
  }
  guardarCarrito(carrito);
  toast("¡Añadido!", nombre + " se agregó al carrito", "success");
}

function cambiarCantidad(id, delta) {
  const carrito = cargarCarrito();
  const item = carrito.find(function (i) { return i.id === id; });
  if (!item) return;
  item.cantidad += delta;
  const limite = item.stockMax || 99;
  if (item.cantidad < 1) item.cantidad = 1;
  if (item.cantidad > limite) {
    item.cantidad = limite;
    toast("Límite de stock", "Máximo disponible: " + limite, "warning");
  }
  guardarCarrito(carrito);
}

function quitarDelCarrito(id) {
  let carrito = cargarCarrito();
  carrito = carrito.filter(function (i) { return i.id !== id; });
  guardarCarrito(carrito);
  toast("Eliminado", "Producto retirado del carrito", "info");
}

function vaciarCarrito() {
  guardarCarrito([]);
  toast("Carrito vacío", "Se eliminaron todos los productos", "info");
}

function totalCarrito() {
  return cargarCarrito().reduce(function (acc, i) { return acc + i.precio * i.cantidad; }, 0);
}

function actualizarBadge() {
  const badge = document.getElementById("badge-carrito");
  if (!badge) return;
  const n = cargarCarrito().reduce(function (acc, i) { return acc + i.cantidad; }, 0);
  badge.textContent = n;
  badge.style.transform = "scale(1.4)";
  setTimeout(function () { badge.style.transform = "scale(1)"; }, 180);
}

function abrirCarrito() {
  document.getElementById("carrito-panel").classList.add("abierto");
  document.getElementById("overlay-carrito").classList.add("visible");
  document.body.style.overflow = "hidden";
  renderCarrito();
}
function cerrarCarrito() {
  document.getElementById("carrito-panel").classList.remove("abierto");
  document.getElementById("overlay-carrito").classList.remove("visible");
  document.body.style.overflow = "";
}

function renderCarrito() {
  const cuerpo = document.getElementById("carrito-cuerpo");
  const pie = document.getElementById("carrito-pie");
  const carrito = cargarCarrito();
  if (!cuerpo || !pie) return;

  if (!carrito.length) {
    cuerpo.innerHTML =
      '<div class="carrito-vacio">' +
      '<div class="emoji">🛒</div>' +
      '<p><strong>Tu carrito está vacío</strong></p>' +
      '<p style="margin-top:6px;">Explora nuestra tienda y añade productos naturales.</p>' +
      '</div>';
    pie.innerHTML = '<button class="btn secundario" onclick="cerrarCarrito(); irATienda();">Ir a la tienda</button>';
    return;
  }

  let html = "";
  carrito.forEach(function (i) {
    const totalLinea = i.precio * i.cantidad;
    html +=
      '<div class="carrito-item">' +
      '<img src="' + escapar(i.imagen) + '" alt="' + escapar(i.nombre) + '">' +
      '<div class="ci-info">' +
      '<div class="ci-nombre">' + escapar(i.nombre) + '</div>' +
      '<div class="ci-precio">' + formatCOP(i.precio) + '</div>' +
      '<div class="ci-acciones">' +
      '<button class="step-btn" onclick="cambiarCantidad(' + i.id + ', -1)">−</button>' +
      '<div class="ci-cant">' + i.cantidad + '</div>' +
      '<button class="step-btn" onclick="cambiarCantidad(' + i.id + ', 1)">+</button>' +
      (i.stockMax > 0 && i.cantidad >= i.stockMax ? '<div class="ci-stock-limite">máx</div>' : '') +
      '<button class="ci-quitar" onclick="quitarDelCarrito(' + i.id + ')">✕ Quitar</button>' +
      '</div>' +
      '</div>' +
      '<div style="align-self:center; color:var(--lima); font-weight:700; font-size:0.95rem;">' + formatCOP(totalLinea) + '</div>' +
      '</div>';
  });

  cuerpo.innerHTML = html;
  pie.innerHTML =
    '<div class="carrito-total-fila"><span>Productos:</span><span>' + carrito.reduce(function (a, i) { return a + i.cantidad; }, 0) + '</span></div>' +
    '<div class="carrito-total-fila grande"><span>Total:</span><span>' + formatCOP(totalCarrito()) + '</span></div>' +
    '<button class="btn" onclick="finalizarCompra()">💳 Finalizar compra</button>' +
    '<button class="btn secundario" onclick="vaciarCarrito()">🗑 Vaciar carrito</button>' +
    '<button class="btn secundario" onclick="cerrarCarrito()">Seguir comprando</button>';
}

function irATienda() {
  document.getElementById("tab-venta").checked = true;
  cerrarCarrito();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function finalizarCompra() {
  const carrito = cargarCarrito();
  if (!carrito.length) return;
  const u = getUser();
  if (!u) {
    const res = await Swal.fire({
      title: "Inicia sesión para comprar",
      text: "Necesitas una cuenta para finalizar tu pedido.",
      icon: "warning",
      background: "#071d12",
      color: "#eafff4",
      confirmButtonColor: "#2ee6a8",
      cancelButtonColor: "#ff5c77",
      showCancelButton: true,
      confirmButtonText: "Ir a iniciar sesión",
      cancelButtonText: "Seguir comprando"
    });
    if (res.isConfirmed) window.location.href = "login.html";
    return;
  }

  Swal.fire({
    title: "Procesando compra...",
    text: "Validando stock",
    background: "#071d12",
    color: "#eafff4",
    allowOutsideClick: false,
    didOpen: function () { Swal.showLoading(); }
  });

  try {
    const r = await apiFetch("/api/venta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: carrito.map(function (i) { return { id: i.id, cantidad: i.cantidad }; })
      })
    });
    Swal.close();
    if (r.ok && r.data.success) {
      guardarCarrito([]);
      cargarProductos();
      alerta("¡Compra exitosa!", r.data.message + ". Total: " + formatCOP(r.data.venta.total), "success", "#52b788");
      cerrarCarrito();
    } else {
      alerta("No se pudo completar la compra", r.data.message || "Error desconocido", "error", "#e63946");
    }
  } catch (e) {
    Swal.close();
    alerta("Error de conexión", "No se pudo conectar al servidor. Verifica que esté corriendo.", "error", "#e63946");
  }
}

// ============================================================
// TIENDA (render)
// ============================================================
function estadoStock(p) {
  if (p.stock <= 0) return { txt: "Agotado", cls: "badge-agotado", ico: "⛔", disable: true };
  if (p.stock <= 5) return { txt: "¡Bajo stock! (" + p.stock + " uds)", cls: "badge-bajo", ico: "⚠️", disable: false };
  return { txt: "En stock", cls: "badge-en-stock", ico: "✅", disable: false };
}

function renderTienda() {
  const grid = document.getElementById("tienda-grid");
  if (!grid) return;
  const term = filtroTienda.toLowerCase();

  const visibles = PRODUCTOS.filter(function (p) {
    if (!p.activo) return false;
    if (!term) return true;
    return (p.nombre || "").toLowerCase().indexOf(term) !== -1 ||
           (p.categoria || "").toLowerCase().indexOf(term) !== -1 ||
           (p.descripcion || "").toLowerCase().indexOf(term) !== -1;
  });

  if (!visibles.length) {
    grid.innerHTML = '<div class="carrito-vacio" style="grid-column:1/-1;"><div class="emoji">🔍</div><p><strong>No se encontraron productos</strong></p></div>';
    return;
  }

  grid.innerHTML = visibles.map(function (p) {
    const st = estadoStock(p);
    const puede = puedeGestionar();
    const stockTxt = puede
      ? '<span class="badge badge-stock-cant">Stock: ' + p.stock + ' uds</span>'
      : '<span class="badge ' + st.cls + '">' + st.ico + ' ' + st.txt + '</span>';
    const btn = st.disable
      ? '<button class="btn-comprar" disabled>Agotado</button>'
      : '<button class="btn-comprar" onclick="agregarCarrito(' + p.id + ', \'' + jsStr(p.nombre) + '\', ' + p.precio + ', ' + (p.precio_anterior || "null") + ', \'' + jsStr(p.imagen) + '\', ' + p.stock + ')">🛒 Añadir al carrito</button>';

    return '<div class="producto-venta' + (st.disable ? " agotado" : "") + '">' +
      '<img class="producto-img" src="' + escapar(p.imagen) + '" alt="' + escapar(p.nombre) + '">' +
      '<div class="producto-detalles">' +
      '<h3>' + escapar(p.nombre) + '</h3>' +
      '<p class="descripcion">' + escapar(p.descripcion) + '</p>' +
      '<div class="precio">' + formatCOP(p.precio) + (p.precio_anterior ? ' <span class="tachado">' + formatCOP(p.precio_anterior) + '</span>' : '') + '</div>' +
      '<div class="stock-fila">' + stockTxt + '</div>' +
      btn +
      '</div></div>';
  }).join("");
}

// ============================================================
// PERFIL
// ============================================================
function abrirPerfil() {
  const u = getUser();
  if (!u) { window.location.href = "login.html"; return; }
  const modal = document.getElementById("modal-perfil");
  if (!modal) { window.location.href = "index.html"; return; }
  const avatar = document.getElementById("perfil-avatar");
  const inicial = (u.nombre || u.usuario || "U").charAt(0).toUpperCase();
  avatar.innerHTML = u.foto ? '<img src="' + u.foto + '" alt="foto">' : inicial;
  document.getElementById("perfil-nombre").value = u.nombre || "";
  document.getElementById("perfil-telefono").value = u.telefono || "";
  document.getElementById("perfil-password").value = "";
  document.getElementById("perfil-rol-muestra").innerHTML =
    '<span class="rol-badge rol-' + u.rol + '">' + rolNombre(u.rol) + '</span>' +
    ' <span style="color:var(--texto-suave);">' + escapar(u.correo || "") + '</span>';
  document.getElementById("modal-perfil").classList.add("visible");
}
function cerrarPerfil() {
  const m = document.getElementById("modal-perfil");
  if (m) m.classList.remove("visible");
}

async function guardarPerfil() {
  const u = getUser();
  if (!u) return;
  const nombre = document.getElementById("perfil-nombre").value.trim();
  const telefono = document.getElementById("perfil-telefono").value.trim();
  const password = document.getElementById("perfil-password").value;
  const body = { nombre: nombre, telefono: telefono };
  if (password) body.password = password;

  Swal.fire({ title: "Guardando...", background: "#071d12", allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
  try {
    const r = await apiFetch("/api/perfil", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    Swal.close();
    if (r.ok && r.data.success) {
      setUser(r.data.usuario);
      aplicarSesion();
      toast("Perfil actualizado", "Tus datos se guardaron correctamente", "success");
      cerrarPerfil();
    } else {
      alerta("Error", r.data.message, "error", "#e63946");
    }
  } catch (e) {
    Swal.close();
    alerta("Error de conexión", "No se pudo guardar el perfil.", "error", "#e63946");
  }
}

function onFotoSeleccionada(input) {
  const archivo = input.files && input.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = function (e) {
    document.getElementById("perfil-avatar").innerHTML = '<img src="' + e.target.result + '" alt="foto">';
  };
  lector.readAsDataURL(archivo);
}

async function subirFotoPerfil() {
  const input = document.getElementById("perfil-foto-input");
  const archivo = input.files && input.files[0];
  if (!archivo) { toast("Selecciona una imagen", "Elige una foto primero", "warning"); return; }

  Swal.fire({ title: "Subiendo foto...", background: "#071d12", allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
  try {
    const fd = new FormData();
    fd.append("token", getToken());
    fd.append("foto", archivo);
    const r = await fetch(API_BASE + "/api/perfil/foto", {
      method: "POST",
      headers: { "X-Token": getToken() },
      body: fd
    });
    const data = await r.json();
    Swal.close();
    if (data.success) {
      setUser(data.usuario);
      aplicarSesion();
      abrirPerfil();
      toast("¡Foto actualizada!", "Se cambió tu foto de perfil", "success");
    } else {
      alerta("Error", data.message, "error", "#e63946");
    }
  } catch (e) {
    Swal.close();
    alerta("Error de conexión", "No se pudo subir la foto.", "error", "#e63946");
  }
}

// ============================================================
// PANEL ADMIN / VENDEDOR
// ============================================================
function renderAdmin() {
  if (!puedeGestionar()) return;
  const stats = document.getElementById("admin-stats");
  if (stats) {
    const bajos = PRODUCTOS.filter(function (p) { return p.stock <= 5; });
    const totalVentas = VENTAS.reduce(function (a, v) { return a + Number(v.total || 0); }, 0);
    stats.innerHTML =
      '<div class="stat-card"><div class="stat-ico">📦</div><div><div class="stat-num">' + PRODUCTOS.length + '</div><div class="stat-txt">Productos</div></div></div>' +
      '<div class="stat-card"><div class="stat-ico">⚠️</div><div><div class="stat-num">' + bajos.length + '</div><div class="stat-txt">Stock bajo / agotado</div></div></div>' +
      '<div class="stat-card"><div class="stat-ico">👥</div><div><div class="stat-num">' + USUARIOS.length + '</div><div class="stat-txt">Usuarios</div></div></div>' +
      '<div class="stat-card"><div class="stat-ico">💰</div><div><div class="stat-num">' + formatCOP(totalVentas) + '</div><div class="stat-txt">Ventas (' + VENTAS.length + ')</div></div></div>';
  }
}

function renderAdminProductos() {
  const tbody = document.getElementById("tabla-productos-body");
  if (!tbody) return;
  const yo = getUser() || {};
  const esAdminUi = yo.rol === "admin";
  const esVendedorUi = yo.rol === "vendedor";
  const filas = PRODUCTOS.map(function (p) {
    const st = estadoStock(p);
    const esMio = esVendedorUi && p.vendedor_id === yo.id;
    const editable = esAdminUi || esMio;
    const publicador = esVendedorUi
      ? (esMio
          ? '<span class="badge badge-mio">✓ Publicado por ti</span>'
          : '<span class="badge badge-otro">👤 ' + escapar(p.vendedor_nombre || "otro vendedor") + '</span>')
      : (p.vendedor_nombre
          ? '<span class="badge badge-otro">👤 ' + escapar(p.vendedor_nombre) + '</span>'
          : '<span class="badge badge-otro">🏢 Admin</span>');
    const stockHtml = editable
      ? '<div style="display:flex; gap:6px; align-items:center;">' +
        '<input class="stock-input" id="stock-' + p.id + '" type="number" min="0" value="' + p.stock + '">' +
        '<button class="btn-mini" onclick="guardarStock(' + p.id + ')" title="Guardar stock">💾</button>' +
        '</div>'
      : '<span class="badge badge-en-stock">' + p.stock + ' uds</span>';
    const editarBtn = editable
      ? '<button class="btn-mini" onclick="abrirProductoModal(' + p.id + ')">✏️ Editar</button>'
      : '<button class="btn-mini" disabled title="Solo editas los productos que publicaste">✏️</button>';
    return '<tr>' +
      '<td><img class="mini-img" src="' + escapar(p.imagen) + '" alt=""></td>' +
      '<td><strong>' + escapar(p.nombre) + '</strong><br><span style="color:var(--texto-suave); font-size:0.78rem;">' + escapar(p.categoria || "—") + '</span><br>' + publicador + '</td>' +
      '<td>' + formatCOP(p.precio) + '</td>' +
      '<td><span class="badge ' + st.cls + '">' + st.txt + '</span></td>' +
      '<td>' + stockHtml + '</td>' +
      '<td>' +
      '<div class="acciones-fila">' +
      editarBtn +
      '<button class="btn-mini rojo" onclick="borrarProducto(' + p.id + ')" ' + (esAdminUi ? "" : "disabled title='Solo admin'") + '>🗑</button>' +
      '</div>' +
      '</td>' +
      '</tr>';
  }).join("");
  tbody.innerHTML = filas || '<tr><td colspan="6" style="text-align:center; color:var(--texto-suave);">Sin productos</td></tr>';
}

async function guardarStock(id) {
  const input = document.getElementById("stock-" + id);
  if (!input) return;
  const stock = parseInt(input.value, 10);
  if (isNaN(stock) || stock < 0) { toast("Stock inválido", "Ingresa un número válido", "warning"); return; }
  try {
    const r = await apiFetch("/api/stock/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stock: stock })
    });
    if (r.ok && r.data.success) {
      toast("Stock actualizado", "Inventario guardado", "success");
      cargarProductos();
    } else {
      alerta("Sin permisos", r.data.message, "error", "#e63946");
    }
  } catch (e) {
    alerta("Error de conexión", "No se pudo actualizar el stock.", "error", "#e63946");
  }
}

function renderAdminUsuarios() {
  const tbody = document.getElementById("tabla-usuarios-body");
  if (!tbody) return;
  if (!esAdmin()) {
    document.getElementById("panel-usuarios").style.display = "none";
    return;
  }
  document.getElementById("panel-usuarios").style.display = "block";
  const filas = USUARIOS.map(function (u) {
    return '<tr>' +
      '<td><strong>' + escapar(u.nombre) + '</strong></td>' +
      '<td>' + escapar(u.correo) + '</td>' +
      '<td>' + escapar(u.usuario) + '</td>' +
      '<td><span class="rol-badge rol-' + u.rol + '">' + rolNombre(u.rol) + '</span></td>' +
      '<td>' + escapar(u.telefono || "—") + '</td>' +
      '<td>' + escapar((u.fecha_registro || "").substring(0, 10)) + '</td>' +
      '</tr>';
  }).join("");
  tbody.innerHTML = filas || '<tr><td colspan="6" style="text-align:center; color:var(--texto-suave);">Sin usuarios</td></tr>';
}

function renderAdminVentas() {
  const tbody = document.getElementById("tabla-ventas-body");
  if (!tbody) return;
  const filas = VENTAS.map(function (v) {
    const det = (v.detalles || []).map(function (d) {
      return d.cantidad + " × " + escapar(d.nombre) + " (" + formatCOP(d.precio * d.cantidad) + ")";
    }).join("<br>");
    return '<tr>' +
      '<td>#' + v.id + '</td>' +
      '<td>' + escapar(v.cliente || "—") + '</td>' +
      '<td>' + formatCOP(v.total) + '</td>' +
      '<td>' + escapar((v.fecha || "").substring(0, 16)) + '</td>' +
      '<td><details><summary style="cursor:pointer; color:var(--verde-neon);">Ver detalle</summary><div style="padding-top:6px; color:var(--lima); font-size:0.82rem; line-height:1.6;">' + det + '</div></details></td>' +
      '</tr>';
  }).join("");
  tbody.innerHTML = filas || '<tr><td colspan="5" style="text-align:center; color:var(--texto-suave);">Sin ventas todavía</td></tr>';
}

// ============================================================
// MODAL PRODUCTO (crear / editar)
// ============================================================
let productoEditandoId = null;

function abrirProductoModal(id) {
  const u = getUser() || {};
  if (id && u.rol === "vendedor") {
    const p = PRODUCTOS.find(function (x) { return x.id === id; });
    if (p && p.vendedor_id !== u.id) {
      alerta("Sin permisos", "Solo puedes modificar el stock de los productos que publicaste.", "error", "#e63946");
      return;
    }
  }
  productoEditandoId = id || null;
  document.getElementById("producto-modal-titulo").textContent = id ? "Editar producto" : "Nuevo producto";
  const p = id ? PRODUCTOS.find(function (x) { return x.id === id; }) : null;
  document.getElementById("prod-nombre").value = p ? p.nombre : "";
  document.getElementById("prod-descripcion").value = p ? (p.descripcion || "") : "";
  document.getElementById("prod-precio").value = p ? p.precio : "";
  document.getElementById("prod-precio-anterior").value = p && p.precio_anterior ? p.precio_anterior : "";
  document.getElementById("prod-stock").value = p ? p.stock : 0;
  document.getElementById("prod-categoria").value = p ? (p.categoria || "") : "";
  document.getElementById("prod-imagen").value = p ? (p.imagen || "") : "";

  const soloStock = id && u.rol === "vendedor";
  ["prod-nombre", "prod-descripcion", "prod-precio", "prod-precio-anterior", "prod-categoria", "prod-imagen"].forEach(function (campoId) {
    document.getElementById(campoId).disabled = soloStock;
  });
  document.getElementById("prod-stock").disabled = false;
  if (soloStock) {
    document.getElementById("producto-modal-titulo").textContent = "Modificar stock";
  }
  document.getElementById("modal-producto").classList.add("visible");
}
function cerrarProductoModal() {
  document.getElementById("modal-producto").classList.remove("visible");
  ["prod-nombre", "prod-descripcion", "prod-precio", "prod-precio-anterior", "prod-stock", "prod-categoria", "prod-imagen"].forEach(function (campoId) {
    document.getElementById(campoId).disabled = false;
  });
  productoEditandoId = null;
}

async function guardarProducto() {
  const u = getUser() || {};
  const soloStock = productoEditandoId && u.rol === "vendedor";
  let data;
  if (soloStock) {
    data = { stock: document.getElementById("prod-stock").value };
  } else {
    data = {
      nombre: document.getElementById("prod-nombre").value.trim(),
      descripcion: document.getElementById("prod-descripcion").value,
      precio: document.getElementById("prod-precio").value,
      precio_anterior: document.getElementById("prod-precio-anterior").value,
      stock: document.getElementById("prod-stock").value,
      categoria: document.getElementById("prod-categoria").value,
      imagen: document.getElementById("prod-imagen").value
    };
  }
  if (!soloStock && !data.nombre) { toast("Falta el nombre", "El nombre es obligatorio", "warning"); return; }
  if (!soloStock && !data.imagen) data.imagen = "img/guaco.jpeg";

  Swal.fire({ title: "Guardando...", background: "#071d12", allowOutsideClick: false, didOpen: function () { Swal.showLoading(); } });
  try {
    const url = productoEditandoId ? "/api/productos/" + productoEditandoId : "/api/productos";
    const metodo = productoEditandoId ? "PUT" : "POST";
    const r = await apiFetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    Swal.close();
    if (r.ok && r.data.success) {
      toast("Producto guardado", productoEditandoId ? "Cambios aplicados" : "Producto creado", "success");
      cerrarProductoModal();
      cargarProductos();
    } else {
      alerta("Error", r.data.message, "error", "#e63946");
    }
  } catch (e) {
    Swal.close();
    alerta("Error de conexión", "No se pudo guardar el producto.", "error", "#e63946");
  }
}

async function borrarProducto(id) {
  const res = await Swal.fire({
    title: "¿Eliminar producto?",
    text: "Esta acción no se puede deshacer.",
    icon: "warning",
    background: "#071d12",
    color: "#eafff4",
    showCancelButton: true,
    confirmButtonText: "Sí, eliminar",
    cancelButtonText: "Cancelar",
    confirmButtonColor: "#ff5c77"
  });
  if (!res.isConfirmed) return;
  try {
    const r = await apiFetch("/api/productos/" + id, { method: "DELETE" });
    if (r.ok && r.data.success) {
      toast("Eliminado", "Producto eliminado", "info");
      cargarProductos();
    } else {
      alerta("Sin permisos", r.data.message, "error", "#e63946");
    }
  } catch (e) {
    alerta("Error de conexión", "No se pudo eliminar.", "error", "#e63946");
  }
}

// ============================================================
// CONTACTO
// ============================================================
function enviarContacto(e) {
  e.preventDefault();
  const form = document.getElementById("formContacto");
  alerta("¡Mensaje enviado!", "Gracias por contactarnos. Te responderemos pronto.", "success", "#52b788");
  form.reset();
}

// ============================================================
// INICIO
// ============================================================
function iniciar() {
  const buscador = document.getElementById("buscador");
  if (buscador) {
    buscador.addEventListener("input", function (ev) {
      filtroTienda = ev.target.value;
      renderTienda();
    });
  }

  const radios = document.querySelectorAll('input[name="tabs"]');
  radios.forEach(function (r) {
    r.addEventListener("change", function () {
      if (this.id === "tab-admin" && puedeGestionar()) {
        cargarUsuarios();
        cargarVentas();
      }
    });
  });

  if (puedeGestionar()) {
    cargarUsuarios();
    cargarVentas();
  }

  aplicarSesion();
  verificarSesion();
  cargarProductos();
  actualizarBadge();
  renderCarrito();
}

document.addEventListener("DOMContentLoaded", iniciar);
