package expo.modules.subjectlift

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executor

class SubjectLiftModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SubjectLift")
    Function("isSupported") { true }
    AsyncFunction("segment") { uri: String, x: Double?, y: Double?, promise: Promise ->
      // The JS bridge writes the server-normalized, upright PNG to the app cache.
      val file = File(Uri.parse(uri).path ?: "")
      val cache = appContext.reactContext?.cacheDir
      if (cache == null || !file.canonicalPath.startsWith(cache.canonicalPath + File.separator)) {
        promise.reject("INVALID_IMAGE", "사진 캐시를 읽지 못했어요.", null)
        return@AsyncFunction
      }
      val bitmap = BitmapFactory.decodeFile(file.path)
      if (bitmap == null) {
        promise.reject("INVALID_IMAGE", "사진을 읽지 못했어요.", null)
        return@AsyncFunction
      }
      val subjectOptions = SubjectSegmenterOptions.SubjectResultOptions.Builder().enableConfidenceMask().build()
      val options = SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().enableMultipleSubjects(subjectOptions).build()
      val segmenter = SubjectSegmentation.getClient(options)
      segmenter.process(InputImage.fromBitmap(bitmap, 0)).addOnSuccessListener(Executor { job -> Thread(job, "SubjectLiftResult").start() }) { result ->
        try {
          val width = bitmap.width
          val height = bitmap.height
          val pixels = IntArray(width * height) { android.graphics.Color.BLACK }
          if (x != null && y != null) {
            val px = (x * width).toInt().coerceIn(0, width - 1)
            val py = (y * height).toInt().coerceIn(0, height - 1)
            val selected = result.subjects.filter { subject ->
              px >= subject.startX && px < subject.startX + subject.width && py >= subject.startY && py < subject.startY + subject.height
            }.maxByOrNull { subject -> subject.confidenceMask!!.get((py - subject.startY) * subject.width + px - subject.startX) }
            if (selected == null || selected.confidenceMask!!.get((py - selected.startY) * selected.width + px - selected.startX) < 0.25f) {
              throw IllegalStateException("누른 곳에서 피사체를 찾지 못했어요. 피사체 안쪽을 눌러 주세요.")
            }
            val mask = selected.confidenceMask!!
            for (sy in 0 until selected.height) for (sx in 0 until selected.width) {
              val dx = selected.startX + sx
              val dy = selected.startY + sy
              if (dx in 0 until width && dy in 0 until height) {
                val gray = (mask.get(sy * selected.width + sx).coerceIn(0f, 1f) * 255).toInt()
                pixels[dy * width + dx] = android.graphics.Color.rgb(gray, gray, gray)
              }
            }
          } else {
            val mask = result.foregroundConfidenceMask ?: throw IllegalStateException("분리 모델을 준비하지 못했어요.")
            if (mask.capacity() != pixels.size) throw IllegalStateException("분리 결과 크기가 사진과 달라요.")
            for (i in pixels.indices) {
              val gray = (mask.get(i).coerceIn(0f, 1f) * 255).toInt()
              pixels[i] = android.graphics.Color.rgb(gray, gray, gray)
            }
          }
          val output = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
          val bytes = ByteArrayOutputStream()
          output.compress(Bitmap.CompressFormat.PNG, 100, bytes)
          output.recycle()
          promise.resolve(mapOf("mask" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), "width" to width, "height" to height, "provider" to "android-mlkit"))
        } catch (error: Exception) {
          promise.reject("NO_SUBJECT", error.message ?: "피사체를 찾지 못했어요.", error)
        } finally { segmenter.close(); bitmap.recycle() }
      }.addOnFailureListener { error ->
        segmenter.close(); bitmap.recycle()
        promise.reject("MODEL_NOT_READY", "자동 분리 모델이 아직 준비되지 않았어요. 인터넷 연결 후 잠시 뒤 다시 시도해 주세요. (${error.message})", error)
      }
    }
  }
}
