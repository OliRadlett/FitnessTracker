import re

with open('.opencode/skills/finalise/SKILL.md', 'r', encoding='utf-8') as f:
    content = f.read()

# The file has duplicated "Write a concise commit message" + Phase 4 sections.
# Find the pattern: Phase 4 ends with "The PR lands on main...", then the same
# content repeats before Phase 5.
#
# Strategy: find "## Phase 5" and work backwards. The duplicate is between
# the first "The PR lands on" and the second "## Phase 5".

# Split into lines for analysis
lines = content.split('\n')

# Find all occurrences of key markers
phase4_starts = [i for i, l in enumerate(lines) if l.startswith('## Phase 4')]
phase4_5_boundary = [i for i, l in enumerate(lines) if l.startswith('## Phase 5')]
commit_msg_lines = [i for i, l in enumerate(lines) if 'Write a concise commit message' in l]

print(f"Phase 4 starts at lines: {phase4_starts}")
print(f"Phase 5 starts at lines: {phase4_5_boundary}")
print(f"Commit message lines at: {commit_msg_lines}")
print(f"Total lines: {len(lines)}")

# If there are 2 Phase 4 starts and 1 Phase 5 start, we have duplication
if len(phase4_starts) == 2 and len(phase4_5_boundary) == 1:
    # Remove lines from the first duplicate start to just before Phase 5
    # The first occurrence of the commit message is correct (in Phase 3),
    # but the second commit message + Phase 4 is the duplicate
    second_phase4 = phase4_starts[1]
    second_commit_msg = commit_msg_lines[1] if len(commit_msg_lines) > 1 else None

    if second_commit_msg:
        # Remove from the second "Write a concise commit message" through the second Phase 4
        # But we need to keep the content before it (the first Phase 4 ends at "The PR lands on main")
        # and the blank line(s) before the duplicate commit message
        # Find the blank line before the second commit message
        cut_start = second_commit_msg
        while cut_start > 0 and lines[cut_start - 1].strip() == '':
            cut_start -= 1

        # Cut from cut_start to second_phase4 (exclusive - keep the ## Phase 5)
        removed = lines[cut_start:second_phase4]
        lines = lines[:cut_start] + lines[second_phase4:]

    content = '\n'.join(lines)
    with open('.opencode/skills/finalise/SKILL.md', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Duplication fixed successfully")
else:
    print("Pattern not as expected — manual review needed")
    # Print context around each occurrence
    for marker in commit_msg_lines + phase4_starts + phase4_5_boundary:
        print(f"\nAround line {marker}:")
        for i in range(max(0, marker-2), min(len(lines), marker+5)):
            print(f"  {i}: {lines[i][:80]}")
