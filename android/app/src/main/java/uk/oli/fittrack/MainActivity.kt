package uk.oli.fittrack

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import uk.oli.fittrack.ui.AppRoot
import uk.oli.fittrack.ui.theme.FitTrackTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            FitTrackTheme {
                AppRoot()
            }
        }
    }
}
