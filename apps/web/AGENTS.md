# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Authentication and empty-state decisions:

- Never add a demo-login endpoint, demo credentials, or a “查看演示” shortcut.
- Public registration must require the owner-issued one-time invitation code; the UI must not suggest that users can create additional spaces.
- Empty timelines and albums must stay empty until the couple adds content. Decorative landing-page imagery is allowed, but it must never be inserted as user data.
