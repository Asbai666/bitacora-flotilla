# Instalar el servicio de Google (una sola vez, 3 minutos)

1. Abre la hoja **Bitácora Flotilla TPLAY** en Google Sheets (en la computadora, o en el navegador del celular en "versión para computadora").
2. Menú **Extensiones → Apps Script**.
3. Borra lo que aparece en `Código.gs` y pega todo el contenido de `Code.gs`. Guarda (ícono de disco).
4. Arriba a la derecha: **Implementar → Nueva implementación**.
   - Tipo: **Aplicación web**
   - Ejecutar como: **Yo (asbai.jimenez@gmail.com)**
   - Quién tiene acceso: **Cualquier usuario**
5. **Implementar** → Google pide autorizar: elige tu cuenta → "Configuración avanzada" → "Ir a Bitácora (no seguro)" → **Permitir**. (Es tu propio script; Google muestra ese aviso para cualquier script que no está publicado en su tienda.)
6. Copia la **URL de la aplicación web** (termina en `/exec`) y pégala en la app, en "Conecta tu hoja".

El script solo acepta peticiones que traen la clave de la app, así que tener la URL no basta para escribir en tu hoja.

Si después cambias el código: **Implementar → Administrar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. La URL se conserva.

## Actualizar a la versión 3 (app 2.1: cargas con evidencias)

1. Abre la hoja → **Extensiones → Apps Script**.
2. Reemplaza todo el contenido de `Código.gs` con el nuevo `Code.gs` y guarda.
3. **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar.**
4. Si Google pide permisos otra vez, acéptalos. La URL /exec no cambia.

## Actualizar a la versión 4 (app 2.6: exportar XLSX)

1. Abre la hoja → **Extensiones → Apps Script** y reemplaza `Código.gs` con el nuevo `Code.gs`. Guarda.
2. Arriba, en la lista de funciones elige **autorizar** y toca **▶ Ejecutar**. Google pide un permiso nuevo
   ("conectarse a un servicio externo", que se usa para generar el archivo de Excel): **Revisar permisos → tu cuenta → Configuración avanzada → Ir a … → Permitir**.
3. **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar.** La URL /exec no cambia.

## Versión 5 (app 3.0: cada técnico con su propia bitácora)

Una sola vez, en la hoja del coordinador:

1. **Extensiones → Apps Script**, reemplaza `Código.gs` con el nuevo `Code.gs` y guarda.
2. Elige la función **autorizar** y toca **▶ Ejecutar**. Acepta los permisos. Esto también crea:
   - "Bitácora Flotilla – PLANTILLA (no editar)": copia limpia de la bitácora (sin datos ni fotos) que se usa para cada técnico.
   - "Bitácora Flotilla – Usuarios": lista de los técnicos registrados con el enlace a su bitácora y su última actividad.
3. **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar.** La URL /exec no cambia.

Después, cada técnico instala la app y llena "Crea tu bitácora" (nombre, No. de empleado, correo, placas).
Su hoja queda en "Bitácora Flotilla - Evidencias / Bitácoras por usuario / <No. empleado> <Nombre>" junto con sus fotos y recorridos,
y se le comparte a su correo. El coordinador (No. de empleado 65071932) sigue usando su bitácora original.

Para cambiar el formato de todas las bitácoras nuevas, edita la PLANTILLA (las que ya existen no cambian).

## Versión 6 (app 4.0)

Pega el nuevo `Code.gs` y crea una **Nueva versión** de la implementación (no hace falta volver a autorizar).
Novedades del servicio: rechaza tramos con km negativo, las filas nuevas siempre van al final, quitar una fila
sube las de abajo (sin huecos), se pueden insertar filas de ajuste, el primer registro de un mes nuevo guarda una
copia del mes anterior en "Meses anteriores" y limpia la hoja, y el coordinador puede ver el resumen del equipo.
