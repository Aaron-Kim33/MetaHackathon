package expo.modules.subjectlift

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.NormalizedKeypoint
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenter
import com.google.mediapipe.tasks.vision.interactivesegmenter.InteractiveSegmenterOptions
import com.google.mediapipe.tasks.vision.interactivesegmenter.Stroke
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

class SubjectLiftModule : Module() {
  private val busy = AtomicBoolean(false)
  override fun definition() = ModuleDefinition {
    Name("SubjectLift")
    Function("isSupported") { true }
    Function("engine") { "mediapipe-cpu-v1" }
    AsyncFunction("segment") { uri: String, x: Double?, y: Double? ->
      check(busy.compareAndSet(false, true)) { "앞선 자동 누끼가 끝날 때까지 기다려 주세요." }
      var original: Bitmap? = null
      var input: Bitmap? = null
      var smallMask: Bitmap? = null
      var fullMask: Bitmap? = null
      var image: MPImage? = null
      var output: MPImage? = null
      var segmenter: InteractiveSegmenter? = null
      val started = SystemClock.elapsedRealtime()
      try {
        val context = appContext.reactContext ?: error("앱이 준비되지 않았어요.")
        val file = File(Uri.parse(uri).path ?: "")
        require(file.canonicalPath.startsWith(context.cacheDir.canonicalPath + File.separator)) { "사진 캐시를 읽지 못했어요." }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        require(bounds.outWidth in 1..1600 && bounds.outHeight in 1..1600) { "사진 크기가 올바르지 않아요. 사진을 다시 열어 주세요." }
        original = BitmapFactory.decodeFile(file.path) ?: error("사진을 읽지 못했어요.")
        val factor = minOf(1.0, 768.0 / maxOf(original.width, original.height))
        input = Bitmap.createScaledBitmap(original, maxOf(1, (original.width * factor).roundToInt()), maxOf(1, (original.height * factor).roundToInt()), true)
        image = BitmapImageBuilder(input).build()
        val options = InteractiveSegmenterOptions.builder().setBaseOptions(
          BaseOptions.builder().setModelAssetPath("interactive_segmentation.task").setDelegate(Delegate.CPU).build()
        ).build()
        Log.i("SubjectLiftCpu", "CPU segmentation start ${input.width}x${input.height}")
        segmenter = InteractiveSegmenter.createFromOptions(context, options)
        segmenter.setImage(image)
        val px = (x ?: 0.5).coerceIn(0.001, 0.999).toFloat()
        val py = (y ?: 0.5).coerceIn(0.001, 0.999).toFloat()
        val stroke = Stroke.builder().setBrushMode(Stroke.BrushMode.POSITIVE)
          .setPoints(listOf(NormalizedKeypoint.create(px, py))).setCompleted(true).build()
        output = segmenter.segment(listOf(stroke))
        val buffer = ByteBufferExtractor.extract(output).order(ByteOrder.nativeOrder()).asFloatBuffer()
        val width = output.width
        val height = output.height
        require(buffer.remaining() >= width * height) { "분리 결과가 올바르지 않아요." }
        val pixels = IntArray(width * height)
        var foreground = 0
        for (i in pixels.indices) {
          val confidence = buffer.get(i)
          val gray = if (confidence.isFinite()) (confidence.coerceIn(0f, 1f) * 255).roundToInt() else 0
          if (gray > 127) foreground++
          pixels[i] = Color.rgb(gray, gray, gray)
        }
        check(foreground > 8) { "피사체를 찾지 못했어요. 피사체 안쪽을 길게 눌러 주세요." }
        smallMask = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
        fullMask = Bitmap.createScaledBitmap(smallMask, bounds.outWidth, bounds.outHeight, true)
        val bytes = ByteArrayOutputStream()
        check(fullMask.compress(Bitmap.CompressFormat.PNG, 100, bytes)) { "누끼 마스크 저장에 실패했어요." }
        Log.i("SubjectLiftCpu", "CPU segmentation complete ${SystemClock.elapsedRealtime() - started}ms foreground=$foreground")
        mapOf("mask" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), "width" to bounds.outWidth, "height" to bounds.outHeight, "provider" to "android-mediapipe-cpu")
      } catch (error: Throwable) {
        Log.e("SubjectLiftCpu", "CPU segmentation failed", error)
        throw error
      } finally {
        runCatching { output?.close() }
        runCatching { segmenter?.close() }
        runCatching { image?.close() }
        if (fullMask !== smallMask) fullMask?.recycle()
        smallMask?.recycle()
        if (input !== original) input?.recycle()
        original?.recycle()
        busy.set(false)
      }
    }
  }
}
