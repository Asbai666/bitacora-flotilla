package mx.ajm.bitacora

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Habla con el servicio de Google (Apps Script) que escribe en la hoja y en Drive. */
class Backend(private val prefs: Prefs) {

    fun call(action: String, payload: JSONObject): JSONObject {
        val url = prefs.scriptUrl
        if (!url.startsWith("https://script.google.com/")) throw IOException("Falta la dirección del servicio de Google en Ajustes")
        payload.put("action", action).put("token", prefs.token)
        val body = payload.toString().toByteArray(Charsets.UTF_8)

        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; instanceFollowRedirects = false
            connectTimeout = 20_000; readTimeout = 120_000
            setRequestProperty("Content-Type", "text/plain; charset=utf-8")
            setFixedLengthStreamingMode(body.size)
        }
        c.outputStream.use { it.write(body) }
        var code = c.responseCode
        var conn = c
        // Apps Script responde con una redirección a googleusercontent.com que se lee con GET
        var hops = 0
        while (code in 300..399 && hops < 5) {
            val loc = conn.getHeaderField("Location") ?: break
            conn.disconnect()
            conn = (URL(loc).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false; connectTimeout = 20_000; readTimeout = 120_000
            }
            code = conn.responseCode; hops++
        }
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        if (code !in 200..299) throw IOException("Google respondió $code")
        val o = try { JSONObject(text) } catch (e: Exception) {
            throw IOException(if (text.contains("<html", true)) "El servicio de Google no está publicado para \"Cualquier usuario\"" else "Respuesta no válida del servicio")
        }
        if (!o.optBoolean("ok", false)) throw IOException(o.optString("error", "Error del servicio"))
        return o
    }
}
