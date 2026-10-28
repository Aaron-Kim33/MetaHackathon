import ExpoModulesCore
import Vision
import CoreImage
import UIKit

public class SubjectLiftModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SubjectLift")
    Function("isSupported") { if #available(iOS 17.0, *) { return true }; return false }
    AsyncFunction("segment") { (uri: String, x: Double?, y: Double?) -> [String: Any] in
      guard #available(iOS 17.0, *) else { throw LiftError("자동 분리는 iOS 17 이상에서 사용할 수 있어요.") }
      guard let url = URL(string: uri), url.isFileURL,
            let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
            url.resolvingSymlinksInPath().path.hasPrefix(cache.resolvingSymlinksInPath().path + "/"),
            let image = CIImage(contentsOf: url) else { throw LiftError("사진 캐시를 읽지 못했어요.") }
      let handler = VNImageRequestHandler(ciImage: image, options: [:])
      let request = VNGenerateForegroundInstanceMaskRequest()
      try handler.perform([request])
      guard let observation = request.results?.first, !observation.allInstances.isEmpty else { throw LiftError("사진에서 피사체를 찾지 못했어요.") }
      var instances = observation.allInstances
      if let x = x, let y = y {
        let labels = observation.instanceMask
        CVPixelBufferLockBaseAddress(labels, .readOnly)
        let width = CVPixelBufferGetWidth(labels), height = CVPixelBufferGetHeight(labels)
        let px = min(width - 1, max(0, Int(x * Double(width))))
        let py = min(height - 1, max(0, Int(y * Double(height))))
        let rowBytes = CVPixelBufferGetBytesPerRow(labels)
        let address = CVPixelBufferGetBaseAddress(labels)!.assumingMemoryBound(to: UInt8.self)
        let instance = Int(address[py * rowBytes + px])
        CVPixelBufferUnlockBaseAddress(labels, .readOnly)
        guard instance > 0, instances.contains(instance) else { throw LiftError("누른 곳에서 피사체를 찾지 못했어요. 피사체 안쪽을 눌러 주세요.") }
        instances = IndexSet(integer: instance)
      }
      let mask = try observation.generateScaledMaskForImage(forInstances: instances, from: handler)
      let context = CIContext()
      let maskImage = CIImage(cvPixelBuffer: mask)
      guard let cgImage = context.createCGImage(maskImage, from: image.extent),
            let png = UIImage(cgImage: cgImage).pngData() else { throw LiftError("누끼 마스크를 만들지 못했어요.") }
      return ["mask": png.base64EncodedString(), "width": cgImage.width, "height": cgImage.height, "provider": "apple-vision"]
    }
  }
}
private struct LiftError: Error, LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}
