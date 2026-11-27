# Preserve Capacitor plugin annotations & reflection entrypoints under R8 minification
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep class com.getcapacitor.** { *; }
-keep class studio.omnidoc.mobile.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
