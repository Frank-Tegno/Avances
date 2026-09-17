import pymysql

print("=" * 50)
print("PROBANDO CONEXION A MySQL")
print("=" * 50)

try:
    conexion = pymysql.connect(
        host="localhost",
        user="root",
        password="",
        database="base1",
        port=3306,
        charset="utf8mb4",
        connect_timeout=5
    )

    print("CONEXION EXITOSA")
    print("   Base de datos: base1")
    print("   Puerto: 3306")
    print("-" * 50)

    with conexion.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM usuarios")
        usuarios = cursor.fetchone()[0]
        print("USUARIOS: {}".format(usuarios))

        cursor.execute("SELECT COUNT(*) FROM productos")
        productos = cursor.fetchone()[0]
        print("PRODUCTOS: {}".format(productos))

        cursor.execute("SELECT COUNT(*) FROM ventas")
        ventas = cursor.fetchone()[0]
        print("VENTAS: {}".format(ventas))

        print("-" * 50)
        if productos > 0:
            print("LISTA DE PRODUCTOS:")
            cursor.execute("SELECT id, nombre, precio, stock FROM productos")
            for fila in cursor.fetchall():
                print("   #{} | {} | ${} | stock: {}".format(fila[0], fila[1], fila[2], fila[3]))
        else:
            print("No hay productos. Arranca app.py para crear las tablas y datos iniciales.")

        print("-" * 50)
        if usuarios > 0:
            print("LISTA DE USUARIOS:")
            cursor.execute("SELECT id, nombre, correo, rol FROM usuarios")
            for fila in cursor.fetchall():
                print("   #{} | {} | {} | {}".format(fila[0], fila[1], fila[2], fila[3]))

    conexion.close()
    print("=" * 50)
    print("Conexion cerrada correctamente.")

except pymysql.err.OperationalError as err:
    codigo = err.args[0]
    print("ERROR DE CONEXION:")
    if codigo == 2003:
        print("   MySQL no responde. Verifica que XAMPP este encendido.")
    elif codigo == 1045:
        print("   Usuario o contrasena incorrectos.")
    elif codigo == 1049:
        print("   La base de datos 'base1' no existe. Arranca app.py para crearla.")
    else:
        print("   Codigo {}: {}".format(codigo, err))

except Exception as e:
    print("Error inesperado: {}".format(e))
