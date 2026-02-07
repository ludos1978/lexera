#!/usr/bin/env python3
"""
Tag Migration Script for Markdown Kanban

Migrates old tag formats to the new tag system:

OLD SYSTEM:
- # for tags
- @ for people AND dates (@john, @2025-03-27)
- ! for temporal (!W12, !10:30, !monday)

NEW SYSTEM:
- # for tags AND people (people are just tags)
- @ for ALL temporal (dates, times, weeks, weekdays)
- ! is no longer used for tags

Usage:
    python migrate_tags.py <file_or_directory> [--dry-run] [--verbose]

Examples:
    python migrate_tags.py myboard.md --dry-run
    python migrate_tags.py ./kanbans/ --verbose
    python migrate_tags.py . --dry-run
"""

import re
import sys
import os
import argparse
from pathlib import Path
from typing import List, Tuple, Set

# Patterns for temporal detection (to distinguish @date from @person)
TEMPORAL_PATTERNS = [
    # Dates: YYYY-MM-DD, DD-MM-YYYY, YYYY.MM.DD, DD.MM.YYYY, etc.
    r'\d{4}[-./]\d{1,2}[-./]\d{1,2}',  # YYYY-MM-DD
    r'\d{1,2}[-./]\d{1,2}[-./]\d{2,4}',  # DD-MM-YYYY or DD-MM-YY
    r'\d{1,2}[-./]\d{1,2}',  # DD.MM (day-month only)
    # Weeks: W12, KW12, 2025W12, 2025-W12
    r'\d{4}[-.]?[wWkK][wW]?\d{1,2}',  # 2025W12, 2025-W12
    r'[wWkK][wW]?\d{1,2}',  # W12, KW12
    # Times: 10:30, 9am, 10pm
    r'\d{1,2}:\d{2}(?:am|pm)?',  # 10:30, 10:30am
    r'\d{1,2}(?:am|pm)',  # 9am, 10pm
    # Time slots: 9:00-17:00, 9am-5pm
    r'\d{1,2}(?::\d{2})?(?:am|pm)?-\d{1,2}(?::\d{2})?(?:am|pm)?',
    # Weekdays
    r'(?:mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)',
    # Year tags: Y2026, J2026
    r'[YyJj]\d{4}',
]

# Combined regex to detect if something after @ is temporal
TEMPORAL_REGEX = re.compile(
    r'^(' + '|'.join(TEMPORAL_PATTERNS) + r')(?:\s|$)',
    re.IGNORECASE
)


def is_temporal_value(value: str) -> bool:
    """Check if a value (after prefix) looks like a temporal tag."""
    return bool(TEMPORAL_REGEX.match(value))


def migrate_line(line: str, verbose: bool = False) -> Tuple[str, List[str]]:
    """
    Migrate a single line from old tag format to new format.
    Returns (migrated_line, list_of_changes).
    """
    changes = []
    result = line

    # 1. Convert !temporal to @temporal
    # Match ! followed by temporal patterns
    def replace_exclaim_temporal(match):
        full = match.group(0)
        value = match.group(1)
        new_tag = '@' + value
        changes.append(f"!{value} -> @{value}")
        return new_tag + match.group(2)  # Include trailing space/end

    # Pattern: ! followed by temporal value, then space or end of string
    temporal_pattern = r'!(' + '|'.join(TEMPORAL_PATTERNS) + r')(\s|$)'
    result = re.sub(temporal_pattern, replace_exclaim_temporal, result, flags=re.IGNORECASE)

    # 2. Convert @person to #person (but NOT @temporal)
    # We need to handle multiple @ tags on the same line, so we use finditer
    # and build the result string piece by piece
    at_pattern = r'(^|\s)@([^\s@]+)'

    # Find all matches first
    matches = list(re.finditer(at_pattern, result))

    if matches:
        # Process in reverse order to preserve positions
        new_result = result
        for match in reversed(matches):
            prefix_space = match.group(1)
            value = match.group(2)

            if is_temporal_value(value):
                # Keep as @ (it's temporal)
                continue
            else:
                # Convert to # (it's a person/tag)
                changes.append(f"@{value} -> #{value}")
                start = match.start()
                end = match.end()
                new_result = new_result[:start] + prefix_space + '#' + value + new_result[end:]

        result = new_result

    return result, changes


def migrate_content(content: str, verbose: bool = False) -> Tuple[str, List[str]]:
    """Migrate all content, return (new_content, all_changes)."""
    lines = content.split('\n')
    all_changes = []
    new_lines = []

    for i, line in enumerate(lines):
        new_line, changes = migrate_line(line, verbose)
        new_lines.append(new_line)
        for change in changes:
            all_changes.append(f"Line {i+1}: {change}")

    return '\n'.join(new_lines), all_changes


def process_file(filepath: Path, dry_run: bool = False, verbose: bool = False) -> Tuple[bool, List[str]]:
    """
    Process a single file.
    Returns (was_modified, list_of_changes).
    """
    try:
        content = filepath.read_text(encoding='utf-8')
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return False, []

    new_content, changes = migrate_content(content, verbose)

    if not changes:
        return False, []

    if not dry_run:
        try:
            filepath.write_text(new_content, encoding='utf-8')
        except Exception as e:
            print(f"Error writing {filepath}: {e}")
            return False, changes

    return True, changes


def find_markdown_files(path: Path) -> List[Path]:
    """Find all markdown files in a directory."""
    if path.is_file():
        if path.suffix.lower() == '.md':
            return [path]
        return []

    files = []
    for ext in ['*.md', '*.MD']:
        files.extend(path.rglob(ext))
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(
        description='Migrate old tag formats to new tag system',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s myboard.md --dry-run     # Preview changes for one file
  %(prog)s ./boards/ --verbose      # Migrate all .md files in directory
  %(prog)s . --dry-run              # Preview changes for all .md files

Tag Migration:
  OLD             NEW
  !W12         -> @W12        (week)
  !KW12        -> @KW12       (German week)
  !2025-03-27  -> @2025-03-27 (date)
  !10:30       -> @10:30      (time)
  !9am-5pm     -> @9am-5pm    (time slot)
  !monday      -> @monday     (weekday)
  @john        -> #john       (person -> tag)
  @team-alpha  -> #team-alpha (person -> tag)
  @2025-03-27  -> @2025-03-27 (date - unchanged)
"""
    )
    parser.add_argument('path', type=str, help='File or directory to process')
    parser.add_argument('--dry-run', '-n', action='store_true',
                        help='Show what would be changed without modifying files')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='Show detailed changes')

    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"Error: Path does not exist: {path}")
        sys.exit(1)

    files = find_markdown_files(path)
    if not files:
        print(f"No markdown files found in: {path}")
        sys.exit(0)

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Processing {len(files)} file(s)...\n")

    total_changes = 0
    files_modified = 0

    for filepath in files:
        modified, changes = process_file(filepath, args.dry_run, args.verbose)

        if changes:
            files_modified += 1
            total_changes += len(changes)

            print(f"{'Would modify' if args.dry_run else 'Modified'}: {filepath}")
            if args.verbose:
                for change in changes:
                    print(f"  {change}")
            else:
                print(f"  {len(changes)} change(s)")
            print()

    # Summary
    print("-" * 50)
    if args.dry_run:
        print(f"DRY RUN: Would modify {files_modified} file(s) with {total_changes} change(s)")
    else:
        print(f"Modified {files_modified} file(s) with {total_changes} change(s)")

    if files_modified > 0 and args.dry_run:
        print("\nRun without --dry-run to apply changes.")


if __name__ == '__main__':
    main()
