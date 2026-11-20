# Contributing to StudyNotes

You can give Claude Code one prompt to take a small public task, make the
change and test it. Use a Claude Code session that can run Git and access
the public repository. Code tasks also need the project's Node.js tools.

## Copy this prompt

~~~text
Contribute one small task to StudyNotes. Use a fresh checkout of
https://github.com/vlmelnik/studynotes.git. If this is a fresh checkout of
the upstream repo or your fork already, reuse it and fetch upstream main.
Read CLAUDE.md, AGENTS.md, TASKS.md and .claude/skills/contribute/SKILL.md.
Pick the first available task in TASKS.md unless I name one. Follow the
skill to make the scoped change, run the relevant checks and commit it.
Use an existing GitHub connection to open a draft PR from an authorized
branch or your fork. Otherwise save a Git patch I can hand to a maintainer.
Work on one task only. Report the task ID, checks and PR link or patch
location. Use the environment's normal tool permissions.
~~~

An existing GitHub login in Claude Code or GitHub CLI lets Claude publish
the draft PR. A contributor can use their own fork with ordinary GitHub
permissions. The maintainer does not need to grant write access to
StudyNotes. A contributor without a GitHub account can clone, work, test and
export a patch. A maintainer with access must receive the patch to publish it.

For Claude Code cloud sessions, use the GitHub connection already available
to that session. Anthropic documents how to reuse an existing GitHub CLI
login through /web-setup. [Claude Code cloud authentication](https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options)

## Maintainer review

The [public task queue](TASKS.md) lists safe, scoped work. Keep private
planning in dev-notes. Add a stable task ID, exact file scope, acceptance
criteria and verification for each public task. Remove a task or mark it
done after merging its PR.

Use the existing Linux and Windows CI jobs for incoming pull requests.
Protect main in GitHub once you are ready to enforce the policy. Require a
pull request, approving review, current branch and passing Linux and Windows
checks. Dismiss stale approvals and leave auto-merge disabled. For a fork
that requires workflow approval, inspect the proposed diff before starting
CI. Mark a draft ready only after reviewing its scope and test report.
[GitHub branch rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

For a patch sent outside GitHub, inspect it before applying to a fresh
branch: run git apply --stat and git apply --check, then import with git am.
Open the usual PR so the patch is reviewed and tested the same way.
