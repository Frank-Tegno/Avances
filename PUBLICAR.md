# Publicar en Netlify — Guía paso a paso

El sitio ya está adaptado para Netlify:

- `netlify/functions/api.js` → reemplaza al backend Python (`/api/*`).
- `supabase/schema.sql` → la base de datos vive en Supabase (gratis).
- El backend original quedó aparte en `backend_original/` (`app.py`, `conexion.py`, `iniciar.vbs`). Si quieres volver al modo local (XAMPP/WAMP), solo devuélvelo a la raíz.

> Nota: ya no hace falta MySQL. Los datos (usuarios, productos, ventas) se guardan en Supabase (PostgreSQL en la nube).

## 1) Instalar Git

En esta PC no está instalado. Descárgalo de https://git-scm.com/download/win e instala con las opciones por defecto. Reinicia la terminal después.

## 2) Crear la base de datos en Supabase

1. Crea una cuenta gratis en https://supabase.com
2. **New project** → ponle nombre (ej. `avances`) y contraseña de base de datos → **Create**. Espera a que termine (2–3 min).
3. Abre el proyecto → menú izquierdo **SQL Editor → New query**.
4. Pega TODO el contenido de `supabase/schema.sql` → **Run**. (Crea tablas, la función de ventas y las cuentas demo.)

## 3) Crear el bucket de fotos

En el proyecto Supabase, menú izquierdo **Storage → New bucket**:

- Nombre: `fotos`
- **Public bucket**: activado
- **Create bucket**

(La función también intenta crearlo sola, pero así es más seguro.)

## 4) Subir el proyecto a GitHub

Con Git instalado, abre la terminal en esta carpeta (`C:\Users\Acer\Downloads\avances`) y ejecuta:

```powershell
git init
git add .
git commit -m "Sitio adaptado para Netlify (API serverless + Supabase)"
git branch -M main
git remote add origin https://github.com/Frank-Tegno/Avances.git
git push -u origin main
```

## 5) Conectar Netlify

1. Abre el enlace que te dio Netlify: `https://app.netlify.com/start/repos/Frank-Tegno%2FAvances`
2. Autoriza con tu cuenta de GitHub y selecciona el repo `Frank-Tegno/Avances`.
3. Deja el **build command** y la **publish directory** con los valores que Netlify detecta (o déjalo vacío: ya viene en `netlify.toml`). Haz clic en **Deploy**.
4. Espera a que termine el deploy (primer despliegue ~1–2 min).

## 6) Configurar las variables del servidor

En Netlify: menú del sitio → **Site configuration → Environment variables → Add a variable**:

| Clave                  | Valor                                                                 |
|------------------------|-----------------------------------------------------------------------|
| `SUPABASE_URL`         | `https://XXXX.supabase.co` (Supabase → Settings → API → Project URL)  |
| `SUPABASE_SERVICE_KEY` | La clave `service_role` (misma página API)                            |

Compartir `service_role` solo con el backend. Guarda y redeploya (**Deploy → Trigger deploy → Deploy site**).

## 7) ¡Listo y prueba!

- Visita `https://tu-sitio.netlify.app` (te aparece el nombre asignado).
- Cuentas demo:

| Rol       | Usuario / correo                    | Contraseña    |
|-----------|-------------------------------------|---------------|
| Admin     | `admin@plantaschocoanas.co` o `admin` | `admin123`    |
| Vendedor  | `vendedor@plantaschocoanas.co`      | `vendedor123` |
| Comprador | `comprador@plantaschocoanas.co`     | `comprador123`|

Prueba: iniciar sesión, comprar, subir foto de perfil, y en el panel de admin crear un producto, ajustar stock y ver ventas.

---

## Troubleshooting

- **`Faltan variables de entorno`**: revisa el paso 6.
- **Error al subir foto**: verifica que el bucket `fotos` existe y es público (paso 3).
- **No conecta el repo**: Netlify necesita que el repo exista en tu GitHub *antes* de abrir el enlace (paso 4).
- **Quieres volver al modo local (Python + MySQL)**: saca `app.py`, `conexion.py` e `iniciar.vbs` de `backend_original/` a la raíz, arranca XAMPP/WAMP y ejecuta `python app.py`. La web funciona igual, ahora con la API en `/api/*`.