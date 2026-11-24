package mx.ajm.bitacora

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Alerta SIN sonido: vibración con un patrón propio que se repite sin parar
 * (tres toques cortos + uno largo, como "· · · —") hasta que abres la app,
 * descartas el aviso o pasan 3 minutos. Vibra como alarma, así que funciona aunque el teléfono esté en silencio.
 */
object Siren {
    // espera, corto, pausa, corto, pausa, corto, pausa, LARGO, descanso → y vuelve a empezar
    private val PATTERN = longArrayOf(0, 160, 110, 160, 110, 160, 260, 900, 1200)
    private val AMPS = intArrayOf(0, 255, 0, 255, 0, 255, 0, 255, 0)
    private const val MAX_MS = 3 * 60_000L
    private val main = Handler(Looper.getMainLooper())
    private var vib: Vibrator? = null
    private val autoStop = Runnable { vib?.cancel(); vib = null }

    fun play(ctx: Context) {
        val app = ctx.applicationContext
        stop(app)
        val v = vibrator(app) ?: return
        try {
            val effect = if (v.hasAmplitudeControl()) VibrationEffect.createWaveform(PATTERN, AMPS, 0) else VibrationEffect.createWaveform(PATTERN, 0)
            if (Build.VERSION.SDK_INT >= 33) v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
            else @Suppress("DEPRECATION") v.vibrate(effect, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
            vib = v
            main.postDelayed(autoStop, MAX_MS)
        } catch (e: Exception) { }
    }

    fun stop(ctx: Context) {
        main.removeCallbacks(autoStop)
        try { (vib ?: vibrator(ctx.applicationContext))?.cancel() } catch (e: Exception) { }
        vib = null
    }

    private fun vibrator(ctx: Context): Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        else @Suppress("DEPRECATION") (ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator)
}
