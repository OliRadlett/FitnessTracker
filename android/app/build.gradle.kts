plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Secrets and endpoints come from local.properties (gitignored) or -P flags,
// never from the committed build file. Parsed by hand: `java.util` resolves to
// the Gradle `java` extension inside a .kts script.
val localProps: Map<String, String> = rootProject.file("local.properties").let { file ->
    if (!file.exists()) {
        emptyMap()
    } else {
        file.readLines()
            .filter { it.contains("=") && !it.trimStart().startsWith("#") }
            .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim() }
    }
}
val googleWebClientId: String =
    (findProperty("googleWebClientId") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps["googleWebClientId"]?.takeIf { it.isNotBlank() }
        // FitTrack's Web application client in fitness-tracker-505713. A client
        // id is public (it appears in the browser's authorize URL), never a
        // secret — committing it keeps `assembleDebug` working on any machine.
        ?: "1001764393180-brsceeq11chgls2svvojdg2kl4hlibj8.apps.googleusercontent.com"
val apiBaseUrl: String =
    (findProperty("apiBaseUrl") as String?)?.takeIf { it.isNotBlank() }
        ?: localProps["apiBaseUrl"]?.takeIf { it.isNotBlank() }
        ?: "https://oliradlett.co.uk/api/v1"

android {
    namespace = "uk.oli.fittrack"
    compileSdk = 35

    defaultConfig {
        applicationId = "uk.oli.fittrack"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.2.0"

        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all {
                // Each test class gets its own JVM, and therefore its own
                // Robolectric data dir. Without this, one class's plan.json or
                // session.json is visible to the next: PlanEditorFlowTest's edit
                // to five bench sets turned up in AppFlowTest's Live screen.
                it.forkEvery = 1
                it.maxParallelForks = 1
                it.testLogging {
                    showStandardStreams = true
                    events("passed", "failed")
                }
            }
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")

    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Google Sign-In via Credential Manager, and the HTTP client behind it.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    testImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("androidx.test.ext:junit:1.2.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
