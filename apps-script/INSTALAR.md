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
