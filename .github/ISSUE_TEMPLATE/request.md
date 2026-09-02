---
name: "Request"
description: "Suggest a small change, improvement, or adjustment to the app"
title: "[Request]: "
labels: ["request"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to share your idea. Please fill out the details below so we can understand the request.
  - type: textarea
    id: summary
    attributes:
      label: "Summary"
      description: "Describe clearly and objectively what you'd like to see changed."
      placeholder: "e.g. Allow the media window to keep its aspect ratio when resizing."
    validations:
      required: true
  - type: textarea
    id: motivation
    attributes:
      label: "Why?"
      description: "What problem does this solve or what pain point does it address?"
      placeholder: "e.g. Currently the image is cropped when the window is resized."
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: "Expected behavior"
      description: "How should it behave after the change?"
    validations:
      required: false
  - type: textarea
    id: context
    attributes:
      label: "Additional context"
      description: "Screenshots, mockups, or any extra information that helps."
    validations:
      required: false