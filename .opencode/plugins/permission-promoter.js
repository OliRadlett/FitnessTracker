import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

/**
 * Permission Promoter Plugin
 *
 * Auto-adds "Always" approved bash commands to opencode.json
 * so they persist across sessions.
 */
export const PermissionPromoter = async ({ directory }) => {
  const configPath = join(directory, "opencode.json")

  return {
    "permission.replied": async (input, output) => {
      // Only process "always" replies for bash commands
      if (output.decision !== "always") return
      if (input.tool !== "bash") return

      const command = input.args?.command
      if (!command) return

      // Extract base command pattern (first word + wildcard)
      const baseCommand = command.trim().split(/\s+/)[0]
      const pattern = baseCommand + " *"

      try {
        // Read current config
        const raw = readFileSync(configPath, "utf8")
        const config = JSON.parse(raw)

        // Check if pattern already exists
        if (config.permission?.bash?.[pattern]) return

        // Ensure structure exists
        config.permission = config.permission || {}
        config.permission.bash = config.permission.bash || {}

        // Insert before the catch-all "*"
        const catchAll = config.permission.bash["*"]
        const entries = Object.entries(config.permission.bash).filter(
          ([k]) => k !== "*"
        )

        // Don't add if it would match an existing broader pattern
        const alreadyCovered = entries.some(([k]) => {
          if (k === pattern) return true
          // Check if existing pattern is a prefix of new pattern
          const existingBase = k.replace(" *", "")
          return pattern.startsWith(existingBase + " ") && k !== "*"
        })

        if (alreadyCovered) return

        // Add new pattern before catch-all
        config.permission.bash = {}
        for (const [k, v] of entries) {
          config.permission.bash[k] = v
        }
        config.permission.bash[pattern] = "allow"
        if (catchAll) {
          config.permission.bash["*"] = catchAll
        }

        // Write back with consistent formatting
        writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
        console.log(`[permission-promoter] Added: ${pattern}`)
      } catch (err) {
        console.error("[permission-promoter] Error:", err.message)
      }
    },
  }
}
