extern crate napi_build;

fn main() {
  napi_build::setup();

  // On macOS, the screencapturekit crate uses Swift FFI which requires
  // the Swift runtime libraries (including libswift_Concurrency.dylib).
  // We must set rpath entries so the dynamic linker can find them at runtime.
  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    if let Ok(output) = std::process::Command::new("xcode-select")
      .arg("-p")
      .output()
    {
      if output.status.success() {
        let xcode_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Swift 5.5 back-deploy path (has libswift_Concurrency.dylib)
        println!(
          "cargo:rustc-link-arg=-Wl,-rpath,{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx",
          xcode_path
        );
        // Standard Swift runtime path
        println!(
          "cargo:rustc-link-arg=-Wl,-rpath,{}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
          xcode_path
        );
      }
    }

    // Also check CommandLineTools path as a fallback
    println!("cargo:rustc-link-arg=-Wl,-rpath,/Library/Developer/CommandLineTools/usr/lib/swift-5.5/macosx");
  }
}
