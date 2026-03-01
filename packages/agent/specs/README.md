# V1 Implementation Specifications

This directory contains detailed implementation specs for the Lexera V1 (VS Code Extension) codebase.

## Purpose

- Document each feature with increasing detail
- Describe data structures, data instances, and function usages
- Describe use cases (UX requirements) first
- Provide clean structure for V2 implementation reference

## Documentation Structure

```
specs/
├── README.md                    # This file
├── INDEX.md                     # Master index of all specs
├── shared/                      # Shared components (used across features)
│   ├── types/                   # Type definitions
│   ├── parser/                  # Markdown parser
│   ├── storage/                 # File storage
│   └── events/                  # Event system
├── core/                        # Core application features
│   ├── board/                   # Board management
│   ├── column/                  # Column management
│   ├── card/                    # Card management
│   └── editor/                  # Card editing
├── ux/                          # User experience features
│   ├── navigation/              # Navigation & keyboard
│   ├── dragdrop/                # Drag & drop
│   ├── search/                  # Search functionality
│   └── export/                  # Export features
├── sync/                        # Synchronization
│   ├── caldav/                  # CalDAV sync
│   ├── webdav/                  # WebDAV sync
│   └── ical/                    # iCal export
└── plugins/                     # Plugin system
    ├── registry/                # Plugin registry
    ├── diagram/                 # Diagram plugins
    └── export/                  # Export plugins
```

## Document Template

Each feature spec follows this structure:

```markdown
# Feature Name

## UX Requirements (Use Cases)
- User can...
- When user does X, Y happens

## Data Structures
- Type definitions
- Schemas

## Data Instances
- Example data
- State examples

## Functions
- Function signatures
- Behavior descriptions

## Integration Points
- How this feature connects to others
```

## How to Use

1. Read `INDEX.md` for overview
2. Navigate to specific feature directory
3. Start with UX Requirements
4. Reference Data Structures for implementation
