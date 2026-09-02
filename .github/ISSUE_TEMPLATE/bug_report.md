---
name: "Bug Report"
description: "Report a bug or unexpected behavior in the app"
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting. A clear, reproducible bug report helps us fix it faster.
  - type: textarea
    id: description
    attributes:
      label: "Description"
      description: "Describe the bug clearly and objectively."
      placeholder: "e.g. Opening the theme picker freezes the app for several seconds."
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: "Steps to reproduce"
      description: "Step-by-step instructions to trigger the bug."
      placeholder: |-
        1. Go to Settings → Background
        2. Select a theme image
        3. The app becomes unresponsive
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: "Expected behavior"
      description: "What did you expect to happen?"
    validations:
      required: true
  - type: textarea
    id: actual
    attributes:
      label: "Actual behavior"
      description: "What actually happened instead?"
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: "App version"
      description: "Version shown in the app (e.g. 0.4.0)."
    validations:
      required: true
  - type: dropdown
    id: platform
    attributes:
      label: "Platform"
      options:
        - Windows
        - macOS
        - Linux
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: "Logs / console output"
      description: "Paste any relevant terminal or console output."
      render: shell
    validations:
      required: false
  - type: textarea
    id: context
    attributes:
      label: "Additional context"
      description: "Screenshots, recordings, or anything else that helps."
    validations:
      required: false