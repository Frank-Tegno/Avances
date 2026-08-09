#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor HTTP + API para Plantas Medicinales Chocoanas
=======================================================
- Conecta con MySQL (WAMP/XAMPP) usando mysql.connector o pymysql
- Crea automaticamente las tablas (usuarios, productos, ventas, venta_detalle)
- Migra los datos de la tabla antigua `registro` si existe
- Crea cuentas demo: admin / vendedor / comprador
- API con sesiones por token, subida de foto de perfil, stock y ventas

Requisitos:
    pip install mysql-connector-python   (o pymysql)
"""

import http.server
import socketserver
import json
import hashlib
import os
import re
import uuid
import datetime
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

PORT = int(os.environ.get("PORT", "5000"))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
MAX_UPLOAD = 5 * 1024 * 1024  # 5 MB
ROLES = ("admin", "vendedor", "comprador")

# ============================================================
# CONFIGURACION MySQL (configurable por variables de entorno)
#   Local (XAMPP/WAMP):  deja las variables vacias
#   Nube (Aiven/TiDB):   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
#                        y opcionalmente DB_CA_PATH con el certificado CA
# ============================================================
DB_CONFIG = {
    "host": os.environ.get("DB_HOST", "localhost"),
    "user": os.environ.get("DB_USER", "root"),
    "password": os.environ.get("DB_PASSWORD", ""),
    "database": os.environ.get("DB_NAME", "base1"),
    "port": int(os.environ.get("DB_PORT", "3306")),
    "charset": "utf8mb4",
}

_db_ca = os.environ.get("DB_CA_PATH")
if _db_ca:
    DB_CONFIG["ssl_ca"] = _db_ca

if os.environ.get("DB_SSL_DISABLED") == "1":
    DB_CONFIG["ssl_disabled"] = True

DB_DRIVER = None
try:
    import mysql.connector  # noqa: F401
    DB_DRIVER = "mysql"
except ImportError:
    try:
        import pymysql  # noqa: F401
        DB_DRIVER = "pymysql"
    except ImportError:
        DB_DRIVER = None

sessions = {}  # token -> user_id


# ============================================================
# CONEXION
# ============================================================
def get_connection(database=True):
    """Crea una conexion a MySQL."""
    config = dict(DB_CONFIG)
    if not database:
        config.pop("database", None)
    if DB_DRIVER == "mysql":
        return mysql.connector.connect(**config)
    if DB_DRIVER == "pymysql":
        return pymysql.connect(**config)
    raise RuntimeError("No hay driver de MySQL instalado")


def fetch_all(sql, params=None):
    """Ejecuta un SELECT y devuelve lista de dicts."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, params or ())
        cols = [d[0] for d in cur.description]
        rows = []
        for row in cur.fetchall():
            rows.append(_to_dict(cols, row))
        cur.close()
        return rows
    finally:
        conn.close()


def fetch_one(sql, params=None):
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(sql, params=None):
    """Ejecuta INSERT/UPDATE/DELETE y hace commit."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, params or ())
        last_id = cur.lastrowid
        conn.commit()
        cur.close()
        return last_id
    finally:
        conn.close()


def _to_dict(cols, row):
    d = {}
    for i, c in enumerate(cols):
        v = row[i]
        if hasattr(v, "__float__") and not isinstance(v, (int, float)):
            try:
                v = float(v)
            except (TypeError, ValueError):
                pass
        if isinstance(v, datetime.datetime):
            v = v.isoformat(sep=" ", timespec="minutes")
        d[c] = v
    return d


# ============================================================
# SEGURIDAD
# ============================================================
def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def crear_token(user_id):
    token = uuid.uuid4().hex
    sessions[token] = user_id
    return token


def usuario_por_token(token):
    uid = sessions.get(token)
    if not uid:
        return None
    return fetch_one(
        "SELECT id, nombre, correo, usuario, rol, telefono, foto, fecha_registro "
        "FROM usuarios WHERE id = %s",
        (uid,),
    )


def publico(usuario):
    """Copia publica del usuario (sin password)."""
    if not usuario:
        return None
    return {
        "id": usuario.get("id"),
        "nombre": usuario.get("nombre"),
        "correo": usuario.get("correo"),
        "usuario": usuario.get("usuario"),
        "rol": usuario.get("rol"),
        "telefono": usuario.get("telefono"),
        "foto": usuario.get("foto"),
        "fecha_registro": usuario.get("fecha_registro"),
    }


# ============================================================
# ESQUEMA / INICIALIZACION
# ============================================================
def ensure_database():
    if not DB_DRIVER:
        return False
    try:
        conn = get_connection(database=False)
        try:
            cur = conn.cursor()
            db = DB_CONFIG["database"]
            cur.execute(
                "CREATE DATABASE IF NOT EXISTS `{}` CHARACTER SET utf8mb4".format(db)
            )
            conn.commit()
            cur.close()
        finally:
            conn.close()
    except Exception:
        # En MySQL de la nube puede no permitirse crear bases de datos;
        # se asume que la base ya existe y fue creada por el usuario.
        pass
    return True


def _asegurar_columna(tabla, columna, alter_sql):
    """Agrega una columna si no existe (para tablas creadas con esquema anterior)."""
    try:
        fila = fetch_one(
            "SELECT COUNT(*) AS n FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = %s AND column_name = %s",
            (tabla, columna),
        )
        if fila and fila["n"] > 0:
            return
        execute(alter_sql)
    except Exception:
        pass


def ensure_tables():
    execute(
        """
        CREATE TABLE IF NOT EXISTS usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(255) NOT NULL,
            correo VARCHAR(255) NOT NULL UNIQUE,
            usuario VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            rol ENUM('admin','vendedor','comprador') NOT NULL DEFAULT 'comprador',
            telefono VARCHAR(50) NULL,
            foto VARCHAR(255) NULL,
            fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4
        """
    )
    execute(
        """
        CREATE TABLE IF NOT EXISTS productos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(255) NOT NULL,
            descripcion TEXT NULL,
            precio DECIMAL(12,2) NOT NULL DEFAULT 0,
            precio_anterior DECIMAL(12,2) NULL,
            stock INT NOT NULL DEFAULT 0,
            imagen VARCHAR(255) NULL,
            categoria VARCHAR(100) NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            vendedor_id INT NULL
        ) CHARACTER SET utf8mb4
        """
    )
    _asegurar_columna(
        "productos",
        "vendedor_id",
        "ALTER TABLE productos ADD COLUMN vendedor_id INT NULL",
    )
    execute(
        """
        CREATE TABLE IF NOT EXISTS ventas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_id INT NOT NULL,
            total DECIMAL(12,2) NOT NULL DEFAULT 0,
            estado VARCHAR(30) NOT NULL DEFAULT 'completada',
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4
        """
    )
    execute(
        """
        CREATE TABLE IF NOT EXISTS venta_detalle (
            id INT AUTO_INCREMENT PRIMARY KEY,
            venta_id INT NOT NULL,
            producto_id INT NOT NULL,
            nombre VARCHAR(255) NOT NULL,
            precio DECIMAL(12,2) NOT NULL DEFAULT 0,
            cantidad INT NOT NULL DEFAULT 1
        ) CHARACTER SET utf8mb4
        """
    )


def migrar_registro():
    """Si existe la tabla antigua `registro`, pasa sus usuarios a `usuarios`."""
    try:
        total = fetch_one("SELECT COUNT(*) AS n FROM usuarios")
        if total and total["n"] > 0:
            return
    except Exception:
        return

    try:
        antiguos = fetch_all("SELECT ID, nombre, correo, contraseña FROM registro")
    except Exception:
        return

    for a in antiguos:
        correo = (a.get("correo") or "").strip().lower()
        if not correo:
            continue
        usuario = correo.split("@")[0].replace(".", "_").replace("-", "_")
        try:
            execute(
                "INSERT INTO usuarios (nombre, correo, usuario, password, rol) "
                "VALUES (%s, %s, %s, %s, 'comprador')",
                (a.get("nombre") or correo, correo, usuario, a.get("contraseña")),
            )
        except Exception:
            pass


def seed_datos():
    """Crea cuentas demo y productos por defecto si la base esta vacia."""
    try:
        if fetch_one("SELECT COUNT(*) AS n FROM usuarios")["n"] > 0:
            cuentas_demo = False
        else:
            cuentas_demo = True
    except Exception:
        cuentas_demo = True

    if cuentas_demo:
        demos = [
            ("Administrador", "admin@plantaschocoanas.co", "admin", "admin123", "admin", None),
            ("Vendedor Demo", "vendedor@plantaschocoanas.co", "vendedor", "vendedor123", "vendedor", None),
            ("Comprador Demo", "comprador@plantaschocoanas.co", "comprador", "comprador123", "comprador", None),
        ]
        for nombre, correo, usuario, pw, rol, tel in demos:
            try:
                execute(
                    "INSERT INTO usuarios (nombre, correo, usuario, password, rol, telefono) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (nombre, correo, usuario, hash_password(pw), rol, tel),
                )
            except Exception:
                pass

    try:
        if fetch_one("SELECT COUNT(*) AS n FROM productos")["n"] > 0:
            return
    except Exception:
        return

    productos = [
        ("Infusion de Guaco", "Bolsa x 25g - Corte fino para infusion. Ideal para vias respiratorias.", 12500, 15000, 24, "img/guaco.jpeg", "Infusion"),
        ("Te de Cidron", "Bolsa x 30g - Hojas deshidratadas. Digestivo y relajante.", 10000, None, 30, "img/cidron.jpeg", "Te"),
        ("Gel de Sabila Natural", "Frasco x 120ml - 100% organico. Cicatrizante.", 28000, None, 15, "img/sabila.jpeg", "Gel"),
        ("Jugo de Noni", "Botella x 500ml - Puro, sin aditivos. Inmunoestimulante.", 45000, 52000, 8, "img/noni.jpeg", "Jugo"),
        ("Kit Plantas Chocoano", "4 productos + guia de uso ancestral.", 85000, None, 5, "img/kit.jpeg", "Kit"),
        ("Extracto de Insulina", "Gotero x 30ml - Concentrado natural para control de azucar.", 35000, None, 2, "img/insulina.webp", "Extracto"),
    ]
    for p in productos:
        try:
            execute(
                "INSERT INTO productos (nombre, descripcion, precio, precio_anterior, stock, imagen, categoria, activo) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, 1)",
                p,
            )
        except Exception:
            pass


# ============================================================
# API: REGISTRO
# ============================================================
def registrar_usuario(data):
    if not DB_DRIVER:
        return {"success": False, "message": "MySQL no disponible. Instala mysql-connector-python o pymysql"}, 500

    nombre = (data.get("nombre") or "").strip()
    correo = (data.get("email") or "").strip().lower()
    usuario = (data.get("usuario") or "").strip().lower()
    password = data.get("password") or ""
    rol = (data.get("rol") or "").strip().lower()
    telefono = (data.get("telefono") or "").strip()

    if rol not in ("vendedor", "comprador"):
        return {"success": False, "message": "Debes especificar si tu cuenta es de tipo vendedor o comprador"}, 400
    if not all([nombre, correo, usuario, password]):
        return {"success": False, "message": "Todos los campos son obligatorios"}, 400
    if len(password) < 6:
        return {"success": False, "message": "La contrasena debe tener al menos 6 caracteres"}, 400
    if "@" not in correo:
        return {"success": False, "message": "Correo electronico invalido"}, 400
    if len(usuario) < 3:
        return {"success": False, "message": "El usuario debe tener al menos 3 caracteres"}, 400

    try:
        if fetch_one("SELECT id FROM usuarios WHERE correo = %s", (correo,)):
            return {"success": False, "message": "Este correo ya esta registrado"}, 409
        if fetch_one("SELECT id FROM usuarios WHERE usuario = %s", (usuario,)):
            return {"success": False, "message": "Este usuario ya existe"}, 409

        execute(
            "INSERT INTO usuarios (nombre, correo, usuario, password, rol, telefono) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (nombre, correo, usuario, hash_password(password), rol, telefono),
        )
        return {
            "success": True,
            "message": "Usuario registrado exitosamente",
            "usuario": {"nombre": nombre, "correo": correo, "usuario": usuario, "rol": rol},
        }, 201
    except Exception as e:
        return {"success": False, "message": "Error al registrar: {}".format(e)}, 500


# ============================================================
# API: LOGIN / LOGOUT / RECUPERAR
# ============================================================
def login_usuario(data):
    if not DB_DRIVER:
        return {"success": False, "message": "MySQL no disponible"}, 500

    usuario_input = (data.get("usuario") or "").strip().lower()
    password = data.get("password") or ""
    if not usuario_input or not password:
        return {"success": False, "message": "Usuario y contrasena son obligatorios"}, 400

    try:
        u = fetch_one(
            "SELECT * FROM usuarios WHERE (correo = %s OR usuario = %s)",
            (usuario_input, usuario_input),
        )
        if u and u.get("password") == hash_password(password):
            token = crear_token(u["id"])
            return {
                "success": True,
                "message": "Bienvenido, {}".format(u["nombre"]),
                "usuario": publico(u),
                "token": token,
            }, 200
        return {"success": False, "message": "Correo/usuario o contrasena incorrectos"}, 401
    except Exception as e:
        return {"success": False, "message": "Error del servidor: {}".format(e)}, 500


def recuperar_password(data):
    correo = (data.get("email") or "").strip().lower()
    nueva = data.get("password") or ""
    if not correo or len(nueva) < 6:
        return {"success": False, "message": "Correo y nueva contrasena (min 6 caracteres) son obligatorios"}, 400
    try:
        u = fetch_one("SELECT id FROM usuarios WHERE correo = %s", (correo,))
        if not u:
            return {"success": False, "message": "No existe una cuenta con ese correo"}, 404
        execute("UPDATE usuarios SET password = %s WHERE id = %s", (hash_password(nueva), u["id"]))
        return {"success": True, "message": "Contrasena actualizada. Ya puedes iniciar sesion."}, 200
    except Exception as e:
        return {"success": False, "message": "Error del servidor: {}".format(e)}, 500


# ============================================================
# API: USUARIOS
# ============================================================
def listar_usuarios(requester=None):
    try:
        fila = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
        if not fila or fila["rol"] not in ("admin", "vendedor"):
            return {"success": False, "message": "Sin permisos"}, 403
        usuarios = fetch_all(
            "SELECT id, nombre, correo, usuario, rol, telefono, foto, fecha_registro FROM usuarios ORDER BY id"
        )
        return {"success": True, "usuarios": usuarios, "total": len(usuarios)}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


# ============================================================
# API: PRODUCTOS
# ============================================================
def listar_productos():
    try:
        prods = fetch_all(
            "SELECT p.*, u.nombre AS vendedor_nombre "
            "FROM productos p "
            "LEFT JOIN usuarios u ON u.id = p.vendedor_id "
            "ORDER BY p.activo DESC, p.id"
        )
        return {"success": True, "productos": prods, "total": len(prods)}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


def _puede_gestionar_productos(requester):
    if not requester:
        return False
    u = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
    return bool(u and u["rol"] in ("admin", "vendedor"))


def crear_producto(data, requester):
    if not _puede_gestionar_productos(requester):
        return {"success": False, "message": "Sin permisos (se requiere cuenta admin o vendedor)"}, 403
    nombre = (data.get("nombre") or "").strip()
    if not nombre:
        return {"success": False, "message": "El nombre es obligatorio"}, 400
    try:
        precio = float(data.get("precio") or 0)
        anterior = data.get("precio_anterior")
        anterior = float(anterior) if anterior not in (None, "", "0") else None
        stock = int(data.get("stock") or 0)
    except (TypeError, ValueError):
        return {"success": False, "message": "Precio/stock invalido"}, 400

    fila_rol = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
    vendedor_id = requester if (fila_rol and fila_rol["rol"] == "vendedor") else None

    pid = execute(
        "INSERT INTO productos (nombre, descripcion, precio, precio_anterior, stock, imagen, categoria, activo, vendedor_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s)",
        (
            nombre,
            data.get("descripcion", ""),
            precio,
            anterior,
            stock,
            data.get("imagen", ""),
            data.get("categoria", ""),
            vendedor_id,
        ),
    )
    return {"success": True, "message": "Producto creado", "id": pid}, 201


def actualizar_producto(pid, data, requester):
    u = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
    if not u or u["rol"] not in ("admin", "vendedor"):
        return {"success": False, "message": "Sin permisos"}, 403
    try:
        existente = fetch_one("SELECT * FROM productos WHERE id = %s", (pid,))
    except Exception:
        existente = None
    if not existente:
        return {"success": False, "message": "Producto no encontrado"}, 404

    es_admin = u["rol"] == "admin"
    if not es_admin and existente.get("vendedor_id") != requester:
        return {"success": False, "message": "Solo puedes modificar el stock de los productos que publicaste"}, 403

    if not es_admin:
        campos_prohibidos = [k for k in data if k != "stock"]
        if campos_prohibidos:
            return {"success": False, "message": "Como vendedor solo puedes modificar el stock de tu producto"}, 403
        try:
            stock = int(data["stock"])
        except (TypeError, ValueError):
            return {"success": False, "message": "Stock invalido"}, 400
        if stock < 0:
            return {"success": False, "message": "El stock no puede ser negativo"}, 400
        campos = {"stock": stock}
    else:
        campos = {}
        if "nombre" in data:
            campos["nombre"] = str(data["nombre"]).strip()
        if "descripcion" in data:
            campos["descripcion"] = str(data["descripcion"])
        if "precio" in data:
            campos["precio"] = float(data["precio"])
        if "precio_anterior" in data:
            campos["precio_anterior"] = float(data["precio_anterior"]) if data["precio_anterior"] else None
        if "stock" in data:
            campos["stock"] = int(data["stock"])
        if "imagen" in data:
            campos["imagen"] = str(data["imagen"])
        if "categoria" in data:
            campos["categoria"] = str(data["categoria"])
        if "activo" in data:
            campos["activo"] = 1 if data["activo"] else 0
        if not campos:
            return {"success": False, "message": "No hay campos para actualizar"}, 400

    sets = ", ".join("{} = %s".format(k) for k in campos)
    params = list(campos.values()) + [pid]
    execute("UPDATE productos SET {} WHERE id = %s".format(sets), params)
    return {"success": True, "message": "Producto actualizado"}, 200


def eliminar_producto(pid, requester):
    if not _puede_gestionar_productos(requester):
        return {"success": False, "message": "Sin permisos"}, 403
    u = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
    if not u or u["rol"] != "admin":
        return {"success": False, "message": "Solo el admin puede eliminar productos"}, 403
    execute("DELETE FROM productos WHERE id = %s", (pid,))
    return {"success": True, "message": "Producto eliminado"}, 200


# ============================================================
# API: PERFIL
# ============================================================
def actualizar_perfil(requester, data):
    campos = {}
    if data.get("nombre"):
        campos["nombre"] = str(data["nombre"]).strip()
    if data.get("telefono") is not None:
        campos["telefono"] = str(data["telefono"]).strip()
    if "password" in data and data["password"]:
        campos["password"] = hash_password(data["password"])
    if not campos:
        return {"success": False, "message": "No hay datos para actualizar"}, 400

    sets = ", ".join("{} = %s".format(k) for k in campos)
    execute("UPDATE usuarios SET {} WHERE id = %s".format(sets), list(campos.values()) + [requester])
    u = fetch_one(
        "SELECT id, nombre, correo, usuario, rol, telefono, foto, fecha_registro "
        "FROM usuarios WHERE id = %s",
        (requester,),
    )
    return {"success": True, "message": "Perfil actualizado", "usuario": publico(u)}, 200


def subir_foto(requester, campos_multipart):
    archivo = campos_multipart.get("foto")
    if not archivo or not archivo.get("content"):
        return {"success": False, "message": "No se envio ninguna foto"}, 400
    contenido = archivo["content"]
    if len(contenido) > MAX_UPLOAD:
        return {"success": False, "message": "La imagen supera los 5 MB"}, 413

    ext = os.path.splitext(archivo.get("filename") or "foto.jpg")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        ext = ".jpg"
    nombre = "foto_{}_{}{}".format(requester, uuid.uuid4().hex[:8], ext)
    ruta = os.path.join(UPLOAD_DIR, nombre)
    with open(ruta, "wb") as f:
        f.write(contenido)

    execute("UPDATE usuarios SET foto = %s WHERE id = %s", ("uploads/" + nombre, requester))
    return {
        "success": True,
        "message": "Foto de perfil actualizada",
        "usuario": publico(
            fetch_one("SELECT * FROM usuarios WHERE id = %s", (requester,))
        ),
    }, 200


# ============================================================
# API: VENTAS
# ============================================================
def crear_venta(requester, data):
    items = data.get("items") or []
    if not requester:
        return {"success": False, "message": "Inicia sesion para comprar"}, 401
    if not items:
        return {"success": False, "message": "El carrito esta vacio"}, 400

    conn = get_connection()
    try:
        cur = conn.cursor()
        total = 0
        detalles = []
        for item in items:
            pid = item.get("id")
            cant = int(item.get("cantidad") or 1)
            if cant <= 0:
                continue
            cur.execute("SELECT id, nombre, precio, stock FROM productos WHERE id = %s AND activo = 1", (pid,))
            row = cur.fetchone()
            if not row:
                conn.rollback()
                return {"success": False, "message": "Un producto ya no esta disponible"}, 400
            prod_id, nombre, precio, stock = row
            if stock < cant:
                conn.rollback()
                return {
                    "success": False,
                    "message": "Stock insuficiente para '{}' (disponibles: {})".format(nombre, stock),
                }, 400
            total += float(precio) * cant
            detalles.append((pid, nombre, float(precio), cant))

        cur.execute("INSERT INTO ventas (usuario_id, total, estado) VALUES (%s, %s, 'completada')", (requester, total))
        venta_id = cur.lastrowid
        for det in detalles:
            cur.execute(
                "INSERT INTO venta_detalle (venta_id, producto_id, nombre, precio, cantidad) VALUES (%s, %s, %s, %s, %s)",
                (venta_id, det[0], det[1], det[2], det[3]),
            )
            cur.execute("UPDATE productos SET stock = stock - %s WHERE id = %s", (det[3], det[0]))
        conn.commit()
        cur.close()
        return {
            "success": True,
            "message": "Compra realizada con exito",
            "venta": {"id": venta_id, "total": total, "items": len(detalles)},
        }, 201
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        return {"success": False, "message": "Error al procesar la venta: {}".format(e)}, 500
    finally:
        conn.close()


def listar_ventas(requester):
    if not requester:
        return {"success": False, "message": "No autenticado"}, 401
    u = fetch_one("SELECT rol FROM usuarios WHERE id = %s", (requester,))
    if not u:
        return {"success": False, "message": "Usuario no encontrado"}, 404
    try:
        if u["rol"] in ("admin", "vendedor"):
            ventas = fetch_all(
                "SELECT v.id, v.usuario_id, v.total, v.estado, v.fecha, u.nombre AS cliente "
                "FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id ORDER BY v.id DESC"
            )
        else:
            ventas = fetch_all(
                "SELECT v.id, v.usuario_id, v.total, v.estado, v.fecha, u.nombre AS cliente "
                "FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id "
                "WHERE v.usuario_id = %s ORDER BY v.id DESC",
                (requester,),
            )
        # Detalles de cada venta
        for v in ventas:
            v["detalles"] = fetch_all(
                "SELECT producto_id, nombre, precio, cantidad FROM venta_detalle WHERE venta_id = %s",
                (v["id"],),
            )
        return {"success": True, "ventas": ventas, "total": len(ventas)}, 200
    except Exception as e:
        return {"success": False, "message": str(e)}, 500


# ============================================================
# MULTIPART (para subida de foto)
# ============================================================
def parse_multipart(body, boundary):
    if isinstance(boundary, bytes):
        boundary = boundary.decode("utf-8", errors="replace")
    delim = ("--" + boundary).encode("utf-8")
    partes = {}
    chunks = body.split(delim)
    for chunk in chunks:
        chunk = chunk.strip(b"\r\n")
        if not chunk or chunk == b"--":
            continue
        sep = chunk.find(b"\r\n\r\n")
        if sep == -1:
            continue
        encabezados = chunk[:sep].decode("utf-8", errors="replace")
        contenido = chunk[sep + 4:]
        if contenido.endswith(b"\r\n"):
            contenido = contenido[:-2]
        nombre = None
        filename = None
        for linea in encabezados.split("\r\n"):
            if linea.lower().startswith("content-disposition"):
                m = re.search(r'name="([^"]*)"', linea)
                if m:
                    nombre = m.group(1)
                mf = re.search(r'filename="([^"]*)"', linea)
                if mf:
                    filename = mf.group(1)
        if nombre:
            partes[nombre] = {"content": contenido, "filename": filename}
    return partes


def fields_to_text(partes):
    d = {}
    for k, v in partes.items():
        if v["filename"] is None:
            d[k] = v["content"].decode("utf-8", errors="replace")
    return d


# ============================================================
# SERVIDOR HTTP
# ============================================================
class MyHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Token")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    # ---------- utilidades ----------
    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length > 0 else b""

    def _read_json(self):
        body = self._read_body()
        try:
            return json.loads(body.decode("utf-8")) if body else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"success": False, "message": "JSON invalido"}, 400)
            return None

    def _token(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        token = (qs.get("token") or [None])[0]
        if not token:
            token = self.headers.get("X-Token")
        return token

    def _usuario_autenticado(self):
        token = self._token()
        if not token:
            return None
        return usuario_por_token(token)

    def _serve_file(self, file_path):
        ext = os.path.splitext(file_path)[1].lower()
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".webp": "image/webp",
        }
        content_type = content_types.get(ext, "application/octet-stream")
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Content-Length", len(content))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self._send_json({"success": False, "message": str(e)}, 500)

    # ---------- GET ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/productos":
            result, status = listar_productos()
            self._send_json(result, status)
            return

        if path == "/api/usuarios":
            user = self._usuario_autenticado()
            result, status = listar_usuarios(user["id"] if user else None)
            self._send_json(result, status)
            return

        if path == "/api/perfil":
            user = self._usuario_autenticado()
            if not user:
                self._send_json({"success": False, "message": "No autenticado"}, 401)
                return
            self._send_json({"success": True, "usuario": publico(user)}, 200)
            return

        if path == "/api/ventas":
            user = self._usuario_autenticado()
            result, status = listar_ventas(user["id"] if user else None)
            self._send_json(result, status)
            return

        if path == "/":
            path = "/index.html"

        file_path = path.lstrip("/")
        if not file_path:
            file_path = "index.html"
        if os.path.exists(file_path):
            self._serve_file(file_path)
        else:
            self._send_json({"success": False, "message": "Archivo no encontrado"}, 404)

    # ---------- POST ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/registro":
            data = self._read_json()
            if data is None:
                return
            result, status = registrar_usuario(data)
            self._send_json(result, status)
            return

        if path == "/api/login":
            data = self._read_json()
            if data is None:
                return
            result, status = login_usuario(data)
            self._send_json(result, status)
            return

        if path == "/api/recuperar":
            data = self._read_json()
            if data is None:
                return
            result, status = recuperar_password(data)
            self._send_json(result, status)
            return

        if path == "/api/logout":
            token = self._token()
            if token and token in sessions:
                del sessions[token]
            self._send_json({"success": True, "message": "Sesion cerrada"}, 200)
            return

        if path == "/api/perfil/foto":
            user = self._usuario_autenticado()
            if not user:
                self._send_json({"success": False, "message": "No autenticado"}, 401)
                return
            raw = self._read_body()
            ctype = self.headers.get("Content-Type", "")
            m = re.search(r"boundary=(.+)", ctype)
            if not m:
                self._send_json({"success": False, "message": "Formato invalido"}, 400)
                return
            partes = parse_multipart(raw, m.group(1).strip().strip('"'))
            result, status = subir_foto(user["id"], partes)
            self._send_json(result, status)
            return

        if path == "/api/perfil":
            user = self._usuario_autenticado()
            if not user:
                self._send_json({"success": False, "message": "No autenticado"}, 401)
                return
            data = self._read_json()
            if data is None:
                return
            result, status = actualizar_perfil(user["id"], data)
            self._send_json(result, status)
            return

        if path == "/api/productos":
            user = self._usuario_autenticado()
            data = self._read_json()
            if data is None:
                return
            result, status = crear_producto(data, user["id"] if user else None)
            self._send_json(result, status)
            return

        if path == "/api/venta":
            user = self._usuario_autenticado()
            data = self._read_json()
            if data is None:
                return
            result, status = crear_venta(user["id"] if user else None, data)
            self._send_json(result, status)
            return

        self._send_json({"success": False, "message": "Ruta no encontrada"}, 404)

    # ---------- PUT ----------
    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        user = self._usuario_autenticado()
        requester = user["id"] if user else None

        m = re.match(r"^/api/productos/(\d+)$", path)
        if m:
            data = self._read_json()
            if data is None:
                return
            result, status = actualizar_producto(int(m.group(1)), data, requester)
            self._send_json(result, status)
            return

        m = re.match(r"^/api/stock/(\d+)$", path)
        if m:
            data = self._read_json()
            if data is None:
                return
            result, status = actualizar_producto(int(m.group(1)), {"stock": data.get("stock")}, requester)
            self._send_json(result, status)
            return

        self._send_json({"success": False, "message": "Ruta no encontrada"}, 404)

    # ---------- DELETE ----------
    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        user = self._usuario_autenticado()
        requester = user["id"] if user else None

        m = re.match(r"^/api/productos/(\d+)$", path)
        if m:
            result, status = eliminar_producto(int(m.group(1)), requester)
            self._send_json(result, status)
            return

        self._send_json({"success": False, "message": "Ruta no encontrada"}, 404)


# ============================================================
# INICIAR SERVIDOR
# ============================================================
def main():
    print("=" * 62)
    print("  SERVIDOR PLANTAS MEDICINALES CHOCOANAS")
    print("=" * 62)

    if not DB_DRIVER:
        print("  [ERROR] Necesitas un driver MySQL. Instala uno:")
        print("    python -m pip install mysql-connector-python")
        print("    o bien:  python -m pip install pymysql")
        print("=" * 62)
        return 1

    if not os.path.exists(UPLOAD_DIR):
        os.makedirs(UPLOAD_DIR)

    try:
        ensure_database()
        ensure_tables()
        migrar_registro()
        seed_datos()
        print("  [OK] Base de datos lista (tablas creadas / verificadas)")
    except Exception as e:
        print("  [ERROR] No se pudo inicializar MySQL: {}".format(e))
        print("  Verifica que WAMP/XAMPP este corriendo y MySQL activo en puerto 3306")
        print("=" * 62)
        return 1

    print("  Cuentas demo:")
    print("    admin      -> admin@plantaschocoanas.co / admin123")
    print("    vendedor   -> vendedor@plantaschocoanas.co / vendedor123")
    print("    comprador  -> comprador@plantaschocoanas.co / comprador123")
    print("=" * 62)
    print("  URL Login:    http://localhost:{}/login.html".format(PORT))
    print("  URL Index:    http://localhost:{}/".format(PORT))
    print("  URL Admin:    http://localhost:{}/admin.html".format(PORT))
    print("  API:          /api/registro /api/login /api/productos /api/venta ...")
    print("=" * 62)
    print("  Presiona CTRL+C para detener")
    print("=" * 62)

    with socketserver.ThreadingTCPServer(("", PORT), MyHandler) as httpd:
        httpd.allow_reuse_address = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[OK] Servidor detenido")


if __name__ == "__main__":
    import sys
    sys.exit(main())
