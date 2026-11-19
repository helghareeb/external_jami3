import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
  keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
  namespace = "dev.hadith.app"
  compileSdk = 36
  buildToolsVersion = "36.1.0"

  defaultConfig {
    applicationId = "dev.hadith.app"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "1.0.0"
  }

  signingConfigs {
    if (keystorePropertiesFile.exists()) {
      create("release") {
        storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
        storePassword = keystoreProperties.getProperty("storePassword")
        keyAlias = keystoreProperties.getProperty("keyAlias")
        keyPassword = keystoreProperties.getProperty("keyPassword")
      }
    }
  }

  buildTypes {
    debug {
      applicationIdSuffix = ""
      isDebuggable = true
    }
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro"
      )
      if (keystorePropertiesFile.exists()) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
    viewBinding = true
    aidl = false
    shaders = false
  }

  packaging {
    resources {
      excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
  }

  lint {
    abortOnError = true
    checkReleaseBuilds = false
  }
}

kotlin {
  jvmToolchain(17)
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.activity.ktx)
  implementation(libs.androidx.appcompat)
  implementation(libs.material)
  implementation(libs.androidx.swiperefreshlayout)
  implementation(libs.androidx.core.splashscreen)
  implementation(libs.androidx.browser)
  implementation(libs.androidx.webkit)

  testImplementation(libs.junit)
}
