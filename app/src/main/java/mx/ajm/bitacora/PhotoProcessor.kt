package mx.ajm.bitacora

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Lee metadatos, aplica marca de agua y reconoce el texto (odómetro o ticket) en el teléfono. */
class PhotoProcessor(private val ctx: Context) {
    private val dir = File(ctx.filesDir, "photos").apply { mkdirs() }
    fun base(slot: String) = File(dir, "${slot}_base.jpg")
    fun marked(slot: String) = File(dir, "${slot}_wm.jpg")
    fun small(slot: String) = File(dir, "${slot}_small.jpg")
    fun meta(slot: String) = File(dir, "${slot}.json")
    fun captureFile(slot: String) = File(dir, "${slot}_capture.jpg")

    data class Meta(val lat: Double?, val lon: Double?, val time: Long, val timeSource: String, val gpsSource: String)

    /** Procesa la foto: [current] es la ubicación del teléfono al tomarla con la cámara. */
    suspend fun process(slot: String, uri: Uri, fromCamera: Boolean, current: Pair<Double, Double>?, who: String, plates: String): JSONObject {
        var lat: Double? = null; var lon: Double? = null
        var time = System.currentTimeMillis(); var timeSrc = "ahora"; var gpsSrc = "ninguna"
        var orientation = ExifInterface.ORIENTATION_NORMAL

        // metadatos EXIF
        try {
            val readUri = originalUri(uri)
            ctx.contentResolver.openInputStream(readUri)?.use { s ->
                val ex = ExifInterface(s)
                orientation = ex.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                ex.latLong?.let { if (!(it[0] == 0.0 && it[1] == 0.0)) { lat = it[0]; lon = it[1]; gpsSrc = "foto" } }
                val dt = ex.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) ?: ex.getAttribute(ExifInterface.TAG_DATETIME)
                if (dt != null) SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).parse(dt)?.let { time = it.time; timeSrc = "foto" }
            }
        } catch (e: Exception) { }
        if (fromCamera) {
            time = System.currentTimeMillis(); timeSrc = "foto"
            if (current != null) { lat = current.first; lon = current.second; gpsSrc = "gps" }
        }

        // imagen reducida y orientada
        val bmp = decode(uri, 1600, orientation) ?: throw IllegalStateException("No se pudo abrir la imagen")
        save(bmp, base(slot), 88)
        val m = Meta(lat, lon, time, timeSrc, gpsSrc)
        writeMeta(slot, m)
        val preview = watermark(slot, m, who, plates)

        // reconocimiento de texto
        val lines = JSONArray()
        try {
            val text = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(InputImage.fromBitmap(bmp, 0)).await()
            text.textBlocks.forEach { b -> b.lines.forEach { l ->
                val box = l.boundingBox
                lines.put(JSONObject().put("text", l.text).put("h", box?.height() ?: 0).put("y", box?.top ?: 0).put("x", box?.left ?: 0))
            } }
        } catch (e: Exception) { }
        bmp.recycle()

        return metaJson(m).put("slot", slot).put("preview", preview).put("lines", lines).put("imgH", 1600)
    }

    /** Vuelve a poner la marca de agua con otras coordenadas (cuando la foto no traía ubicación). */
    fun rewatermark(slot: String, lat: Double, lon: Double, who: String, plates: String): JSONObject {
        val old = readMeta(slot) ?: throw IllegalStateException("No hay foto en $slot")
        val m = old.copy(lat = lat, lon = lon, gpsSource = "manual")
        writeMeta(slot, m)
        return metaJson(m).put("slot", slot).put("preview", watermark(slot, m, who, plates))
    }

    fun clear(slot: String) { listOf(base(slot), marked(slot), small(slot), meta(slot), captureFile(slot)).forEach { it.delete() } }

    fun b64(f: File): String = Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)

    // ---------- interno ----------
    private fun originalUri(uri: Uri): Uri {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return uri
        return try {
            val media = if (uri.authority == MediaStore.AUTHORITY) uri else MediaStore.getMediaUri(ctx, uri)
            if (media != null) MediaStore.setRequireOriginal(media) else uri
        } catch (e: Exception) { uri }
    }

    private fun decode(uri: Uri, maxSide: Int, orientation: Int): Bitmap? {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
        if (o.outWidth <= 0) return null
        var sample = 1
        while (max(o.outWidth, o.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val raw = ctx.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val mx = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> mx.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> mx.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> mx.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> mx.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { mx.postRotate(90f); mx.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { mx.postRotate(270f); mx.postScale(-1f, 1f) }
        }
        val s = min(1f, maxSide.toFloat() / max(raw.width, raw.height))
        if (s < 1f) mx.postScale(s, s)
        val out = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, mx, true)
        if (out != raw) raw.recycle()
        return out
    }

    private fun watermark(slot: String, m: Meta, who: String, plates: String): String {
        val src = BitmapFactory.decodeFile(base(slot).path) ?: throw IllegalStateException("Foto no disponible")
        val bmp = src.copy(Bitmap.Config.ARGB_8888, true); src.recycle()
        val c = Canvas(bmp)
        val w = bmp.width.toFloat(); val h = bmp.height.toFloat()
        val fs = max(18f, min(w, h) * 0.042f)
        val df = SimpleDateFormat("dd/MM/yyyy  HH:mm 'hrs'", Locale.US)
        val coords = if (m.lat != null && m.lon != null) "Lat, Lon  %.6f, %.6f".format(Locale.US, m.lat, m.lon) else "Sin coordenadas"
        val label = (LABELS[slot] ?: slot) + (if (plates.isNotBlank()) "  ·  $plates" else "") + "  ·  Totalplay"
        val lines = listOf(Triple(who, 1.15f, true), Triple(df.format(Date(m.time)), 1f, false), Triple(coords, 1f, false), Triple(label, 0.8f, false))
        val lh = fs * 1.32f; val pad = fs * 0.7f
        val bandH = lines.sumOf { (lh * it.second).toDouble() }.toFloat() + pad * 2
        c.drawRect(0f, h - bandH, w, h, Paint().apply { color = Color.argb(158, 10, 20, 26) })
        c.drawRect(0f, h - bandH, max(6f, fs * 0.25f), h, Paint().apply { color = Color.rgb(232, 163, 23) })
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; setShadowLayer(fs * 0.15f, 0f, 0f, Color.argb(130, 0, 0, 0)) }
        var y = h - bandH + pad
        lines.forEach { (t, s, bold) ->
            p.textSize = fs * s
            p.typeface = Typeface.create(Typeface.SANS_SERIF, if (bold) Typeface.BOLD else Typeface.NORMAL)
            c.drawText(t, fs * 0.9f, y + p.textSize, p)
            y += lh * s
        }
        save(bmp, marked(slot), 85)
        // versión para el recuadro de la hoja (menos de 1 millón de píxeles)
        val k = min(1f, 1000f / max(w, h))
        val sm = Bitmap.createScaledBitmap(bmp, (w * k).roundToInt(), (h * k).roundToInt(), true)
        save(sm, small(slot), 80)
        // vista previa para la app
        val pk = min(1f, 720f / max(w, h))
        val pv = Bitmap.createScaledBitmap(bmp, (w * pk).roundToInt(), (h * pk).roundToInt(), true)
        val bos = ByteArrayOutputStream(); pv.compress(Bitmap.CompressFormat.JPEG, 80, bos)
        listOf(sm, pv, bmp).distinct().forEach { it.recycle() }
        return "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }

    private fun save(b: Bitmap, f: File, q: Int) { f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, q, it) } }

    private fun writeMeta(slot: String, m: Meta) = meta(slot).writeText(metaJson(m).toString())
    fun readMeta(slot: String): Meta? = try {
        val o = JSONObject(meta(slot).readText())
        Meta(if (o.isNull("lat")) null else o.getDouble("lat"), if (o.isNull("lon")) null else o.getDouble("lon"),
            o.getLong("time"), o.optString("timeSource"), o.optString("gpsSource"))
    } catch (e: Exception) { null }

    private fun metaJson(m: Meta) = JSONObject().apply {
        put("lat", m.lat ?: JSONObject.NULL); put("lon", m.lon ?: JSONObject.NULL)
        put("time", m.time); put("timeSource", m.timeSource); put("gpsSource", m.gpsSource)
    }

    companion object {
        val LABELS = mapOf(
            "ini" to "Odómetro al salir", "fin" to "Odómetro al llegar",
            "ticket" to "Ticket de bomba", "ticketCar" to "Ticket Car", "odoCarga" to "Odómetro en la carga"
        )
    }
}
