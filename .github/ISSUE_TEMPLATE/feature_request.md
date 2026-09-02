---
name: "Feature Request"
description: "Propose a new feature or significant enhancement"
title: "[Feature]: "
labels: ["feature"]
body:
  - type: markdown
    attributes:
      value: |
        A new feature or significant enhancement. Please describe it in enough detail for the team to evaluate.
  - type: textarea
    id: summary
    attributes:
      label: "Description"
      description: "Describe the feature clearly and objectively."
      placeholder: "e.g. Add support for custom module API keys."
    validations:
      required: true
  - type: textarea
    id: motivation
    attributes:
      label: "Why?"
      description: "What problem does this solve? Who benefits?"
    validations:
      required: true
  - type: textarea
    id: proposed
    attributes:
      label: "Proposed approach"
      description: "High-level idea of how it could be implemented (optional)."
    validations:
      required: false
  - type: textarea
    id: impact
    attributes:
      label: "UX / API impact"
      description: "Any changes to user flow, contracts, or existing behavior."
    validations:
      required: false
  - type: textarea
    id: context
    attributes:
      label: "Additional context"
      description: "Screenshots, mockups, references, or links."
    validations:
      required: false