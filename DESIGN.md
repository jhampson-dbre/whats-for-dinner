---
name: "What's for Dinner? — Neighborhood Notice prototype"
description: "The implemented Community noticeboard visual system for the design prototype; production UI approval is pending."
colors:
  cobalt: "#1c4595"
  cobalt-deep: "#123572"
  periwinkle: "#eaedf8"
  yellow: "#f1c75b"
  paper: "#ffffff"
  ground: "#f3f5fc"
  ink: "#182238"
  secondary: "#47536e"
  line: "#cbd3e6"
  success: "#245f48"
  success-ground: "#e5f1e9"
  warning: "#70500c"
  warning-ground: "#fff2ca"
  error: "#963b37"
  error-ground: "#fae8e5"
typography:
  display:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "clamp(1.9rem, 3.6vw, 2.65rem)"
    fontWeight: 750
    lineHeight: 1.18
    letterSpacing: "-.035em"
  headline:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 720
    lineHeight: 1.18
    letterSpacing: "-.018em"
  title:
    fontFamily: "Public Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.18
  body:
    fontFamily: "Public Sans, sans-serif"
    lineHeight: 1.5
  label:
    fontFamily: "Public Sans, sans-serif"
    fontSize: ".875rem"
    fontWeight: 600
    lineHeight: 1.5
  action:
    fontFamily: "Public Sans, sans-serif"
    fontWeight: 650
    lineHeight: 1.25
rounded:
  surface: "12px"
  control: "6px"
  badge: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-deep}"
  button-yellow:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.periwinkle}"
  button-text:
    textColor: "{colors.cobalt}"
    typography: "{typography.action}"
    padding: "8px 0"
  button-icon:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px"
    width: "44px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    width: "100%"
  navigation:
    textColor: "#eef2ff"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  navigation-current:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
  badge:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.ink}"
    rounded: "{rounded.badge}"
    padding: "3px 8px"
  surface:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
    padding: "24px"
---

# Design System: What's for Dinner? — Neighborhood Notice prototype

## Overview

**Creative North Star: "Neighborhood Notice"**

Neighborhood Notice makes a household week feel like a clear, shared noticeboard. Cobalt frames the work, pale periwinkle gathers related information, and ink carries the content. Paper surfaces and fine dividers give dated rows room to breathe without lifting each dinner into a separate card.

The interface is practical and visibly labeled. One self-hosted typeface supplies compact metadata, confident headings, and plain action text. Selection, readiness, warnings, and failures use color together with words; controls retain their native semantics and visible keyboard focus.

This record describes the clickable design prototype in `docs/prototypes/production-ui/`, including its phone and desktop presentation. The user selected Community noticeboard / Neighborhood Notice (direction seed `e7bf206d`). Prototype approval remains pending, and this file does not authorize production UI implementation. The task map and first-surface composition remain in the surface brief.

**Key Characteristics:**

- Cobalt navigation and yellow selected destinations.
- Flat paper groups with periwinkle headings and dated rows.
- Public Sans throughout, with visible labels and restrained metadata.
- Explicit state text, native controls, and a brief state-color settle.

## Colors

The palette combines a strong civic blue, pale work surfaces, warm selection, and calm semantic state pairs. The frontmatter is the color source of truth.

### Primary

- **Noticeboard Cobalt:** the navigation shell, primary buttons, links, focused controls, and recurring line icons.
- **Deep Cobalt:** hover on primary actions and unselected navigation; the transient status toast.

### Secondary

- **Pale Periwinkle:** board headings, neutral badges, capacity labels, loading placeholders, and pending-save surfaces.

### Tertiary

- **Selected Yellow:** the current navigation destination, the confirmed-week shopping action, text selection, and the beginning of the saved-state settle.

### Neutral

- **Paper:** controls and grouped content surfaces.
- **Cool Ground:** the page canvas and inline edit area.
- **Ink:** primary content and text on yellow.
- **Secondary Ink:** explanatory copy and metadata.
- **Divider Line:** internal row boundaries and quiet control outlines.

### Status pairs

- **Readiness Green / Readiness Ground:** saved status, confirmed compatibility, and usable leftover coverage.
- **Caution Ochre / Caution Ground:** review requirements, consequential change notices, and conflicts.
- **Failure Red / Failure Ground:** failed-save and access-error information.

**The Selected Destination Rule.** The current task destination uses yellow with ink text and an explicit current-page attribute. Cobalt identifies primary actions and navigation context.

## Typography

**Display and Body Font:** Public Sans, with a sans-serif fallback. The variable font is served from the prototype's local `assets/PublicSans.ttf` and uses swap loading.

**Character:** Direct, compact, and readable. The same face keeps task labels, household records, and actions familiar while weight and whitespace establish priority.

### Hierarchy

- **Display:** page headings; fluid size, strong weight, and tight tracking.
- **Headline:** section and group headings; smaller and slightly less tight than display.
- **Title:** entry and subsection headings. Meal titles use a slightly more open line-height (1.35) than general third-level headings.
- **Body:** the inherited browser text size with the recorded body line-height. Paragraphs are limited to a readable measure (70ch).
- **Label:** field labels and supporting UI labels.
- **Action:** button text. Navigation labels use a medium weight (600); metadata commonly uses the small text size (.875rem).
- **Dated metadata:** uppercase weekday labels with tabular date numerals; this is a date column within a record, not a separate promotional heading.

The current dinner heading uses a contextual size (1.8rem desktop, 1.5rem phone). Phone row metadata remains readable (.875rem) rather than shrinking with the compact date and action columns.

**The One Typeface Rule.** Public Sans carries headings, body copy, controls, and labels. Hierarchy comes from size, weight, spacing, and placement.

## Layout

The app frame uses a cobalt rail beside a centered work area. The full desktop rail is fixed in grid width (236px), while the main work area has a maximum width (1220px). Planning, shopping, and Today share a main-content and readiness arrangement; the readiness column is compact (268px) and the columns are separated by a clear gap (28px).

At the medium breakpoint (1180px), the rail narrows (212px) and readiness moves below the main content. At the phone breakpoint (760px), the rail becomes a compact brand header and the same five task destinations become a persistent bottom navigation. Work content uses phone gutters (20px) and enough bottom padding (170px) for the navigation and action dock. The Plan and Shop dock keeps the next action above navigation and includes safe-area spacing.

Related entries live inside paper groups. Dated dinner rows have a date column, flexible content, and a text action; their spacing tightens on phone while notes wrap. Household and recipe-detail columns become one stack. The spacing scale supplies small label gaps, comfortable control groups, surface padding, and large separation between sections; observed intermediate values serve specific rows and headings rather than adding a second spacing scale.

**The Grouped Rows Rule.** Related dinners, groceries, recipes, and household records share a group; dividers organize entries inside it.

## Elevation & Depth

The system uses tonal grouping and divider lines instead of card shadows. Paper sits on Cool Ground; Pale Periwinkle marks group headings and low-intensity state surfaces. The native confirmation dialog is the sole raised layer, with an ambient ink shadow and an ink-tinted backdrop. Its exact shadow and backdrop values are recorded in the sidecar.

**The Resting Surface Rule.** Work areas remain flat at rest. The confirmation dialog alone uses an elevation shadow and a dimmed backdrop.

## Shapes

Group surfaces and the confirmation dialog use the surface corner token. Buttons, fields, recipe marks, and inline editing use the tighter control token. Small capacity labels and badges use the compact badge token. Fine borders divide rows and outline secondary controls; grocery group headings use a stronger cobalt underline (2px).

Icons are inline, unfilled SVG line drawings with rounded strokes (1.8px). They support a visible label or an explicit accessible name.

## Components

### Buttons

Confident rectangular controls with modest corners. Primary uses cobalt with paper text; the yellow variant identifies the next shopping action; secondary uses paper and a quiet border. Primary hover deepens the blue, yellow hover warms to its observed darker fill, and secondary hover uses periwinkle with a cobalt border. Text actions underline on hover.

Regular controls have a minimum height (44px). Disabled buttons retain their label, use reduced opacity (.55), and expose the native disabled state. Row text actions use a compact height (40px). Keyboard focus is a visible outline (3px with 4px offset), cobalt by default and yellow on primary buttons or the cobalt navigation rail.

### Chips

Capacity and compatibility badges are compact, noninteractive text labels. Periwinkle is neutral; green and ochre variants pair state text with their corresponding ground. They do not acquire button behavior or hover treatments.

### Cards / Containers

Paper containers group a set of rows or a related form. The week board has a periwinkle header, dated entries, and internal dividers; it does not give each dinner its own elevated container. General surfaces use the recorded surface padding, tightened on phone (20px).

### Inputs / Fields

Visible labels precede native inputs, selects, and textareas. White fields use a quiet blue-gray border (#a5b2cd), recorded control corners, and cobalt caret and focus. Placeholder text is a darker muted blue-gray (#586581). Checkboxes and radio buttons remain native and use cobalt accent, with visible label text.

No separate custom validation-error or disabled-field visual variant is established by this prototype; native field behavior remains in effect.

### Navigation

Five labeled task links share the same order: Today, Plan, Shop, Recipes, Household. Desktop presents them vertically in the rail; phone pairs their small line icons with labels across the bottom bar. The current destination is yellow with ink text and `aria-current="page"`. Unselected hover deepens the cobalt and keyboard focus uses yellow.

### State feedback

Saved, pending, and failed messages occupy the same status position below the heading. Conflict and consequential change warnings use labeled alert surfaces. Loading uses static periwinkle placeholders. The brief saved-state animation changes yellow to the success ground with the recorded duration (140ms) and easing; reduced-motion preference disables animation and transitions.

**The State With Words Rule.** A state color always accompanies a readable status, label, or action. Saved and pending updates use status regions; failed saves use an alert.

### Dated rows and grocery rows

The date column anchors a dinner's label, practical effort or leftover note, capacity badge, and change/history action. A grocery row pairs a native checkbox with the ingredient name, meal provenance, and unavailable-item action. Checked groceries gain a strike-through and muted name as well as the checked control. These are recurring record patterns, not separate decorative tiles.

## Do's and Don'ts

### Do:

- **Do** keep Public Sans self-hosted and use the recorded hierarchy.
- **Do** organize recurring records as labeled groups and readable rows.
- **Do** preserve native button, link, field, checkbox, radio, disclosure, and dialog semantics.
- **Do** retain visible focus and readable labels in phone and desktop presentations.

### Don't:

- **Don't** rely on color alone to communicate save, warning, compatibility, or error states.
- **Don't** replace the prototype's visible task labels with standalone icons.
