Pod::Spec.new do |s|
  s.name = 'SubjectLift'
  s.version = '0.1.0'
  s.summary = 'On-device foreground masks for the Pop Out editor'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Pop Out'
  s.homepage = 'https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details'
  s.source = { :git => '' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.frameworks = 'Vision', 'CoreImage', 'UIKit'
  s.source_files = '**/*.{h,m,mm,swift}'
end
