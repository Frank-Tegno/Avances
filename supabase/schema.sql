-- ============================================================
-- SUPABASE - Plantas Medicinales Chocoanas
-- ============================================================
-- Ejecuta este archivo en: Supabase Dashboard > SQL Editor > New query
-- (pega todo el contenido y presiona Run).

-- ---------- TABLAS ----------
create table if not exists public.usuarios (
  id bigserial primary key,
  nombre text not null,
  correo text not null unique,
  usuario text not null unique,
  password text not null,
  rol text not null default 'comprador' check (rol in ('admin','vendedor','comprador')),
  telefono text,
  foto text,
  fecha_registro timestamptz not null default now()
);

create table if not exists public.productos (
  id bigserial primary key,
  nombre text not null,
  descripcion text,
  precio numeric(12,2) not null default 0,
  precio_anterior numeric(12,2),
  stock integer not null default 0,
  imagen text,
  categoria text,
  activo integer not null default 1,
  vendedor_id bigint references public.usuarios(id)
);

create table if not exists public.ventas (
  id bigserial primary key,
  usuario_id bigint not null,
  total numeric(12,2) not null default 0,
  estado text not null default 'completada',
  fecha timestamptz not null default now()
);

create table if not exists public.venta_detalle (
  id bigserial primary key,
  venta_id bigint not null references public.ventas(id),
  producto_id bigint not null,
  nombre text not null,
  precio numeric(12,2) not null default 0,
  cantidad integer not null default 1
);

create table if not exists public.sesiones (
  token text primary key,
  user_id bigint not null references public.usuarios(id),
  creada timestamptz not null default now()
);

create index if not exists idx_productos_vendedor on public.productos(vendedor_id);
create index if not exists idx_ventas_usuario on public.ventas(usuario_id);
create index if not exists idx_detalle_venta on public.venta_detalle(venta_id);

-- ---------- FUNCION DE VENTA (transaccional) ----------
create or replace function public.crear_venta(p_user_id integer, p_items jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_total numeric := 0;
  v_venta_id integer;
  v_nombre text;
  v_precio numeric;
  v_stock integer;
  v_cant integer;
  v_det integer := 0;
  item jsonb;
  mensaje text;
begin
  if p_user_id is null then
    return '{"success": false, "message": "Inicia sesion para comprar"}'::jsonb;
  end if;

  if p_items is null or p_items = '[]'::jsonb then
    return '{"success": false, "message": "El carrito esta vacio"}'::jsonb;
  end if;

  begin
    insert into public.ventas (usuario_id, total, estado)
    values (p_user_id, 0, 'completada')
    returning id into v_venta_id;

    for item in select value from jsonb_array_elements(p_items) loop
      v_cant := coalesce((item->>'cantidad')::int, 1);
      if v_cant <= 0 then
        continue;
      end if;

      select nombre, precio, stock
        into v_nombre, v_precio, v_stock
        from public.productos
       where id = (item->>'id')::int
         and activo = 1;

      if not found then
        raise exception 'PROD404';
      end if;

      if v_stock < v_cant then
        raise exception 'STOCK:%', v_nombre;
      end if;

      insert into public.venta_detalle (venta_id, producto_id, nombre, precio, cantidad)
      values (v_venta_id, (item->>'id')::int, v_nombre, v_precio, v_cant);

      update public.productos set stock = stock - v_cant where id = (item->>'id')::int;

      v_total := v_total + (v_precio * v_cant);
      v_det := v_det + 1;
    end loop;

    update public.ventas set total = v_total where id = v_venta_id;

    return jsonb_build_object(
      'success', true,
      'message', 'Compra realizada con exito',
      'venta', jsonb_build_object('id', v_venta_id, 'total', v_total, 'items', v_det)
    );

  exception
    when others then
      mensaje := sqlerrm;
      if mensaje like 'STOCK:%' then
        return jsonb_build_object(
          'success', false,
          'message', 'Stock insuficiente para ' || substring(mensaje from 7)
        );
      elsif mensaje like 'PROD404%' then
        return '{"success": false, "message": "Un producto ya no esta disponible"}'::jsonb;
      else
        return jsonb_build_object(
          'success', false,
          'message', 'Error al procesar la venta: ' || mensaje
        );
      end if;
  end;
end;
$$;

-- ---------- CUENTAS DEMO ----------
insert into public.usuarios (nombre, correo, usuario, password, rol, telefono) values
  ('Administrador', 'admin@plantaschocoanas.co', 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin', null),
  ('Vendedor Demo', 'vendedor@plantaschocoanas.co', 'vendedor', '56976bf24998ca63e35fe4f1e2469b5751d1856003e8d16fef0aafef496ed044', 'vendedor', null),
  ('Comprador Demo', 'comprador@plantaschocoanas.co', 'comprador', 'c8f87bff8a03dc1998fb397c349d9002a3d70436c30281a138771f877dbe1749', 'comprador', null)
on conflict (correo) do nothing;

-- ---------- PRODUCTOS DE EJEMPLO ----------
insert into public.productos (nombre, descripcion, precio, precio_anterior, stock, imagen, categoria, activo) values
  ('Infusion de Guaco', 'Bolsa x 25g - Corte fino para infusion. Ideal para vias respiratorias.', 12500, 15000, 24, 'img/guaco.jpeg', 'Infusion', 1),
  ('Te de Cidron', 'Bolsa x 30g - Hojas deshidratadas. Digestivo y relajante.', 10000, null, 30, 'img/cidron.jpeg', 'Te', 1),
  ('Gel de Sabila Natural', 'Frasco x 120ml - 100% organico. Cicatrizante.', 28000, null, 15, 'img/sabila.jpeg', 'Gel', 1),
  ('Jugo de Noni', 'Botella x 500ml - Puro, sin aditivos. Inmunoestimulante.', 45000, 52000, 8, 'img/noni.jpeg', 'Jugo', 1),
  ('Kit Plantas Chocoano', '4 productos + guia de uso ancestral.', 85000, null, 5, 'img/kit.jpeg', 'Kit', 1),
  ('Extracto de Insulina', 'Gotero x 30ml - Concentrado natural para control de azucar.', 35000, null, 2, 'img/insulina.webp', 'Extracto', 1)
on conflict do nothing;