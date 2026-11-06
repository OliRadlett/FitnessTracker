package uk.oli.fittrack.ui.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.Notification
import uk.oli.fittrack.domain.orderNotifications
import uk.oli.fittrack.domain.unreadLabel
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * Notifications, newest unread first.
 *
 * The website's page adds type filters and a preferences grid; on a phone the
 * only two actions are "read this" and "read everything", so those are the ones
 * that exist.
 */
@Composable
fun NotificationsScreen(
    items: List<Notification>?,
    onRead: (String) -> Unit,
    onReadAll: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    val shown = orderNotifications(items.orEmpty())

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .statusBarsPadding()
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(12.dp))
            Text(
                "‹ Back",
                fontSize = 14.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onBack() }
                    .padding(vertical = 6.dp)
            )
            Spacer(Modifier.height(6.dp))
            Label("NOTIFICATIONS")
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "Notifications.",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Fg,
                    modifier = Modifier.weight(1f)
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(unreadLabel(items.orEmpty()), fontSize = 13.sp, color = Tokens.Muted)
            Spacer(Modifier.height(12.dp))

            if (items.orEmpty().isNotEmpty()) {
                Row {
                    Action(if (shown.none { !it.read }) "Refresh" else "Mark all read") {
                        if (shown.none { !it.read }) onRefresh() else onReadAll()
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            when {
                items == null -> Text("Loading…", fontSize = 14.sp, color = Tokens.Muted)
                shown.isEmpty() -> {
                    Text("Nothing to tell you.", fontSize = 15.sp, color = Tokens.Fg)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Health alerts, records, goal milestones and plan reminders land here.",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
                else -> shown.forEach { notification ->
                    NotificationRow(notification) { onRead(notification.id) }
                    Spacer(Modifier.height(10.dp))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun NotificationRow(notification: Notification, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (notification.read) Tokens.Bg else Tokens.Surface)
            .clickable { onClick() }
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (!notification.read) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(16.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Tokens.Accent)
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                notification.typeLabel,
                fontSize = 10.sp,
                letterSpacing = 0.6.sp,
                fontWeight = FontWeight.Medium,
                color = if (notification.isUrgent) Tokens.Accent else Tokens.Muted,
                modifier = Modifier.weight(1f)
            )
            Text(notification.age(), fontSize = 11.sp, color = Tokens.Muted)
        }
        Spacer(Modifier.height(6.dp))
        Text(
            notification.title,
            fontSize = 15.sp,
            fontWeight = if (notification.read) FontWeight.Normal else FontWeight.Medium,
            color = if (notification.read) Tokens.Muted else Tokens.Fg
        )
        if (notification.body.isNotBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(notification.body, fontSize = 12.sp, color = Tokens.Muted)
        }
    }
}

@Composable
private fun Action(label: String, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        color = Tokens.Accent,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 7.dp)
    )
}
